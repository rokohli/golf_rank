"""Deterministic, additive point-based scoring for Openverse candidates.

Distinct from Wikimedia's 0.0-1.0 confidence float (wikimedia.py) and from
the Gemini-based quality_score used for USER uploads (course_photo_scoring.py)
-- this is an integer point score specifically about "is this a photo of
*this* course", not "is this a good-looking photo".

A wrong course photo is worse than no photo, so this errs toward rejection:
hard disqualifiers are pre-filtered before scoring even runs, and any signal
that this might be a *different* course (especially a sibling course sharing
the same facility, e.g. Bethpage Black vs Bethpage Green) is penalized hard.
"""

import difflib
import re
from dataclasses import dataclass, field

from .openverse_query import normalize_course_name

# Openverse's own `category` field, when present -- used as a pre-filter
# rather than a scoring signal, since it's a binary "is this even a photo"
# question, not a soft quality signal.
NON_PHOTO_CATEGORIES = {"illustration", "digitized_artwork"}

GOLF_CONTEXT_WORDS = {
    "golf", "hole", "green", "fairway", "tee", "links", "clubhouse",
    "bunker", "putting", "pin", "fairways", "course",
}

GENERIC_GOLF_WORDS = {
    "golf", "ball", "balls", "green", "hole", "club", "clubs", "course", "swing",
}

MINI_GOLF_OR_EQUIPMENT_WORDS = {
    "minigolf", "mini-golf", "miniature", "putt-putt", "puttputt",
    "driving", "range", "simulator", "clubs", "bag", "cart", "carts",
    "glove", "shoes", "tees", "scorecard",
}

# A small, deliberately conservative allowlist of Openverse `source` values
# known to carry reliable geotagging/attribution -- a content-quality
# judgment, not an ops dial, so it's a constant rather than a setting.
TRUSTED_SOURCES = {"flickr", "wikimedia", "met", "smithsonian", "nasa"}

PARTIAL_MATCH_RATIO_THRESHOLD = 0.6


@dataclass(frozen=True)
class OpenverseCandidate:
    """Normalized shape of one Openverse search result, independent of the
    raw API response shape -- built once at the HTTP-parsing boundary so the
    scoring/filter functions below are pure and easy to unit test."""

    id: str
    title: str
    description: str | None
    url: str
    thumbnail_url: str | None
    creator: str | None
    creator_url: str | None
    license: str
    license_url: str | None
    license_version: str | None
    source: str | None
    foreign_landing_url: str | None
    width: int | None
    height: int | None
    category: str | None = None
    tags: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ScoreResult:
    score: int
    reasons: list[str]


def _words(text: str | None) -> set[str]:
    if not text:
        return set()
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def prefilter(
    candidate: OpenverseCandidate, *, min_width: int, allowed_licenses: set[str],
) -> str | None:
    """Hard, binary rejects -- returns a rejection reason, or None if the
    candidate survives to scoring. These are gates, not scored penalties:
    an unlicensed or non-photo result is never usable regardless of how well
    it otherwise matches."""
    if candidate.license.lower() not in allowed_licenses:
        return f"license '{candidate.license}' not in allowed list"
    if candidate.category and candidate.category.lower() in NON_PHOTO_CATEGORIES:
        return f"category '{candidate.category}' is not a photograph"
    if not candidate.width or not candidate.height:
        return "missing width/height"
    if candidate.width < min_width:
        return f"width {candidate.width} below minimum {min_width}"
    if candidate.width <= candidate.height:
        return "not landscape orientation"
    return None


def _course_name_match_points(candidate_text: str, normalized_course_name: str) -> tuple[int, str | None]:
    if not normalized_course_name:
        return 0, None
    normalized_text = normalize_course_name(candidate_text)
    if not normalized_text:
        return 0, None
    if normalized_course_name in normalized_text:
        return 50, "+50 exact course name match"
    ratio = difflib.SequenceMatcher(None, normalized_course_name, normalized_text).ratio()
    course_words = set(normalized_course_name.split())
    text_words = set(normalized_text.split())
    overlap = len(course_words & text_words) / len(course_words) if course_words else 0.0
    if ratio >= PARTIAL_MATCH_RATIO_THRESHOLD or overlap >= 0.5:
        return 30, "+30 partial course name match"
    return 0, None


