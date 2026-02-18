"""
============================================================================
API Layer Workflow Adapter
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module provides adapter functions to bridge the API layer with the
new workflow_engine_v2. It handles:
1. Converting old status strings to spec-compliant values
2. Wrapping v2 engine calls for API compatibility
3. Error translation for HTTP responses

MIGRATION STRATEGY:
- API endpoints call these adapter functions
- Adapters internally use workflow_engine_v2
- Ensures all status mutations go through the engine
"""

from typing import Optional, List, Tuple
from sqlalchemy.orm import Session

from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem

from .workflow_matrix import (
    RequisitionStatus,
    RequisitionItemStatus,
)
from .workflow_engine_v2 import (
    RequisitionWorkflowEngine as WorkflowEngineV2,
    RequisitionItemWorkflowEngine as ItemWorkflowEngineV2,
)
from .workflow_exceptions import (
    WorkflowException,
    InvalidTransitionException,
    TerminalStateException,
    AuthorizationException,
    ConcurrencyConflictException,
    EntityNotFoundException,
)


# =============================================================================
# STATUS MAPPING (Legacy <-> Spec v1.0.0)
# =============================================================================

LEGACY_TO_SPEC_HEADER = {
    "Pending Budget Approval": RequisitionStatus.PENDING_BUDGET.value,
    "Pending HR Approval": RequisitionStatus.PENDING_HR.value,
    "Approved & Unassigned": RequisitionStatus.PENDING_HR.value,  # Maps to pending
    "Approved": RequisitionStatus.ACTIVE.value,
    "Active": RequisitionStatus.ACTIVE.value,
    "Draft": RequisitionStatus.DRAFT.value,
    "Fulfilled": RequisitionStatus.FULFILLED.value,
    "Rejected": RequisitionStatus.REJECTED.value,
    "Cancelled": RequisitionStatus.CANCELLED.value,
    # Spec values map to themselves
    "Pending_Budget": RequisitionStatus.PENDING_BUDGET.value,
    "Pending_HR": RequisitionStatus.PENDING_HR.value,
}

LEGACY_TO_SPEC_ITEM = {
    "Open": RequisitionItemStatus.PENDING.value,
    "Pending": RequisitionItemStatus.PENDING.value,
    "Sourcing": RequisitionItemStatus.SOURCING.value,
    "Shortlisted": RequisitionItemStatus.SHORTLISTED.value,
    "Interviewing": RequisitionItemStatus.INTERVIEWING.value,
    "Offered": RequisitionItemStatus.OFFERED.value,
    "Fulfilled": RequisitionItemStatus.FULFILLED.value,
    "Cancelled": RequisitionItemStatus.CANCELLED.value,
}


def normalize_header_status(status: str) -> str:
    """Convert legacy status string to spec-compliant value."""
    return LEGACY_TO_SPEC_HEADER.get(status, status)


def normalize_item_status(status: str) -> str:
    """Convert legacy item status string to spec-compliant value."""
    return LEGACY_TO_SPEC_ITEM.get(status, status)


# =============================================================================
# API-COMPATIBLE ERROR
# =============================================================================

class WorkflowAPIError(Exception):
    """
    API-friendly workflow error.
    
    Compatible with the old WorkflowError interface for minimal API changes.
    """
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)
    
    @classmethod
    def from_workflow_exception(cls, e: WorkflowException) -> "WorkflowAPIError":
        """Convert workflow exception to API error."""
        status_code = 400
        
        if isinstance(e, EntityNotFoundException):
            status_code = 404
        elif isinstance(e, AuthorizationException):
            status_code = 403
        elif isinstance(e, ConcurrencyConflictException):
            status_code = 409
        elif isinstance(e, TerminalStateException):
            status_code = 400
        elif isinstance(e, InvalidTransitionException):
            status_code = 400
        
        return cls(message=str(e), status_code=status_code)


# =============================================================================
# REQUISITION CREATION (Spec Compliant)
# =============================================================================

def create_requisition_draft(
    db: Session,
    raised_by: int,
    **kwargs
) -> Requisition:
    """
    Create a new requisition in DRAFT state.
    
    Per Workflow Specification v1.0.0, all requisitions start as DRAFT.
    Use submit_requisition() to transition to PENDING_BUDGET.
    
    Args:
        db: Database session
        raised_by: User ID of requester
        **kwargs: Additional requisition fields
        
    Returns:
        Created Requisition in DRAFT state
    """
    requisition = Requisition(
        raised_by=raised_by,
        overall_status=RequisitionStatus.DRAFT.value,
        version=1,
        **kwargs
    )
    db.add(requisition)
    return requisition


