from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import Settings
from app.main import create_app
from app.models import Course, Plan, PlanGeneration
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


def test_ai_itinerary_rejects_stale_output_after_plan_dates_change() -> None:
    provider = RecordingNarrativeProvider()
    app = _ai_app(provider)
    client = TestClient(app)
    created = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json=_plan_payload("Plan changes in flight"),
    ).json()
    original_generate = provider.generate

    async def generate_after_edit(
        request: PlannerNarrativeRequest,
    ) -> PlannerNarrativeResult:
        with app.state.session_factory() as editing_session:
            plan = editing_session.get(Plan, created["id"])
            assert plan is not None
            plan.start_date = plan.start_date.fromordinal(plan.start_date.toordinal() + 2)
            plan.end_date = plan.end_date.fromordinal(plan.end_date.toordinal() + 2)
            editing_session.commit()
        return await original_generate(request)

    provider.generate = generate_after_edit

    response = client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary",
        headers=ALICE,
    )

    assert response.status_code == 200
    assert response.json()["generation_status"] == "fallback"
    assert response.json()["fallback_reason"] == "plan_changed"


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


def test_ai_planner_allowlist_keeps_other_users_on_deterministic_fallback() -> None:
    provider = RecordingNarrativeProvider()
    app = create_app(Settings(
        ai_planner_enabled=True,
        gemini_api_key="test-key",
        ai_planner_data_tier="unpaid",
        ai_planner_allowed_subjects="dev:plan-alice",
    ))
    app.state.planner_narrative_provider = provider
    client = TestClient(app)
    created = client.post(
        "/api/v1/me/plans", headers=BOB, json=_plan_payload("Restricted AI")
    ).json()

    response = client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary", headers=BOB
    )

    assert response.status_code == 200
    assert response.json()["generation_status"] == "fallback"
    assert response.json()["fallback_reason"] == "restricted"
    assert response.json()["itinerary"] == created["itinerary"]
    assert provider.requests == []


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


def test_preferred_course_id_guarantees_position_1_in_dense_region() -> None:
    app = create_app()
    client = TestClient(app)

    with app.state.session_factory() as session:
        for i in range(1, 7):
            cid = 800 + i
            if not session.get(Course, cid):
                c = Course(
                    id=cid,
                    name=f"Scottsdale Course {i}",
                    city="Scottsdale",
                    region="Scottsdale, AZ",
                    admin1_code="AZ",
                    latitude=33.5 + (i * 0.01),
                    longitude=-111.9 - (i * 0.01),
                    green_fee=100,
                    difficulty="intermediate",
                    is_public=True,
                    hole_count=18,
                    par=72,
                    status="active",
                )
                session.add(c)
        session.commit()

    response = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Scottsdale Focus",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "regions": ["Scottsdale"],
            "max_candidates": 5,
            "preferred_course_id": 806,
        },
    )
    assert response.status_code == 201
    data = response.json()
    candidates = data["candidates"]
    assert len(candidates) == 5
    assert candidates[0]["course"]["id"] == 806
    assert candidates[0]["position"] == 1
    assert any("Selected as the featured focus" in reason for reason in candidates[0]["reasons"])
    assert data["itinerary"][0]["course"]["id"] == 806
    assert "Play Scottsdale Course 6" in data["itinerary"][0]["title"]


def test_ai_itinerary_with_preferred_course_included_and_validated() -> None:
    provider = RecordingNarrativeProvider()
    app = _ai_app(provider)
    client = TestClient(app)

    # Alice creates a plan with preferred_course_id=2 (Spyglass Hill)
    created = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Monterey Preferred",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "regions": ["Monterey, CA"],
            "preferred_course_id": 2,
        },
    ).json()

    response = client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary",
        headers=ALICE,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["generation_status"] == "generated"
    assert len(provider.requests) == 1
    sent_req = provider.requests[0]
    assert sent_req.preferences.get("preferred_course_id") == 2
    # Spyglass Hill (ID 2) is in the itinerary
    assert any(item["course"]["id"] == 2 for item in body["itinerary"])