def _resort_guard(
    candidate_text_words: set[str], *, course_name: str, sibling_course_names: list[str],
) -> tuple[int, str | None]:
    """When this course shares a facility with sibling courses (e.g. Bethpage
    Black alongside Bethpage Green/Red), a candidate must specifically name
    *this* course, not just the shared facility -- otherwise a generic
    facility photo (or worse, a sibling's own photo) could get misattributed.
    """
    if not sibling_course_names:
        return 0, None

    normalized_course = normalize_course_name(course_name)
    course_words = set(normalized_course.split())
    if course_words and course_words <= candidate_text_words:
        return 0, None  # this course's own distinguishing words are present

    for sibling in sibling_course_names:
        normalized_sibling = normalize_course_name(sibling)
        sibling_words = set(normalized_sibling.split())
        # Only treat this as "names a different sibling" when the sibling's
        # distinguishing words are actually distinct from this course's own --
        # otherwise siblings that share most of their name (e.g. two courses
        # both starting "Torrey Pines") would false-positive on each other.
        distinguishing = sibling_words - course_words
        if distinguishing and distinguishing <= candidate_text_words:
            return -100, f"-100 names a different course at the same facility ({sibling})"

    return -60, "-60 ambiguous: shared-facility course but no course-specific signal found"


def score_candidate(
    candidate: OpenverseCandidate,
    *,
    course_name: str,
    city: str | None,
    state: str | None,
    matched_query: str,
    sibling_course_names: list[str] | None = None,
) -> ScoreResult:
    """Additive point score for how confidently `candidate` depicts
    `course_name`. See module docstring for the overall philosophy."""
    reasons: list[str] = []
    score = 0

    title_words = _words(candidate.title)
    description_words = _words(candidate.description)
    all_words = title_words | description_words | {tag.lower() for tag in candidate.tags}

    normalized_course_name = normalize_course_name(course_name)

    name_points, name_reason = _course_name_match_points(candidate.title, normalized_course_name)
    if name_points:
        score += name_points
        reasons.append(name_reason)

    if city and city.lower() in _words(candidate.title) | _words(candidate.description):
        score += 20
        reasons.append("+20 city match")
    elif city and normalize_course_name(city) and normalize_course_name(city) in " ".join(all_words):
        score += 20
        reasons.append("+20 city match")

    if state:
        state_words = _words(state)
        if state_words & all_words:
            score += 15
            reasons.append("+15 state match")

    if GOLF_CONTEXT_WORDS & title_words:
        score += 10
        reasons.append("+10 golf-context words in title")

    if normalized_course_name and normalized_course_name in normalize_course_name(candidate.description or ""):
        score += 10
        reasons.append("+10 course name in description")

    if candidate.width and candidate.height and candidate.width > candidate.height:
        score += 5
        reasons.append("+5 landscape orientation")

    if candidate.width and candidate.width >= 1600:
        score += 5
        reasons.append("+5 width >= 1600px")

    if candidate.source and candidate.source.lower() in TRUSTED_SOURCES:
        score += 5
        reasons.append("+5 trusted source")

    if not name_points and not (GOLF_CONTEXT_WORDS & all_words):
        # No course-name signal *and* no golf context at all -- almost
        # certainly an unrelated image the search happened to surface.
        score -= 40
        reasons.append("-40 generic image, no course-name or golf-context signal")
    elif not name_points and (GENERIC_GOLF_WORDS & title_words) and not (title_words - GENERIC_GOLF_WORDS):
        score -= 40
        reasons.append("-40 generic golf image (stock-like title)")

    if MINI_GOLF_OR_EQUIPMENT_WORDS & all_words:
        score -= 100
        reasons.append("-100 mini-golf/equipment subject")

    if not candidate.title and not candidate.description and not candidate.tags:
        score -= 20
        reasons.append("-20 no useful title/description/metadata")

    guard_points, guard_reason = _resort_guard(
        all_words, course_name=course_name, sibling_course_names=sibling_course_names or [],
    )
    if guard_points:
        score += guard_points
        reasons.append(guard_reason)

    return ScoreResult(score=score, reasons=reasons)
