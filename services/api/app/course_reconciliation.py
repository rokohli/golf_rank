import argparse
import json
import re
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from math import asin, cos, radians, sin, sqrt

from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.config import Settings
from .db import make_engine, make_session_factory
from .models import Course, CourseReconciliation


@dataclass(frozen=True)
class ReconciliationProposal:
    source: str
    source_course_id: str
    source_name: str
    canonical_course_id: int
    canonical_name: str
    name_similarity: float
    distance_miles: float
    city_match: bool
    hole_count_match: bool
    par_match: bool


def normalized_name(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))


def _distance_miles(left: Course, right: Course) -> float:
    radius = 3958.8
    lat_delta = radians(right.latitude - left.latitude)
    lon_delta = radians(right.longitude - left.longitude)
    value = (
        sin(lat_delta / 2) ** 2
        + cos(radians(left.latitude))
        * cos(radians(right.latitude))
        * sin(lon_delta / 2) ** 2
    )
    return radius * 2 * asin(sqrt(value))


def propose_matches(session: Session) -> list[ReconciliationProposal]:
    courses = list(session.scalars(
        select(Course).where(Course.status == "active", Course.source_course_id.is_not(None))
    ).all())
    mapped = {
        (item.source, item.source_course_id)
        for item in session.scalars(select(CourseReconciliation)).all()
    }
    proposals: list[ReconciliationProposal] = []
    for source_course in courses:
        identity = (source_course.source, source_course.source_course_id)
        if identity in mapped or source_course.source == "seed":
            continue
        for canonical in courses:
            if canonical.id == source_course.id or canonical.source == source_course.source:
                continue
            similarity = SequenceMatcher(
                None, normalized_name(source_course.name), normalized_name(canonical.name)
            ).ratio()
            distance = _distance_miles(source_course, canonical)
            city_match = bool(
                source_course.city
                and canonical.city
                and source_course.city.casefold() == canonical.city.casefold()
            )
            hole_match = bool(
                source_course.hole_count is not None
                and canonical.hole_count is not None
                and source_course.hole_count == canonical.hole_count
            )
            par_match = bool(
                source_course.par is not None
                and canonical.par is not None
                and source_course.par == canonical.par
            )
            corroborating = city_match or hole_match or par_match
            exact_name = similarity == 1.0
            if not (
                (exact_name and distance <= 10 and corroborating)
                or (similarity >= 0.92 and distance <= 2 and corroborating)
            ):
                continue
            proposals.append(ReconciliationProposal(
                source=source_course.source,
                source_course_id=source_course.source_course_id or "",
                source_name=source_course.name,
                canonical_course_id=canonical.id,
                canonical_name=canonical.name,
                name_similarity=round(similarity, 3),
                distance_miles=round(distance, 2),
                city_match=city_match,
                hole_count_match=hole_match,
                par_match=par_match,
            ))
    return sorted(
        proposals,
        key=lambda item: (
            item.source,
            item.source_course_id,
            -item.name_similarity,
            item.distance_miles,
            item.canonical_course_id,
        ),
    )


def confirm_mapping(
    session: Session,
    *,
    source: str,
    source_course_id: str,
    canonical_course_id: int,
    match_data: dict | None = None,
) -> CourseReconciliation:
    source_course = session.scalar(select(Course).where(
        Course.source == source,
        Course.source_course_id == source_course_id,
    ))
    canonical = session.get(Course, canonical_course_id)
    if source_course is None:
        raise ValueError("Source course not found")
    if canonical is None:
        raise ValueError("Canonical course not found")
    if source_course.id == canonical.id:
        raise ValueError("A course cannot be mapped to itself")
    existing = session.scalar(select(CourseReconciliation).where(
        CourseReconciliation.source == source,
        CourseReconciliation.source_course_id == source_course_id,
    ))
    if existing is not None:
        if existing.canonical_course_id != canonical_course_id:
            raise ValueError("Source course already maps to a different canonical course")
        return existing
    mapping = CourseReconciliation(
        source=source,
        source_course_id=source_course_id,
        canonical_course_id=canonical_course_id,
        match_status="confirmed",
        match_data=match_data or {},
    )
    session.add(mapping)
    session.commit()
    return mapping


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Propose or explicitly confirm non-destructive course reconciliations."
    )
    parser.add_argument("--source")
    parser.add_argument("--source-course-id")
    parser.add_argument("--canonical-course-id", type=int)
    parser.add_argument("--confirm", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    session_factory = make_session_factory(make_engine(settings.database_url))
    with session_factory() as session:
        if args.confirm:
            if not args.source or not args.source_course_id or args.canonical_course_id is None:
                parser.error(
                    "--confirm requires --source, --source-course-id, and --canonical-course-id"
                )
            mapping = confirm_mapping(
                session,
                source=args.source,
                source_course_id=args.source_course_id,
                canonical_course_id=args.canonical_course_id,
                match_data={"confirmed_by": "course_reconciliation_command"},
            )
            print(json.dumps({"mapping_id": mapping.id, "status": mapping.match_status}))
            return
        print(json.dumps([asdict(item) for item in propose_matches(session)], indent=2))


if __name__ == "__main__":
    main()
