"""Requisition Items Workflow & FK Fix

Revision ID: a4da1ccd6324
Revises: 5c510adf6065
Create Date: 2026-01-30 09:38:02.374689

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a4da1ccd6324'
down_revision: Union[str, Sequence[str], None] = '5c510adf6065'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # 1. FIX assigned_emp_id (VARCHAR FK)

    # Add FK constraint safely (type already matches)
    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS requisition_items_assigned_emp_id_fkey;
    """)

    op.create_foreign_key(
        'requisition_items_assigned_emp_id_fkey',
        'requisition_items',
        'employees',
        ['assigned_emp_id'],
        ['emp_id']
    )

    # 2. UPDATE item_status WORKFLOW
    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_requisition_item_status;
    """)

    op.create_check_constraint(
        'chk_requisition_item_status',
        'requisition_items',
        """
        item_status IN (
            'Pending',
            'Sourcing',
            'Shortlisted',
            'Fulfilled',
            'Cancelled'
        )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""

    # Restore old status constraint
    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_requisition_item_status;
    """)

    op.create_check_constraint(
        'chk_requisition_item_status',
        'requisition_items',
        """
        item_status IN (
            'Pending',
            'Fulfilled',
            'Cancelled'
        )
        """
    )

    # Drop FK
    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS requisition_items_assigned_emp_id_fkey;
    """)