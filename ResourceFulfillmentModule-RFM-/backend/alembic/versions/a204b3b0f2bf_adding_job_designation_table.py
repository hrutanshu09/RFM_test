"""adding job designation table

Revision ID: a204b3b0f2bf
Revises: f3a9c1d2b4e6
Create Date: 2026-02-02 09:20:26.682183

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a204b3b0f2bf'
down_revision: Union[str, Sequence[str], None] = 'f3a9c1d2b4e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --------------------------------------------------
    # 1️⃣ Create company_roles table
    # --------------------------------------------------
    op.create_table(
        "company_roles",
        sa.Column("role_id", sa.Integer(), primary_key=True),
        sa.Column("role_name", sa.String(length=100), nullable=False, unique=True),
        sa.Column("role_description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # --------------------------------------------------
    # 2️⃣ Add company_role_id column to employees
    # --------------------------------------------------
    op.add_column(
        "employees",
        sa.Column("company_role_id", sa.Integer(), nullable=True),
    )

    # --------------------------------------------------
    # 3️⃣ Add Foreign Key Constraint
    # --------------------------------------------------
    op.create_foreign_key(
        "fk_employees_company_role",
        "employees",
        "company_roles",
        ["company_role_id"],
        ["role_id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # --------------------------------------------------
    # 1️⃣ Drop Foreign Key
    # --------------------------------------------------
    op.drop_constraint(
        "fk_employees_company_role",
        "employees",
        type_="foreignkey",
    )

    # --------------------------------------------------
    # 2️⃣ Drop Column from employees
    # --------------------------------------------------
    op.drop_column("employees", "company_role_id")

    # --------------------------------------------------
    # 3️⃣ Drop company_roles table
    # --------------------------------------------------
    op.drop_table("company_roles")