"""add fulfilled status to requisitions

Revision ID: f8b2c1d4e6f7
Revises: f9e099ded9c6
Create Date: 2026-02-03
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "f8b2c1d4e6f7"
down_revision = "f9e099ded9c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE requisitions DROP CONSTRAINT chk_requisition_status")
    op.execute(
        """
        ALTER TABLE requisitions
        ADD CONSTRAINT chk_requisition_status
        CHECK (
            overall_status IN (
                'Pending Budget Approval',
                'Pending HR Approval',
                'Approved & Unassigned',
                'Active',
                'Fulfilled',
                'Closed',
                'Rejected'
            )
        )
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE requisitions DROP CONSTRAINT chk_requisition_status")
    op.execute(
        """
        ALTER TABLE requisitions
        ADD CONSTRAINT chk_requisition_status
        CHECK (
            overall_status IN (
                'Pending Budget Approval',
                'Pending HR Approval',
                'Approved & Unassigned',
                'Active',
                'Closed',
                'Rejected'
            )
        )
        """
    )
