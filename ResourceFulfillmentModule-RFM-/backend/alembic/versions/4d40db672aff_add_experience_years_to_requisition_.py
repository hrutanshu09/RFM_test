"""add experience years to requisition items

Revision ID: 4d40db672aff
Revises: b8dc7695d421
Create Date: 2026-01-28 11:16:51.151984

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '4d40db672aff'
down_revision: Union[str, Sequence[str], None] = 'b8dc7695d421'
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
