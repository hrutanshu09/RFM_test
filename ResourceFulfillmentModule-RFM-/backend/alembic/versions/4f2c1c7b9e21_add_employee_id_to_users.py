"""add_employee_id_to_users

Revision ID: 4f2c1c7b9e21
Revises: 3c1a8f2b0f12
Create Date: 2026-01-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4f2c1c7b9e21"
down_revision: Union[str, Sequence[str], None] = "3c1a8f2b0f12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("users", sa.Column("employee_id", sa.String(length=20), nullable=True))
    op.create_foreign_key(
        "fk_users_employee_id_employees",
        "users",
        "employees",
        ["employee_id"],
        ["emp_id"],
    )
    op.create_unique_constraint("uq_users_employee_id", "users", ["employee_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("uq_users_employee_id", "users", type_="unique")
    op.drop_constraint("fk_users_employee_id_employees", "users", type_="foreignkey")
    op.drop_column("users", "employee_id")
