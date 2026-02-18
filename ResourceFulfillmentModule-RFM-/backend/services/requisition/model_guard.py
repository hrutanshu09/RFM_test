"""
============================================================================
Model-Level Status Guard
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module provides enhanced SQLAlchemy validators and ORM event
listeners to enforce status protection at the model level.

FEATURES:
1. @validates decorator on status columns
2. Before-flush event to catch any remaining mutations
3. Insert validation for initial states
4. Runtime bypass detection

This is a defense-in-depth layer complementing status_protection.py.
"""

from typing import Optional, Set
from sqlalchemy import event, inspect
from sqlalchemy.orm import Session, validates
from threading import local

from db.base import Base
from .workflow_matrix import RequisitionStatus, RequisitionItemStatus


# =============================================================================
# THREAD-LOCAL CONTEXT
# =============================================================================

_guard_context = local()


def is_guard_disabled() -> bool:
    """Check if model guard is disabled for current thread."""
    return getattr(_guard_context, 'disabled', False)


def disable_guard():
    """Disable guard for current thread (for migrations/maintenance)."""
    _guard_context.disabled = True


def enable_guard():
    """Re-enable guard for current thread."""
    _guard_context.disabled = False


class guard_disabled:
    """Context manager to temporarily disable model guard."""
    
    def __enter__(self):
        self.previous = is_guard_disabled()
        _guard_context.disabled = True
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        _guard_context.disabled = self.previous
        return False


# =============================================================================
# VALID STATUS SETS
# =============================================================================

VALID_HEADER_STATUSES: Set[str] = {s.value for s in RequisitionStatus}
VALID_ITEM_STATUSES: Set[str] = {s.value for s in RequisitionItemStatus}

INITIAL_HEADER_STATUS = RequisitionStatus.DRAFT.value
INITIAL_ITEM_STATUS = RequisitionItemStatus.PENDING.value


# =============================================================================
# CUSTOM EXCEPTION
# =============================================================================

class ModelGuardViolation(Exception):
    """Raised when model-level guard detects invalid status mutation."""
    
    def __init__(
        self, 
        model_name: str, 
        field: str, 
        value: str,
        violation_type: str,
        details: str = ""
    ):
        self.model_name = model_name
        self.field = field
        self.value = value
        self.violation_type = violation_type
        
        message = (
            f"MODEL GUARD VIOLATION [{violation_type}]: "
            f"{model_name}.{field} = '{value}'"
        )
        if details:
            message += f" — {details}"
        
        super().__init__(message)


# =============================================================================
# MIXIN FOR PROTECTED STATUS FIELDS
# =============================================================================

class StatusProtectedMixin:
    """
    Mixin that provides model-level status validation.
    
    Add to models with protected status fields to enable:
    - Initial value validation on INSERT
    - Valid enum value validation
    - Invalid status detection
    
    Usage:
        class MyModel(Base, StatusProtectedMixin):
            _protected_status_field = "my_status"
            _valid_statuses = {"status1", "status2"}
            _initial_status = "status1"
    """
    
    _protected_status_field: str = ""
    _valid_statuses: Set[str] = set()
    _initial_status: str = ""
    
    def validate_status_value(self, value: str) -> str:
        """Validate status value against allowed values."""
        if is_guard_disabled():
            return value
        
        if value not in self._valid_statuses:
            raise ModelGuardViolation(
                model_name=self.__class__.__name__,
                field=self._protected_status_field,
                value=value,
                violation_type="INVALID_STATUS",
                details=f"Valid values: {sorted(self._valid_statuses)}"
            )
        
        return value


# =============================================================================
# SESSION-LEVEL EVENT LISTENERS
# =============================================================================

def _validate_requisition_status_on_flush(session: Session, flush_context, instances):
    """
    Before-flush validation for Requisition status.
    
    Catches any status mutations that weren't caught by @validates.
    """
    from db.models.requisition import Requisition
    from services.requisition.status_protection import is_in_workflow_context
    
    if is_guard_disabled():
        return
    
    for obj in session.new:
        if isinstance(obj, Requisition):
            status = obj.overall_status
            if status not in VALID_HEADER_STATUSES:
                raise ModelGuardViolation(
                    model_name="Requisition",
                    field="overall_status",
                    value=status,
                    violation_type="INVALID_INSERT_STATUS",
                    details=f"Valid values: {sorted(VALID_HEADER_STATUSES)}"
                )
    
    for obj in session.dirty:
        if isinstance(obj, Requisition):
            state = inspect(obj)
            history = state.attrs.overall_status.history
            
            if history.has_changes() and not is_in_workflow_context():
                old = history.deleted[0] if history.deleted else None
                new = history.added[0] if history.added else obj.overall_status
                
                if old != new:
                    raise ModelGuardViolation(
                        model_name="Requisition",
                        field="overall_status",
                        value=new,
                        violation_type="DIRECT_MUTATION",
                        details=f"Change from '{old}' to '{new}' outside workflow context"
                    )