def create_and_submit_requisition(
    db: Session,
    raised_by: int,
    user_roles: List[str],
    **kwargs
) -> Requisition:
    """
    Create a requisition and immediately submit it.
    
    This is a convenience method for the common workflow:
    1. Create in DRAFT
    2. Submit to PENDING_BUDGET
    
    Args:
        db: Database session
        raised_by: User ID of requester
        user_roles: Roles of the creating user
        **kwargs: Additional requisition fields
        
    Returns:
        Created and submitted Requisition in PENDING_BUDGET state
    """
    # Create in DRAFT
    requisition = Requisition(
        raised_by=raised_by,
        overall_status=RequisitionStatus.DRAFT.value,
        version=1,
        **kwargs
    )
    db.add(requisition)
    db.flush()  # Get req_id
    
    # Submit via workflow engine
    try:
        result = WorkflowEngineV2.submit(
            db=db,
            req_id=requisition.req_id,
            user_id=raised_by,
            user_roles=user_roles,
        )
        return result
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def create_requisition_item(
    db: Session,
    req_id: int,
    **kwargs
) -> RequisitionItem:
    """
    Create a new requisition item in PENDING state.
    
    Args:
        db: Database session
        req_id: Parent requisition ID
        **kwargs: Additional item fields
        
    Returns:
        Created RequisitionItem in PENDING state
    """
    item = RequisitionItem(
        req_id=req_id,
        item_status=RequisitionItemStatus.PENDING.value,
        version=1,
        **kwargs
    )
    db.add(item)
    return item


# =============================================================================
# ADAPTER FUNCTIONS (API -> Workflow Engine v2)
# =============================================================================

