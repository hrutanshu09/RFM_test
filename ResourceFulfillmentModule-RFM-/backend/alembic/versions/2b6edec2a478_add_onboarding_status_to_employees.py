"""add_onboarding_status_to_employees

Revision ID: 2b6edec2a478
Revises: 7dfe41ef72c5
Create Date: 2026-01-22 12:52:47.285412

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2b6edec2a478'
down_revision: Union[str, Sequence[str], None] = '7dfe41ef72c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Drop the old constraint
    op.drop_constraint('chk_emp_status', 'employees', type_='check')
    
    # Add the new constraint with Onboarding status
    op.create_check_constraint(
        'chk_emp_status',
        'employees',
        "emp_status IN ('Onboarding', 'Active', 'On Leave', 'Exited')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Drop the new constraint
    op.drop_constraint('chk_emp_status', 'employees', type_='check')
    
    # Restore the old constraint
    op.create_check_constraint(
        'chk_emp_status',
        'employees',
        "emp_status IN ('Active', 'On Leave', 'Exited')"
    )
