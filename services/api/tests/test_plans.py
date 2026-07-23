from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.main import create_app
from app.models import PlanGeneration
from app.planner_narrative import (
    PlannerNarrativeOutput,
    PlannerNarrativeRequest,
    PlannerNarrativeResult,
)


ALICE = {"X-Development-Subject": "dev:plan-alice"}
BOB = {"X-Development-Subject": "dev:plan-bob"}


def _plan_payload(title: str = "Private plan") -> dict:
    return {
        "title": title,
        "start_date": "2026-08-01",
        "end_date": "2026-08-02",
        "regions": ["Monterey, CA"],
    }


class RecordingNarrativeProvider:
    def __init__(self, *, invalid_course: bool = False, timeout: bool = False) -> None:
        self.invalid_course = invalid_course
        self.timeout = timeout
        self.requests: list[PlannerNarrativeRequest] = []

    async def generate(self, request: PlannerNarrativeRequest) -> PlannerNarrativeResult:
        self.requests.append(request)
        if self.timeout:
            raise TimeoutError
        expected_count = min(
            len(request.candidates), (request.end_date - request.start_date).days + 1
        )
        selected = request.candidates[:expected_count]
        course_ids = [candidate.course_id for candidate in selected]
        if self.invalid_course:
            course_ids[0] = 999_999
        output = PlannerNarrativeOutput.model_validate({
            "summary": request.summary_options[-1],
            "ordered_course_ids": course_ids,
            "itinerary": [
                {
                    "date": request.start_date.fromordinal(
                        request.start_date.toordinal() + index
                    ),
                    "course_id": course_id,
                    "reason_indices": [0] if selected[index].reasons else [],
                }
                for index, course_id in enumerate(course_ids)
            ],
        })
        return PlannerNarrativeResult(
            output=output,
            provider="test-provider",
            model_identifier="test-model",
            input_tokens=100,
            output_tokens=40,
            estimated_cost_micros=340,
        )


def _ai_app(
    provider: RecordingNarrativeProvider,
    *,
    monthly_cost_limit_cents: int = 1000,
):
    app = create_app(Settings(
        ai_planner_enabled=True,
        gemini_api_key="test-key",
        ai_planner_monthly_cost_limit_cents=monthly_cost_limit_cents,
    ))
    app.state.planner_narrative_provider = provider
    return app


def test_plan_reads_and_mutations_are_owner_scoped() -> None:
    client = TestClient(create_app())
    created = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json=_plan_payload(),
    )
    assert created.status_code == 201
    plan_id = created.json()["id"]

    assert client.get("/api/v1/me/plans", headers=BOB).json() == []
    assert client.get(f"/api/v1/me/plans/{plan_id}", headers=BOB).status_code == 404
    assert client.put(
        f"/api/v1/me/plans/{plan_id}",
        headers=BOB,
        json=_plan_payload("Stolen plan"),
    ).status_code == 404
    assert client.post(
        f"/api/v1/me/plans/{plan_id}/save",
        headers=BOB,
    ).status_code == 404
    assert client.delete(f"/api/v1/me/plans/{plan_id}", headers=BOB).status_code == 404

    retained = client.get(f"/api/v1/me/plans/{plan_id}", headers=ALICE)
    assert retained.status_code == 200
    assert retained.json()["title"] == "Private plan"
    assert retained.json()["status"] == "draft"
    assert retained.json()["candidates"]
    assert retained.json()["itinerary"]


def test_ai_itinerary_uses_only_validated_candidates_and_persists_metadata() -> None:
    provider = RecordingNarrativeProvider()
    app = _ai_app(provider)
    client = TestClient(app)
    created = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json=_plan_payload("AI Monterey"),
    ).json()

    response = client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary",
        headers=ALICE,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["generation_status"] == "generated"
    assert body["status"] == "draft"
    assert body["fallback_reason"] is None
    assert len(provider.requests) == 1
    sent = provider.requests[0].model_dump(mode="json")
    assert "provider_subject" not in str(sent)
    assert "email" not in str(sent)
    allowed_ids = {candidate["course_id"] for candidate in sent["candidates"]}
    assert {item["course"]["id"] for item in body["itinerary"]} <= allowed_ids
    assert all(item["details"]["availability_verified"] is False for item in body["itinerary"])
    assert all(
        "availability" in " ".join(item["details"]["caveats"]).lower()
        for item in body["itinerary"]
    )

    with app.state.session_factory() as session:
        generation = session.scalar(select(PlanGeneration))
        assert generation is not None
        assert generation.status == "succeeded"
        assert generation.provider == "test-provider"
        assert generation.model_identifier == "test-model"
        assert generation.input_tokens == 100
        assert generation.output_tokens == 40
        assert generation.estimated_cost_micros == 340

    assert client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary",
        headers=BOB,
    ).status_code == 404
    assert len(provider.requests) == 1