def test_over_budget_preferred_course_emits_budget_caveat_not_affordable_reason() -> None:
    app = create_app()
    client = TestClient(app)

    # Course 2 (Spyglass Hill) has green_fee=495. Alice sets max_green_fee=100.
    response = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Budget Monterey",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "regions": ["Monterey, CA"],
            "max_green_fee": 100,
            "preferred_course_id": 2,
        },
    )
    assert response.status_code == 201
    data = response.json()
    pref_cand = next(c for c in data["candidates"] if c["course"]["id"] == 2)
    # Must NOT claim within budget!
    assert not any("is within your budget" in reason for reason in pref_cand["reasons"])
    # Must explicitly emit caveat explaining the budget overrun
    assert any("exceeds your $100 budget limit" in caveat for caveat in pref_cand["caveats"])


def test_ai_itinerary_with_reconciled_alias_preferred_course_canonicalizes_and_validates() -> None:
    from app.models import CourseReconciliation

    provider = RecordingNarrativeProvider()
    app = _ai_app(provider)
    client = TestClient(app)

    with app.state.session_factory() as session:
        if not session.get(Course, 703):
            alias = Course(
                id=703,
                name="Spyglass (Alias 703)",
                city="Pebble Beach",
                region="Pebble Beach, CA",
                admin1_code="CA",
                source="legacy_import",
                source_course_id="spyglass-703",
                latitude=36.58,
                longitude=-121.96,
                is_public=True,
                green_fee=495,
                hole_count=18,
                par=72,
                status="active",
            )
            session.add(alias)
            session.flush()
            recon = CourseReconciliation(
                source="legacy_import",
                source_course_id="spyglass-703",
                canonical_course_id=2,
                match_status="confirmed",
            )
            session.add(recon)
            session.commit()

    created = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Alias Monterey Plan",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "regions": ["Monterey, CA"],
            "preferred_course_id": 703,
        },
    ).json()

    # Preferred course was canonicalized to Course 2
    assert created["candidates"][0]["course"]["id"] == 2

    response = client.post(
        f"/api/v1/me/plans/{created['id']}/ai-itinerary",
        headers=ALICE,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["generation_status"] == "generated"
    assert len(provider.requests) == 1
    sent_req = provider.requests[0]
    # Canonical ID 2 should be passed in preferences, matching the candidate ID in candidates
    assert sent_req.preferences.get("preferred_course_id") == 2
    assert any(item["course"]["id"] == 2 for item in body["itinerary"])


def test_plan_must_haves_and_walking_grounded_in_golfer_reports() -> None:
    app = create_app()
    client = TestClient(app)

    user1 = {"X-Development-Subject": "dev:user-1"}
    user2 = {"X-Development-Subject": "dev:user-2"}
    user3 = {"X-Development-Subject": "dev:user-3"}

    # 3 golfers log public rounds on Course 1 with walked and ocean_views
    for u in (user1, user2, user3):
        res = client.post(
            "/api/v1/me/rounds",
            headers=u,
            json={
                "course_id": 1,
                "played_on": "2026-07-01",
                "tags": ["walked", "ocean_views"],
                "visibility": "public",
            },
        )
        assert res.status_code == 201

    # Alice creates a plan asking for walking, ocean views, and caddie
    plan_res = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Grounded Plan",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "regions": ["Monterey, CA"],
            "transportation": "walking",
            "must_haves": ["walkable", "ocean views", "caddie"],
        },
    )
    assert plan_res.status_code == 201
    plan_body = plan_res.json()
    candidates = plan_body["candidates"]
    assert len(candidates) > 0

    c1 = next(c for c in candidates if c["course"]["id"] == 1)
    # Walking observation reason present
    assert any("reporting golfers walked" in r for r in c1["reasons"])
    # Ocean views highlight reason present
    assert any("Ocean Views" in r for r in c1["reasons"])
    # Policy caveat MUST be retained even when walked is observed
    assert "Walking policy and cart requirements must be confirmed directly with the course." in c1["caveats"]
    # Confirmed must-have receives verification caveat
    assert "Requested must-have 'ocean views' is supported by recent golfer reports but requires confirmation with the course." in c1["caveats"]
    # Unconfirmed must-have receives caveat
    assert "Requested must-have 'caddie' is unconfirmed and requires verification with the course." in c1["caveats"]
    # Course object carries golfer_reports
    assert c1["course"]["golfer_reports"] is not None
    assert c1["course"]["golfer_reports"]["total_reporting_golfers"] == 3
    assert c1["source_checked_at"] is not None

    # Course without walking reports (Course 2)
    c2 = next((c for c in candidates if c["course"]["id"] == 2), None)
    if c2:
        assert "Walking policy is unconfirmed; verify walking and cart rules directly with the course." in c2["caveats"]
        assert "Requested must-have 'ocean views' is unconfirmed and requires verification with the course." in c2["caveats"]


