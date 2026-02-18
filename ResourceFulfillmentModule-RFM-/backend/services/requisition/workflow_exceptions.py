"""
============================================================================
WORKFLOW EXCEPTIONS - Error Handling Infrastructure
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

Custom exceptions for workflow operations. Each exception type maps to
specific HTTP error codes and provides structured error information.
"""

from typing import Optional, Any, Dict


class WorkflowException(Exception):
    """
    Base exception for all workflow-related errors.
    
    Attributes:
        message: Human-readable error description
        code: Machine-readable error code
        http_status: Suggested HTTP status code
        details: Additional structured error information
    """
    
    def __init__(
        self,
        message: str,
        code: str = "WORKFLOW_ERROR",
        http_status: int = 400,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.message = message
        self.code = code
        self.http_status = http_status
        self.details = details or {}
        super().__init__(self.message)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert exception to API response format."""
        return {
            "error": True,
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


class InvalidTransitionException(WorkflowException):
    """
    Raised when a requested state transition is not allowed.
    
    This covers cases where:
    - The transition is not defined in the matrix
    - The transition exists but prerequisites are not met
    """
    
    def __init__(
        self,
        from_status: str,
        to_status: str,
        entity_type: str = "entity",
        allowed_transitions: Optional[list] = None,
    ):
        self.from_status = from_status
        self.to_status = to_status
        self.entity_type = entity_type
        self.allowed_transitions = allowed_transitions or []
        
        message = (
            f"Invalid transition: cannot move {entity_type} "
            f"from '{from_status}' to '{to_status}'."
        )
        if self.allowed_transitions:
            message += f" Allowed transitions: {self.allowed_transitions}"
        else:
            message += " No transitions allowed from current state."
        
        super().__init__(
            message=message,
            code="INVALID_TRANSITION",
            http_status=400,
            details={
                "entity_type": entity_type,
                "from_status": from_status,
                "to_status": to_status,
                "allowed_transitions": self.allowed_transitions,
            },
        )


class TerminalStateException(WorkflowException):
    """
    Raised when attempting to transition from a terminal state.
    
    Terminal states are final and cannot be changed.
    GC-002: Terminal states are irreversible.
    """
    
    def __init__(
        self,
        current_status: str,
        entity_type: str = "entity",
        entity_id: Optional[int] = None,
    ):
        self.current_status = current_status
        self.entity_type = entity_type
        self.entity_id = entity_id
        
        message = (
            f"Cannot transition {entity_type}: current status '{current_status}' "
            f"is a terminal state. Terminal states are irreversible."
        )
        
        super().__init__(
            message=message,
            code="TERMINAL_STATE",
            http_status=400,
            details={
                "entity_type": entity_type,
                "entity_id": entity_id,
                "current_status": current_status,
                "terminal": True,
            },
        )


class AuthorizationException(WorkflowException):
    """
    Raised when a user is not authorized to perform a transition.
    
    Maps to HTTP 403 Forbidden.
    """
    
    def __init__(
        self,
        action: str,
        user_roles: list,
        required_roles: Optional[list] = None,
        reason: Optional[str] = None,
    ):
        self.action = action
        self.user_roles = user_roles
        self.required_roles = required_roles or []
        
        if reason:
            message = reason
        else:
            message = (
                f"User with roles {user_roles} is not authorized to perform "
                f"action '{action}'."
            )
            if self.required_roles:
                message += f" Required roles: {self.required_roles}"
        
        super().__init__(
            message=message,
            code="UNAUTHORIZED_TRANSITION",
            http_status=403,
            details={
                "action": action,
                "user_roles": user_roles,
                "required_roles": self.required_roles,
            },
        )


class ConcurrencyConflictException(WorkflowException):
    """
    Raised when optimistic locking detects a concurrent modification.
    
    Maps to HTTP 409 Conflict.
    """
    
    def __init__(
        self,
        entity_type: str,
        entity_id: int,
        expected_version: int,
        actual_version: int,
    ):
        self.entity_type = entity_type
        self.entity_id = entity_id
        self.expected_version = expected_version
        self.actual_version = actual_version
        
        message = (
            f"Concurrent modification detected on {entity_type} {entity_id}. "
            f"Expected version {expected_version}, but found version {actual_version}. "
            f"Please refresh and retry."
        )
        
        super().__init__(
            message=message,
            code="CONFLICT",
            http_status=409,
            details={
                "entity_type": entity_type,
                "entity_id": entity_id,
                "expected_version": expected_version,
                "actual_version": actual_version,
            },
        )


class EntityLockedException(WorkflowException):
    """
    Raised when an entity cannot be modified due to its current state.
    
    Maps to HTTP 423 Locked.
    """
    
    def __init__(
        self,
        entity_type: str,
        entity_id: int,
        reason: str,
    ):
        self.entity_type = entity_type
        self.entity_id = entity_id
        
        message = f"{entity_type} {entity_id} is locked: {reason}"
        
        super().__init__(
            message=message,
            code="LOCKED",
            http_status=423,
            details={
                "entity_type": entity_type,
                "entity_id": entity_id,
                "reason": reason,
            },
        )


class ValidationException(WorkflowException):
    """
    Raised when required parameters are missing or invalid.
    
    Maps to HTTP 422 Unprocessable Entity.
    """
    
    def __init__(
        self,
        field: str,
        message: str,
        value: Optional[Any] = None,
    ):
        self.field = field
        self.invalid_value = value
        
        super().__init__(
            message=f"Validation error on '{field}': {message}",
            code="VALIDATION_ERROR",
            http_status=422,
            details={
                "field": field,
                "message": message,
                "value": value,
            },
        )


class PrerequisiteException(WorkflowException):
    """
    Raised when a transition prerequisite is not met.
    
    GC-004: Item cannot transition to FULFILLED unless assigned_employee_id exists.
    """
    
    def __init__(
        self,
        transition: str,
        prerequisite: str,
        entity_type: str = "entity",
        entity_id: Optional[int] = None,
    ):
        self.transition = transition
        self.prerequisite = prerequisite
        self.entity_type = entity_type
        self.entity_id = entity_id
        
        message = (
            f"Cannot perform transition '{transition}' on {entity_type}: "
            f"prerequisite not met - {prerequisite}"
        )
        
        super().__init__(
            message=message,
            code="PREREQUISITE_NOT_MET",
            http_status=400,
            details={
                "entity_type": entity_type,
                "entity_id": entity_id,
                "transition": transition,
                "prerequisite": prerequisite,
            },
        )


class EntityNotFoundException(WorkflowException):
    """
    Raised when a referenced entity does not exist.
    
    Maps to HTTP 404 Not Found.
    """
    
    def __init__(
        self,
        entity_type: str,
        entity_id: Any,
    ):
        self.entity_type = entity_type
        self.entity_id = entity_id
        
        message = f"{entity_type} with id '{entity_id}' not found"
        
        super().__init__(
            message=message,
            code="NOT_FOUND",
            http_status=404,
            details={
                "entity_type": entity_type,
                "entity_id": entity_id,
            },
        )


class AuditWriteException(WorkflowException):
    """
    Raised when audit log write fails.
    
    This exception triggers a full transaction rollback.
    """
    
    def __init__(
        self,
        operation: str,
        original_error: Optional[str] = None,
    ):
        self.operation = operation
        self.original_error = original_error
        
        message = f"Failed to write audit log for operation '{operation}'"
        if original_error:
            message += f": {original_error}"
        message += ". Transaction rolled back."
        
        super().__init__(
            message=message,
            code="AUDIT_WRITE_FAILURE",
            http_status=500,
            details={
                "operation": operation,
                "original_error": original_error,
            },
        )


class SystemOnlyTransitionException(WorkflowException):
    """
    Raised when a user attempts a system-only transition.
    
    GC-008: Only SYSTEM can transition header ACTIVE → FULFILLED.
    """
    
    def __init__(
        self,
        from_status: str,
        to_status: str,
        entity_type: str = "entity",
    ):
        self.from_status = from_status
        self.to_status = to_status
        self.entity_type = entity_type
        
        message = (
            f"Transition from '{from_status}' to '{to_status}' on {entity_type} "
            f"is system-controlled and cannot be triggered manually."
        )
        
        super().__init__(
            message=message,
            code="SYSTEM_ONLY_TRANSITION",
            http_status=403,
            details={
                "entity_type": entity_type,
                "from_status": from_status,
                "to_status": to_status,
                "system_only": True,
            },
        )


class ReasonRequiredException(WorkflowException):
    """
    Raised when a backward transition is attempted without a reason.
    
    GC-009: Backward item transitions require reason (min 10 characters).
    """
    
    def __init__(
        self,
        from_status: str,
        to_status: str,
        min_length: int = 10,
    ):
        self.from_status = from_status
        self.to_status = to_status
        self.min_length = min_length
        
        message = (
            f"Backward transition from '{from_status}' to '{to_status}' "
            f"requires a reason with at least {min_length} characters."
        )
        
        super().__init__(
            message=message,
            code="REASON_REQUIRED",
            http_status=422,
            details={
                "from_status": from_status,
                "to_status": to_status,
                "min_length": min_length,
            },
        )
