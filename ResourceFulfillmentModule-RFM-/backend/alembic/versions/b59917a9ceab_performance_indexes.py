"""performance indexes

Revision ID: b59917a9ceab
Revises: 0e30de8a4a10
Create Date: 2026-01-19 17:07:25.630190

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b59917a9ceab'
down_revision: Union[str, Sequence[str], None] = '0e30de8a4a10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Employee filtering
    op.create_index(
        "idx_employee_status",
        "employees",
        ["emp_status"]
    )

    # Requisition workflow filtering
    op.create_index(
        "idx_requisition_status",
        "requisitions",
        ["status"]
    )

    op.create_index(
        "idx_requisition_priority",
        "requisitions",
        ["priority"]
    )

    # Skill-based employee matching
    op.create_index(
        "idx_employee_skill",
        "employee_skills",
        ["skill_id"]
    )

    # Manager reporting
    op.create_index(
        "idx_assignment_manager",
        "employee_assignments",
        ["manager_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_assignment_manager", table_name="employee_assignments")
    op.drop_index("idx_employee_skill", table_name="employee_skills")
    op.drop_index("idx_requisition_priority", table_name="requisitions")
    op.drop_index("idx_requisition_status", table_name="requisitions")
    op.drop_index("idx_employee_status", table_name="employees")
