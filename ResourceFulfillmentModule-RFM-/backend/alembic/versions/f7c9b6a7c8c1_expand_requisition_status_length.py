"""expand requisition status length

Revision ID: f7c9b6a7c8c1
Revises: 0e30de8a4a10
Create Date: 2026-02-02 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f7c9b6a7c8c1"
down_revision: Union[str, Sequence[str], None] = "0e30de8a4a10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column(
        "requisition_status_history",
        "old_status",
        existing_type=sa.String(length=20),
        type_=sa.String(length=50),
        existing_nullable=True,
    )
    op.alter_column(
        "requisition_status_history",
        "new_status",
        existing_type=sa.String(length=20),
        type_=sa.String(length=50),
        existing_nullable=True,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        "requisition_status_history",
        "new_status",
        existing_type=sa.String(length=50),
        type_=sa.String(length=20),
        existing_nullable=True,
    )
    op.alter_column(
        "requisition_status_history",
        "old_status",
        existing_type=sa.String(length=50),
        type_=sa.String(length=20),
        existing_nullable=True,
    )