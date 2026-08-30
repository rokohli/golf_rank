"""Scoring candidate course photos against stated taste criteria via Gemini vision."""

import base64
import json
import time
from dataclasses import dataclass

import httpx

MAX_TRANSIENT_RETRIES = 5
RETRY_BACKOFF_SECONDS = 3.0


GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

SCORE_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer", "minimum": 0, "maximum": 10},
        "reasons": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3},
    },
    "required": ["score", "reasons"],
    "additionalProperties": False,
}

# Criteria supplied by the product owner, not inferred -- earlier attempts to
# reverse-engineer a rule from which hero photos got picked manually found no
# reliable pattern in the metadata (source, official-ness, position). This is
# the actual stated taste instead.
CRITERIA_PROMPT = (
    "You are screening candidate photos for a golf course directory app. Score the "
    "PHOTO TO SCORE from 0 (reject) to 10 (excellent) against these criteria:\n"
    "- Strongly prefer wide fairway or green shots that read as a specific hole, "
    "not a generic landscape.\n"
    "- Reject or heavily penalize any photo with people clearly visible in frame.\n"
    "- Reject photos that only show the clubhouse or a building, with no course "
    "or hole visible.\n"
    "- Reject night, dark, or gloomy/heavily overcast-looking shots.\n"
    "- Ground-level shots are acceptable; elevated or aerial shots are preferred.\n"
    "Two REFERENCE GOOD EXAMPLE photos are provided first -- photos the product "
    "owner already picked as exactly the style wanted. Score the PHOTO TO SCORE "
    "relative to how well it matches that style and the criteria above."
)


@dataclass(frozen=True)
class PhotoScore:
    score: int
    reasons: list[str]


class PhotoScoringError(RuntimeError):
    pass


def score_course_photo(
    client: httpx.Client,
    *,
    api_key: str,
    model: str,
    image_data: bytes,
    image_content_type: str,
    reference_images: list[tuple[bytes, str]],
) -> PhotoScore:
    """Score one candidate photo, few-shot primed with reference "good" photos."""
    parts: list[dict] = [{"text": CRITERIA_PROMPT}]
    for reference_data, reference_content_type in reference_images:
        parts.append({"text": "REFERENCE GOOD EXAMPLE:"})
        parts.append({"inlineData": {
            "mimeType": reference_content_type,
            "data": base64.b64encode(reference_data).decode("ascii"),
        }})
    parts.append({"text": "PHOTO TO SCORE:"})
    parts.append({"inlineData": {
        "mimeType": image_content_type,
        "data": base64.b64encode(image_data).decode("ascii"),
    }})

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": SCORE_SCHEMA,
            "maxOutputTokens": 300,
        },
    }
    for attempt in range(MAX_TRANSIENT_RETRIES + 1):
        try:
            response = client.post(
                GEMINI_GENERATE_URL.format(model=model),
                headers={"x-goog-api-key": api_key},
                json=payload,
            )
            if response.status_code == 429 and attempt < MAX_TRANSIENT_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
                continue
            break
        except httpx.TransportError:
            if attempt == MAX_TRANSIENT_RETRIES:
                raise
            time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
    response.raise_for_status()
    output_text = _gemini_output_text(response.json())
    parsed = json.loads(output_text)
    return PhotoScore(score=int(parsed["score"]), reasons=[str(r) for r in parsed.get("reasons", [])])


def _gemini_output_text(body: dict) -> str:
    prompt_feedback = body.get("promptFeedback") or {}
    if prompt_feedback.get("blockReason"):
        raise PhotoScoringError("provider_refusal")
    for candidate in body.get("candidates", []):
        if candidate.get("finishReason") not in {None, "STOP"}:
            raise PhotoScoringError("incomplete_response")
        content = candidate.get("content") or {}
        for part in content.get("parts", []):
            if isinstance(part.get("text"), str):
                return part["text"]
    raise PhotoScoringError("missing_output")
