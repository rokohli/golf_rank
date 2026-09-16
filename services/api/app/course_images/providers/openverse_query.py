"""Course-name normalization and search-query generation for Openverse.

Pure functions, no I/O -- kept separate from openverse.py so they're trivially
unit-testable in isolation (see tests/test_openverse_query.py).
"""

import re

# Common golf-facility qualifiers that vary between how a course is named in
# our catalog and how a photo's title/description names it (e.g. "Pebble
# Beach Golf Links" vs "Pebble Beach"). Stripping them lets a normalized
# comparison treat these as the same course without over-aggressive fuzzy
# matching on the distinctive part of the name.
_SUFFIX_PATTERN = re.compile(
    r"\b(golf\s+(club|course|links)|country\s+club|resort|gc|cc)\b",
    re.IGNORECASE,
)
_LEADING_THE_PATTERN = re.compile(r"^\s*the\s+", re.IGNORECASE)
_PUNCTUATION_PATTERN = re.compile(r"[^\w\s]")
_WHITESPACE_PATTERN = re.compile(r"\s+")


def normalize_course_name(name: str) -> str:
    """Lowercases, strips common suffixes/qualifiers and punctuation, and
    collapses whitespace, so two spellings of the same course compare equal.

    "Pebble Beach Golf Links" / "Pebble Beach Golf Course" / "Pebble Beach"
    all normalize to "pebble beach".
    """
    if not name:
        return ""
    value = _LEADING_THE_PATTERN.sub("", name)
    value = _SUFFIX_PATTERN.sub(" ", value)
    value = _PUNCTUATION_PATTERN.sub(" ", value)
    value = _WHITESPACE_PATTERN.sub(" ", value).strip().lower()
    return value


def generate_queries(
    *,
    course_name: str | None,
    facility_name: str | None,
    city: str | None,
    state: str | None,
) -> list[str]:
    """Priority-ordered candidate search queries, most to least specific.

    Falls back to `facility_name` when `course_name` is unset (some Course
    rows only carry the legacy `name` field, not the newer course_name/
    facility_name split) -- callers should pass `course.course_name or
    course.name` as `course_name`.
    """
    name = (course_name or facility_name or "").strip()
    if not name:
        return []

    queries: list[str] = []

    def add(query: str) -> None:
        query = _WHITESPACE_PATTERN.sub(" ", query).strip()
        if query and query not in queries:
            queries.append(query)

    if city and state:
        add(f"{name} golf course {city} {state}")
        add(f"{name} {city} {state}")
    if state:
        add(f"{name} golf club {state}")
    add(name)

    return queries
