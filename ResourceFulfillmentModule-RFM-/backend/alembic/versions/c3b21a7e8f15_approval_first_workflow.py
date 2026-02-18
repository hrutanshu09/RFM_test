"""Approval-first workflow

Revision ID: c3b21a7e8f15
Revises: b14f2c9e3a7d
Create Date: 2026-01-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c3b21a7e8f15"
down_revision: Union[str, Sequence[str], None] = "b14f2c9e3a7d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.execute(
        """
        ALTER TABLE requisitions
        DROP CONSTRAINT IF EXISTS chk_requisition_status;
        """
    )

    op.add_column(
        "requisitions",
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("users.user_id"), nullable=True),
    )
    op.add_column(
        "requisitions",
        sa.Column("approval_history", sa.TIMESTAMP(), nullable=True),
    )

    op.execute(
        """
        UPDATE requisitions
        SET overall_status = 'Pending Budget Approval'
        WHERE overall_status IN ('Draft', 'Pending Budget');
        """
    )

    op.execute(
        """
        UPDATE requisitions
        SET overall_status = 'Approved & Unassigned'
        WHERE overall_status = 'Approved';
        """
    )

    op.execute(
        """
        UPDATE requisitions
        SET overall_status = 'In-Progress'
        WHERE overall_status = 'Active';
        """
    )

    op.execute(
        """
        UPDATE requisitions
        SET overall_status = 'Rejected'
        WHERE overall_status = 'Expired';
        """
    )

    op.create_check_constraint(
        "chk_requisition_status",
        "requisitions",
        """
        overall_status IN (
            'Pending Budget Approval',
            'Pending HR Approval',
            'Approved & Unassigned',
            'In-Progress',
            'Closed',
            'Rejected'
        )
        """,
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.execute(
        """
        ALTER TABLE requisitions
        DROP CONSTRAINT IF EXISTS chk_requisition_status;
        """
    )

    op.create_check_constraint(
        "chk_requisition_status",
        "requisitions",
        """
        overall_status IN (
            'Draft',
            'Pending Budget',
            'Approved',
            'Active',
            'Closed',
            'Expired'
        )
        """,
    )

    op.execute(
        """
        UPDATE requisitions
        SET overall_status = 'Draft'
        WHERE overall_status = 'Pending Budget Approval';
        """
    )

    op.execute(
        """
        UPDATE requisitions
        SET overall_status = 'Approved'
        WHERE overall_status = 'Approved & Unassigned';
        """
    )

    op.execute(
        """
        UPDATE requisitions
        SET overall_status = 'Active'
        WHERE overall_status = 'In-Progress';
        """
    )

    op.execute(
        """
        UPDATE requisitions
        SET overall_status = 'Expired'
        WHERE overall_status = 'Rejected';
        """
    )

    op.drop_column("requisitions", "approval_history")
    op.drop_column("requisitions", "approved_by")
