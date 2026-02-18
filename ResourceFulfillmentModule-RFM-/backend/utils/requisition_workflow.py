"""
============================================================================
REQUISITION WORKFLOW - Backend Definition
============================================================================

Mirrors the frontend requisition workflow for server-side validation.
This ensures that even if someone bypasses the UI, invalid transitions
are rejected by the API.
"""

from typing import Dict, Any, Union

from .workflow_engine import (
    Workflow,
    TransitionEdge,
    min_length,
    has_role,
    when,
    Guard,
)


# ============================================================================
# Status Constants
# ============================================================================

REQUISITION_STATUSES = [
    "Draft",
    "Pending Budget Approval",
    "Pending HR Approval",
    "Approved & Unassigned",
    "Active",
    "Closed",
    "Rejected",
    "Cancelled",
]


# ============================================================================
# Guards
# ============================================================================

has_rejection_reason = min_length(
    "rejection_reason",
    10,
    "Rejection reason must be at least 10 characters"
)

has_cancellation_reason = min_length(
    "cancellation_reason",
    10,
    "Cancellation reason must be at least 10 characters"
)

is_budget_manager = has_role(
    "budget_manager",
    message="Only budget managers can approve budget"
)

is_hr_user = has_role(
    "hr",
    message="Only HR users can perform this action"
)

is_requester = has_role(
    "requester",
    message="Only the requester can perform this action"
)

has_positions_assigned = when(
    lambda ctx: ctx.get("has_assignments") is True,
    "At least one position must be assigned"
)


# ============================================================================
# Workflow Definition
# ============================================================================

requisition_workflow = Workflow(
    name="Requisition",
    version="1.0.0",
    description="Resource requisition approval and fulfillment workflow",
    transitions={
        # Draft state
        "Draft": {
            "Pending Budget Approval": TransitionEdge(
                description="Submit requisition for budget approval",
                guards=[is_requester],
            ),
            "Cancelled": TransitionEdge(
                description="Cancel draft requisition",
                guards=[is_requester],
            ),
        },
        
        # Pending Budget Approval
        "Pending Budget Approval": {
            "Pending HR Approval": TransitionEdge(
                description="Approve budget and send to HR",
                guards=[is_budget_manager],
            ),
            "Rejected": TransitionEdge(
                description="Reject due to budget constraints",
                guards=[is_budget_manager, has_rejection_reason],
            ),
            "Draft": TransitionEdge(
                description="Return to requester for edits",
                guards=[is_budget_manager],
            ),
        },
        
        # Pending HR Approval
        "Pending HR Approval": {
            "Approved & Unassigned": TransitionEdge(
                description="Approve requisition for hiring",
                guards=[is_hr_user],
            ),
            "Rejected": TransitionEdge(
                description="Reject due to HR policy",
                guards=[is_hr_user, has_rejection_reason],
            ),
            "Pending Budget Approval": TransitionEdge(
                description="Return to budget review",
                guards=[is_hr_user],
            ),
        },
        
        # Approved & Unassigned
        "Approved & Unassigned": {
            "Active": TransitionEdge(
                description="Activate when assignments begin",
                guards=[is_hr_user, has_positions_assigned],
            ),
            "Cancelled": TransitionEdge(
                description="Cancel approved requisition",
                guards=[is_hr_user, has_cancellation_reason],
            ),
        },
        
        # Active
        "Active": {
            "Closed": TransitionEdge(
                description="Close when all positions filled",
                guards=[is_hr_user],
            ),
            "Cancelled": TransitionEdge(
                description="Cancel active requisition",
                guards=[is_hr_user, has_cancellation_reason],
            ),
        },
        
        # Terminal states - no outgoing transitions
        "Closed": {},
        "Rejected": {},
        "Cancelled": {},
    }
)


# ============================================================================
# Convenience Functions
# ============================================================================

def can_transition_requisition(current: str, next_status: str) -> bool:
    """Quick check if a status transition is structurally possible."""
    return requisition_workflow.can_transition(current, next_status)


def validate_requisition_transition(
    current: str,
    next_status: str,
    context: Dict[str, Any] = None
):
    """Full validation of a requisition status change."""
    return requisition_workflow.validate(current, next_status, context or {})


def assert_requisition_transition(
    current: str,
    next_status: str,
    context: Dict[str, Any] = None
) -> None:
    """Validate and raise WorkflowError if not allowed."""
    requisition_workflow.assert_transition(current, next_status, context or {})


def get_requisition_next_statuses(current: str) -> list:
    """Get all possible next statuses from current state."""
    return requisition_workflow.get_available_transitions(current)


def is_terminal_requisition_status(status: str) -> bool:
    """Check if a status is a terminal state."""
    return len(requisition_workflow.get_available_transitions(status)) == 0
