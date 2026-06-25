import pytest
from sqlalchemy.exc import IntegrityError

from app.db import make_engine, make_session_factory
from app.models import Base, OnboardingPreference, User


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
