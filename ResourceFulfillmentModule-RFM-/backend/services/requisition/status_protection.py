"""
Status Protection Layer

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module provides SQLAlchemy event listeners to prevent direct status mutations.
All status changes MUST go through the WorkflowEngine.

Governance Rule GC-001: No actor may directly edit status. All transitions via WorkflowEngine.
"""

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session
from contextlib import contextmanager
from threading import local

from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem


# Thread-local storage for tracking workflow context
_workflow_context = local()


def is_in_workflow_context() -> bool:
    """Check if current thread is executing within a workflow transition."""
    return getattr(_workflow_context, 'active', False)


@contextmanager
def workflow_transition_context():
    """
    Context manager that marks the current execution as a workflow transition.
    
    Only code executing within this context is allowed to modify status fields.
    
    Usage:
        with workflow_transition_context():
            requisition.overall_status = new_status
    """
    previous = getattr(_workflow_context, 'active', False)
    _workflow_context.active = True
    try:
        yield
    finally:
        _workflow_context.active = previous


class StatusProtectionError(Exception):
    """Raised when an unauthorized status mutation is attempted."""
    def __init__(self, entity_type: str, entity_id, field: str, old_value: str, new_value: str):
        self.entity_type = entity_type
        self.entity_id = entity_id
        self.field = field
        self.old_value = old_value
        self.new_value = new_value
        super().__init__(
            f"BLOCKED: Direct mutation of {entity_type}.{field} "
            f"(id={entity_id}) from '{old_value}' to '{new_value}'. "
            f"Use WorkflowEngine for status transitions. (GC-001)"
        )


def _check_requisition_status_change(mapper, connection, target):
    """
    SQLAlchemy before_update listener for Requisition.
    Blocks direct overall_status mutations outside workflow context.
    """
    if is_in_workflow_context():
        return  # Allow changes within workflow engine
    
    state = inspect(target)
    history = state.attrs.overall_status.history
    
    if history.has_changes():
        old_value = history.deleted[0] if history.deleted else None
        new_value = history.added[0] if history.added else target.overall_status
        
        if old_value != new_value:
            raise StatusProtectionError(
                entity_type="Requisition",
                entity_id=target.req_id,
                field="overall_status",
                old_value=old_value,
                new_value=new_value
            )


def _check_item_status_change(mapper, connection, target):
    """
    SQLAlchemy before_update listener for RequisitionItem.
    Blocks direct item_status mutations outside workflow context.
    """
    if is_in_workflow_context():
        return  # Allow changes within workflow engine
    
    state = inspect(target)
    history = state.attrs.item_status.history
    
    if history.has_changes():
        old_value = history.deleted[0] if history.deleted else None
        new_value = history.added[0] if history.added else target.item_status
        
        if old_value != new_value:
            raise StatusProtectionError(
                entity_type="RequisitionItem",
                entity_id=target.item_id,
                field="item_status",
                old_value=old_value,
                new_value=new_value
            )


def register_status_protection():
    """
    Register SQLAlchemy event listeners to enforce status protection.
    
    Call this once during application startup (e.g., in main.py).
    """
    event.listen(Requisition, 'before_update', _check_requisition_status_change)
    event.listen(RequisitionItem, 'before_update', _check_item_status_change)


def unregister_status_protection():
    """
    Remove status protection listeners.
    
    Useful for testing or maintenance operations.
    """
    event.remove(Requisition, 'before_update', _check_requisition_status_change)
    event.remove(RequisitionItem, 'before_update', _check_item_status_change)


# Convenience export for workflow engines
__all__ = [
    'workflow_transition_context',
    'is_in_workflow_context',
    'StatusProtectionError',
    'register_status_protection',
    'unregister_status_protection',
]
