"""merge heads

Revision ID: 3b59fcfc4996
Revises: a7c8d9e0f1a2, f8b2c1d4e6f7
Create Date: 2026-02-03 14:28:14.064634

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3b59fcfc4996'
down_revision: Union[str, Sequence[str], None] = ('a7c8d9e0f1a2', 'f8b2c1d4e6f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