def submit_requisition(
    db: Session,
    req_id: int,
    user_id: int,
    user_roles: Optional[List[str]] = None,
) -> Requisition:
    """
    Submit a requisition (DRAFT -> PENDING_BUDGET).
    
    API-compatible wrapper for WorkflowEngineV2.submit().
    """
    try:
        return WorkflowEngineV2.submit(
            db=db,
            req_id=req_id,
            user_id=user_id,
            user_roles=user_roles or ["Manager"],
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def approve_budget(
    db: Session,
    req_id: int,
    user_id: int,
    user_roles: Optional[List[str]] = None,
) -> Requisition:
    """
    Approve budget (PENDING_BUDGET -> PENDING_HR).
    
    API-compatible wrapper for WorkflowEngineV2.approve_budget().
    """
    try:
        return WorkflowEngineV2.approve_budget(
            db=db,
            req_id=req_id,
            user_id=user_id,
            user_roles=user_roles or ["Manager"],
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def approve_hr(
    db: Session,
    req_id: int,
    user_id: int,
    user_roles: Optional[List[str]] = None,
) -> Requisition:
    """
    HR approval (PENDING_HR -> ACTIVE).
    
    API-compatible wrapper for WorkflowEngineV2.approve_hr().
    """
    try:
        return WorkflowEngineV2.approve_hr(
            db=db,
            req_id=req_id,
            user_id=user_id,
            user_roles=user_roles or ["HR"],
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def reject_requisition(
    db: Session,
    req_id: int,
    user_id: int,
    reason: str,
    user_roles: Optional[List[str]] = None,
) -> Requisition:
    """
    Reject a requisition.
    
    API-compatible wrapper for WorkflowEngineV2.reject().
    """
    try:
        return WorkflowEngineV2.reject(
            db=db,
            req_id=req_id,
            user_id=user_id,
            user_roles=user_roles or ["Manager", "HR"],
            reason=reason,
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def cancel_requisition(
    db: Session,
    req_id: int,
    user_id: int,
    reason: str,
    user_roles: Optional[List[str]] = None,
) -> Requisition:
    """
    Cancel a requisition.
    
    API-compatible wrapper for WorkflowEngineV2.cancel().
    """
    try:
        return WorkflowEngineV2.cancel(
            db=db,
            req_id=req_id,
            user_id=user_id,
            user_roles=user_roles or ["Manager"],
            reason=reason,
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def assign_ta_to_requisition(
    db: Session,
    req_id: int,
    ta_user_id: int,
    performed_by: int,
    user_roles: Optional[List[str]] = None,
) -> Requisition:
    """
    Assign TA to requisition (transitions to ACTIVE if in PENDING_HR).
    
    API-compatible wrapper for WorkflowEngineV2.assign_ta().
    """
    try:
        return WorkflowEngineV2.assign_ta(
            db=db,
            req_id=req_id,
            ta_user_id=ta_user_id,
            performed_by=performed_by,
            user_roles=user_roles or ["HR"],
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def recalculate_header_status(
    db: Session,
    req_id: int,
    user_id: int = 0,
) -> Optional[Requisition]:
    """
    Recalculate header status based on item states.
    
    API-compatible wrapper for WorkflowEngineV2.recalculate_header_status().
    """
    try:
        return WorkflowEngineV2.recalculate_header_status(
            db=db,
            req_id=req_id,
            user_id=user_id,
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


# =============================================================================
# ITEM WORKFLOW ADAPTERS
# =============================================================================

def assign_ta_to_item(
    db: Session,
    item_id: int,
    ta_user_id: int,
    performed_by: int,
    user_roles: Optional[List[str]] = None,
) -> RequisitionItem:
    """
    Assign TA to item (PENDING -> SOURCING).
    
    API-compatible wrapper for ItemWorkflowEngineV2.assign_ta().
    """
    try:
        return ItemWorkflowEngineV2.assign_ta(
            db=db,
            item_id=item_id,
            ta_user_id=ta_user_id,
            performed_by=performed_by,
            user_roles=user_roles or ["HR", "TA"],
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def advance_item(
    db: Session,
    item_id: int,
    target_status: str,
    performed_by: int,
    user_roles: Optional[List[str]] = None,
) -> RequisitionItem:
    """
    Advance item to next status.
    
    Normalizes legacy status strings automatically.
    """
    normalized = normalize_item_status(target_status)
    
    try:
        return ItemWorkflowEngineV2.transition(
            db=db,
            item_id=item_id,
            target_status=RequisitionItemStatus(normalized),
            performed_by=performed_by,
            user_roles=user_roles or ["TA"],
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def fulfill_item(
    db: Session,
    item_id: int,
    employee_id: str,
    performed_by: int,
    user_roles: Optional[List[str]] = None,
) -> RequisitionItem:
    """
    Fulfill an item with an employee assignment.
    
    API-compatible wrapper for ItemWorkflowEngineV2.fulfill().
    """
    try:
        return ItemWorkflowEngineV2.fulfill(
            db=db,
            item_id=item_id,
            employee_id=employee_id,
            performed_by=performed_by,
            user_roles=user_roles or ["TA"],
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


def cancel_item(
    db: Session,
    item_id: int,
    performed_by: int,
    reason: str,
    user_roles: Optional[List[str]] = None,
) -> RequisitionItem:
    """
    Cancel a requisition item.
    
    API-compatible wrapper for ItemWorkflowEngineV2.cancel().
    """
    try:
        return ItemWorkflowEngineV2.cancel(
            db=db,
            item_id=item_id,
            performed_by=performed_by,
            user_roles=user_roles or ["Manager", "HR"],
            reason=reason,
        )
    except WorkflowException as e:
        raise WorkflowAPIError.from_workflow_exception(e)


# =============================================================================
# QUERY HELPERS (Status Normalized)
# =============================================================================

def get_spec_compliant_statuses() -> dict:
    """Get all spec-compliant status values for queries."""
    return {
        "header": {
            "draft": RequisitionStatus.DRAFT.value,
            "pending_budget": RequisitionStatus.PENDING_BUDGET.value,
            "pending_hr": RequisitionStatus.PENDING_HR.value,
            "active": RequisitionStatus.ACTIVE.value,
            "fulfilled": RequisitionStatus.FULFILLED.value,
            "rejected": RequisitionStatus.REJECTED.value,
            "cancelled": RequisitionStatus.CANCELLED.value,
        },
        "item": {
            "pending": RequisitionItemStatus.PENDING.value,
            "sourcing": RequisitionItemStatus.SOURCING.value,
            "shortlisted": RequisitionItemStatus.SHORTLISTED.value,
            "interviewing": RequisitionItemStatus.INTERVIEWING.value,
            "offered": RequisitionItemStatus.OFFERED.value,
            "fulfilled": RequisitionItemStatus.FULFILLED.value,
            "cancelled": RequisitionItemStatus.CANCELLED.value,
        }
    }


# Convenience exports
__all__ = [
    # Errors
    'WorkflowAPIError',
    # Creation
    'create_requisition_draft',
    'create_and_submit_requisition',
    'create_requisition_item',
    # Header operations
    'submit_requisition',
    'approve_budget',
    'approve_hr',
    'reject_requisition',
    'cancel_requisition',
    'assign_ta_to_requisition',
    'recalculate_header_status',
    # Item operations
    'assign_ta_to_item',
    'advance_item',
    'fulfill_item',
    'cancel_item',
    # Helpers
    'normalize_header_status',
    'normalize_item_status',
    'get_spec_compliant_statuses',
]
