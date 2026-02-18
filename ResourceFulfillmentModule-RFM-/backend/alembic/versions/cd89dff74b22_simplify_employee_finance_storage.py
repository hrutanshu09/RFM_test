"""simplify employee finance storage

Revision ID: cd89dff74b22
Revises: 75ce56ac4e23
Create Date: 2026-01-21 11:38:57.822756
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "cd89dff74b22"
down_revision = "75ce56ac4e23"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Replace encrypted bank details with plain text storage.
    """

    # 1. Drop old encrypted column
    op.drop_column("employee_finance", "bank_details_encrypted")

    # 2. Add new plain-text column
    op.add_column(
        "employee_finance",
        sa.Column("bank_details", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    """
    Revert to encrypted storage (structure only).
    """

    # 1. Remove plain-text column
    op.drop_column("employee_finance", "bank_details")

    # 2. Restore encrypted column
    op.add_column(
        "employee_finance",
        sa.Column("bank_details_encrypted", sa.LargeBinary(), nullable=True)
    )
