"""fix requisition status constraint to include Active

Revision ID: f3a9c1d2b4e6
Revises: e2f7a9c4f1b2
Create Date: 2026-01-31 00:00:00.000000
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "f3a9c1d2b4e6"
down_revision = "e2f7a9c4f1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("chk_requisition_status", "requisitions", type_="check")
    op.create_check_constraint(
        "chk_requisition_status",
        "requisitions",
        """
        overall_status IN (
            'Pending Budget Approval',
            'Pending HR Approval',
            'Approved & Unassigned',
            'Active',
            'Closed',
            'Rejected'
        )
        """,
    )


def downgrade() -> None:
    op.drop_constraint("chk_requisition_status", "requisitions", type_="check")
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
