"""
Production Hardening — Workflow Observability Indexes

Revision ID: wf_observability_indexes
Revises: wf_defense_indexes
Create Date: 2026-02-05

This migration adds indexes optimized for workflow audit queries:
1. Composite index for requisition audit lookups
2. Composite index for user activity queries
3. Index for time-based queries
4. Partial indexes for active entities
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = 'wf_observability_indexes'
down_revision = 'wf_defense_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add observability-optimized indexes."""
    
    # Index for audit log queries by entity (most common query)
    op.create_index(
        'ix_wf_audit_entity_lookup',
        'workflow_transition_audit',
        ['entity_type', 'entity_id', 'created_at'],
        postgresql_using='btree',
    )
    
    # Index for user activity queries
    op.create_index(
        'ix_wf_audit_user_activity',
        'workflow_transition_audit',
        ['performed_by', 'created_at'],
        postgresql_using='btree',
    )
    
    # Index for time-based queries (metrics, statistics)
    op.create_index(
        'ix_wf_audit_time_stats',
        'workflow_transition_audit',
        ['created_at', 'action'],
        postgresql_using='btree',
    )
    
    # Index for action-based grouping
    op.create_index(
        'ix_wf_audit_action_entity',
        'workflow_transition_audit',
        ['action', 'entity_type'],
        postgresql_using='btree',
    )
    
    # Note: Partial index with NOW() is not possible as NOW() is not IMMUTABLE
    # Instead, we rely on the composite indexes above for time-based queries
    # If needed, schedule periodic index maintenance or use table partitioning
    
    # Index on requisition status for dashboard queries
    op.create_index(
        'ix_requisitions_status_created',
        'requisitions',
        ['overall_status', 'created_at'],
        postgresql_using='btree',
        if_not_exists=True,
    )
    
    # Index on requisition item status + req_id for sync queries
    op.create_index(
        'ix_req_items_sync_lookup',
        'requisition_items',
        ['req_id', 'item_status'],
        postgresql_using='btree',
        if_not_exists=True,
    )


def downgrade() -> None:
    """Remove observability indexes."""
    
    op.drop_index('ix_wf_audit_entity_lookup', table_name='workflow_transition_audit')
    op.drop_index('ix_wf_audit_user_activity', table_name='workflow_transition_audit')
    op.drop_index('ix_wf_audit_time_stats', table_name='workflow_transition_audit')
    op.drop_index('ix_wf_audit_action_entity', table_name='workflow_transition_audit')
    
    op.drop_index('ix_requisitions_status_created', table_name='requisitions', if_exists=True)
    op.drop_index('ix_req_items_sync_lookup', table_name='requisition_items', if_exists=True)
