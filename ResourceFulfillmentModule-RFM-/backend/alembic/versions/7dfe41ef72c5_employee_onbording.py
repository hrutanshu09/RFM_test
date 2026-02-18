"""employee onboarding status support

Revision ID: 7dfe41ef72c5
Revises: cd89dff74b22
Create Date: 2026-01-22 09:40:35.487251
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# Alembic revision identifiers
revision: str = "7dfe41ef72c5"
down_revision: Union[str, Sequence[str], None] = "cd89dff74b22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add 'Onboarding' to employee status and set default."""
    
    # Drop old constraint
    op.drop_constraint(
        "chk_emp_status",
        "employees",
        type_="check"
    )

    # Create new constraint with onboarding
    op.create_check_constraint(
        "chk_emp_status",
        "employees",
        "emp_status IN ('Onboarding', 'Active', 'On Leave', 'Exited')"
    )

    # Set default to Onboarding
    op.alter_column(
        "employees",
        "emp_status",
        server_default=sa.text("'Onboarding'")
    )


def downgrade() -> None:
    """Revert employee status constraint and default."""
    
    op.drop_constraint(
        "chk_emp_status",
        "employees",
        type_="check"
    )

    op.create_check_constraint(
        "chk_emp_status",
        "employees",
        "emp_status IN ('Active', 'On Leave', 'Exited')"
    )

    op.alter_column(
        "employees",
        "emp_status",
        server_default=sa.text("'Active'")
    )