import httpx

from app.course_photo_scoring import PhotoScoringError, score_course_photo

import app.course_photo_scoring as course_photo_scoring


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _gemini_response(score: int, reasons: list[str]) -> httpx.Response:
    import json
    return httpx.Response(200, json={
        "candidates": [{
            "finishReason": "STOP",
            "content": {"parts": [{"text": json.dumps({"score": score, "reasons": reasons})}]},
        }],
    })


def test_score_course_photo_sends_references_then_candidate_and_parses_score() -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "test-key"
        assert request.url.path.endswith("/models/gemini-2.5-flash-lite:generateContent")
        import json
        captured["body"] = json.loads(request.content)
        return _gemini_response(8, ["wide fairway shot", "no people visible"])

    score = score_course_photo(
        _client(handler),
        api_key="test-key",
        model="gemini-2.5-flash-lite",
        image_data=b"candidate-bytes",
        image_content_type="image/jpeg",
        reference_images=[(b"reference-bytes", "image/jpeg")],
    )

    assert score.score == 8
    assert score.reasons == ["wide fairway shot", "no people visible"]

    parts = captured["body"]["contents"][0]["parts"]
    inline_parts = [p for p in parts if "inlineData" in p]
    assert len(inline_parts) == 2
    assert inline_parts[-1]["inlineData"]["data"] == "Y2FuZGlkYXRlLWJ5dGVz"  # base64("candidate-bytes")


def test_score_course_photo_retries_transient_transport_errors(monkeypatch) -> None:
    monkeypatch.setattr(course_photo_scoring.time, "sleep", lambda _seconds: None)
    attempts = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.")
        return _gemini_response(5, ["ok"])

    score = score_course_photo(
        _client(handler),
        api_key="test-key",
        model="gemini-flash-lite-latest",
        image_data=b"x",
        image_content_type="image/jpeg",
        reference_images=[],
    )

    assert attempts["count"] == 3
    assert score.score == 5


def test_score_course_photo_raises_on_provider_refusal() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}})

    try:
        score_course_photo(
            _client(handler),
            api_key="test-key",
            model="gemini-2.5-flash-lite",
            image_data=b"x",
            image_content_type="image/jpeg",
            reference_images=[],
        )
        assert False, "expected PhotoScoringError"
    except PhotoScoringError as error:
        assert str(error) == "provider_refusal"


def test_score_course_photos_apply_clears_unscored_hero_images(monkeypatch) -> None:
    from app.core.config import Settings
    from app.db import make_engine, make_session_factory
    from app.models import Base, Course, CourseImage
    import scripts.score_course_photos as script

    settings = Settings()
    engine = make_engine(settings.database_url, pool_size=1, max_overflow=0)
    Base.metadata.create_all(bind=engine)
    session_factory = make_session_factory(engine)

    with session_factory() as session:
        ref_course = Course(
            id=210,
            name="Reference Course",
            region="CA",
            latitude=37.0,
            longitude=-122.0,
            is_public=True,
            source="manual",
            source_course_id="ref",
            hole_count=18,
            par=72,
        )
        ref_image = CourseImage(
            course_id=210,
            external_url="https://example.com/ref.jpg",
            is_hero=True,
            position=0,
        )
        target_course = Course(
            id=999,
            name="Target Course",
            region="CA",
            latitude=37.0,
            longitude=-122.0,
            is_public=True,
            source="manual",
            source_course_id="target",
            hole_count=18,
            par=72,
        )
        session.add_all([ref_course, ref_image, target_course])
        session.flush()

        img_storage_hero = CourseImage(
            course_id=999,
            storage_key="unresolvable_key",
            external_url=None,
            is_hero=True,
            position=0,
        )
        img_candidate_1 = CourseImage(
            course_id=999,
            external_url="https://example.com/best.jpg",
            is_hero=False,
            position=1,
        )
        img_candidate_2 = CourseImage(
            course_id=999,
            external_url="https://example.com/mediocre.jpg",
            is_hero=False,
            position=2,
        )
        session.add_all([img_storage_hero, img_candidate_1, img_candidate_2])
        session.commit()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(script, "make_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr(script, "REFERENCE_COURSE_IDS", [210])
    monkeypatch.setattr(script, "REQUEST_DELAY_SECONDS", 0.0)
    monkeypatch.setattr(script, "_fetch", lambda client, url: (b"bytes", "image/jpeg"))

    def mock_score(client, *, api_key, model, image_data, image_content_type, reference_images):
        from app.course_photo_scoring import PhotoScore
        return PhotoScore(score=8, reasons=["great fairway"])

    monkeypatch.setattr(script, "score_course_photo", mock_score)
    monkeypatch.setattr(
        "sys.argv",
        ["score_course_photos.py", "--course-ids", "999", "--apply"],
    )

    exit_code = script.main()
    assert exit_code == 0

    with session_factory() as session:
        images = session.query(CourseImage).filter(CourseImage.course_id == 999).order_by(CourseImage.position).all()
        assert images[0].is_hero is False
        assert images[1].is_hero is True
        assert images[2].is_hero is False
