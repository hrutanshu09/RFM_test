"""employee assignment approval workflow

Revision ID: 6a2b1bbf7c90
Revises: 4c6d9f6d8a11
Create Date: 2026-03-04 16:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6a2b1bbf7c90"
down_revision: Union[str, Sequence[str], None] = "4c6d9f6d8a11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "employee_project_assignments",
        sa.Column(
            "approval_status",
            sa.String(length=20),
            nullable=False,
            server_default="Pending",
        ),
    )
    op.add_column(
        "employee_project_assignments",
        sa.Column("approved_by_manager_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "employee_project_assignments",
        sa.Column("approved_at", sa.TIMESTAMP(), nullable=True),
    )
    op.add_column(
        "employee_project_assignments",
        sa.Column("approval_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "employee_project_assignments",
        sa.Column("approval_requested_by_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "employee_project_assignments",
        sa.Column("approval_requested_at", sa.TIMESTAMP(), nullable=True),
    )
    op.create_foreign_key(
        "fk_assignment_approved_by_manager",
        "employee_project_assignments",
        "users",
        ["approved_by_manager_id"],
        ["user_id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_assignment_requested_by_user",
        "employee_project_assignments",
        "users",
        ["approval_requested_by_user_id"],
        ["user_id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "chk_assignment_approval_status",
        "employee_project_assignments",
        "approval_status IN ('Pending', 'Approved', 'Rejected')",
    )
    op.execute(
        """
        UPDATE employee_project_assignments
        SET
            approval_status = 'Approved',
            approval_note = 'Backfilled as approved',
            approval_requested_at = NOW(),
            approved_at = NOW()
        WHERE approval_status IS NULL
        """
    )
    op.alter_column("employee_project_assignments", "approval_status", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "chk_assignment_approval_status",
        "employee_project_assignments",
        type_="check",
    )
    op.drop_constraint(
        "fk_assignment_requested_by_user",
        "employee_project_assignments",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_assignment_approved_by_manager",
        "employee_project_assignments",
        type_="foreignkey",
    )
    op.drop_column("employee_project_assignments", "approval_requested_at")
    op.drop_column("employee_project_assignments", "approval_requested_by_user_id")
    op.drop_column("employee_project_assignments", "approval_note")
    op.drop_column("employee_project_assignments", "approved_at")
    op.drop_column("employee_project_assignments", "approved_by_manager_id")
    op.drop_column("employee_project_assignments", "approval_status")
