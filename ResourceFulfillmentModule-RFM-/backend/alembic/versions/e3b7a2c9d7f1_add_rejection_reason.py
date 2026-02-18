"""add rejection reason fields

Revision ID: e3b7a2c9d7f1
Revises: c1b5a9c2d3e4
Create Date: 2026-02-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "e3b7a2c9d7f1"
down_revision: Union[str, Sequence[str], None] = "c1b5a9c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("requisitions", sa.Column("rejection_reason", sa.Text(), nullable=True))
    op.add_column(
        "requisition_status_history",
        sa.Column("justification", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("requisition_status_history", "justification")
    op.drop_column("requisitions", "rejection_reason")
