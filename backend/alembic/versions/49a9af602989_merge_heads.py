"""merge heads

Revision ID: 49a9af602989
Revises: b5e6f7a8c9d0, f4e99b7d5fc1
Create Date: 2026-02-23 17:07:26.185807

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '49a9af602989'
down_revision: Union[str, Sequence[str], None] = ('b5e6f7a8c9d0', 'f4e99b7d5fc1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
