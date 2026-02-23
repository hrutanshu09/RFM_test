"""add projects tables

Revision ID: f4e99b7d5fc1
Revises: b5e6f7a8c9d0
Create Date: 2026-02-23 16:52:18.037283

"""
from alembic import op
import sqlalchemy as sa

revision = 'f4e99b7d5fc1'
down_revision = 'f9e099ded9c6' # Matches the previous head in your versions folder
branch_labels = None
depends_on = None

def upgrade():
    # 1. projects
    op.create_table(
        'projects',
        sa.Column('project_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_name', sa.String(length=200), nullable=False),
        sa.Column('client_name', sa.String(length=200), nullable=True),
        sa.Column('project_status', sa.String(length=30), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('project_id'),
        sa.CheckConstraint("project_status IN ('Active', 'On Hold', 'Completed', 'Cancelled')", name='chk_project_status')
    )
    op.create_index('ix_projects_status', 'projects', ['project_status'])

    # 2. project_managers
    op.create_table(
        'project_managers',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('manager_user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=False),
        sa.Column('assigned_from', sa.Date(), nullable=False),
        sa.Column('assigned_to', sa.Date(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.ForeignKeyConstraint(['manager_user_id'], ['users.user_id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.project_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_project_managers_project_id', 'project_managers', ['project_id'])
    op.create_index('ix_project_managers_manager_user_id', 'project_managers', ['manager_user_id'])

    # 3. project_timelines
    op.create_table(
        'project_timelines',
        sa.Column('timeline_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('planned_end_date', sa.Date(), nullable=False),
        sa.Column('actual_end_date', sa.Date(), nullable=True),
        sa.Column('version_number', sa.Integer(), server_default='1', nullable=False),
        sa.Column('reason_for_change', sa.Text(), nullable=True),
        sa.Column('is_current', sa.Boolean(), server_default='true', nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.project_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('timeline_id')
    )
    op.create_index('ix_project_timelines_project_id', 'project_timelines', ['project_id'])
    op.create_index(
        'ix_unique_current_timeline',
        'project_timelines',
        ['project_id'],
        unique=True,
        postgresql_where=sa.text('is_current = true')
    )

    # 4. employee_project_assignments
    op.create_table(
        'employee_project_assignments',
        sa.Column('assignment_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('emp_id', sa.String(length=20), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=100), nullable=True),
        sa.Column('allocation_pct', sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(['emp_id'], ['employees.emp_id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.project_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('assignment_id'),
        sa.CheckConstraint('allocation_pct >= 0 AND allocation_pct <= 100', name='chk_allocation_pct'),
        sa.CheckConstraint("status IN ('Planned', 'Active', 'Ended')", name='chk_assignment_status')
    )
    op.create_index('ix_employee_project_assignments_emp_id', 'employee_project_assignments', ['emp_id'])
    op.create_index('ix_employee_project_assignments_project_id', 'employee_project_assignments', ['project_id'])

def downgrade():
    op.drop_table('employee_project_assignments')
    op.drop_table('project_timelines')
    op.drop_table('project_managers')
    op.drop_table('projects')