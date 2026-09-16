"""Openverse provider -- the second priority tier, behind OFFICIAL/USER and
ahead of Wikimedia (see app/course_images/types.py's PRIORITY_ORDER).

Runs generate_queries() in priority order and stops at the first query that
returns any post-prefilter candidates, scores them all with
openverse_scoring.score_candidate, and only returns a CourseImageResult when
the top score clears auto_accept_threshold. The full scored candidate list is
always returned too, so review-band candidates can be persisted for the admin
moderation queue even when nothing was auto-accepted.
"""

import logging
import time
from dataclasses import dataclass
from typing import Protocol

import httpx

from ...course_photos import request_with_retries
from ..types import CourseImageResult
from .openverse_auth import OpenverseTokenManager
from .openverse_query import generate_queries
from .openverse_scoring import OpenverseCandidate, ScoreResult, prefilter, score_candidate

logger = logging.getLogger("golfrank.course_images")

OPENVERSE_USER_AGENT = "GolfRank-CoursePhotoBackfill/1.0 (https://github.com/golf-rank/golf_rank)"

# Openverse's `category=photograph` filter excludes illustrations/vectors/
# digitized artwork server-side, cheaper than fetching and rejecting them.
_SEARCH_PARAMS = {
    "mature": "false",
    "category": "photograph",
}


class HasCourseForOpenverse(Protocol):
    name: str
    course_name: str | None
    facility_name: str | None
    city: str | None
    admin1_name: str | None


@dataclass(frozen=True)
class ScoredCandidate:
    candidate: OpenverseCandidate
    score: ScoreResult
    matched_query: str


@dataclass(frozen=True)
class OpenverseLookup:
    result: CourseImageResult | None
    top_candidate: ScoredCandidate | None
    review_candidates: list[ScoredCandidate]


def _parse_candidate(raw: dict) -> OpenverseCandidate | None:
    url = raw.get("url")
    license_code = raw.get("license")
    if not url or not license_code:
        return None
    return OpenverseCandidate(
        id=raw.get("id", ""),
        title=raw.get("title") or "",
        description=raw.get("description"),
        url=url,
        thumbnail_url=raw.get("thumbnail"),
        creator=raw.get("creator"),
        creator_url=raw.get("creator_url"),
        license=license_code,
        license_url=raw.get("license_url"),
        license_version=raw.get("license_version"),
        source=raw.get("source"),
        foreign_landing_url=raw.get("foreign_landing_url"),
        width=raw.get("width"),
        height=raw.get("height"),
        category=raw.get("category"),
        tags=[tag.get("name", "") for tag in (raw.get("tags") or []) if isinstance(tag, dict)],
    )


def build_openverse_attribution(candidate: OpenverseCandidate) -> str:
    """"Photo by {creator} · {LICENSE} · via {source}", gracefully
    omitting segments Openverse didn't give us."""
    parts = []
    if candidate.creator:
        parts.append(f"Photo by {candidate.creator}")
    license_label = candidate.license.upper()
    if candidate.license_version:
        license_label = f"{license_label} {candidate.license_version}"
    parts.append(license_label)
    via = candidate.source.title() if candidate.source else "Openverse"
    parts.append(f"via {via}")
    return " · ".join(parts)


