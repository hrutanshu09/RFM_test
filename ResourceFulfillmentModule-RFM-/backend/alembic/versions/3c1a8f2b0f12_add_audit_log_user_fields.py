"""add_audit_log_user_fields

Revision ID: 3c1a8f2b0f12
Revises: 2b6edec2a478
Create Date: 2026-01-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "3c1a8f2b0f12"
down_revision: Union[str, Sequence[str], None] = "2b6edec2a478"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("audit_log", sa.Column("target_user_id", sa.Integer(), nullable=True))
    op.add_column("audit_log", sa.Column("old_value", sa.Text(), nullable=True))
    op.add_column("audit_log", sa.Column("new_value", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_audit_log_target_user_id_users",
        "audit_log",
        "users",
        ["target_user_id"],
        ["user_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_audit_log_target_user_id_users", "audit_log", type_="foreignkey")
    op.drop_column("audit_log", "new_value")
    op.drop_column("audit_log", "old_value")
    op.drop_column("audit_log", "target_user_id")
