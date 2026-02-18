"""
Requisition Workflow Services

This package contains the centralized business logic for requisition management.

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

Modules:
- workflow_matrix.py: Official state definitions, transition matrices, role authorization
- workflow_exceptions.py: Custom exception classes for workflow errors
- workflow_engine_v2.py: Official workflow engines (RequisitionWorkflowEngine, RequisitionItemWorkflowEngine)
- events.py: Side effects (status history, audit logging)
- permissions.py: Legacy ownership and permission validation

===========================================================================
F-001 REMEDIATION: LEGACY ENGINE DISABLED
===========================================================================
As of February 2026, the legacy workflow_engine.py has been DISABLED.
All imports of RequisitionWorkflowEngine now resolve to the V2 engine.

Migration:
- OLD: from services.requisition.workflow_engine import RequisitionWorkflowEngine
- NEW: from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine

The legacy engine will raise RuntimeError if any methods are called.
===========================================================================
"""

# Official v2 workflow implementation (Specification v1.0.0)
from .workflow_matrix import (
    RequisitionStatus,
    RequisitionItemStatus,
    SystemRole,
    HEADER_TRANSITIONS,
    HEADER_TERMINAL_STATES,
    ITEM_TRANSITIONS,
    ITEM_TERMINAL_STATES,
)

from .workflow_exceptions import (
    WorkflowException,
    InvalidTransitionException,
    TerminalStateException,
    AuthorizationException,
    ConcurrencyConflictException,
    EntityLockedException,
    ValidationException,
    PrerequisiteException,
    EntityNotFoundException,
    SystemOnlyTransitionException,
    ReasonRequiredException,
)

from .workflow_engine_v2 import (
    RequisitionWorkflowEngine as RequisitionWorkflowEngineV2,
    RequisitionItemWorkflowEngine,
    WorkflowAuditLogger,
)

# F-001 FIX: Export V2 engine as the default RequisitionWorkflowEngine
# Legacy callers expecting the old engine will now get V2
from .workflow_engine_v2 import RequisitionWorkflowEngine

# Status Protection (GC-001 Enforcement)
from .status_protection import (
    register_status_protection,
    unregister_status_protection,
    workflow_transition_context,
    StatusProtectionError,
)

# Workflow Hooks (Extension Pattern)
from .workflow_hooks import (
    TransitionHookRegistry,
    TransitionEvent,
    create_transition_event,
    BaseTransitionHook,
    MetricsHook,
    SLATimerHook,
    NotificationHook,
    register_default_hooks,
)

# API Adapter (Production Hardening)
from .workflow_api_adapter import (
    WorkflowAPIError,
    create_requisition_draft,
    create_and_submit_requisition,
    create_requisition_item,
    normalize_header_status,
    normalize_item_status,
    get_spec_compliant_statuses,
)

# Supporting modules (still valid)
from .events import RequisitionEvents
from .permissions import RequisitionPermissions

__all__ = [
    # Enums
    "RequisitionStatus",
    "RequisitionItemStatus",
    "SystemRole",
    # Matrices
    "HEADER_TRANSITIONS",
    "HEADER_TERMINAL_STATES",
    "ITEM_TRANSITIONS",
    "ITEM_TERMINAL_STATES",
    # Exceptions
    "WorkflowException",
    "InvalidTransitionException",
    "TerminalStateException",
    "AuthorizationException",
    "ConcurrencyConflictException",
    "EntityLockedException",
    "ValidationException",
    "PrerequisiteException",
    "EntityNotFoundException",
    "SystemOnlyTransitionException",
    "ReasonRequiredException",
    # V2 Engines (Official - F-001 compliant)
    "RequisitionWorkflowEngine",  # Now points to V2
    "RequisitionWorkflowEngineV2",  # Explicit V2 alias
    "RequisitionItemWorkflowEngine",
    "WorkflowAuditLogger",
    # Status Protection (GC-001)
    "register_status_protection",
    "unregister_status_protection",
    "workflow_transition_context",
    "StatusProtectionError",
    # Workflow Hooks (Extension Pattern)
    "TransitionHookRegistry",
    "TransitionEvent",
    "create_transition_event",
    "BaseTransitionHook",
    "MetricsHook",
    "SLATimerHook",
    "NotificationHook",
    "register_default_hooks",
    # API Adapter (Production Hardening)
    "WorkflowAPIError",
    "create_requisition_draft",
    "create_and_submit_requisition",
    "create_requisition_item",
    "normalize_header_status",
    "normalize_item_status",
    "get_spec_compliant_statuses",
    # Supporting Modules
    "RequisitionEvents", 
    "RequisitionPermissions",
]
