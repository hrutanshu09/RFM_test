"""add partially fulfilled status

Revision ID: c8d1f2a3b4c5
Revises: 3b59fcfc4996
Create Date: 2026-02-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d1f2a3b4c5"
down_revision: Union[str, Sequence[str], None] = "3b59fcfc4996"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


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
            'Fulfilled',
            'Closed',
            'Closed (Partially Fulfilled)',
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
            'Active',
            'Fulfilled',
            'Closed',
            'Rejected'
        )
        """,
    )
