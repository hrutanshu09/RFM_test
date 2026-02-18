"""
Workflow Transition Audit Model

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This model provides detailed audit logging for workflow transitions with:
- Version tracking (before/after)
- Comprehensive metadata capture
- Denormalized fields for query performance
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    TIMESTAMP,
    ForeignKey,
    Index,
)
from sqlalchemy.sql import func
from db.base import Base


class WorkflowTransitionAudit(Base):
    """
    Comprehensive audit log for workflow transitions.
    
    Each transition creates exactly one record in this table.
    Records are immutable (append-only).
    """
    __tablename__ = "workflow_transition_audit"

    # --------------------
    # Primary Key
    # --------------------
    audit_id = Column(Integer, primary_key=True)

    # --------------------
    # Entity Reference
    # --------------------
    entity_type = Column(
        String(30),
        nullable=False,
        index=True
    )  # 'requisition' or 'requisition_item'
    
    entity_id = Column(
        Integer,
        nullable=False,
        index=True
    )

    # --------------------
    # Transition Details
    # --------------------
    action = Column(
        String(50),
        nullable=False,
        index=True
    )  # e.g., 'SUBMIT', 'APPROVE_BUDGET', 'FULFILL'
    
    from_status = Column(
        String(30),
        nullable=False
    )
    
    to_status = Column(
        String(30),
        nullable=False
    )

    # --------------------
    # Version Tracking (Optimistic Lock)
    # --------------------
    version_before = Column(
        Integer,
        nullable=False
    )
    
    version_after = Column(
        Integer,
        nullable=False
    )

    # --------------------
    # Actor Information
    # --------------------
    performed_by = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,  # NULL = SYSTEM action
        index=True
    )
    
    user_roles = Column(
        String(200),
        nullable=True
    )  # Comma-separated roles at time of action

    # --------------------
    # Reason / Justification
    # --------------------
    reason = Column(
        Text,
        nullable=True
    )

    # --------------------
    # Context Metadata (JSON)
    # --------------------
    transition_metadata = Column(
        Text,
        nullable=True
    )  # JSON-serialized additional context

    # --------------------
    # Timestamps
    # --------------------
    created_at = Column(
        TIMESTAMP,
        nullable=False,
        server_default=func.now(),
        index=True
    )

    # --------------------
    # Indexes for Common Queries
    # --------------------
    __table_args__ = (
        # Composite index for entity lookup
        Index('ix_wf_audit_entity', 'entity_type', 'entity_id'),
        # Composite index for time-range queries
        Index('ix_wf_audit_entity_time', 'entity_type', 'entity_id', 'created_at'),
        # Actor activity lookup
        Index('ix_wf_audit_actor_time', 'performed_by', 'created_at'),
    )
