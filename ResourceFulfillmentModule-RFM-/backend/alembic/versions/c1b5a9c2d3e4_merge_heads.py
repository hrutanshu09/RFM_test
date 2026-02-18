"""merge heads

Revision ID: c1b5a9c2d3e4
Revises: a204b3b0f2bf, f7c9b6a7c8c1
Create Date: 2026-02-02 12:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c1b5a9c2d3e4"
down_revision: Union[str, Sequence[str], None] = (
    "a204b3b0f2bf",
    "f7c9b6a7c8c1",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass