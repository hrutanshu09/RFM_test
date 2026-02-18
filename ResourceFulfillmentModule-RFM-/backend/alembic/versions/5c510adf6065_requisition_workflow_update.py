"""Requisition Workflow Update

Revision ID: 5c510adf6065
Revises: 74add6920fae
Create Date: 2026-01-29 16:41:16.777904

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '5c510adf6065'
down_revision: Union[str, Sequence[str], None] = '74add6920fae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # ------------------------------------
    # 1. ADD budget_approved_by (FK users)
    # ------------------------------------
    op.add_column(
        'requisitions',
        sa.Column(
            'budget_approved_by',
            sa.Integer(),
            sa.ForeignKey('users.user_id'),
            nullable=True
        )
    )

    # ------------------------------------
    # 2. DROP old boolean flag (IF EXISTS)
    # ------------------------------------
    op.execute("""
        ALTER TABLE requisitions
        DROP COLUMN IF EXISTS budget_approved;
    """)

    # ------------------------------------
    # 3. DROP OLD STATUS CONSTRAINT SAFELY
    # ------------------------------------
    op.execute("""
        ALTER TABLE requisitions
        DROP CONSTRAINT IF EXISTS chk_requisition_status;
    """)

    # ------------------------------------
    # 4. ADD NEW WORKFLOW CONSTRAINT
    # ------------------------------------
    op.create_check_constraint(
        'chk_requisition_status',
        'requisitions',
        """
        overall_status IN (
            'Pending Budget',
            'Pending HR',
            'Approved & Unassigned',
            'Active',
            'Closed',
            'Expired'
        )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""

    # ------------------------------------
    # DROP NEW WORKFLOW CONSTRAINT
    # ------------------------------------
    op.execute("""
        ALTER TABLE requisitions
        DROP CONSTRAINT IF EXISTS chk_requisition_status;
    """)

    # ------------------------------------
    # RESTORE OLD STATUS CONSTRAINT
    # ------------------------------------
    op.create_check_constraint(
        'chk_requisition_status',
        'requisitions',
        """
        overall_status IN (
            'Open',
            'In Progress',
            'Closed',
            'Cancelled'
        )
        """
    )

    # ------------------------------------
    # RESTORE budget_approved BOOLEAN
    # ------------------------------------
    op.add_column(
        'requisitions',
        sa.Column(
            'budget_approved',
            sa.Boolean(),
            nullable=True
        )
    )

    op.execute("""
        ALTER TABLE requisitions
        DROP COLUMN IF EXISTS budget_approved_by;
    """)
