"""requisition items fix

Revision ID: a14171864704
Revises: 55c524bcc109
Create Date: 2026-01-28 11:30:13.337996

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a14171864704'
down_revision: Union[str, Sequence[str], None] = '55c524bcc109'
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
