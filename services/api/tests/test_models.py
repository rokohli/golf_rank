from datetime import date

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.db import make_engine, make_session_factory
from app.models import (
    Base,
    Course,
    OnboardingPreference,
    Round,
    RoundCompanion,
    User,
    UserCourseRating,
)


def test_user_has_one_onboarding_preference() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)

    with session_factory() as session:
        user = User(provider_subject="dev:alice")
        session.add(user)
        session.flush()

        session.add_all(
            [
                OnboardingPreference(user_id=user.id, max_green_fee=250, difficulty="any", access="any"),
                OnboardingPreference(user_id=user.id, max_green_fee=300, difficulty="challenging", access="public"),
            ]
        )

        with pytest.raises(IntegrityError):
            session.commit()


def test_current_rating_and_round_memories_persist_with_constraints() -> None:
    engine = make_engine("sqlite+pysqlite://")
    Base.metadata.create_all(engine)
    session_factory = make_session_factory(engine)

    with session_factory() as session:
        course = Course(
            name="Pebble Beach Golf Links",
            region="Monterey, CA",
            latitude=36.568,
            longitude=-121.95,
            is_public=True,
            difficulty="challenging",
            green_fee=625,
        )
        golfer = User(provider_subject="dev:golfer")
        friend = User(provider_subject="dev:friend")
        session.add_all([course, golfer, friend])
        session.flush()

        round_ = Round(
            user_id=golfer.id,
            course_id=course.id,
            played_on=date(2026, 7, 14),
            score=82,
            favorite_hole=7,
        )
        session.add(round_)
        session.flush()

        rating = UserCourseRating(
            user_id=golfer.id,
            course_id=course.id,
            round_id=round_.id,
            tier="green",
            rating=9.2,
            confidence=0.85,
        )
        friend_companion = RoundCompanion(round_id=round_.id, friend_user_id=friend.id)
        guest_companion = RoundCompanion(round_id=round_.id, guest_name="Sam")
        session.add_all([rating, friend_companion, guest_companion])
        session.commit()

        assert session.get(Round, round_.id).favorite_hole == 7
        stored_rating = session.get(UserCourseRating, rating.id)
        assert stored_rating.tier == "green"
        assert stored_rating.rating == pytest.approx(9.2)
        assert stored_rating.confidence == pytest.approx(0.85)
        assert stored_rating.updated_at is not None
        assert session.get(RoundCompanion, friend_companion.id).friend_user_id == friend.id
        assert session.get(RoundCompanion, guest_companion.id).guest_name == "Sam"
        assert "phone" not in {
            column["name"] for column in inspect(engine).get_columns("round_companions")
        }

        session.add(
            UserCourseRating(
                user_id=golfer.id,
                course_id=course.id,
                round_id=round_.id + 1,
                tier="fairway",
                rating=7.5,
                confidence=0.5,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(RoundCompanion(round_id=round_.id, guest_name="Alex", friend_user_id=friend.id))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(RoundCompanion(round_id=round_.id))
        with pytest.raises(IntegrityError):
            session.commit()
