"""add jd_file_key to requisition_items (item-level JD)

Revision ID: b5e6f7a8c9d0
Revises: add_candidates_interviews
Create Date: 2026-02-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b5e6f7a8c9d0"
down_revision: Union[str, Sequence[str], None] = "add_candidates_interviews"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "requisition_items",
        sa.Column("jd_file_key", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("requisition_items", "jd_file_key")
