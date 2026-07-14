"""persist current ratings and golf memories

Revision ID: 0005_rating_experience
Revises: 0004_product_domains
Create Date: 2026-07-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0005_rating_experience"
down_revision = "0004_product_domains"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rounds") as batch_op:
        batch_op.add_column(sa.Column("favorite_hole", sa.Integer(), nullable=True))
        batch_op.create_unique_constraint(
            "uq_round_id_user_course", ["id", "user_id", "course_id"]
        )

    op.execute(
        """
        UPDATE tier_assignments
        SET tier = CASE tier
            WHEN 'loved_it' THEN 'green'
            WHEN 'liked_it' THEN 'fairway'
            WHEN 'fine' THEN 'rough'
            WHEN 'no' THEN 'bunker'
            ELSE tier
        END
        """
    )

    op.create_table(
        "user_course_ratings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("course_id", sa.Integer(), nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=False),
        sa.Column("tier", sa.String(length=20), nullable=False),
        sa.Column("rating", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["round_id", "user_id", "course_id"],
            ["rounds.id", "rounds.user_id", "rounds.course_id"],
            name="fk_user_course_rating_round_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("round_id", name="uq_user_course_rating_round"),
        sa.UniqueConstraint("user_id", "course_id", name="uq_user_course_rating_user_course"),
    )
    op.create_index("ix_user_course_ratings_user_id", "user_course_ratings", ["user_id"])
    op.create_index("ix_user_course_ratings_course_id", "user_course_ratings", ["course_id"])
    op.create_index("ix_user_course_ratings_tier", "user_course_ratings", ["tier"])

    op.create_table(
        "round_companions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("round_id", sa.Integer(), nullable=False),
        sa.Column("friend_user_id", sa.Integer(), nullable=True),
        sa.Column("guest_name", sa.String(length=255), nullable=True),
        sa.CheckConstraint(
            "(friend_user_id IS NOT NULL AND guest_name IS NULL) OR "
            "(friend_user_id IS NULL AND guest_name IS NOT NULL)",
            name="ck_round_companion_exactly_one_identity",
        ),
        sa.ForeignKeyConstraint(["friend_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["round_id"], ["rounds.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("round_id", "friend_user_id", name="uq_round_companion_round_friend"),
    )
    op.create_index("ix_round_companions_round_id", "round_companions", ["round_id"])
    op.create_index(
        "ix_round_companions_friend_user_id", "round_companions", ["friend_user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_round_companions_friend_user_id", table_name="round_companions")
    op.drop_index("ix_round_companions_round_id", table_name="round_companions")
    op.drop_table("round_companions")

    op.drop_index("ix_user_course_ratings_tier", table_name="user_course_ratings")
    op.drop_index("ix_user_course_ratings_course_id", table_name="user_course_ratings")
    op.drop_index("ix_user_course_ratings_user_id", table_name="user_course_ratings")
    op.drop_table("user_course_ratings")

    op.execute(
        """
        UPDATE tier_assignments
        SET tier = CASE tier
            WHEN 'green' THEN 'loved_it'
            WHEN 'fairway' THEN 'liked_it'
            WHEN 'rough' THEN 'fine'
            WHEN 'bunker' THEN 'no'
            ELSE tier
        END
        """
    )

    with op.batch_alter_table("rounds") as batch_op:
        batch_op.drop_constraint("uq_round_id_user_course", type_="unique")
        batch_op.drop_column("favorite_hole")
