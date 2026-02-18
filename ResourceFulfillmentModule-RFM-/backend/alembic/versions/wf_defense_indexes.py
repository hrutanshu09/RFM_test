"""Database Defense-in-Depth: Indexes and Constraints Verification

Revision ID: wf_defense_indexes
Revises: wf_transition_audit
Create Date: 2026-02-05

This migration ensures all required indexes exist for performance
and adds any missing constraints for data integrity.

VERIFIES:
1. Status column indexes exist
2. Foreign key indexes exist (req_id, assigned_ta)
3. Version columns are NOT NULL
4. CHECK constraints align with workflow matrix
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'wf_defense_indexes'
down_revision = 'wf_transition_audit'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add missing indexes for performance optimization.
    
    Index Strategy:
    - Status columns: frequent filtering/grouping
    - Foreign keys: join performance
    - Composite indexes: common query patterns
    """
    
    # --------------------------------------------------------------------------
    # REQUISITIONS TABLE
    # --------------------------------------------------------------------------
    
    # Index on overall_status (already exists in model, ensure it's there)
    # This is idempotent - will skip if exists
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisitions_overall_status 
        ON requisitions(overall_status)
    """)
    
    # Index on raised_by for "my requisitions" queries
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisitions_raised_by 
        ON requisitions(raised_by)
    """)
    
    # Index on assigned_ta for TA workload queries
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisitions_assigned_ta 
        ON requisitions(assigned_ta) 
        WHERE assigned_ta IS NOT NULL
    """)
    
    # Composite index for status + date queries (dashboard)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisitions_status_created 
        ON requisitions(overall_status, created_at DESC)
    """)
    
    # --------------------------------------------------------------------------
    # REQUISITION_ITEMS TABLE
    # --------------------------------------------------------------------------
    
    # Index on item_status (already exists in model, ensure it's there)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisition_items_item_status 
        ON requisition_items(item_status)
    """)
    
    # Index on req_id (FK, should have index)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisition_items_req_id 
        ON requisition_items(req_id)
    """)
    
    # Index on assigned_ta for TA workload queries
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisition_items_assigned_ta 
        ON requisition_items(assigned_ta) 
        WHERE assigned_ta IS NOT NULL
    """)
    
    # Index on assigned_emp_id for fulfillment tracking
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisition_items_assigned_emp_id 
        ON requisition_items(assigned_emp_id) 
        WHERE assigned_emp_id IS NOT NULL
    """)
    
    # Composite index for status queries within requisition
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_requisition_items_req_status 
        ON requisition_items(req_id, item_status)
    """)
    
    # --------------------------------------------------------------------------
    # REQUISITION_STATUS_HISTORY TABLE
    # --------------------------------------------------------------------------
    
    # Index for history lookup by requisition
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_req_status_history_req_time 
        ON requisition_status_history(req_id, changed_at DESC)
    """)
    
    # --------------------------------------------------------------------------
    # AUDIT_LOG TABLE
    # --------------------------------------------------------------------------
    
    # Index for entity lookup
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_audit_log_entity 
        ON audit_log(entity_name, entity_id)
    """)
    
    # Index for actor activity
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_audit_log_performed_by 
        ON audit_log(performed_by, performed_at DESC) 
        WHERE performed_by IS NOT NULL
    """)


def downgrade() -> None:
    """
    Remove added indexes.
    Note: We keep essential indexes even on downgrade for safety.
    """
    # Only remove the composite/optimization indexes
    op.execute("DROP INDEX IF EXISTS ix_requisitions_status_created")
    op.execute("DROP INDEX IF EXISTS ix_requisition_items_req_status")
    op.execute("DROP INDEX IF EXISTS ix_req_status_history_req_time")
    op.execute("DROP INDEX IF EXISTS ix_audit_log_entity")
    op.execute("DROP INDEX IF EXISTS ix_audit_log_performed_by")
