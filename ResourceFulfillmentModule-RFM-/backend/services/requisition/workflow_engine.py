"""
============================================================================
LEGACY WORKFLOW ENGINE — DISABLED (Audit Remediation F-001)
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This file has been DISABLED as part of workflow engine consolidation.
All workflow operations MUST use the V2 engine:

    from services.requisition.workflow_engine_v2 import (
        RequisitionWorkflowEngine,
        RequisitionItemWorkflowEngine,
    )

Or via the package exports:

    from services.requisition import (
        RequisitionWorkflowEngineV2,
        RequisitionItemWorkflowEngine,
    )

MIGRATION GUIDE:
================

OLD (Legacy):
    from services.requisition.workflow_engine import RequisitionWorkflowEngine, WorkflowError
    RequisitionWorkflowEngine.approve_budget(db, requisition, user_id)

NEW (V2):
    from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
    from services.requisition.workflow_exceptions import WorkflowException
    RequisitionWorkflowEngine.approve_budget(db, req_id, user_id, user_roles)

Key differences:
1. V2 methods take req_id (int) instead of requisition object
2. V2 methods require user_roles parameter for authorization
3. V2 uses WorkflowException hierarchy instead of WorkflowError
4. V2 enforces status protection via workflow_transition_context()
5. V2 provides optimistic locking via expected_version parameter

Disabled: February 2026 (Audit Remediation F-001)
"""


class _LegacyEngineDisabledError(RuntimeError):
    """Raised when legacy workflow engine is accessed."""
    pass


class WorkflowError(Exception):
    """
    DEPRECATED: Legacy workflow error class.
    
    Use WorkflowException from workflow_exceptions.py instead:
        from services.requisition.workflow_exceptions import WorkflowException
    
    This class is preserved ONLY for import compatibility during migration.
    """
    def __init__(self, message: str = "", status_code: int = 400):
        self._message = message
        self._status_code = status_code
        super().__init__(message)
    
    @property
    def message(self):
        return self._message
    
    @property
    def status_code(self):
        return self._status_code


class RequisitionWorkflowEngine:
    """
    DISABLED: Legacy workflow engine.
    
    Use RequisitionWorkflowEngine from workflow_engine_v2.py:
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
    
    Or use the V2 alias from package exports:
        from services.requisition import RequisitionWorkflowEngineV2
    
    All methods will raise RuntimeError if called.
    """
    
    @staticmethod
    def _raise_disabled(*args, **kwargs):
        raise _LegacyEngineDisabledError(
            "RequisitionWorkflowEngine (legacy) is DISABLED. "
            "Use RequisitionWorkflowEngine from workflow_engine_v2.py. "
            "See services/requisition/workflow_engine.py for migration guide."
        )
    
    # All legacy methods redirect to error
    approve_budget = _raise_disabled
    approve_hr = _raise_disabled
    reject = _raise_disabled
    assign_ta = _raise_disabled
    assign_ta_to_item = _raise_disabled
    assign_employee_to_item = _raise_disabled
    cancel = _raise_disabled
    recalculate_header_status = _raise_disabled
    update_item_status = _raise_disabled
    validate_can_create_item = _raise_disabled
    log_interview_result = _raise_disabled
    swap_ta_for_item = _raise_disabled
    bulk_swap_ta = _raise_disabled
