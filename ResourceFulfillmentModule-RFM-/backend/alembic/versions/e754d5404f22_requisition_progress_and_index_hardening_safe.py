"""test

Revision ID: e754d5404f22
Revises: 46ee35aed147
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "e754d5404f22"
down_revision: Union[str, Sequence[str], None] = "46ee35aed147"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():

    # ==========================================================
    # 1️⃣ DROP ALL OLD STATUS CONSTRAINTS FIRST
    # ==========================================================

    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_item_status;
    """)

    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_requisition_item_status;
    """)

    # ==========================================================
    # 2️⃣ DATA FIX (ONLY WHAT IS NEEDED)
    # ==========================================================

    # Convert legacy Open → Pending
    op.execute("""
        UPDATE requisition_items
        SET item_status = 'Pending'
        WHERE item_status = 'Open';
    """)

    # Ensure no NULL values
    op.execute("""
        UPDATE requisition_items
        SET item_status = 'Pending'
        WHERE item_status IS NULL;
    """)

    # ==========================================================
    # 3️⃣ CREATE NEW CLEAN CONSTRAINT
    # ==========================================================

    op.create_check_constraint(
        "chk_requisition_item_status",
        "requisition_items",
        """
        item_status IN (
            'Pending',
            'Sourcing',
            'Shortlisted',
            'Interviewing',
            'Fulfilled',
            'Cancelled'
        )
        """
    )

    # ==========================================================
    # 4️⃣ SAFE INDEX
    # ==========================================================

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_requisition_items_status
        ON requisition_items (item_status);
    """)


def downgrade():

    op.execute("DROP INDEX IF EXISTS idx_requisition_items_status")

    op.execute("""
        ALTER TABLE requisition_items
        DROP CONSTRAINT IF EXISTS chk_requisition_item_status;
    """)
