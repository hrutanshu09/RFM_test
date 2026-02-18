"""yearsofexp addrequisition items 

Revision ID: 66e350b8481e
Revises: a14171864704
Create Date: 2026-01-28 11:31:15.746943

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '66e350b8481e'
down_revision: Union[str, Sequence[str], None] = 'a14171864704'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column(
        'requisition_items',
        sa.Column(
            'experience_years',
            sa.Numeric(4, 1),
            nullable=True
        )
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('requisition_items', 'experience_years')
