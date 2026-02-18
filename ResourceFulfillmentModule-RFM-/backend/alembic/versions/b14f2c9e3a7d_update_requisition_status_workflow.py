"""Update requisition status workflow

Revision ID: b14f2c9e3a7d
Revises: a4da1ccd6324
Create Date: 2026-01-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b14f2c9e3a7d'
down_revision: Union[str, Sequence[str], None] = 'f9e099ded9c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # Normalize existing statuses to fit new workflow
    op.execute("""
        UPDATE requisitions
        SET overall_status = 'Approved'
        WHERE overall_status IN ('Pending HR', 'Approved & Unassigned');
    """)

    # Replace status constraint
    op.execute("""
        ALTER TABLE requisitions
        DROP CONSTRAINT IF EXISTS chk_requisition_status;
    """)

    op.create_check_constraint(
        'chk_requisition_status',
        'requisitions',
        """
        overall_status IN (
            'Draft',
            'Pending Budget',
            'Approved',
            'Active',
            'Closed',
            'Expired'
        )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""

    # Normalize statuses back to previous workflow
    op.execute("""
        UPDATE requisitions
        SET overall_status = 'Approved & Unassigned'
        WHERE overall_status = 'Approved';
    """)

    op.execute("""
        UPDATE requisitions
        SET overall_status = 'Pending Budget'
        WHERE overall_status = 'Draft';
    """)

    # Restore prior constraint
    op.execute("""
        ALTER TABLE requisitions
        DROP CONSTRAINT IF EXISTS chk_requisition_status;
    """)

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
