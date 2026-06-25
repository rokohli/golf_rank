import pytest

from app.core.config import Settings


def test_production_rejects_development_identity() -> None:
    with pytest.raises(ValueError, match="development-only"):
        Settings(app_env="production", allow_development_identity=True).validate_security()
