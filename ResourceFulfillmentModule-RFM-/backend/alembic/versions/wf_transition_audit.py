"""Create workflow_transition_audit table

Revision ID: wf_transition_audit
Revises: wf_spec_v1_constraints
Create Date: 2026-02-05

This migration creates the workflow_transition_audit table for
comprehensive workflow audit logging with version tracking.
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'wf_transition_audit'
down_revision = 'wf_spec_v1_constraints'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create workflow_transition_audit table
    op.create_table(
        'workflow_transition_audit',
        sa.Column('audit_id', sa.Integer(), primary_key=True),
        
        # Entity reference
        sa.Column('entity_type', sa.String(30), nullable=False, index=True),
        sa.Column('entity_id', sa.Integer(), nullable=False, index=True),
        
        # Transition details
        sa.Column('action', sa.String(50), nullable=False, index=True),
        sa.Column('from_status', sa.String(30), nullable=False),
        sa.Column('to_status', sa.String(30), nullable=False),
        
        # Version tracking
        sa.Column('version_before', sa.Integer(), nullable=False),
        sa.Column('version_after', sa.Integer(), nullable=False),
        
        # Actor information
        sa.Column('performed_by', sa.Integer(), 
                  sa.ForeignKey('users.user_id', ondelete='SET NULL'), 
                  nullable=True, index=True),
        sa.Column('user_roles', sa.String(200), nullable=True),
        
        # Reason/justification
        sa.Column('reason', sa.Text(), nullable=True),
        
        # Metadata (JSON) - named transition_metadata to avoid SQLAlchemy reserved word
        sa.Column('transition_metadata', sa.Text(), nullable=True),
        
        # Timestamps
        sa.Column('created_at', sa.TIMESTAMP(), 
                  server_default=sa.func.now(), 
                  nullable=False, index=True),
    )
    
    # Create composite indexes for common queries
    op.create_index(
        'ix_wf_audit_entity',
        'workflow_transition_audit',
        ['entity_type', 'entity_id']
    )
    op.create_index(
        'ix_wf_audit_entity_time',
        'workflow_transition_audit',
        ['entity_type', 'entity_id', 'created_at']
    )
    op.create_index(
        'ix_wf_audit_actor_time',
        'workflow_transition_audit',
        ['performed_by', 'created_at']
    )


def downgrade() -> None:
    # Drop indexes first
    op.drop_index('ix_wf_audit_actor_time', 'workflow_transition_audit')
    op.drop_index('ix_wf_audit_entity_time', 'workflow_transition_audit')
    op.drop_index('ix_wf_audit_entity', 'workflow_transition_audit')
    
    # Drop table
    op.drop_table('workflow_transition_audit')
