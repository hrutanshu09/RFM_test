"""project approval workflow

Revision ID: 4c6d9f6d8a11
Revises: a8823a2289fb
Create Date: 2026-03-04 12:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4c6d9f6d8a11"
down_revision: Union[str, Sequence[str], None] = "a8823a2289fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "approval_status",
            sa.String(length=20),
            nullable=False,
            server_default="Pending",
        ),
    )
    op.add_column(
        "projects",
        sa.Column("approved_by_manager_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("approved_at", sa.TIMESTAMP(), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("approval_note", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_projects_approved_by_manager",
        "projects",
        "users",
        ["approved_by_manager_id"],
        ["user_id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "chk_project_approval_status",
        "projects",
        "approval_status IN ('Pending', 'Approved', 'Rejected')",
    )
    op.execute(
        "UPDATE projects SET approval_status = 'Pending' WHERE approval_status IS NULL"
    )
    op.alter_column("projects", "approval_status", server_default=None)


def downgrade() -> None:
    op.drop_constraint("chk_project_approval_status", "projects", type_="check")
    op.drop_constraint("fk_projects_approved_by_manager", "projects", type_="foreignkey")
    op.drop_column("projects", "approval_note")
    op.drop_column("projects", "approved_at")
    op.drop_column("projects", "approved_by_manager_id")
    op.drop_column("projects", "approval_status")
