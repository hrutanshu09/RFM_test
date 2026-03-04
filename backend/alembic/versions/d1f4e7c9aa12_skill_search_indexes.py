"""skill search indexes

Revision ID: d1f4e7c9aa12
Revises: 6a2b1bbf7c90
Create Date: 2026-03-04 19:45:00.000000

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "d1f4e7c9aa12"
down_revision: Union[str, Sequence[str], None] = "6a2b1bbf7c90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_skills_skill_name ON skills (skill_name)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_employee_skills_skill_id ON employee_skills (skill_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_employee_skills_emp_id ON employee_skills (emp_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_employee_project_assignments_project_emp "
        "ON employee_project_assignments (project_id, emp_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_employee_project_assignments_project_emp")
    op.execute("DROP INDEX IF EXISTS ix_employee_skills_emp_id")
    op.execute("DROP INDEX IF EXISTS ix_employee_skills_skill_id")
    op.execute("DROP INDEX IF EXISTS ix_skills_skill_name")
