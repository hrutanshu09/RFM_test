"""remove requisition date_closed

Revision ID: f1a2b3c4d5e6
Revises: e3b7a2c9d7f1
Create Date: 2026-02-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e3b7a2c9d7f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE requisitions DROP COLUMN IF EXISTS date_closed")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "requisitions",
        sa.Column("date_closed", sa.TIMESTAMP(), nullable=True),
    )
