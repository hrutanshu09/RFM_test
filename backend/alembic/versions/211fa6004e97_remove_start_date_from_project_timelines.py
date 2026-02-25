"""remove start_date from project timelines

Revision ID: 211fa6004e97
Revises: 0c8fc7fa9479
Create Date: 2026-02-25 11:19:15.638923

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '211fa6004e97'
down_revision: Union[str, Sequence[str], None] = '0c8fc7fa9479'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
