import argparse
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.config import Settings
from .db import make_engine, make_session_factory
from .models import Course, Profile


SOURCE = "opengolfapi"
API_BASE_URL = "https://api.opengolfapi.org/v1"
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


@dataclass
class ImportReport:
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    retired: int = 0
    invalid: int = 0
    errors: list[str] = field(default_factory=list)


def fetch_state_courses(state: str, *, client: httpx.Client | None = None) -> list[dict]:
    owned_client = client is None
    client = client or httpx.Client(timeout=30)
    try:
        courses: list[dict] = []
        offset = 0
        limit = 250
        while True:
            response = client.get(f"{API_BASE_URL}/courses/state/{state}", params={"limit": limit, "offset": offset})
            response.raise_for_status()
            payload = response.json()
            page = payload.get("courses", [])
            courses.extend(page)
            offset += len(page)
            if not page or offset >= int(payload.get("total", len(courses))):
                break
        return courses
    finally:
        if owned_client:
            client.close()


def normalize_course_name(value: str) -> str:
    """Remove OpenGolfAPI's plain-text artifact for a stripped trademark mark."""

    return re.sub(r"(?i)(?<=\w)tm(?=\s|$)", "", value).strip()


def import_courses(session: Session, records: list[dict], *, state: str, dry_run: bool = False) -> ImportReport:
    report = ImportReport(fetched=len(records))
    now = datetime.now(UTC)
    seen_ids: set[str] = set()
    existing = {
        course.source_course_id: course
        for course in session.scalars(
            select(Course).where(Course.source == SOURCE, Course.admin1_code == state)
        ).all()
        if course.source_course_id
    }
    for record in records:
        source_id = record.get("id")
        name = normalize_course_name((record.get("course_name") or record.get("name") or "").strip())
        city = (record.get("city") or "").strip() or None
        latitude = record.get("latitude")
        if latitude is None:
            latitude = record.get("lat")
        longitude = record.get("longitude")
        if longitude is None:
            longitude = record.get("lng")
        if not source_id or not name or latitude is None or longitude is None:
            report.invalid += 1
            report.errors.append(f"invalid record id={source_id!r} name={name!r}: missing identity, name, or coordinates")
            continue
        seen_ids.add(source_id)
        access, is_public = normalize_access(record.get("type"))
        values = {
            "name": name,
            "course_name": name,
            "facility_name": (
                normalize_course_name(record["name"].strip())
                if record.get("name") and normalize_course_name(record["name"].strip()) != name
                else None
            ),
            "region": f"{city}, {state}" if city else STATE_NAMES.get(state, state),
            "latitude": float(latitude),
            "longitude": float(longitude),
            "is_public": is_public,
            "difficulty": None,
            "green_fee": None,
            "source": SOURCE,
            "source_course_id": source_id,
            "country_code": "US",
            "admin1_code": state,
            "admin1_name": STATE_NAMES.get(state, state),
            "city": city,
            "status": "active",
            "hole_count": record.get("holes"),
            "par": record.get("par"),
            "access": access,
            "source_updated_at": now,
            "last_verified_at": now,
        }
        course = existing.get(source_id)
        if course is None:
            report.inserted += 1
            if not dry_run:
                session.add(Course(**values))
        else:
            report.updated += 1
            if not dry_run:
                for key, value in values.items():
                    setattr(course, key, value)
    for source_id, course in existing.items():
        if source_id not in seen_ids and course.status != "retired":
            report.retired += 1
            if not dry_run:
                course.status = "retired"
                course.source_updated_at = now
    if dry_run:
        session.rollback()
    else:
        session.commit()
    return report


def normalize_access(raw_type: str | None) -> tuple[str | None, bool | None]:
    if not raw_type:
        return None, None
    value = raw_type.casefold()
    if "public" in value or "municipal" in value:
        return "public", True
    if "private" in value:
        return "private", False
    if "resort" in value:
        return "resort", None
    return value[:30], None


def state_code_from_region(region: str) -> str | None:
    trailing_code = re.search(r"(?:^|,|\s)\s*([A-Za-z]{2})\s*$", region)
    if trailing_code and trailing_code.group(1).upper() in STATE_NAMES:
        return trailing_code.group(1).upper()
    normalized = region.strip().casefold()
    return next((code for code, name in STATE_NAMES.items() if normalized == name.casefold()), None)


def onboarding_states(session: Session) -> list[str]:
    return sorted({
        code
        for region in session.scalars(select(Profile.home_region)).all()
        if (code := state_code_from_region(region)) is not None
    })


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a state catalog from OpenGolfAPI (ODbL-1.0).")
    parser.add_argument("--state", action="append", dest="states", help="Two-letter state code; repeat for multiple states")
    parser.add_argument("--onboarding-regions", action="store_true", help="Import states requested in saved onboarding regions")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    session_factory = make_session_factory(make_engine(Settings().database_url))
    with session_factory() as session:
        states = {state.upper() for state in (args.states or [])}
        if args.onboarding_regions or not states:
            states.update(onboarding_states(session))
        unknown = sorted(states - STATE_NAMES.keys())
        if unknown:
            parser.error(f"unknown state codes: {', '.join(unknown)}")
        if not states:
            parser.error("no importable onboarding regions found; pass --state XX")
        for state in sorted(states):
            records = fetch_state_courses(state)
            report = import_courses(session, records, state=state, dry_run=args.dry_run)
            print(
                f"state={state} fetched={report.fetched} inserted={report.inserted} updated={report.updated} "
                f"retired={report.retired} invalid={report.invalid} dry_run={args.dry_run}"
            )
            for error in report.errors[:20]:
                print(f"state={state} error: {error}")


if __name__ == "__main__":
    main()
