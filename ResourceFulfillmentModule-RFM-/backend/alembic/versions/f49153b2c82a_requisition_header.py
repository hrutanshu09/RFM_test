"""requisition_header

Revision ID: f49153b2c82a
Revises: 4f2c1c7b9e21
Create Date: 2026-01-28 10:37:58.607755
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f49153b2c82a'
down_revision: Union[str, Sequence[str], None] = '4f2c1c7b9e21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    # -----------------------------
    # RENAME EXISTING COLUMNS
    # -----------------------------
    op.alter_column(
        'requisitions',
        'status',
        new_column_name='overall_status'
    )

    op.alter_column(
        'requisitions',
        'required_by',
        new_column_name='required_by_date'
    )

    op.alter_column(
        'requisitions',
        'budget',
        new_column_name='budget_amount'
    )

    # -----------------------------
    # ADD MISSING COLUMNS
    # -----------------------------
    op.add_column(
        'requisitions',
        sa.Column('assigned_ta', sa.Integer(), sa.ForeignKey('users.user_id'))
    )

    op.add_column(
        'requisitions',
        sa.Column('is_replacement', sa.Boolean(), server_default=sa.false())
    )

    op.add_column(
        'requisitions',
        sa.Column('duration', sa.String(length=50))
    )

    op.add_column(
        'requisitions',
        sa.Column('date_closed', sa.DateTime())
    )

    op.add_column(
        'requisitions',
        sa.Column('work_mode', sa.String(length=10))
    )

    op.add_column(
        'requisitions',
        sa.Column('office_location', sa.String(length=100))
    )

    # -----------------------------
    # ADD CHECK CONSTRAINTS
    # -----------------------------
    op.create_check_constraint(
        'chk_requisition_work_mode',
        'requisitions',
        "work_mode IN ('WFO', 'WFH', 'Hybrid')"
    )


def downgrade() -> None:
    """Downgrade schema."""

    # -----------------------------
    # DROP CONSTRAINTS
    # -----------------------------
    op.drop_constraint(
        'chk_requisition_work_mode',
        'requisitions',
        type_='check'
    )

    # -----------------------------
    # DROP ADDED COLUMNS
    # -----------------------------
    op.drop_column('requisitions', 'office_location')
    op.drop_column('requisitions', 'work_mode')
    op.drop_column('requisitions', 'date_closed')
    op.drop_column('requisitions', 'duration')
    op.drop_column('requisitions', 'is_replacement')
    op.drop_column('requisitions', 'assigned_ta')

    # -----------------------------
    # RENAME COLUMNS BACK
    # -----------------------------
    op.alter_column(
        'requisitions',
        'overall_status',
        new_column_name='status'
    )

    op.alter_column(
        'requisitions',
        'required_by_date',
        new_column_name='required_by'
    )

    op.alter_column(
        'requisitions',
        'budget_amount',
        new_column_name='budget'
    )
