"""
============================================================================
WORKFLOW ENGINE - Core State Machine Infrastructure (Python Backend)
============================================================================

This module mirrors the frontend workflow engine to ensure consistent
validation across the stack. The backend MUST enforce the same rules
to prevent API bypass attacks.

DESIGN PRINCIPLES:
1. Mirror frontend workflow definitions exactly
2. Single source of truth per domain
3. Raise clear exceptions for invalid transitions
4. Support async context for database checks
"""

from dataclasses import dataclass, field
from typing import (
    Generic,
    TypeVar,
    Dict,
    List,
    Callable,
    Optional,
    Any,
    Set,
    Union,
)
from enum import Enum


# ============================================================================
# Core Types
# ============================================================================

TStatus = TypeVar("TStatus", bound=str)
TContext = TypeVar("TContext", bound=Dict[str, Any])


@dataclass
class TransitionResult:
    """Result of a transition validation check."""
    allowed: bool
    error: Optional[str] = None
    code: Optional[str] = None


class WorkflowError(Exception):
    """Exception raised when a workflow transition is invalid."""
    
    def __init__(self, message: str, code: Optional[str] = None):
        super().__init__(message)
        self.code = code


# Type alias for guard functions
Guard = Callable[[Dict[str, Any]], Union[bool, str]]


@dataclass
class TransitionEdge:
    """Configuration for a single transition edge."""
    description: Optional[str] = None
    guards: List[Guard] = field(default_factory=list)
    required_context: List[str] = field(default_factory=list)


# ============================================================================
# Workflow Class
# ============================================================================

class Workflow(Generic[TStatus]):
    """
    A type-safe workflow engine that enforces state transitions.
    
    Example:
        requisition_workflow = Workflow(
            name="Requisition",
            version="1.0.0",
            transitions={
                "Pending Budget Approval": {
                    "Pending HR Approval": TransitionEdge(
                        guards=[is_budget_manager]
                    ),
                    "Rejected": TransitionEdge(
                        guards=[is_budget_manager, has_rejection_reason]
                    ),
                },
            }
        )
        
        result = requisition_workflow.validate(
            "Pending Budget Approval",
            "Rejected",
            {"rejection_reason": "Budget constraints"}
        )
    """
    
    def __init__(
        self,
        name: str,
        version: str,
        transitions: Dict[str, Dict[str, TransitionEdge]],
        description: Optional[str] = None,
    ):
        self.name = name
        self.version = version
        self.description = description
        self._transitions = transitions
    
    def can_transition(self, current: str, next_status: str) -> bool:
        """Check if a transition is structurally allowed (ignores guards)."""
        if current == next_status:
            return False
        from_state = self._transitions.get(current)
        if not from_state:
            return False
        return next_status in from_state
    
    def get_available_transitions(self, current: str) -> List[str]:
        """Get all statuses that can be reached from the current status."""
        from_state = self._transitions.get(current)
        if not from_state:
            return []
        return list(from_state.keys())
    
    def validate(
        self,
        current: str,
        next_status: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> TransitionResult:
        """
        Full validation including guards.
        This is the primary method endpoints should use.
        """
        context = context or {}
        
        # Same state is a no-op
        if current == next_status:
            return TransitionResult(
                allowed=False,
                error="No change in status",
                code="NO_CHANGE"
            )
        
        # Check if transition path exists
        from_state = self._transitions.get(current)
        if not from_state:
            return TransitionResult(
                allowed=False,
                error=f'No transitions defined from "{current}"',
                code="INVALID_SOURCE"
            )
        
        edge = from_state.get(next_status)
        if not edge:
            return TransitionResult(
                allowed=False,
                error=f'Transition from "{current}" to "{next_status}" is not allowed',
                code="TRANSITION_NOT_ALLOWED"
            )
        
        # Check required context fields
        for field_name in edge.required_context:
            if field_name not in context or context[field_name] is None:
                return TransitionResult(
                    allowed=False,
                    error=f"Missing required field: {field_name}",
                    code="MISSING_CONTEXT"
                )
        
        # Run all guards
        for guard in edge.guards:
            result = guard(context)
            if result is not True:
                error_msg = result if isinstance(result, str) else "Guard check failed"
                return TransitionResult(
                    allowed=False,
                    error=error_msg,
                    code="GUARD_FAILED"
                )
        
        return TransitionResult(allowed=True)
    
    def assert_transition(
        self,
        current: str,
        next_status: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Validate and raise if not allowed."""
        result = self.validate(current, next_status, context)
        if not result.allowed:
            raise WorkflowError(
                result.error or "Transition not allowed",
                result.code
            )


# ============================================================================
# Guard Factory Functions
# ============================================================================

def min_length(
    field: str,
    min_len: int,
    message: Optional[str] = None
) -> Guard:
    """Creates a guard that checks if a string field has minimum length."""
    def guard(ctx: Dict[str, Any]) -> Union[bool, str]:
        value = ctx.get(field, "")
        if not isinstance(value, str) or len(value.strip()) < min_len:
            return message or f"{field} must be at least {min_len} characters"
        return True
    return guard


def required(field: str, message: Optional[str] = None) -> Guard:
    """Creates a guard that checks if a field is present and truthy."""
    def guard(ctx: Dict[str, Any]) -> Union[bool, str]:
        value = ctx.get(field)
        if value is None or value == "":
            return message or f"{field} is required"
        return True
    return guard


def has_date(field: str, message: Optional[str] = None) -> Guard:
    """Creates a guard that checks if a date field is set."""
    def guard(ctx: Dict[str, Any]) -> Union[bool, str]:
        value = ctx.get(field)
        if not value:
            return message or f"{field} date is required"
        return True
    return guard


def when(
    predicate: Callable[[Dict[str, Any]], bool],
    error_message: str
) -> Guard:
    """Creates a guard that checks a boolean condition."""
    def guard(ctx: Dict[str, Any]) -> Union[bool, str]:
        if predicate(ctx):
            return True
        return error_message
    return guard


def has_role(*roles: str, message: Optional[str] = None) -> Guard:
    """Creates a guard that checks if user has one of the specified roles."""
    def guard(ctx: Dict[str, Any]) -> Union[bool, str]:
        user_role = ctx.get("user_role")
        if user_role in roles or user_role == "admin":
            return True
        return message or f"Requires one of roles: {', '.join(roles)}"
    return guard
