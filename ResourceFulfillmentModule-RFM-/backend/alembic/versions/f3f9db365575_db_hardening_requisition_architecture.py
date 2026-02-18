"""db_hardening_requisition_architecture

Revision ID: f3f9db365575
Revises: c8d1f2a3b4c5
Create Date: 2026-02-05 11:53:25.632953

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3f9db365575'
down_revision: Union[str, Sequence[str], None] = 'c8d1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade():

    # ==========================================================
    # STEP 0 — DROP OLD CONSTRAINT IF EXISTS
    # ==========================================================

    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_requisition_item_status;
    """)

    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_item_status;
    """)

    op.execute("""
        ALTER TABLE requisition_status_history
        DROP CONSTRAINT IF EXISTS chk_requisition_status_values;
    """)

    # ==========================================================
    # STEP 1 — CLEAN DATA
    # ==========================================================

    # Normalize item_status
    op.execute("""
        UPDATE requisition_items
        SET item_status = 'Open'
        WHERE item_status = 'Pending';
    """)

    # Normalize status history
    op.execute("""
        UPDATE requisition_status_history
        SET new_status = 'Pending Budget Approval'
        WHERE new_status = 'Pending HR Approval';
    """)

    op.execute("""
        UPDATE requisition_status_history
        SET new_status = 'Closed'
        WHERE new_status = 'Closed (Partially Fulfilled)';
    """)

    # ==========================================================
    # STEP 2 — ADD NEW CONSTRAINT
    # ==========================================================

    op.create_check_constraint(
        "chk_item_status",
        "requisition_items",
        """
        item_status IN (
            'Open',
            'Assigned',
            'Searching',
            'Shortlisted',
            'Interviewing',
            'Fulfilled',
            'Cancelled'
        )
        """,
    )

    op.create_check_constraint(
        "chk_requisition_status_values",
        "requisition_status_history",
        """
        new_status IS NULL OR new_status IN (
            'Draft',
            'Pending Budget Approval',
            'Approved & Unassigned',
            'Active',
            'Fulfilled',
            'Closed',
            'Rejected'
        )
        """,
    )
