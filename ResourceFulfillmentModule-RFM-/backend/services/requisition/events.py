"""
Requisition Events - Side Effects Management

Handles all side effects for requisition operations:
- Status history recording
- Audit log creation
"""

import json
from sqlalchemy.orm import Session

from db.models.requisition_status_history import RequisitionStatusHistory
from db.models.audit_log import AuditLog
from .workflow_matrix import RequisitionStatus
from .workflow_exceptions import WorkflowException


class RequisitionEvents:
    """
    Handles side effects for requisition workflow operations.
    All methods are static and operate on the provided DB session.
    """

    @staticmethod
    def record_status_history(
        db: Session,
        req_id: int,
        old_status: str | None,
        new_status: str | None,
        changed_by: int | None,
        justification: str | None = None,
    ) -> None:
        """
        Record a status change in the requisition_status_history table.
        
        Args:
            db: Database session
            req_id: Requisition ID
            old_status: Previous status (must be a valid RequisitionStatus value)
            new_status: New status
            changed_by: User ID who made the change
            justification: Optional reason for the change
            
        Raises:
            WorkflowException: If old_status is None or either status is invalid
        """
        if old_status is None:
            raise WorkflowException(
                message="Invalid transition: old_status cannot be NULL",
                code="NULL_OLD_STATUS",
            )

        if not new_status or new_status == old_status:
            return

        # Validate both statuses against the canonical enum
        _valid = {s.value for s in RequisitionStatus}
        if old_status not in _valid:
            raise WorkflowException(
                message=f"Invalid old_status '{old_status}' — not in RequisitionStatus enum",
                code="INVALID_OLD_STATUS",
            )
        if new_status not in _valid:
            raise WorkflowException(
                message=f"Invalid new_status '{new_status}' — not in RequisitionStatus enum",
                code="INVALID_NEW_STATUS",
            )

        history = RequisitionStatusHistory(
            req_id=req_id,
            old_status=old_status,
            new_status=new_status,
            changed_by=changed_by,
            justification=justification,
        )
        db.add(history)

    @staticmethod
    def log_audit(
        db: Session,
        entity_name: str,
        entity_id: str,
        action: str,
        performed_by: int,
        old_value: dict | None = None,
        new_value: dict | None = None,
    ) -> None:
        """
        Create an audit log entry.
        
        Args:
            db: Database session
            entity_name: Name of the entity (e.g., "requisition")
            entity_id: ID of the entity
            action: Action performed (e.g., "CANCEL", "TA_ASSIGN", "BUDGET_UPDATE")
            performed_by: User ID who performed the action
            old_value: Previous state (dict, will be JSON serialized)
            new_value: New state (dict, will be JSON serialized)
        """
        audit = AuditLog(
            entity_name=entity_name,
            entity_id=entity_id,
            action=action,
            performed_by=performed_by,
            old_value=json.dumps(old_value) if old_value else None,
            new_value=json.dumps(new_value) if new_value else None,
        )
        db.add(audit)

    @staticmethod
    def log_budget_update(
        db: Session,
        req_id: int,
        old_budget: float | None,
        new_budget: float | None,
        performed_by: int,
    ) -> None:
        """
        Log a budget update in the audit log.
        """
        RequisitionEvents.log_audit(
            db=db,
            entity_name="requisition",
            entity_id=str(req_id),
            action="BUDGET_UPDATE",
            performed_by=performed_by,
            old_value={
                "budget_amount": str(old_budget) if old_budget is not None else None
            },
            new_value={
                "budget_amount": str(new_budget) if new_budget is not None else None
            },
        )

    @staticmethod
    def log_ta_assignment(
        db: Session,
        req_id: int,
        ta_user_id: int,
        performed_by: int,
    ) -> None:
        """
        Log a TA assignment in the audit log.
        """
        RequisitionEvents.log_audit(
            db=db,
            entity_name="requisition",
            entity_id=str(req_id),
            action="TA_ASSIGN",
            performed_by=performed_by,
            old_value={"assigned_ta": None, "overall_status": "Approved & Unassigned"},
            new_value={"assigned_ta": ta_user_id, "overall_status": "Active"},
        )

    @staticmethod
    def log_cancellation(
        db: Session,
        req_id: int,
        old_status: str,
        reason: str,
        performed_by: int,
    ) -> None:
        """
        Log a requisition cancellation in the audit log.
        """
        RequisitionEvents.log_audit(
            db=db,
            entity_name="requisition",
            entity_id=str(req_id),
            action="CANCEL",
            performed_by=performed_by,
            old_value={"overall_status": old_status},
            new_value={"overall_status": "Closed", "reason": reason},
        )
