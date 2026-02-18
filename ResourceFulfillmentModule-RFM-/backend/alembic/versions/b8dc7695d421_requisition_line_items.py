"""requisition_line_items

Revision ID: b8dc7695d421
Revises: f49153b2c82a
Create Date: 2026-01-28 10:46:52.614440
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8dc7695d421'
down_revision: Union[str, Sequence[str], None] = 'f49153b2c82a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # ---------------------------------
    # RENAME EXISTING COLUMN
    # ---------------------------------
    op.alter_column(
        'requisition_items',
        'required_level',
        new_column_name='skill_level'
    )

    # ---------------------------------
    # ADD MISSING BUSINESS COLUMNS
    # ---------------------------------
    op.add_column(
        'requisition_items',
        sa.Column('role_position', sa.String(length=50))
    )

    op.add_column(
        'requisition_items',
        sa.Column('requirements', sa.Text())
    )

    # NOTE:
    # We intentionally keep `skill_id` (normalized design)
    # We intentionally keep `education_requirement`
    # No changes to requisitions table


def downgrade() -> None:
    """Downgrade schema."""

    # ---------------------------------
    # DROP ADDED COLUMNS
    # ---------------------------------
    op.drop_column('requisition_items', 'requirements')
    op.drop_column('requisition_items', 'role_position')

    # ---------------------------------
    # RENAME COLUMN BACK
    # ---------------------------------
    op.alter_column(
        'requisition_items',
        'skill_level',
        new_column_name='required_level'
    )
