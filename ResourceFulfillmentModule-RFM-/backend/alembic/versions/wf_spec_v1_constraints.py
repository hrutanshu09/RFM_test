"""Add version column and update status constraints for workflow specification v1.0.0

Revision ID: wf_spec_v1_constraints
Revises: 42c538a9ab8e
Create Date: 2026-02-05

This migration:
1. Adds version column to requisitions table (optimistic locking)
2. Adds version column to requisition_items table (optimistic locking)
3. Updates requisition overall_status CHECK constraint to match specification
4. Updates requisition_item item_status CHECK constraint to match specification
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'wf_spec_v1_constraints'
down_revision = '42c538a9ab8e'
branch_labels = None
depends_on = None


# Specification v1.0.0 status values
HEADER_STATUSES = [
    'Draft',
    'Pending_Budget',
    'Pending_HR',
    'Active',
    'Fulfilled',
    'Rejected',
    'Cancelled',
]

ITEM_STATUSES = [
    'Pending',
    'Sourcing',
    'Shortlisted',
    'Interviewing',
    'Offered',
    'Fulfilled',
    'Cancelled',
]


def upgrade() -> None:
    # --------------------------------------------------------------------------
    # Add version columns for optimistic locking
    # --------------------------------------------------------------------------
    
    # Add version column to requisitions
    op.add_column(
        'requisitions',
        sa.Column('version', sa.Integer(), nullable=False, server_default='1')
    )
    
    # Add version column to requisition_items
    op.add_column(
        'requisition_items',
        sa.Column('version', sa.Integer(), nullable=False, server_default='1')
    )
    
    # --------------------------------------------------------------------------
    # Drop old constraints FIRST (so data migration doesn't violate them)
    # --------------------------------------------------------------------------
    
    # Drop old requisition status constraint
    op.drop_constraint('chk_requisition_status', 'requisitions', type_='check')
    
    # Drop old requisition_item status constraint  
    op.drop_constraint('chk_requisition_item_status', 'requisition_items', type_='check')
    
    # --------------------------------------------------------------------------
    # Migrate existing data to new status values
    # --------------------------------------------------------------------------
    
    # Old status -> New status mapping for requisitions
    header_status_mapping = {
        'Pending Budget Approval': 'Pending_Budget',
        'Pending HR Approval': 'Pending_HR',
        'Approved & Unassigned': 'Active',
        'Closed': 'Cancelled',
        'Closed (Partially Fulfilled)': 'Cancelled',
        # These remain the same:
        # 'Draft' -> 'Draft'
        # 'Active' -> 'Active'
        # 'Fulfilled' -> 'Fulfilled'
        # 'Rejected' -> 'Rejected'
    }
    
    # Run UPDATE statements to transform existing data
    for old_status, new_status in header_status_mapping.items():
        op.execute(
            f"UPDATE requisitions SET overall_status = '{new_status}' WHERE overall_status = '{old_status}'"
        )
    
    # --------------------------------------------------------------------------
    # Create new constraints with specification-compliant values
    # --------------------------------------------------------------------------
    
    # Create new requisition status constraint
    op.create_check_constraint(
        'chk_requisition_status',
        'requisitions',
        f"overall_status IN ({', '.join([repr(s) for s in HEADER_STATUSES])})"
    )
    
    # Create new requisition_item status constraint
    op.create_check_constraint(
        'chk_requisition_item_status',
        'requisition_items',
        f"item_status IN ({', '.join([repr(s) for s in ITEM_STATUSES])})"
    )
    
    # --------------------------------------------------------------------------
    # Add fulfillment constraint (GC-004)
    # Uses NOT VALID to not check existing rows (legacy data may have Fulfilled without employee)
    # Constraint will be enforced for all new/updated rows going forward
    # --------------------------------------------------------------------------
    
    # FULFILLED items must have employee assigned
    # Using raw SQL with NOT VALID to allow existing data that violates constraint
    op.execute("""
        ALTER TABLE requisition_items 
        ADD CONSTRAINT chk_fulfilled_has_employee 
        CHECK (item_status != 'Fulfilled' OR assigned_emp_id IS NOT NULL)
        NOT VALID
    """)


def downgrade() -> None:
    # --------------------------------------------------------------------------
    # Remove fulfillment constraint
    # --------------------------------------------------------------------------
    op.drop_constraint('chk_fulfilled_has_employee', 'requisition_items', type_='check')
    
    # --------------------------------------------------------------------------
    # Restore old requisition_item status constraint
    # --------------------------------------------------------------------------
    op.drop_constraint('chk_requisition_item_status', 'requisition_items', type_='check')
    
    op.create_check_constraint(
        'chk_requisition_item_status',
        'requisition_items',
        """
        item_status IN (
            'Pending',
            'Sourcing',
            'Shortlisted',
            'Fulfilled',
            'Cancelled'
        )
        """
    )
    
    # --------------------------------------------------------------------------
    # Restore old requisition status constraint
    # --------------------------------------------------------------------------
    op.drop_constraint('chk_requisition_status', 'requisitions', type_='check')
    
    op.create_check_constraint(
        'chk_requisition_status',
        'requisitions',
        """
        overall_status IN (
            'Pending Budget Approval',
            'Pending HR Approval',
            'Approved & Unassigned',
            'Active',
            'Fulfilled',
            'Closed',
            'Closed (Partially Fulfilled)',
            'Rejected'
        )
        """
    )
    
    # --------------------------------------------------------------------------
    # Remove version columns
    # --------------------------------------------------------------------------
    op.drop_column('requisition_items', 'version')
    op.drop_column('requisitions', 'version')
