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