def test_plan_walking_requires_representative_evidence_and_preserves_snapshot_as_of() -> None:
    app = create_app()
    client = TestClient(app)

    # Course 2: 1 walker and 3 cart users (25% walked, cart majority)
    client.post("/api/v1/me/rounds", headers={"X-Development-Subject": "dev:c2-user1"}, json={"course_id": 2, "played_on": "2026-07-01", "tags": ["walked"], "visibility": "public"})
    client.post("/api/v1/me/rounds", headers={"X-Development-Subject": "dev:c2-user2"}, json={"course_id": 2, "played_on": "2026-07-01", "tags": ["cart"], "visibility": "public"})
    client.post("/api/v1/me/rounds", headers={"X-Development-Subject": "dev:c2-user3"}, json={"course_id": 2, "played_on": "2026-07-01", "tags": ["cart"], "visibility": "public"})
    client.post("/api/v1/me/rounds", headers={"X-Development-Subject": "dev:c2-user4"}, json={"course_id": 2, "played_on": "2026-07-01", "tags": ["cart"], "visibility": "public"})

    # Course 1: 3 walkers (100% walked)
    client.post("/api/v1/me/rounds", headers={"X-Development-Subject": "dev:c1-user1"}, json={"course_id": 1, "played_on": "2026-07-01", "tags": ["walked"], "visibility": "public"})
    client.post("/api/v1/me/rounds", headers={"X-Development-Subject": "dev:c1-user2"}, json={"course_id": 1, "played_on": "2026-07-01", "tags": ["walked"], "visibility": "public"})
    client.post("/api/v1/me/rounds", headers={"X-Development-Subject": "dev:c1-user3"}, json={"course_id": 1, "played_on": "2026-07-01", "tags": ["walked"], "visibility": "public"})

    plan_res = client.post(
        "/api/v1/me/plans",
        headers=ALICE,
        json={
            "title": "Walking Preference Plan",
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "regions": ["Monterey, CA"],
            "transportation": "walking",
        },
    )
    assert plan_res.status_code == 201
    plan = plan_res.json()
    plan_id = plan["id"]

    c1 = next(c for c in plan["candidates"] if c["course"]["id"] == 1)
    c2 = next(c for c in plan["candidates"] if c["course"]["id"] == 2)

    # Course 1 (100% walked, >= 3 walkers) received walking observation and boost
    assert any("reporting golfers walked" in r for r in c1["reasons"])
    # Course 2 (25% walked, cart-dominated) did NOT receive walking observation reason
    assert not any("reporting golfers walked" in r for r in c2["reasons"])
    assert "Walking policy is unconfirmed; verify walking and cart rules directly with the course." in c2["caveats"]

    # Add a new backdated round after plan creation
    client.post(
        "/api/v1/me/rounds",
        headers={"X-Development-Subject": "dev:c1-user4"},
        json={"course_id": 1, "played_on": "2026-07-01", "tags": ["cart"], "visibility": "public"},
    )

    # When retrieving the plan later, candidate reports remain the persisted snapshot
    retrieved = client.get(f"/api/v1/me/plans/{plan_id}", headers=ALICE).json()
    r_c1 = next(c for c in retrieved["candidates"] if c["course"]["id"] == 1)
    assert r_c1["course"]["golfer_reports"] is not None
    assert r_c1["course"]["golfer_reports"]["total_reporting_golfers"] == 3

    # An explicitly empty snapshot (Course 3 had 0 reports at plan creation)
    c3 = next((c for c in plan["candidates"] if c["course"]["id"] == 3), None)
    if c3:
        assert c3["course"]["golfer_reports"] is None
        # Add 3 rounds to Course 3 after plan creation
        for u in ("dev:c3-u1", "dev:c3-u2", "dev:c3-u3"):
            client.post(
                "/api/v1/me/rounds",
                headers={"X-Development-Subject": u},
                json={"course_id": 3, "played_on": "2026-07-01", "tags": ["walked"], "visibility": "public"},
            )
        # Empty snapshot remains None (not populated by later backdated rounds)
        retrieved2 = client.get(f"/api/v1/me/plans/{plan_id}", headers=ALICE).json()
        r_c3 = next((c for c in retrieved2["candidates"] if c["course"]["id"] == 3), None)
        assert r_c3["course"]["golfer_reports"] is None




