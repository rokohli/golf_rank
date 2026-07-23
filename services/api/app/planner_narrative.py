import json
from dataclasses import dataclass
from datetime import date
from typing import Protocol

import httpx
from pydantic import BaseModel, Field

from .core.config import Settings


PROMPT_VERSION = "planner-narrative-v1"


class NarrativeCandidate(BaseModel):
    course_id: int
    name: str
    reasons: list[str]
    caveats: list[str]


class PlannerNarrativeRequest(BaseModel):
    title: str
    start_date: date
    end_date: date
    preferences: dict
    candidates: list[NarrativeCandidate]
    summary_options: list[str]


class NarrativeItineraryItem(BaseModel):
    date: date
    course_id: int
    reason_indices: list[int] = Field(default_factory=list)


class PlannerNarrativeOutput(BaseModel):
    summary: str = Field(min_length=1, max_length=500)
    ordered_course_ids: list[int]
    itinerary: list[NarrativeItineraryItem]


@dataclass(frozen=True)
class PlannerNarrativeResult:
    output: PlannerNarrativeOutput
    provider: str
    model_identifier: str
    input_tokens: int
    output_tokens: int
    estimated_cost_micros: int


class PlannerNarrativeProvider(Protocol):
    async def generate(
        self, request: PlannerNarrativeRequest
    ) -> PlannerNarrativeResult: ...


class PlannerNarrativeProviderError(RuntimeError):
    pass


class GeminiPlannerNarrativeProvider:
    def __init__(self, settings: Settings) -> None:
        if not settings.gemini_api_key:
            raise ValueError("Gemini API key is required")
        self._api_key = settings.gemini_api_key
        self._model = settings.ai_planner_model
        self._timeout = settings.ai_planner_timeout_seconds
        self._max_output_tokens = settings.ai_planner_max_output_tokens
        self._input_cost = settings.ai_planner_input_cost_micros_per_million_tokens
        self._output_cost = settings.ai_planner_output_cost_micros_per_million_tokens

    async def generate(
        self, request: PlannerNarrativeRequest
    ) -> PlannerNarrativeResult:
        candidate_ids = [candidate.course_id for candidate in request.candidates]
        valid_dates = [
            date.fromordinal(value).isoformat()
            for value in range(
                request.start_date.toordinal(), request.end_date.toordinal() + 1
            )
        ]
        schema = {
            "type": "object",
            "properties": {
                "summary": {"type": "string", "enum": request.summary_options},
                "ordered_course_ids": {
                    "type": "array",
                    "items": {"type": "integer", "enum": candidate_ids},
                    "minItems": 1,
                    "maxItems": min(len(candidate_ids), len(valid_dates)),
                },
                "itinerary": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "date": {"type": "string", "enum": valid_dates},
                            "course_id": {"type": "integer", "enum": candidate_ids},
                            "reason_indices": {
                                "type": "array",
                                "items": {"type": "integer", "minimum": 0},
                            },
                        },
                        "required": ["date", "course_id", "reason_indices"],
                        "additionalProperties": False,
                    },
                    "minItems": 1,
                    "maxItems": min(len(candidate_ids), len(valid_dates)),
                },
            },
            "required": ["summary", "ordered_course_ids", "itinerary"],
            "additionalProperties": False,
        }
        minimized_input = request.model_dump(mode="json")
        payload = {
            "systemInstruction": {
                "parts": [
                    {
                        "text": (
                            "Organize only the supplied golf-course candidates into the requested "
                            "date range. Select one supplied summary verbatim. Never add a course, "
                            "price, availability claim, tee time, travel duration, lodging, or "
                            "restaurant. reason_indices must reference only the selected candidate's "
                            "reasons array."
                        )
                    }
                ]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": json.dumps(
                                minimized_input, separators=(",", ":")
                            )
                        }
                    ],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": schema,
                "maxOutputTokens": self._max_output_tokens,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    (
                        "https://generativelanguage.googleapis.com/v1beta/models/"
                        f"{self._model}:generateContent"
                    ),
                    headers={"x-goog-api-key": self._api_key},
                    json=payload,
                )
                response.raise_for_status()
        except (httpx.HTTPError, OSError) as error:
            raise PlannerNarrativeProviderError(type(error).__name__) from error

        try:
            body = response.json()
            if not isinstance(body, dict):
                raise PlannerNarrativeProviderError("invalid_response")
            output_text = _gemini_output_text(body)
            usage = body.get("usageMetadata") or {}
            input_tokens = usage.get("promptTokenCount")
            candidate_tokens = usage.get("candidatesTokenCount")
            thinking_tokens = usage.get("thoughtsTokenCount", 0)
            if (
                not isinstance(input_tokens, int)
                or not isinstance(candidate_tokens, int)
                or not isinstance(thinking_tokens, int)
            ):
                raise PlannerNarrativeProviderError("missing_usage")
            output_tokens = candidate_tokens + thinking_tokens
            output = PlannerNarrativeOutput.model_validate_json(output_text)
        except PlannerNarrativeProviderError:
            raise
        except (AttributeError, ValueError, TypeError) as error:
            raise PlannerNarrativeProviderError("invalid_structured_output") from error
        return PlannerNarrativeResult(
            output=output,
            provider="gemini",
            model_identifier=self._model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost_micros=_estimated_cost_micros(
                input_tokens,
                output_tokens,
                self._input_cost,
                self._output_cost,
            ),
        )


def _gemini_output_text(body: dict) -> str:
    prompt_feedback = body.get("promptFeedback") or {}
    if prompt_feedback.get("blockReason"):
        raise PlannerNarrativeProviderError("provider_refusal")
    for candidate in body.get("candidates", []):
        if candidate.get("finishReason") not in {None, "STOP"}:
            raise PlannerNarrativeProviderError("incomplete_response")
        content = candidate.get("content") or {}
        for part in content.get("parts", []):
            if isinstance(part.get("text"), str):
                return part["text"]
    raise PlannerNarrativeProviderError("missing_output")


def _estimated_cost_micros(
    input_tokens: int,
    output_tokens: int,
    input_cost_micros_per_million_tokens: int,
    output_cost_micros_per_million_tokens: int,
) -> int:
    numerator = (
        input_tokens * input_cost_micros_per_million_tokens
        + output_tokens * output_cost_micros_per_million_tokens
    )
    return (numerator + 999_999) // 1_000_000


def build_planner_narrative_provider(
    settings: Settings,
) -> PlannerNarrativeProvider | None:
    if not settings.ai_planner_enabled:
        return None
    return GeminiPlannerNarrativeProvider(settings)
