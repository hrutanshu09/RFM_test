"""user employee mapping

Revision ID: 75ce56ac4e23
Revises: b59917a9ceab
Create Date: 2026-01-20 12:29:26.912792
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# Alembic revision identifiers (MANDATORY)
revision: str = "75ce56ac4e23"
down_revision: Union[str, Sequence[str], None] = "b59917a9ceab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_employee_map",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emp_id", sa.String(length=20), nullable=False),
        sa.Column(
            "linked_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False
        ),

        sa.PrimaryKeyConstraint("user_id", "emp_id"),
        sa.UniqueConstraint("user_id"),
        sa.UniqueConstraint("emp_id"),

        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.user_id"],
            ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["emp_id"],
            ["employees.emp_id"],
            ondelete="CASCADE"
        ),
    )


def downgrade() -> None:
    op.drop_table("user_employee_map")
