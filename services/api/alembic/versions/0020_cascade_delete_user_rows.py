"""cascade-delete profiles and onboarding_preferences with their user

Revision ID: 0020_cascade_delete_user_rows
Revises: 0019_incomplete_tier_assignments
"""

import sqlalchemy as sa
from alembic import op


revision = "0020_cascade_delete_user_rows"
down_revision = "0019_incomplete_tier_assignments"
branch_labels = None
depends_on = None


NAMING_CONVENTION = {"fk": "fk_%(table_name)s_%(column_0_name)s_users"}

# The original (0001_initial) foreign keys were created with no explicit
# name, so each backend assigned its own default: Postgres names them
# "<table>_<column>_fkey" at CREATE TABLE time, while SQLite leaves them
# anonymous until batch mode reflects and renames them per naming_convention.
# Batch mode alters Postgres in place (no reflection/rename), so the two
# backends need different names for the constraint being dropped here.


def _existing_fk_name(bind, table_name: str, column_name: str = "user_id") -> str:
    if bind.dialect.name == "sqlite":
        return NAMING_CONVENTION["fk"] % {"table_name": table_name, "column_0_name": column_name}
    insp = sa.inspect(bind)
    for fk in insp.get_foreign_keys(table_name):
        if fk.get("constrained_columns") == [column_name]:
            return fk["name"]
    return f"{table_name}_{column_name}_fkey"


def upgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("profiles", naming_convention=NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint(_existing_fk_name(bind, "profiles", "user_id"), type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_profiles_user_id_users", "users", ["user_id"], ["id"], ondelete="CASCADE"
        )
    with op.batch_alter_table("onboarding_preferences", naming_convention=NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint(
            _existing_fk_name(bind, "onboarding_preferences", "user_id"), type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "fk_onboarding_preferences_user_id_users", "users", ["user_id"], ["id"], ondelete="CASCADE"
        )


def downgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("onboarding_preferences", naming_convention=NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint("fk_onboarding_preferences_user_id_users", type_="foreignkey")
        batch_op.create_foreign_key(
            "onboarding_preferences_user_id_fkey"
            if bind.dialect.name != "sqlite"
            else NAMING_CONVENTION["fk"] % {"table_name": "onboarding_preferences", "column_0_name": "user_id"},
            "users",
            ["user_id"],
            ["id"],
        )
    with op.batch_alter_table("profiles", naming_convention=NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint("fk_profiles_user_id_users", type_="foreignkey")
        batch_op.create_foreign_key(
            "profiles_user_id_fkey"
            if bind.dialect.name != "sqlite"
            else NAMING_CONVENTION["fk"] % {"table_name": "profiles", "column_0_name": "user_id"},
            "users",
            ["user_id"],
            ["id"],
        )
