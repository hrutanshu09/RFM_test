"""
============================================================================
EMPLOYEE LIFECYCLE WORKFLOW - Backend Definition
============================================================================

Mirrors the frontend employee lifecycle workflow for server-side validation.
"""

from typing import Dict, Any

from .workflow_engine import (
    Workflow,
    TransitionEdge,
    min_length,
    has_role,
    has_date,
    when,
)


# ============================================================================
# Status Constants
# ============================================================================

EMPLOYEE_LIFECYCLE_STATUSES = [
    "Pre-Onboarding",
    "Onboarding",
    "Active",
    "On Leave",
    "Notice Period",
    "Exited",
    "Terminated",
    "Suspended",
]

ONBOARDING_STATUSES = [
    "Not Started",
    "Documentation Pending",
    "Background Check",
    "IT Setup",
    "Orientation",
    "Completed",
]


# ============================================================================
# Guards
# ============================================================================

has_date_of_joining = has_date(
    "date_of_joining",
    "Date of Joining is required to activate employee"
)

has_exit_date = has_date(
    "exit_date",
    "Exit date is required for offboarding"
)

has_last_working_day = has_date(
    "last_working_day",
    "Last working day is required"
)

has_background_check = when(
    lambda ctx: ctx.get("background_check_complete") is True,
    "Background check must be completed"
)

has_it_setup = when(
    lambda ctx: ctx.get("it_setup_complete") is True,
    "IT setup must be completed"
)

has_documents = when(
    lambda ctx: ctx.get("documents_complete") is True,
    "All required documents must be submitted"
)

has_termination_reason = min_length(
    "termination_reason",
    10,
    "Termination reason must be at least 10 characters"
)

has_suspension_reason = min_length(
    "suspension_reason",
    10,
    "Suspension reason must be at least 10 characters"
)

has_leave_details = when(
    lambda ctx: bool(ctx.get("leave_type")) and bool(ctx.get("expected_return_date")),
    "Leave type and expected return date are required"
)

has_exit_interview = when(
    lambda ctx: ctx.get("exit_interview_complete") is True,
    "Exit interview must be completed"
)

has_handover = when(
    lambda ctx: ctx.get("handover_complete") is True,
    "Handover must be completed"
)

is_hr_or_admin = has_role("hr", message="Only HR can perform this action")


# ============================================================================
# Workflow Definition
# ============================================================================

employee_lifecycle_workflow = Workflow(
    name="Employee Lifecycle",
    version="1.0.0",
    description="Employee lifecycle from hire to exit",
    transitions={
        # Pre-Onboarding
        "Pre-Onboarding": {
            "Onboarding": TransitionEdge(
                description="Begin onboarding process",
                guards=[is_hr_or_admin, has_documents],
            ),
        },
        
        # Onboarding
        "Onboarding": {
            "Active": TransitionEdge(
                description="Complete onboarding and activate",
                guards=[
                    is_hr_or_admin,
                    has_date_of_joining,
                    has_background_check,
                    has_it_setup,
                ],
            ),
            "Pre-Onboarding": TransitionEdge(
                description="Return to pre-onboarding if issues found",
                guards=[is_hr_or_admin],
            ),
        },
        
        # Active
        "Active": {
            "On Leave": TransitionEdge(
                description="Employee goes on leave",
                guards=[has_leave_details],
            ),
            "Notice Period": TransitionEdge(
                description="Employee resignation or notice given",
                guards=[is_hr_or_admin, has_last_working_day],
            ),
            "Terminated": TransitionEdge(
                description="Immediate termination",
                guards=[is_hr_or_admin, has_termination_reason],
            ),
            "Suspended": TransitionEdge(
                description="Suspend employee",
                guards=[is_hr_or_admin, has_suspension_reason],
            ),
        },
        
        # On Leave
        "On Leave": {
            "Active": TransitionEdge(
                description="Return from leave",
                guards=[],
            ),
            "Notice Period": TransitionEdge(
                description="Resign while on leave",
                guards=[is_hr_or_admin, has_last_working_day],
            ),
        },
        
        # Notice Period
        "Notice Period": {
            "Exited": TransitionEdge(
                description="Complete exit process",
                guards=[
                    is_hr_or_admin,
                    has_exit_date,
                    has_exit_interview,
                    has_handover,
                ],
            ),
            "Active": TransitionEdge(
                description="Withdrawal of resignation (if accepted)",
                guards=[is_hr_or_admin],
            ),
        },
        
        # Suspended
        "Suspended": {
            "Active": TransitionEdge(
                description="Reinstate employee",
                guards=[is_hr_or_admin],
            ),
            "Terminated": TransitionEdge(
                description="Terminate suspended employee",
                guards=[is_hr_or_admin, has_termination_reason],
            ),
        },
        
        # Terminal states
        "Exited": {},
        "Terminated": {},
    }
)


# ============================================================================
# Convenience Functions
# ============================================================================

def can_transition_employee(current: str, next_status: str) -> bool:
    """Quick check if a status transition is structurally possible."""
    return employee_lifecycle_workflow.can_transition(current, next_status)


def validate_employee_transition(
    current: str,
    next_status: str,
    context: Dict[str, Any] = None
):
    """Full validation of an employee status change."""
    return employee_lifecycle_workflow.validate(current, next_status, context or {})


def assert_employee_transition(
    current: str,
    next_status: str,
    context: Dict[str, Any] = None
) -> None:
    """Validate and raise WorkflowError if not allowed."""
    employee_lifecycle_workflow.assert_transition(current, next_status, context or {})


def get_employee_next_statuses(current: str) -> list:
    """Get all possible next statuses from current state."""
    return employee_lifecycle_workflow.get_available_transitions(current)


def is_terminal_employee_status(status: str) -> bool:
    """Check if a status is a terminal state."""
    return len(employee_lifecycle_workflow.get_available_transitions(status)) == 0