def test_invalid_ai_output_and_timeout_fall_back_without_replacing_itinerary() -> None:
    for provider, expected_reason in (
        (RecordingNarrativeProvider(invalid_course=True), "invalid_output"),
        (RecordingNarrativeProvider(timeout=True), "timeout"),
    ):
        app = _ai_app(provider)
        client = TestClient(app)
        created = client.post(
            "/api/v1/me/plans",
            headers=ALICE,
            json=_plan_payload(f"Fallback {expected_reason}"),
        ).json()
        original_ids = [item["course"]["id"] for item in created["itinerary"]]

        response = client.post(
            f"/api/v1/me/plans/{created['id']}/ai-itinerary",
            headers=ALICE,
        )

        assert response.status_code == 200
        assert response.json()["generation_status"] == "fallback"
        assert response.json()["fallback_reason"] == expected_reason
        assert [item["course"]["id"] for item in response.json()["itinerary"]] == original_ids


def test_disabled_ai_planner_returns_deterministic_plan() -> None:
    app = create_app()
    client = TestClient(app)
    created = client.post(
        "/api/v1/me/plans", headers=ALICE, json=_plan_payload("Disabled AI")
    ).json()

    response = client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary", headers=ALICE
    )

    assert response.status_code == 200
    assert response.json()["generation_status"] == "fallback"
    assert response.json()["fallback_reason"] == "disabled"
    assert response.json()["itinerary"] == created["itinerary"]


def test_ai_planner_monthly_cost_ceiling_prevents_provider_spend() -> None:
    provider = RecordingNarrativeProvider()
    app = _ai_app(provider, monthly_cost_limit_cents=1)
    client = TestClient(app)
    created = client.post(
        "/api/v1/me/plans", headers=ALICE, json=_plan_payload("Cost ceiling")
    ).json()
    with app.state.session_factory() as session:
        session.add(PlanGeneration(
            plan_id=created["id"],
            status="succeeded",
            provider="test-provider",
            model_identifier="test-model",
            prompt_version="planner-narrative-v1",
            input_tokens=1000,
            output_tokens=1000,
            estimated_cost_micros=10_000,
            generated_summary="Prior generation",
        ))
        session.commit()

    response = client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary", headers=ALICE
    )

    assert response.status_code == 200
    assert response.json()["generation_status"] == "fallback"
    assert response.json()["fallback_reason"] == "monthly_cost_limit"
    assert provider.requests == []


def test_plan_hard_filters_and_uses_ranking_and_saved_signals() -> None:
    client = TestClient(create_app())
    client.put(
        "/api/v1/me/rankings/tiers",
        headers=ALICE,
        json={"assignments": [
            {"course_id": 2, "tier": "loved_it"},
            {"course_id": 3, "tier": "liked_it"},
        ]},
    )
    saved_list = client.post(
        "/api/v1/me/saved-lists",
        headers=ALICE,
        json={"name": "Next", "visibility": "private"},
    ).json()
    client.put(
        f"/api/v1/me/saved-lists/{saved_list['id']}/courses/3",
        headers=ALICE,
        json={},
    )

    response = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Monterey weekend",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "max_green_fee": 500,
            "access": "public",
            "max_candidates": 5,
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert all(item["course"]["green_fee"] <= 500 for item in body["candidates"])
    assert all(item["course"]["id"] != 1 for item in body["candidates"])
    assert body["candidates"][0]["course"]["id"] in {2, 3}
    assert all("availability" in item["caveats"][0].lower() for item in body["candidates"])
    assert len(body["itinerary"]) == 2

    plan_id = body["id"]
    assert client.get(f"/api/v1/me/plans/{plan_id}", headers=BOB).status_code == 404
    saved = client.post(f"/api/v1/me/plans/{plan_id}/save", headers=ALICE)
    assert saved.json()["status"] == "saved"
    regenerated = client.put(
        f"/api/v1/me/plans/{plan_id}",
        headers=ALICE,
        json={
            "title": "Monterey weekend updated",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "max_green_fee": 500,
            "access": "public",
        },
    )
    assert regenerated.json()["status"] == "draft"


def test_plan_radius_requires_origin_and_updates_regenerate_candidates() -> None:
    client = TestClient(create_app())
    invalid = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Invalid",
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "radius_miles": 20,
        },
    )
    assert invalid.status_code == 422

    created = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Santa Cruz",
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "regions": ["Santa Cruz, CA"],
        },
    )
    assert [item["course"]["id"] for item in created.json()["candidates"]] == [3]
    updated = client.put(
        f"/api/v1/me/plans/{created.json()['id']}",
        headers=ALICE,
        json={
            "title": "Monterey",
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
            "regions": ["Monterey, CA"],
        },
    )
    assert {item["course"]["id"] for item in updated.json()["candidates"]} == {1, 2}
    assert all(item["distance_miles"] is not None for item in updated.json()["candidates"])
    assert all(
        any("destination center" in reason for reason in item["reasons"])
        for item in updated.json()["candidates"]
    )


def test_plan_destination_accepts_a_city_and_derives_its_origin() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Monterey",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "regions": ["Monterey"],
        },
    )

    assert response.status_code == 201
    assert {item["course"]["id"] for item in response.json()["candidates"]} == {1, 2}
    assert all(item["distance_miles"] is not None for item in response.json()["candidates"])
