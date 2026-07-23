import asyncio
import json
from datetime import date

import httpx

from app.core.config import Settings
from app.planner_narrative import (
    NarrativeCandidate,
    GeminiPlannerNarrativeProvider,
    PlannerNarrativeRequest,
)


def test_gemini_provider_uses_strict_structured_output(
    monkeypatch,
) -> None:
    captured: dict = {}
    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        assert request.headers["x-goog-api-key"] == "test-key"
        assert request.url.path.endswith("/models/gemini-2.5-flash:generateContent")
        return httpx.Response(200, json={
            "candidates": [{
                "finishReason": "STOP",
                "content": {"parts": [{
                    "text": json.dumps({
                        "summary": "A validated itinerary.",
                        "ordered_course_ids": [7],
                        "itinerary": [{
                            "date": "2026-08-01",
                            "course_id": 7,
                            "reason_indices": [0],
                        }],
                    }),
                }]},
            }],
            "usageMetadata": {
                "promptTokenCount": 80,
                "candidatesTokenCount": 20,
                "thoughtsTokenCount": 5,
            },
        })

    monkeypatch.setattr(
        "app.planner_narrative.httpx.AsyncClient",
        lambda **kwargs: original_async_client(
            **kwargs, transport=httpx.MockTransport(handler)
        ),
    )
    provider = GeminiPlannerNarrativeProvider(Settings(
        ai_planner_enabled=True,
        gemini_api_key="test-key",
    ))
    request = PlannerNarrativeRequest(
        title="Monterey",
        start_date=date(2026, 8, 1),
        end_date=date(2026, 8, 1),
        preferences={"party_size": 4},
        candidates=[NarrativeCandidate(
            course_id=7,
            name="Validated Course",
            reasons=["You saved this course."],
            caveats=["Tee-time availability has not been verified."],
        )],
        summary_options=["A validated itinerary."],
    )

    result = asyncio.run(provider.generate(request))

    assert result.output.ordered_course_ids == [7]
    assert result.input_tokens == 80
    assert result.output_tokens == 25
    assert result.estimated_cost_micros == 156
    config = captured["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["responseJsonSchema"]["properties"]["summary"]["enum"] == [
        "A validated itinerary."
    ]
    assert "test-key" not in json.dumps(captured)
