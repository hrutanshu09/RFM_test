"""Post upgrade check

Revision ID: f9e099ded9c6
Revises: a4da1ccd6324
Create Date: 2026-01-30 00:00:00.000000

"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = 'f9e099ded9c6'
down_revision: Union[str, Sequence[str], None] = 'a4da1ccd6324'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
