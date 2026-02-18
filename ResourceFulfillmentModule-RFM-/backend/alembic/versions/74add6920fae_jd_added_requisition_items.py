"""jd added requisition items 

Revision ID: 74add6920fae
Revises: 66e350b8481e
Create Date: 2026-01-28 13:03:35.586965

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '74add6920fae'
down_revision: Union[str, Sequence[str], None] = '66e350b8481e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # Step 1: add column with temporary default
    op.add_column(
        'requisition_items',
        sa.Column(
            'job_description',
            sa.Text(),
            nullable=False,
            server_default=''
        )
    )

    # Step 2: remove default so future inserts must provide JD
    op.alter_column(
        'requisition_items',
        'job_description',
        server_default=None
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('requisition_items', 'job_description')