class OpenverseImageProvider:
    def __init__(
        self, *, api_base_url: str, token_manager: OpenverseTokenManager, timeout_seconds: float,
        auto_accept_threshold: int, min_width: int, allowed_licenses: set[str], max_retries: int = 0,
        search_budget_seconds: float | None = None,
    ):
        self._api_base_url = api_base_url.rstrip("/")
        self._token_manager = token_manager
        self._timeout_seconds = timeout_seconds
        self._auto_accept_threshold = auto_accept_threshold
        self._min_width = min_width
        self._allowed_licenses = allowed_licenses
        # 0 (default) for the synchronous per-request live path -- doesn't
        # block a held DB session/lock on growing backoff. Offline batch jobs
        # (scripts/backfill_openverse_photos.py) pass a higher value, since an
        # hours-long run can afford to absorb a transient blip.
        self._max_retries = max_retries
        # search() tries up to 4 queries sequentially and shares ONE deadline
        # across all of them (bounds total latency for one course, matching
        # the Wikimedia provider's shared-deadline pattern). Defaulting this to
        # timeout_seconds keeps the live path's existing tight bound; batch
        # jobs pass a much larger budget so 4 queries x up to max_retries
        # attempts each (with growing backoff) actually has room to complete,
        # instead of racing a 5s budget meant for a single unretried request.
        self._search_budget_seconds = (
            search_budget_seconds if search_budget_seconds is not None else timeout_seconds
        )
        self._client = httpx.Client(timeout=timeout_seconds, headers={"User-Agent": OPENVERSE_USER_AGENT})

    def close(self) -> None:
        self._client.close()

    def search(
        self, course: HasCourseForOpenverse, *, sibling_course_names: list[str] | None = None,
    ) -> OpenverseLookup:
        course_name = course.course_name or course.name
        queries = generate_queries(
            course_name=course_name, facility_name=course.facility_name,
            city=course.city, state=course.admin1_name,
        )
        if not queries:
            return OpenverseLookup(result=None, top_candidate=None, review_candidates=[])

        deadline = time.monotonic() + self._search_budget_seconds
        for query in queries:
            candidates = self._search_one_query(query, deadline=deadline)
            survivors = [
                candidate for candidate in candidates
                if prefilter(candidate, min_width=self._min_width, allowed_licenses=self._allowed_licenses) is None
            ]
            if not survivors:
                continue

            scored = [
                ScoredCandidate(
                    candidate=candidate,
                    score=score_candidate(
                        candidate, course_name=course_name, city=course.city, state=course.admin1_name,
                        matched_query=query, sibling_course_names=sibling_course_names,
                    ),
                    matched_query=query,
                )
                for candidate in survivors
            ]
            scored.sort(key=lambda item: item.score.score, reverse=True)
            top = scored[0]
            result = None
            if top.score.score >= self._auto_accept_threshold:
                result = CourseImageResult(
                    type="OPENVERSE",
                    url=top.candidate.url,
                    thumbnail_url=top.candidate.thumbnail_url or top.candidate.url,
                    attribution=build_openverse_attribution(top.candidate),
                    license=top.candidate.license.upper(),
                    license_url=top.candidate.license_url,
                    source_url=top.candidate.foreign_landing_url,
                    alt_text=f"{course.name} course photo",
                    width=top.candidate.width,
                    height=top.candidate.height,
                )
            return OpenverseLookup(result=result, top_candidate=top, review_candidates=scored)

        return OpenverseLookup(result=None, top_candidate=None, review_candidates=[])

    def _search_one_query(self, query: str, *, deadline: float) -> list[OpenverseCandidate]:
        headers = {"Authorization": f"Bearer {self._token_manager.get_token()}"}
        params = dict(_SEARCH_PARAMS, q=query, license=",".join(sorted(self._allowed_licenses)))
        try:
            response = request_with_retries(
                self._client, "GET", f"{self._api_base_url}/v1/images/",
                max_retries=self._max_retries, deadline=deadline, params=params, headers=headers,
            )
            if response.status_code == 401:
                # Token expired/rejected despite our TTL tracking -- refresh
                # once and retry this one query.
                headers = {"Authorization": f"Bearer {self._token_manager.force_refresh()}"}
                response = request_with_retries(
                    self._client, "GET", f"{self._api_base_url}/v1/images/",
                    max_retries=self._max_retries, deadline=deadline, params=params, headers=headers,
                )
            response.raise_for_status()
        except Exception:
            logger.warning("openverse_search_failed query=%r", query, exc_info=True)
            return []

        results = response.json().get("results", [])
        candidates = [_parse_candidate(raw) for raw in results]
        return [candidate for candidate in candidates if candidate is not None]