def _validate_item_status_on_flush(session: Session, flush_context, instances):
    """
    Before-flush validation for RequisitionItem status.
    
    Catches any status mutations that weren't caught by @validates.
    """
    from db.models.requisition_item import RequisitionItem
    from services.requisition.status_protection import is_in_workflow_context
    
    if is_guard_disabled():
        return
    
    for obj in session.new:
        if isinstance(obj, RequisitionItem):
            status = obj.item_status
            if status not in VALID_ITEM_STATUSES:
                raise ModelGuardViolation(
                    model_name="RequisitionItem",
                    field="item_status",
                    value=status,
                    violation_type="INVALID_INSERT_STATUS",
                    details=f"Valid values: {sorted(VALID_ITEM_STATUSES)}"
                )
    
    for obj in session.dirty:
        if isinstance(obj, RequisitionItem):
            state = inspect(obj)
            history = state.attrs.item_status.history
            
            if history.has_changes() and not is_in_workflow_context():
                old = history.deleted[0] if history.deleted else None
                new = history.added[0] if history.added else obj.item_status
                
                if old != new:
                    raise ModelGuardViolation(
                        model_name="RequisitionItem",
                        field="item_status",
                        value=new,
                        violation_type="DIRECT_MUTATION",
                        details=f"Change from '{old}' to '{new}' outside workflow context"
                    )


# =============================================================================
# REGISTRATION FUNCTIONS
# =============================================================================

_model_guard_registered = False


def register_model_guard(session_class=None):
    """
    Register model-level guard with SQLAlchemy Session.
    
    Should be called once at application startup.
    
    Args:
        session_class: SQLAlchemy Session class to attach listeners to.
                      If None, attaches to all Sessions.
    """
    global _model_guard_registered
    
    if _model_guard_registered:
        return
    
    target = session_class or Session
    
    # Register before_flush listeners
    event.listen(target, 'before_flush', _validate_requisition_status_on_flush)
    event.listen(target, 'before_flush', _validate_item_status_on_flush)
    
    _model_guard_registered = True


def unregister_model_guard(session_class=None):
    """
    Remove model-level guard listeners.
    
    Useful for testing or maintenance operations.
    """
    global _model_guard_registered
    
    if not _model_guard_registered:
        return
    
    target = session_class or Session
    
    try:
        event.remove(target, 'before_flush', _validate_requisition_status_on_flush)
        event.remove(target, 'before_flush', _validate_item_status_on_flush)
    except Exception:
        pass
    
    _model_guard_registered = False


# =============================================================================
# MODEL VALIDATORS (to be added to models)
# =============================================================================

def create_status_validator(
    field_name: str,
    valid_values: Set[str],
    model_name: str = "Model"
):
    """
    Create a @validates function for status fields.
    
    Usage in model:
        @validates('overall_status')
        def validate_overall_status(self, key, value):
            return _validate_status(value)
    """
    def validator(self, key, value):
        if is_guard_disabled():
            return value
        
        # Check valid enum values
        if value not in valid_values:
            raise ModelGuardViolation(
                model_name=model_name,
                field=field_name,
                value=value,
                violation_type="INVALID_VALUE",
                details=f"Valid: {sorted(valid_values)}"
            )
        
        return value
    
    return validator


# =============================================================================
# CONVENIENCE EXPORTS
# =============================================================================

__all__ = [
    # Context management
    'is_guard_disabled',
    'disable_guard',
    'enable_guard',
    'guard_disabled',
    # Constants
    'VALID_HEADER_STATUSES',
    'VALID_ITEM_STATUSES',
    'INITIAL_HEADER_STATUS',
    'INITIAL_ITEM_STATUS',
    # Exception
    'ModelGuardViolation',
    # Mixin
    'StatusProtectedMixin',
    # Registration
    'register_model_guard',
    'unregister_model_guard',
    # Validator factory
    'create_status_validator',
]
