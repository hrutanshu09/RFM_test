"""add billing details to assignments

Revision ID: c902b3e54d54
Revises: 49a9af602989
Create Date: 2026-02-25 10:58:39.248942

"""
from alembic import op
import sqlalchemy as sa

revision = 'c902b3e54d54'
down_revision = '49a9af602989'
branch_labels = None
depends_on = None

def upgrade():
    # Adding billing and metadata columns to employee_project_assignments
    op.add_column('employee_project_assignments', sa.Column('billing_rate', sa.Numeric(precision=10, scale=2), nullable=True))
    op.add_column('employee_project_assignments', sa.Column('billing_start_date', sa.Date(), nullable=True))
    op.add_column('employee_project_assignments', sa.Column('billing_end_date', sa.Date(), nullable=True))
    op.add_column('employee_project_assignments', sa.Column('is_billable', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('employee_project_assignments', sa.Column('timesheet_required', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('employee_project_assignments', sa.Column('client_pm_name', sa.String(length=200), nullable=True))
    op.add_column('employee_project_assignments', sa.Column('billing_project_id', sa.Integer(), nullable=True))
    
    # Add ForeignKey for billing_project_id (referencing the projects table)
    op.create_foreign_key(
        'fk_assignment_billing_project',
        'employee_project_assignments', 'projects',
        ['billing_project_id'], ['project_id'],
        ondelete='SET NULL'
    )

def downgrade():
    op.drop_constraint('fk_assignment_billing_project', 'employee_project_assignments', type_='foreignkey')
    op.drop_column('employee_project_assignments', 'billing_project_id')
    op.drop_column('employee_project_assignments', 'client_pm_name')
    op.drop_column('employee_project_assignments', 'timesheet_required')
    op.drop_column('employee_project_assignments', 'is_billable')
    op.drop_column('employee_project_assignments', 'billing_end_date')
    op.drop_column('employee_project_assignments', 'billing_start_date')
    op.drop_column('employee_project_assignments', 'billing_rate')
