"""
============================================================================
WORKFLOW ENGINE - Official State Machine Implementation
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module implements the authoritative workflow engines for:
1. RequisitionWorkflowEngine - Header-level state management
2. RequisitionItemWorkflowEngine - Item-level state management

DESIGN PRINCIPLES:
1. All status transitions go through these engines
2. Direct mutation of status fields is forbidden (GC-001)
3. Concurrency control via optimistic + pessimistic locking
4. All transitions are audited
5. Transactions are atomic - audit failure rolls back everything

USAGE:
    All methods must be called within a transaction context.
    The caller is responsible for commit/rollback.
"""

from datetime import datetime, timezone
from typing import List, Optional, Tuple
import json

from sqlalchemy.orm import Session
from sqlalchemy import func

from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem
from db.models.requisition_status_history import RequisitionStatusHistory
from db.models.audit_log import AuditLog
from db.models.workflow_audit import WorkflowTransitionAudit
from db.models.employee import Employee

from .workflow_matrix import (
    RequisitionStatus,
    RequisitionItemStatus,
    SystemRole,
    HEADER_TRANSITIONS,
    HEADER_TERMINAL_STATES,
    ITEM_TRANSITIONS,
    ITEM_TERMINAL_STATES,
    ITEM_BACKWARD_TRANSITIONS,
    HEADER_TRANSITION_AUTHORITY,
    ITEM_TRANSITION_AUTHORITY,
    ITEM_MODIFICATION_BLOCKED_HEADER_STATES,
    ITEM_STATUS_CHANGE_ALLOWED_HEADER_STATES,
    is_valid_header_transition,
    is_valid_item_transition,
    is_header_terminal,
    is_item_terminal,
    is_backward_item_transition,
    is_system_only_header_transition,
    is_system_only_item_transition,
    get_header_authorized_roles,
    get_item_authorized_roles,
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
    AuditWriteException,
    SystemOnlyTransitionException,
    ReasonRequiredException,
)

# Status protection - all status mutations must occur within workflow context
from .status_protection import workflow_transition_context


# ============================================================================
# AUDIT LOGGER
# ============================================================================

class WorkflowAuditLogger:
    """
    Handles all audit logging for workflow operations.
    Audit writes are mandatory - failure causes transaction rollback.
    
    Two audit strategies:
    1. WorkflowTransitionAudit - Detailed workflow-specific audit with version tracking
    2. AuditLog - General purpose audit log (legacy compatibility)
    3. RequisitionStatusHistory - Status history for requisition headers
    
    All writes occur within the same transaction as the workflow operation.
    If any audit write fails, the entire transaction rolls back.
    """
    
    @staticmethod
    def log_transition(
        db: Session,
        entity_type: str,
        entity_id: int,
        action: str,
        prev_status: str,
        new_status: str,
        performed_by: int,
        version_before: int = 0,
        version_after: int = 0,
        user_roles: Optional[List[str]] = None,
        reason: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> WorkflowTransitionAudit:
        """
        Log a workflow transition to the workflow_transition_audit table.
        
        This is the PRIMARY audit mechanism for workflow operations.
        
        Args:
            db: Database session (must be in transaction)
            entity_type: 'requisition' or 'requisition_item'
            entity_id: Primary key of the entity
            action: Action name (e.g., 'SUBMIT', 'APPROVE_BUDGET')
            prev_status: Status before transition
            new_status: Status after transition
            performed_by: User ID performing the action (0 for SYSTEM)
            version_before: Entity version before transition
            version_after: Entity version after transition
            user_roles: List of user's roles at time of action
            reason: Optional justification/reason
            metadata: Optional additional context (JSON-serializable)
            
        Returns:
            Created WorkflowTransitionAudit record
            
        Raises:
            AuditWriteException: If audit write fails
        """
        try:
            audit = WorkflowTransitionAudit(
                entity_type=entity_type,
                entity_id=entity_id,
                action=action,
                from_status=prev_status,
                to_status=new_status,
                version_before=version_before,
                version_after=version_after,
                performed_by=performed_by if performed_by > 0 else None,
                user_roles=",".join(user_roles) if user_roles else None,
                reason=reason,
                transition_metadata=json.dumps(metadata) if metadata else None,
            )
            db.add(audit)
            db.flush()  # Ensure write succeeds within transaction
            return audit
        except Exception as e:
            raise AuditWriteException(
                operation=f"{action} on {entity_type}:{entity_id}",
                original_error=str(e),
            )
    
    @staticmethod
    def log_to_general_audit(
        db: Session,
        entity_type: str,
        entity_id: int,
        action: str,
        prev_status: str,
        new_status: str,
        performed_by: int,
        reason: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> AuditLog:
        """
        Log to general audit_log table for backward compatibility.
        
        This supplements the workflow-specific audit.
        """
        try:
            audit = AuditLog(
                entity_name=entity_type,
                entity_id=str(entity_id),
                action=action,
                performed_by=performed_by if performed_by > 0 else None,
                old_value=json.dumps({
                    "status": prev_status,
                }),
                new_value=json.dumps({
                    "status": new_status,
                    "reason": reason,
                    **(metadata or {}),
                }),
            )
            db.add(audit)
            db.flush()
            return audit
        except Exception as e:
            raise AuditWriteException(
                operation=f"general_audit {action} on {entity_type}:{entity_id}",
                original_error=str(e),
            )
    
    @staticmethod
    def log_status_history(
        db: Session,
        req_id: int,
        old_status: str,
        new_status: str,
        changed_by: int,
        justification: Optional[str] = None,
    ) -> RequisitionStatusHistory:
        """
        Record a status change in requisition_status_history.
        
        This is specific to requisition headers and provides
        a quick lookup of status change history.
        
        Raises:
            WorkflowException: If old_status is None
            AuditWriteException: If DB write fails
        """
        if old_status is None:
            raise WorkflowException(
                message="Invalid transition: old_status cannot be NULL",
                code="NULL_OLD_STATUS",
            )

        # Validate both statuses against the canonical enum
        _valid = {s.value for s in RequisitionStatus}
        if old_status not in _valid:
            raise ValidationException(
                field="old_status",
                message=f"Invalid status value: {old_status}",
                value=old_status,
            )
        if new_status not in _valid:
            raise ValidationException(
                field="new_status",
                message=f"Invalid status value: {new_status}",
                value=new_status,
            )

        try:
            history = RequisitionStatusHistory(
                req_id=req_id,
                old_status=old_status,
                new_status=new_status,
                changed_by=changed_by if changed_by > 0 else None,
                justification=justification,
            )
            db.add(history)
            db.flush()
            return history
        except Exception as e:
            raise AuditWriteException(
                operation=f"status_history for requisition:{req_id}",
                original_error=str(e),
            )


# ============================================================================
# REQUISITION WORKFLOW ENGINE (Header)
# ============================================================================

class RequisitionWorkflowEngine:
    """
    Official workflow engine for requisition header state management.
    
    All header status transitions MUST go through this engine.
    Direct mutation of overall_status is forbidden (GC-001).
    
    Concurrency Strategy:
    - Optimistic locking via version column
    - Pessimistic locking via SELECT FOR UPDATE
    """
    
    MIN_REASON_LENGTH = 10
    
    # =========================================================================
    # TRANSITION VALIDATION
    # =========================================================================
    
    @staticmethod
    def _parse_status(status_value: str) -> RequisitionStatus:
        """Convert string status to enum, handling validation."""
        try:
            return RequisitionStatus(status_value)
        except ValueError:
            raise ValidationException(
                field="overall_status",
                message=f"Invalid status value: {status_value}",
                value=status_value,
            )
    
    @staticmethod
    def _validate_transition(
        current_status: RequisitionStatus,
        target_status: RequisitionStatus,
        user_roles: List[str],
        is_system: bool = False,
    ) -> None:
        """
        Validate a transition against the workflow matrix.
        
        Raises:
            TerminalStateException: If current state is terminal
            InvalidTransitionException: If transition not allowed
            SystemOnlyTransitionException: If system-only and not system call
            AuthorizationException: If user not authorized
        """
        # GC-002: Terminal state check
        if is_header_terminal(current_status):
            raise TerminalStateException(
                current_status=current_status.value,
                entity_type="requisition",
            )
        
        # Check transition exists in matrix
        if not is_valid_header_transition(current_status, target_status):
            allowed = HEADER_TRANSITIONS.get(current_status, set())
            raise InvalidTransitionException(
                from_status=current_status.value,
                to_status=target_status.value,
                entity_type="requisition",
                allowed_transitions=[s.value for s in allowed],
            )
        
        # GC-008: System-only transition check
        if is_system_only_header_transition(current_status, target_status):
            if not is_system:
                raise SystemOnlyTransitionException(
                    from_status=current_status.value,
                    to_status=target_status.value,
                    entity_type="requisition",
                )
            return  # System transitions skip role check
        
        # Role authorization check
        authorized_roles = get_header_authorized_roles(current_status, target_status)
        user_system_roles = {
            SystemRole(r) for r in user_roles 
            if r in [sr.value for sr in SystemRole]
        }
        
        if not user_system_roles.intersection(authorized_roles):
            raise AuthorizationException(
                action=f"transition requisition from {current_status.value} to {target_status.value}",
                user_roles=user_roles,
                required_roles=[r.value for r in authorized_roles],
            )
    
    @staticmethod
    def _validate_version(
        requisition: Requisition,
        expected_version: Optional[int],
    ) -> None:
        """
        Validate optimistic lock version.
        
        Raises:
            ConcurrencyConflictException: If version mismatch
        """
        if expected_version is not None:
            current_version = getattr(requisition, 'version', 0) or 0
            if current_version != expected_version:
                raise ConcurrencyConflictException(
                    entity_type="requisition",
                    entity_id=requisition.req_id,
                    expected_version=expected_version,
                    actual_version=current_version,
                )
    
    @staticmethod
    def _increment_version(requisition: Requisition) -> None:
        """Increment version for optimistic locking."""
        current = getattr(requisition, 'version', 0) or 0
        if hasattr(requisition, 'version'):
            requisition.version = current + 1
    
    @staticmethod
    def _set_status(requisition: Requisition, new_status: str) -> None:
        """
        Set requisition status within protected context.
        This is the ONLY place where overall_status should be mutated.
        """
        with workflow_transition_context():
            requisition.overall_status = new_status
    
    # =========================================================================
    # LOCK AND FETCH
    # =========================================================================
    
    @staticmethod
    def _get_locked_requisition(
        db: Session,
        req_id: int,
    ) -> Requisition:
        """
        Fetch requisition with pessimistic lock.
        
        Raises:
            EntityNotFoundException: If requisition not found
        """
        requisition = (
            db.query(Requisition)
            .filter(Requisition.req_id == req_id)
            .with_for_update()
            .first()
        )
        if not requisition:
            raise EntityNotFoundException(
                entity_type="requisition",
                entity_id=req_id,
            )
        return requisition
    
    # =========================================================================
    # TRANSITION OPERATIONS
    # =========================================================================
    
    @classmethod
    def submit(
        cls,
        db: Session,
        req_id: int,
        user_id: int,
        user_roles: List[str],
        expected_version: Optional[int] = None,
    ) -> Requisition:
        """
        Submit requisition for budget approval.
        DRAFT → PENDING_BUDGET
        
        Args:
            db: Database session (must be in transaction)
            req_id: Requisition ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            expected_version: Optional version for optimistic locking
            
        Returns:
            Updated requisition
            
        Raises:
            Various WorkflowException subclasses
        """
        requisition = cls._get_locked_requisition(db, req_id)
        current_status = cls._parse_status(requisition.overall_status)
        target_status = RequisitionStatus.PENDING_BUDGET
        
        cls._validate_version(requisition, expected_version)
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = requisition.overall_status
            version_before = getattr(requisition, 'version', 1) or 1
            cls._set_status(requisition, target_status.value)
            cls._increment_version(requisition)
            version_after = getattr(requisition, 'version', 1) or 1
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition",
                entity_id=req_id,
                action="SUBMIT",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                version_before=version_before,
                version_after=version_after,
                user_roles=user_roles,
            )
            WorkflowAuditLogger.log_status_history(
                db=db,
                req_id=req_id,
                old_status=old_status,
                new_status=target_status.value,
                changed_by=user_id,
            )
        
        return requisition
    
    @classmethod
    def approve_budget(
        cls,
        db: Session,
        req_id: int,
        user_id: int,
        user_roles: List[str],
        expected_version: Optional[int] = None,
    ) -> Requisition:
        """
        Approve budget for requisition.
        PENDING_BUDGET → PENDING_HR
        
        Args:
            db: Database session (must be in transaction)
            req_id: Requisition ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            expected_version: Optional version for optimistic locking
            
        Returns:
            Updated requisition
        """
        requisition = cls._get_locked_requisition(db, req_id)
        current_status = cls._parse_status(requisition.overall_status)
        target_status = RequisitionStatus.PENDING_HR
        
        cls._validate_version(requisition, expected_version)
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = requisition.overall_status
            cls._set_status(requisition, target_status.value)
            requisition.budget_approved_by = user_id
            if hasattr(requisition, 'budget_approved_at'):
                requisition.budget_approved_at = datetime.now(timezone.utc)
            cls._increment_version(requisition)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition",
                entity_id=req_id,
                action="APPROVE_BUDGET",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
            )
            WorkflowAuditLogger.log_status_history(
                db=db,
                req_id=req_id,
                old_status=old_status,
                new_status=target_status.value,
                changed_by=user_id,
            )
        
        return requisition
    
    @classmethod
    def approve_hr(
        cls,
        db: Session,
        req_id: int,
        user_id: int,
        user_roles: List[str],
        expected_version: Optional[int] = None,
    ) -> Requisition:
        """
        HR approval of requisition.
        PENDING_HR → ACTIVE
        
        Args:
            db: Database session (must be in transaction)
            req_id: Requisition ID
            user_id: ID of HR user performing action
            user_roles: List of user's role names
            expected_version: Optional version for optimistic locking
            
        Returns:
            Updated requisition
        """
        requisition = cls._get_locked_requisition(db, req_id)
        current_status = cls._parse_status(requisition.overall_status)
        target_status = RequisitionStatus.ACTIVE
        
        cls._validate_version(requisition, expected_version)
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = requisition.overall_status
            cls._set_status(requisition, target_status.value)
            requisition.approved_by = user_id
            if hasattr(requisition, 'hr_approved_at'):
                requisition.hr_approved_at = datetime.now(timezone.utc)
            requisition.approval_history = datetime.now(timezone.utc)
            cls._increment_version(requisition)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition",
                entity_id=req_id,
                action="APPROVE_HR",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
            )
            WorkflowAuditLogger.log_status_history(
                db=db,
                req_id=req_id,
                old_status=old_status,
                new_status=target_status.value,
                changed_by=user_id,
            )
        
        return requisition
    
    @classmethod
    def reject(
        cls,
        db: Session,
        req_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
        expected_version: Optional[int] = None,
    ) -> Requisition:
        """
        Reject requisition.
        PENDING_BUDGET → REJECTED or PENDING_HR → REJECTED
        
        Args:
            db: Database session (must be in transaction)
            req_id: Requisition ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Rejection reason (min 10 chars)
            expected_version: Optional version for optimistic locking
            
        Returns:
            Updated requisition
        """
        # Validate reason
        reason = (reason or "").strip()
        if len(reason) < cls.MIN_REASON_LENGTH:
            raise ValidationException(
                field="reason",
                message=f"Rejection reason must be at least {cls.MIN_REASON_LENGTH} characters",
                value=reason,
            )
        
        requisition = cls._get_locked_requisition(db, req_id)
        current_status = cls._parse_status(requisition.overall_status)
        target_status = RequisitionStatus.REJECTED
        
        cls._validate_version(requisition, expected_version)
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = requisition.overall_status
            cls._set_status(requisition, target_status.value)
            requisition.rejection_reason = reason
            cls._increment_version(requisition)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition",
                entity_id=req_id,
                action="REJECT",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                reason=reason,
            )
            WorkflowAuditLogger.log_status_history(
                db=db,
                req_id=req_id,
                old_status=old_status,
                new_status=target_status.value,
                changed_by=user_id,
                justification=reason,
            )
        
        return requisition
    
    @classmethod
    def cancel(
        cls,
        db: Session,
        req_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
        expected_version: Optional[int] = None,
    ) -> Requisition:
        """
        Cancel requisition.
        DRAFT/PENDING_BUDGET/PENDING_HR/ACTIVE → CANCELLED
        
        Also cancels all non-terminal items.
        
        Args:
            db: Database session (must be in transaction)
            req_id: Requisition ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Cancellation reason (min 10 chars)
            expected_version: Optional version for optimistic locking
            
        Returns:
            Updated requisition
        """
        # Validate reason
        reason = (reason or "").strip()
        if len(reason) < cls.MIN_REASON_LENGTH:
            raise ValidationException(
                field="reason",
                message=f"Cancellation reason must be at least {cls.MIN_REASON_LENGTH} characters",
                value=reason,
            )
        
        requisition = cls._get_locked_requisition(db, req_id)
        current_status = cls._parse_status(requisition.overall_status)
        target_status = RequisitionStatus.CANCELLED
        
        cls._validate_version(requisition, expected_version)
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Cancel all non-terminal items
        items = (
            db.query(RequisitionItem)
            .filter(
                RequisitionItem.req_id == req_id,
                ~RequisitionItem.item_status.in_([
                    RequisitionItemStatus.FULFILLED.value,
                    RequisitionItemStatus.CANCELLED.value,
                ]),
            )
            .with_for_update()
            .all()
        )
        
        # Cancel items + transition + audit within workflow context
        with workflow_transition_context():
            for item in items:
                item.item_status = RequisitionItemStatus.CANCELLED.value
            
            # Perform transition
            old_status = requisition.overall_status
            cls._set_status(requisition, target_status.value)
            cls._increment_version(requisition)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition",
                entity_id=req_id,
                action="CANCEL",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                reason=reason,
                metadata={"cancelled_items": len(items)},
            )
            WorkflowAuditLogger.log_status_history(
                db=db,
                req_id=req_id,
                old_status=old_status,
                new_status=target_status.value,
                changed_by=user_id,
                justification=reason,
            )
        
        return requisition
    
    # =========================================================================
    # F-004: REJECTED → DRAFT TRANSITION (Resubmission Path)
    # =========================================================================
    
    @classmethod
    def reopen_for_revision(
        cls,
        db: Session,
        req_id: int,
        user_id: int,
        user_roles: List[str],
        reason: Optional[str] = None,
        expected_version: Optional[int] = None,
    ) -> Requisition:
        """
        Reopen rejected requisition for revision.
        REJECTED → DRAFT
        
        F-004: Allows managers to address rejection feedback and resubmit.
        
        Args:
            db: Database session (must be in transaction)
            req_id: Requisition ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Optional reason for reopening
            expected_version: Optional version for optimistic locking
            
        Returns:
            Updated requisition (now in DRAFT status)
        """
        requisition = cls._get_locked_requisition(db, req_id)
        current_status = cls._parse_status(requisition.overall_status)
        target_status = RequisitionStatus.DRAFT
        
        cls._validate_version(requisition, expected_version)
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = requisition.overall_status
            cls._set_status(requisition, target_status.value)
            cls._increment_version(requisition)
            
            # Clear previous approval fields for fresh submission cycle
            requisition.budget_approved_by = None
            requisition.approved_by = None
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition",
                entity_id=req_id,
                action="REOPEN_FOR_REVISION",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                reason=reason,
                metadata={"resubmission": True},
            )
            WorkflowAuditLogger.log_status_history(
                db=db,
                req_id=req_id,
                old_status=old_status,
                new_status=target_status.value,
                changed_by=user_id,
                justification=reason or "Reopened for revision after rejection",
            )
        
        return requisition
    
    # =========================================================================
    # HEADER SYNCHRONIZATION (Section 6.2)
    # =========================================================================
    
    @classmethod
    def recalculate_header_status(
        cls,
        db: Session,
        req_id: int,
        changed_by: Optional[int] = None,
    ) -> Optional[RequisitionStatus]:
        """
        Recalculate header status based on item statuses.
        
        ONLY recalculates when header.overall_status == ACTIVE.
        
        Algorithm (Section 6.2):
        - If header in [DRAFT, PENDING_BUDGET, PENDING_HR, REJECTED, CANCELLED]:
          return current status (no change)
        - If header == ACTIVE:
          - If no items: CANCELLED
          - If all active items done and at least 1 fulfilled: FULFILLED
          - If all active items done and none fulfilled: CANCELLED
          - Otherwise: ACTIVE
        
        Returns:
            New status if changed, None if no change
        """
        requisition = cls._get_locked_requisition(db, req_id)
        current_status = cls._parse_status(requisition.overall_status)
        
        # Only recalculate for ACTIVE headers
        if current_status in {
            RequisitionStatus.DRAFT,
            RequisitionStatus.PENDING_BUDGET,
            RequisitionStatus.PENDING_HR,
            RequisitionStatus.REJECTED,
            RequisitionStatus.CANCELLED,
        }:
            return None
        
        if current_status != RequisitionStatus.ACTIVE:
            return None
        
        # Count item statuses
        items = (
            db.query(RequisitionItem)
            .filter(RequisitionItem.req_id == req_id)
            .all()
        )
        
        total_items = len(items)
        if total_items == 0:
            # No items = auto-cancel
            new_status = RequisitionStatus.CANCELLED
        else:
            fulfilled_count = sum(
                1 for i in items 
                if i.item_status == RequisitionItemStatus.FULFILLED.value
            )
            cancelled_count = sum(
                1 for i in items 
                if i.item_status == RequisitionItemStatus.CANCELLED.value
            )
            active_count = total_items - fulfilled_count - cancelled_count
            
            if active_count == 0 and fulfilled_count > 0:
                new_status = RequisitionStatus.FULFILLED
            elif active_count == 0 and fulfilled_count == 0:
                new_status = RequisitionStatus.CANCELLED
            else:
                new_status = RequisitionStatus.ACTIVE
        
        # Apply if changed (using SYSTEM for automatic transition)
        if new_status != current_status:
            with workflow_transition_context():
                old_status = requisition.overall_status
                cls._set_status(requisition, new_status.value)
                cls._increment_version(requisition)
                
                # Audit (SYSTEM triggered)
                WorkflowAuditLogger.log_transition(
                    db=db,
                    entity_type="requisition",
                    entity_id=req_id,
                    action="AUTO_RECALCULATE",
                    prev_status=old_status,
                    new_status=new_status.value,
                    performed_by=changed_by or 0,  # 0 indicates system
                    metadata={"trigger": "item_status_change"},
                )
                WorkflowAuditLogger.log_status_history(
                    db=db,
                    req_id=req_id,
                    old_status=old_status,
                    new_status=new_status.value,
                    changed_by=changed_by,
                    justification="Automatic status recalculation based on item statuses",
                )
            
            return new_status
        
        return None


# ============================================================================
# REQUISITION ITEM WORKFLOW ENGINE
# ============================================================================

class RequisitionItemWorkflowEngine:
    """
    Official workflow engine for requisition item state management.
    
    All item status transitions MUST go through this engine.
    Direct mutation of item_status is forbidden (GC-001).
    
    Concurrency Strategy:
    - Optimistic locking via version column (if present)
    - Pessimistic locking via SELECT FOR UPDATE
    """
    
    MIN_REASON_LENGTH = 10
    
    # =========================================================================
    # VALIDATION
    # =========================================================================
    
    @staticmethod
    def _parse_status(status_value: str) -> RequisitionItemStatus:
        """Convert string status to enum, handling validation."""
        try:
            return RequisitionItemStatus(status_value)
        except ValueError:
            raise ValidationException(
                field="item_status",
                message=f"Invalid status value: {status_value}",
                value=status_value,
            )
    
    @staticmethod
    def _validate_transition(
        current_status: RequisitionItemStatus,
        target_status: RequisitionItemStatus,
        user_roles: List[str],
        reason: Optional[str] = None,
        is_system: bool = False,
    ) -> None:
        """
        Validate a transition against the workflow matrix.
        
        Raises:
            TerminalStateException: If current state is terminal
            InvalidTransitionException: If transition not allowed
            SystemOnlyTransitionException: If system-only and not system call
            ReasonRequiredException: If backward transition without reason
            AuthorizationException: If user not authorized
        """
        # GC-002: Terminal state check
        if is_item_terminal(current_status):
            raise TerminalStateException(
                current_status=current_status.value,
                entity_type="requisition_item",
            )
        
        # Check transition exists in matrix
        if not is_valid_item_transition(current_status, target_status):
            allowed = ITEM_TRANSITIONS.get(current_status, set())
            raise InvalidTransitionException(
                from_status=current_status.value,
                to_status=target_status.value,
                entity_type="requisition_item",
                allowed_transitions=[s.value for s in allowed],
            )
        
        # GC-009: Backward transition requires reason
        if is_backward_item_transition(current_status, target_status):
            reason = (reason or "").strip()
            if len(reason) < 10:
                raise ReasonRequiredException(
                    from_status=current_status.value,
                    to_status=target_status.value,
                )
        
        # System-only transition check
        if is_system_only_item_transition(current_status, target_status):
            if not is_system:
                raise SystemOnlyTransitionException(
                    from_status=current_status.value,
                    to_status=target_status.value,
                    entity_type="requisition_item",
                )
            return  # System transitions skip role check
        
        # Role authorization check
        authorized_roles = get_item_authorized_roles(current_status, target_status)
        user_system_roles = {
            SystemRole(r) for r in user_roles 
            if r in [sr.value for sr in SystemRole]
        }
        
        if not user_system_roles.intersection(authorized_roles):
            raise AuthorizationException(
                action=f"transition item from {current_status.value} to {target_status.value}",
                user_roles=user_roles,
                required_roles=[r.value for r in authorized_roles],
            )
    
    @staticmethod
    def _validate_header_allows_item_change(
        db: Session,
        req_id: int,
    ) -> Requisition:
        """
        Validate that the parent requisition allows item status changes.
        
        Raises:
            EntityLockedException: If header state blocks item changes
        """
        requisition = (
            db.query(Requisition)
            .filter(Requisition.req_id == req_id)
            .first()
        )
        if not requisition:
            raise EntityNotFoundException(
                entity_type="requisition",
                entity_id=req_id,
            )
        
        current_status = RequisitionWorkflowEngine._parse_status(
            requisition.overall_status
        )
        
        if current_status not in ITEM_STATUS_CHANGE_ALLOWED_HEADER_STATES:
            raise EntityLockedException(
                entity_type="requisition_item",
                entity_id=req_id,
                reason=f"Parent requisition is in '{requisition.overall_status}' status. "
                       f"Item status changes only allowed when header is ACTIVE.",
            )
        
        return requisition
    
    # =========================================================================
    # LOCK AND FETCH
    # =========================================================================
    
    @staticmethod
    def _get_locked_item(
        db: Session,
        item_id: int,
    ) -> RequisitionItem:
        """
        Fetch item with pessimistic lock.
        
        Raises:
            EntityNotFoundException: If item not found
        """
        item = (
            db.query(RequisitionItem)
            .filter(RequisitionItem.item_id == item_id)
            .with_for_update()
            .first()
        )
        if not item:
            raise EntityNotFoundException(
                entity_type="requisition_item",
                entity_id=item_id,
            )
        return item
    
    @staticmethod
    def _validate_assigned_ta(
        item: RequisitionItem,
        user_id: int,
        user_roles: List[str],
    ) -> None:
        """
        Validate that user is the assigned TA for the item (Phase 7 permission transfer).
        
        HR and Admin bypass this check as they have override authority.
        TA users can only modify items assigned to them.
        
        Raises:
            AuthorizationException: If TA is not assigned to this item
        """
        # HR and Admin have override authority
        if "HR" in user_roles or "Admin" in user_roles:
            return
        
        # TA users must be the assigned TA
        if "TA" in user_roles:
            assigned_ta_id = item.assigned_ta

            # Backward compatibility: if item-level TA is not set, fall back to
            # requisition header TA assignment.
            if assigned_ta_id is None:
                try:
                    header_ta = getattr(item, "requisition", None)
                    assigned_ta_id = getattr(header_ta, "assigned_ta", None)
                except Exception:
                    assigned_ta_id = None

            if assigned_ta_id is None:
                raise AuthorizationException(
                    action="modify unassigned item",
                    user_roles=user_roles,
                    required_roles=["HR", "Admin"],
                    reason="Item has no TA assigned. Only HR or Admin can modify.",
                )
            if assigned_ta_id != user_id:
                raise AuthorizationException(
                    action="modify item assigned to another TA",
                    user_roles=user_roles,
                    required_roles=["HR", "Admin"],
                    reason=f"You are not the assigned TA for this item. "
                           f"Assigned TA ID: {assigned_ta_id}",
                )
    
    @staticmethod
    def _set_item_status(item: RequisitionItem, new_status: str) -> None:
        """
        Set item status within protected context.
        This is the ONLY place where item_status should be mutated.
        """
        with workflow_transition_context():
            item.item_status = new_status
    
    @staticmethod
    def _increment_item_version(item: RequisitionItem) -> None:
        """Increment version for optimistic locking."""
        if hasattr(item, 'version'):
            current = getattr(item, 'version', 0) or 0
            item.version = current + 1
    
    # =========================================================================
    # GC-003: TA ASSIGNMENT AUTO-TRANSITION
    # =========================================================================
    
    @classmethod
    def assign_ta(
        cls,
        db: Session,
        item_id: int,
        ta_user_id: int,
        performed_by: int,
        user_roles: List[str],
    ) -> RequisitionItem:
        """
        Assign a TA to an item.
        
        GC-003: Assigning TA auto-transitions PENDING → SOURCING (SYSTEM).
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            ta_user_id: ID of TA user to assign
            performed_by: ID of user performing action
            user_roles: List of user's role names
            
        Returns:
            Updated item
        """
        # HR/Admin can assign any TA; TA can only self-assign (ta_user_id == performed_by)
        if "HR" not in user_roles and "Admin" not in user_roles:
            if "TA" not in user_roles:
                raise AuthorizationException(
                    action="assign TA to item",
                    user_roles=user_roles,
                    required_roles=["HR", "Admin", "TA"],
                )
            if ta_user_id != performed_by:
                raise AuthorizationException(
                    action="assign another TA to item",
                    user_roles=user_roles,
                    required_roles=["HR", "Admin"],
                    reason="TA can only self-assign. To assign another TA, use HR or Admin.",
                )

        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        
        current_status = cls._parse_status(item.item_status)
        
        # Check if already assigned
        if item.assigned_ta is not None:
            raise ValidationException(
                field="assigned_ta",
                message="TA already assigned to this item",
                value=item.assigned_ta,
            )
        
        # Cannot assign to terminal items
        if is_item_terminal(current_status):
            raise TerminalStateException(
                current_status=current_status.value,
                entity_type="requisition_item",
                entity_id=item_id,
            )
        
        # Assign TA
        item.assigned_ta = ta_user_id
        
        # GC-003: Auto-transition PENDING → SOURCING
        with workflow_transition_context():
            if current_status == RequisitionItemStatus.PENDING:
                old_status = item.item_status
                cls._set_item_status(item, RequisitionItemStatus.SOURCING.value)
                
                # Audit (SYSTEM triggered transition)
                WorkflowAuditLogger.log_transition(
                    db=db,
                    entity_type="requisition_item",
                    entity_id=item_id,
                    action="TA_ASSIGN_AUTO_SOURCING",
                    prev_status=old_status,
                    new_status=RequisitionItemStatus.SOURCING.value,
                    performed_by=performed_by,
                    metadata={"ta_user_id": ta_user_id, "trigger": "GC-003"},
                )
            else:
                # Just log the assignment without status change
                WorkflowAuditLogger.log_transition(
                    db=db,
                    entity_type="requisition_item",
                    entity_id=item_id,
                    action="TA_ASSIGN",
                    prev_status=item.item_status,
                    new_status=item.item_status,
                    performed_by=performed_by,
                    metadata={"ta_user_id": ta_user_id},
                )
        
        # Recalculate header (just in case)
        RequisitionWorkflowEngine.recalculate_header_status(
            db=db,
            req_id=item.req_id,
            changed_by=performed_by,
        )
        
        return item
    
    # =========================================================================
    # TRANSITION OPERATIONS
    # =========================================================================
    
    @classmethod
    def shortlist(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        candidate_count: Optional[int] = None,
    ) -> RequisitionItem:
        """
        Move item to SHORTLISTED.
        SOURCING → SHORTLISTED
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            candidate_count: Optional number of candidates shortlisted
            
        Returns:
            Updated item
        """
        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        cls._validate_assigned_ta(item, user_id, user_roles)  # Phase 7: TA ownership check
        
        current_status = cls._parse_status(item.item_status)
        target_status = RequisitionItemStatus.SHORTLISTED
        
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = item.item_status
            cls._set_item_status(item, target_status.value)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item_id,
                action="SHORTLIST",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                metadata={"candidate_count": candidate_count} if candidate_count else None,
            )
        
        return item
    
    @classmethod
    def start_interview(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
    ) -> RequisitionItem:
        """
        Move item to INTERVIEWING.
        SHORTLISTED → INTERVIEWING
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            
        Returns:
            Updated item
        """
        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        cls._validate_assigned_ta(item, user_id, user_roles)  # Phase 7: TA ownership check
        
        current_status = cls._parse_status(item.item_status)
        target_status = RequisitionItemStatus.INTERVIEWING
        
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = item.item_status
            cls._set_item_status(item, target_status.value)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item_id,
                action="START_INTERVIEW",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
            )
        
        return item
    
    @classmethod
    def make_offer(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        candidate_id: Optional[str] = None,
        offer_details: Optional[dict] = None,
    ) -> RequisitionItem:
        """
        Move item to OFFERED.
        INTERVIEWING → OFFERED
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            candidate_id: Optional ID of candidate receiving offer
            offer_details: Optional dict with offer information
            
        Returns:
            Updated item
        """
        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        cls._validate_assigned_ta(item, user_id, user_roles)  # Phase 7: TA ownership check
        
        current_status = cls._parse_status(item.item_status)
        target_status = RequisitionItemStatus.OFFERED
        
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = item.item_status
            cls._set_item_status(item, target_status.value)
            
            # Audit
            metadata = {}
            if candidate_id:
                metadata["candidate_id"] = candidate_id
            if offer_details:
                metadata["offer_details"] = offer_details
            
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item_id,
                action="MAKE_OFFER",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                metadata=metadata or None,
            )
        
        return item
    
    @classmethod
    def fulfill(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        employee_id: str,
    ) -> RequisitionItem:
        """
        Fulfill item - assign employee.
        OFFERED → FULFILLED
        
        GC-004: Item cannot transition to FULFILLED unless assigned_employee_id exists.
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            employee_id: ID of employee being assigned
            
        Returns:
            Updated item
        """
        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        cls._validate_assigned_ta(item, user_id, user_roles)  # Phase 7: TA ownership check
        
        current_status = cls._parse_status(item.item_status)
        target_status = RequisitionItemStatus.FULFILLED
        
        cls._validate_transition(current_status, target_status, user_roles)
        
        # GC-004: Validate employee exists
        employee = db.query(Employee).filter(Employee.emp_id == employee_id).first()
        if not employee:
            raise PrerequisiteException(
                transition="OFFERED → FULFILLED",
                prerequisite=f"Employee with ID '{employee_id}' must exist",
                entity_type="requisition_item",
                entity_id=item_id,
            )
        
        # Check for duplicate assignment
        existing = (
            db.query(RequisitionItem)
            .filter(
                RequisitionItem.assigned_emp_id == employee_id,
                RequisitionItem.item_status == RequisitionItemStatus.FULFILLED.value,
                RequisitionItem.item_id != item_id,
            )
            .first()
        )
        if existing:
            raise ValidationException(
                field="employee_id",
                message=f"Employee '{employee_id}' is already assigned to another fulfilled item",
                value=employee_id,
            )
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = item.item_status
            cls._set_item_status(item, target_status.value)
            item.assigned_emp_id = employee_id
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item_id,
                action="FULFILL",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                metadata={"employee_id": employee_id},
            )
        
        # Trigger header recalculation (may auto-transition to FULFILLED)
        RequisitionWorkflowEngine.recalculate_header_status(
            db=db,
            req_id=item.req_id,
            changed_by=user_id,
        )
        
        return item
    
    @classmethod
    def cancel(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
    ) -> RequisitionItem:
        """
        Cancel item.
        Any non-terminal → CANCELLED
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Cancellation reason (min 10 chars)
            
        Returns:
            Updated item
        """
        # Validate reason
        reason = (reason or "").strip()
        if len(reason) < cls.MIN_REASON_LENGTH:
            raise ValidationException(
                field="reason",
                message=f"Cancellation reason must be at least {cls.MIN_REASON_LENGTH} characters",
                value=reason,
            )
        
        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        cls._validate_assigned_ta(item, user_id, user_roles)  # Phase 7: TA ownership check
        
        current_status = cls._parse_status(item.item_status)
        target_status = RequisitionItemStatus.CANCELLED
        
        cls._validate_transition(current_status, target_status, user_roles)
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = item.item_status
            cls._set_item_status(item, target_status.value)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item_id,
                action="CANCEL",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                reason=reason,
            )
        
        # Trigger header recalculation
        RequisitionWorkflowEngine.recalculate_header_status(
            db=db,
            req_id=item.req_id,
            changed_by=user_id,
        )
        
        return item
    
    # =========================================================================
    # BACKWARD TRANSITIONS (Section 4.5)
    # =========================================================================
    
    @classmethod
    def re_source(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
    ) -> RequisitionItem:
        """
        Return item to SOURCING (backward transition).
        SHORTLISTED → SOURCING
        
        GC-009: Requires reason (min 10 chars).
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Reason for re-sourcing (min 10 chars)
            
        Returns:
            Updated item
        """
        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        
        current_status = cls._parse_status(item.item_status)
        target_status = RequisitionItemStatus.SOURCING
        
        # Validate transition (includes reason check for backward)
        cls._validate_transition(
            current_status, target_status, user_roles, reason=reason
        )
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = item.item_status
            cls._set_item_status(item, target_status.value)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item_id,
                action="RE_SOURCE",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                reason=reason,
            )
        
        return item
    
    @classmethod
    def return_to_shortlist(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
    ) -> RequisitionItem:
        """
        Return item to SHORTLISTED (backward transition).
        INTERVIEWING → SHORTLISTED
        
        GC-009: Requires reason (min 10 chars).
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Reason for returning (min 10 chars)
            
        Returns:
            Updated item
        """
        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        
        current_status = cls._parse_status(item.item_status)
        target_status = RequisitionItemStatus.SHORTLISTED
        
        # Validate transition (includes reason check for backward)
        cls._validate_transition(
            current_status, target_status, user_roles, reason=reason
        )
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = item.item_status
            cls._set_item_status(item, target_status.value)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item_id,
                action="RETURN_TO_SHORTLIST",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                reason=reason,
            )
        
        return item
    
    @classmethod
    def offer_declined(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
    ) -> RequisitionItem:
        """
        Return item to INTERVIEWING after offer declined (backward transition).
        OFFERED → INTERVIEWING
        
        GC-009: Requires reason (min 10 chars).
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Reason for decline (min 10 chars)
            
        Returns:
            Updated item
        """
        item = cls._get_locked_item(db, item_id)
        cls._validate_header_allows_item_change(db, item.req_id)
        
        current_status = cls._parse_status(item.item_status)
        target_status = RequisitionItemStatus.INTERVIEWING
        
        # Validate transition (includes reason check for backward)
        cls._validate_transition(
            current_status, target_status, user_roles, reason=reason
        )
        
        # Perform transition + audit within workflow context
        with workflow_transition_context():
            old_status = item.item_status
            cls._set_item_status(item, target_status.value)
            
            # Audit
            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item_id,
                action="OFFER_DECLINED",
                prev_status=old_status,
                new_status=target_status.value,
                performed_by=user_id,
                reason=reason,
            )
        
        return item
    
    # =========================================================================
    # SWAP OPERATIONS
    # =========================================================================
    
    @classmethod
    def swap_ta(
        cls,
        db: Session,
        item_id: int,
        new_ta_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
    ) -> RequisitionItem:
        """
        Swap the TA assigned to an item.
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            new_ta_id: ID of new TA user
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Reason for swap (min 5 chars)
            
        Returns:
            Updated item
        """
        # Only HR or Admin can swap TA
        if "HR" not in user_roles and "Admin" not in user_roles:
            raise AuthorizationException(
                action="swap TA on item",
                user_roles=user_roles,
                required_roles=["HR", "Admin"],
            )
        
        # Validate reason
        reason = (reason or "").strip()
        if len(reason) < 5:
            raise ValidationException(
                field="reason",
                message="Swap reason must be at least 5 characters",
                value=reason,
            )
        
        item = cls._get_locked_item(db, item_id)
        current_status = cls._parse_status(item.item_status)
        
        # Cannot swap on terminal items
        if is_item_terminal(current_status):
            raise TerminalStateException(
                current_status=current_status.value,
                entity_type="requisition_item",
                entity_id=item_id,
            )
        
        # Perform swap
        old_ta_id = item.assigned_ta
        item.assigned_ta = new_ta_id
        
        # Audit
        WorkflowAuditLogger.log_transition(
            db=db,
            entity_type="requisition_item",
            entity_id=item_id,
            action="SWAP_TA",
            prev_status=item.item_status,
            new_status=item.item_status,
            performed_by=user_id,
            reason=reason,
            metadata={"old_ta_id": old_ta_id, "new_ta_id": new_ta_id},
        )
        
        return item
    
    @classmethod
    def bulk_reassign(
        cls,
        db: Session,
        req_id: int,
        old_ta_id: int,
        new_ta_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
        item_ids: Optional[List[int]] = None,
    ) -> List[RequisitionItem]:
        """
        Bulk reassign items from one TA to another within a single transaction.

        All eligible items are locked with FOR UPDATE, updated, and audited
        inside the caller's transaction boundary.  If any step fails the
        caller must rollback — the engine never commits.

        Args:
            db: Database session (caller owns the transaction)
            req_id: Requisition header ID
            old_ta_id: Current TA to reassign FROM
            new_ta_id: Target TA to reassign TO
            user_id: HR Admin performing the action
            user_roles: Roles of the performing user
            reason: Mandatory reason (min 5 chars)
            item_ids: Optional subset of item IDs to reassign.
                      If None, all eligible items under old_ta_id are reassigned.

        Returns:
            List of updated RequisitionItem objects.

        Raises:
            AuthorizationException: If user is not HR or Admin.
            ValidationException: If reason too short or old == new TA.
            EntityNotFoundException: If requisition not found.
        """
        # ---- Role check ----
        if "HR" not in user_roles and "Admin" not in user_roles:
            raise AuthorizationException(
                action="bulk reassign TA",
                user_roles=user_roles,
                required_roles=["HR", "Admin"],
            )

        # ---- Validate reason ----
        reason = (reason or "").strip()
        if len(reason) < 5:
            raise ValidationException(
                field="reason",
                message="Reassignment reason must be at least 5 characters",
                value=reason,
            )

        # ---- Validate TAs differ ----
        if old_ta_id == new_ta_id:
            raise ValidationException(
                field="new_ta_id",
                message="New TA must be different from the current TA",
                value=str(new_ta_id),
            )

        # ---- Verify requisition exists ----
        requisition = (
            db.query(Requisition)
            .filter(Requisition.req_id == req_id)
            .first()
        )
        if not requisition:
            raise EntityNotFoundException(
                entity_type="requisition",
                entity_id=req_id,
            )

        # ---- Lock eligible items with FOR UPDATE ----
        query = (
            db.query(RequisitionItem)
            .filter(
                RequisitionItem.req_id == req_id,
                RequisitionItem.assigned_ta == old_ta_id,
                RequisitionItem.item_status.notin_(["Fulfilled", "Cancelled"]),
            )
            .with_for_update()
        )

        if item_ids:
            query = query.filter(RequisitionItem.item_id.in_(item_ids))

        items = query.all()

        if not items:
            raise ValidationException(
                field="items",
                message="No eligible items found for reassignment",
                value=f"req_id={req_id}, old_ta={old_ta_id}",
            )

        # ---- Update + audit each item inside the same transaction ----
        for item in items:
            item.assigned_ta = new_ta_id

            WorkflowAuditLogger.log_transition(
                db=db,
                entity_type="requisition_item",
                entity_id=item.item_id,
                action="ITEM_REASSIGNED",
                prev_status=item.item_status,
                new_status=item.item_status,
                performed_by=user_id,
                reason=reason,
                metadata={
                    "old_ta_id": old_ta_id,
                    "new_ta_id": new_ta_id,
                    "req_id": req_id,
                },
            )

        return items
    
    # =========================================================================
    # ITEM BUDGET WORKFLOW OPERATIONS
    # =========================================================================
    
    @classmethod
    def edit_budget(
        cls,
        db: Session,
        item_id: int,
        estimated_budget: float,
        currency: str,
        user_id: int,
        user_roles: List[str],
    ) -> RequisitionItem:
        """
        Edit the estimated budget for an item.
        
        Can only be done when header is in DRAFT or PENDING_BUDGET.
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            estimated_budget: New estimated budget (must be > 0)
            currency: Currency code (ISO 4217)
            user_id: ID of user performing action
            user_roles: List of user's role names
            
        Returns:
            Updated item
            
        Raises:
            ValidationException: If budget <= 0 or currency invalid
            AuthorizationException: If user not authorized
            EntityLockedException: If header state doesn't allow budget editing
        """
        from .workflow_matrix import (
            ITEM_BUDGET_EDITABLE_HEADER_STATES,
            ITEM_BUDGET_EDIT_AUTHORITY,
            SystemRole,
        )
        import re
        
        # Validate estimated_budget
        if estimated_budget <= 0:
            raise ValidationException(
                field="estimated_budget",
                message="Estimated budget must be greater than 0",
                value=estimated_budget,
            )
        
        # Validate currency format (ISO 4217 pattern)
        if not re.match(r'^[A-Z]{2,10}$', currency):
            raise ValidationException(
                field="currency",
                message="Currency must be 2-10 uppercase letters (ISO 4217)",
                value=currency,
            )
        
        # Check authorization
        user_system_roles = {
            SystemRole(r) for r in user_roles
            if r in [sr.value for sr in SystemRole]
        }
        if not user_system_roles.intersection(ITEM_BUDGET_EDIT_AUTHORITY):
            raise AuthorizationException(
                action="edit item budget",
                user_roles=user_roles,
                required_roles=[r.value for r in ITEM_BUDGET_EDIT_AUTHORITY],
            )
        
        # Lock item
        item = cls._get_locked_item(db, item_id)
        
        # Check header state allows budget editing
        requisition = (
            db.query(Requisition)
            .filter(Requisition.req_id == item.req_id)
            .with_for_update()
            .first()
        )
        if not requisition:
            raise EntityNotFoundException(
                entity_type="requisition",
                entity_id=item.req_id,
            )
        
        header_status = RequisitionWorkflowEngine._parse_status(requisition.overall_status)
        if header_status not in ITEM_BUDGET_EDITABLE_HEADER_STATES:
            raise EntityLockedException(
                entity_type="requisition_item",
                entity_id=item_id,
                reason=f"Cannot edit budget when requisition is in '{requisition.overall_status}' status. "
                       f"Budget editing only allowed in: {', '.join(s.value for s in ITEM_BUDGET_EDITABLE_HEADER_STATES)}",
            )

        # Business rule: during Pending_Budget, HR/Admin should set approved_budget,
        # not modify estimated_budget. They must use approve-budget endpoint.
        role_set = {r.lower() for r in user_roles}
        if (
            requisition.overall_status == "Pending_Budget"
            and ("hr" in role_set or "admin" in role_set)
        ):
            raise EntityLockedException(
                entity_type="requisition_item",
                entity_id=item_id,
                reason=(
                    "Estimated budget cannot be edited by HR/Admin in Pending_Budget. "
                    "Set approved_budget via approve-budget endpoint."
                ),
            )
        
        # Cannot edit budget if already approved
        if item.approved_budget is not None:
            raise EntityLockedException(
                entity_type="requisition_item",
                entity_id=item_id,
                reason="Cannot edit budget after it has been approved. Request a budget revision instead.",
            )
        
        # Capture old values for audit
        old_estimated_budget = float(item.estimated_budget) if item.estimated_budget else 0
        old_currency = item.currency
        # Preserve approved_budget - editing estimated_budget should NEVER change approved_budget
        preserved_approved_budget = item.approved_budget
        
        # Update budget (ONLY estimated_budget and currency; approved_budget stays unchanged)
        item.estimated_budget = estimated_budget
        item.currency = currency
        # Explicitly ensure approved_budget is not modified
        item.approved_budget = preserved_approved_budget
        cls._increment_item_version(item)
        
        # Audit
        WorkflowAuditLogger.log_transition(
            db=db,
            entity_type="requisition_item",
            entity_id=item_id,
            action="ITEM_BUDGET_EDITED",
            prev_status=item.item_status,
            new_status=item.item_status,
            performed_by=user_id,
            user_roles=user_roles,
            metadata={
                "previous_estimated_budget": old_estimated_budget,
                "new_estimated_budget": estimated_budget,
                "previous_currency": old_currency,
                "new_currency": currency,
            },
        )
        
        return item
    
    @classmethod
    def approve_budget(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        approved_budget: Optional[float] = None,
    ) -> RequisitionItem:
        """
        Approve budget for an item.
        
        If approved_budget is provided, sets item.approved_budget = approved_budget
        (estimated_budget is unchanged). Otherwise sets approved_budget = estimated_budget.
        Can only be done when header is in PENDING_BUDGET.
        
        After approval:
        - If ALL items have approved budgets → header transitions to PENDING_HR
        - If some items still pending → header remains PENDING_BUDGET
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            approved_budget: Optional amount to approve at (can differ from estimated). If None, use estimated_budget.
            
        Returns:
            Updated item
            
        Raises:
            ValidationException: If estimated_budget <= 0 or approved_budget <= 0 when provided
            AuthorizationException: If user not authorized
            EntityLockedException: If header state doesn't allow approval
        """
        from .workflow_matrix import (
            ITEM_BUDGET_APPROVABLE_HEADER_STATES,
            ITEM_BUDGET_APPROVE_AUTHORITY,
            SystemRole,
        )
        
        # Check authorization
        user_system_roles = {
            SystemRole(r) for r in user_roles
            if r in [sr.value for sr in SystemRole]
        }
        if not user_system_roles.intersection(ITEM_BUDGET_APPROVE_AUTHORITY):
            raise AuthorizationException(
                action="approve item budget",
                user_roles=user_roles,
                required_roles=[r.value for r in ITEM_BUDGET_APPROVE_AUTHORITY],
            )
        
        # Lock item with SELECT FOR UPDATE
        item = cls._get_locked_item(db, item_id)
        
        # Check header state allows budget approval
        requisition = (
            db.query(Requisition)
            .filter(Requisition.req_id == item.req_id)
            .with_for_update()
            .first()
        )
        if not requisition:
            raise EntityNotFoundException(
                entity_type="requisition",
                entity_id=item.req_id,
            )
        
        header_status = RequisitionWorkflowEngine._parse_status(requisition.overall_status)
        if header_status not in ITEM_BUDGET_APPROVABLE_HEADER_STATES:
            raise EntityLockedException(
                entity_type="requisition_item",
                entity_id=item_id,
                reason=f"Cannot approve budget when requisition is in '{requisition.overall_status}' status. "
                       f"Budget approval only allowed in: {', '.join(s.value for s in ITEM_BUDGET_APPROVABLE_HEADER_STATES)}",
            )
        
        # Validate estimated_budget > 0
        if not item.estimated_budget or float(item.estimated_budget) <= 0:
            raise ValidationException(
                field="estimated_budget",
                message="Cannot approve budget: estimated_budget must be greater than 0",
                value=float(item.estimated_budget) if item.estimated_budget else 0,
            )
        
        # Check if already approved
        if item.approved_budget is not None:
            raise ValidationException(
                field="approved_budget",
                message="Budget has already been approved for this item",
                value=float(item.approved_budget),
            )
        
        # Determine approved amount: use provided value or copy from estimated (do not change estimated_budget)
        if approved_budget is not None:
            if approved_budget <= 0:
                raise ValidationException(
                    field="approved_budget",
                    message="Approved budget must be greater than 0",
                    value=approved_budget,
                )
            approved_value = float(approved_budget)
        else:
            approved_value = float(item.estimated_budget)
        
        estimated_budget_value = float(item.estimated_budget)
        
        # Set approved_budget only; estimated_budget stays unchanged
        from decimal import Decimal
        item.approved_budget = Decimal(str(approved_value))
        cls._increment_item_version(item)
        
        # Audit
        WorkflowAuditLogger.log_transition(
            db=db,
            entity_type="requisition_item",
            entity_id=item_id,
            action="ITEM_BUDGET_APPROVED",
            prev_status=item.item_status,
            new_status=item.item_status,
            performed_by=user_id,
            user_roles=user_roles,
            metadata={
                "estimated_budget": estimated_budget_value,
                "approved_budget": approved_value,
                "currency": item.currency,
            },
        )
        
        # Check if all items now have approved budgets → transition header to PENDING_HR
        cls._recalculate_header_budget_status(db, requisition, user_id, user_roles)
        
        return item
    
    @classmethod
    def reject_budget(
        cls,
        db: Session,
        item_id: int,
        user_id: int,
        user_roles: List[str],
        reason: str,
    ) -> RequisitionItem:
        """
        Reject budget for an item.
        
        Clears approved_budget and requires manager to revise estimated_budget.
        
        Args:
            db: Database session (must be in transaction)
            item_id: Item ID
            user_id: ID of user performing action
            user_roles: List of user's role names
            reason: Rejection reason (min 10 chars)
            
        Returns:
            Updated item
        """
        from .workflow_matrix import (
            ITEM_BUDGET_APPROVABLE_HEADER_STATES,
            ITEM_BUDGET_REJECT_AUTHORITY,
            SystemRole,
        )
        
        # Validate reason
        reason = (reason or "").strip()
        if len(reason) < cls.MIN_REASON_LENGTH:
            raise ValidationException(
                field="reason",
                message=f"Rejection reason must be at least {cls.MIN_REASON_LENGTH} characters",
                value=reason,
            )
        
        # Check authorization
        user_system_roles = {
            SystemRole(r) for r in user_roles
            if r in [sr.value for sr in SystemRole]
        }
        if not user_system_roles.intersection(ITEM_BUDGET_REJECT_AUTHORITY):
            raise AuthorizationException(
                action="reject item budget",
                user_roles=user_roles,
                required_roles=[r.value for r in ITEM_BUDGET_REJECT_AUTHORITY],
            )
        
        # Lock item
        item = cls._get_locked_item(db, item_id)
        
        # Check header state
        requisition = (
            db.query(Requisition)
            .filter(Requisition.req_id == item.req_id)
            .with_for_update()
            .first()
        )
        if not requisition:
            raise EntityNotFoundException(
                entity_type="requisition",
                entity_id=item.req_id,
            )
        
        header_status = RequisitionWorkflowEngine._parse_status(requisition.overall_status)
        if header_status not in ITEM_BUDGET_APPROVABLE_HEADER_STATES:
            raise EntityLockedException(
                entity_type="requisition_item",
                entity_id=item_id,
                reason=f"Cannot reject budget when requisition is in '{requisition.overall_status}' status.",
            )
        
        # Capture values for audit
        old_estimated_budget = float(item.estimated_budget) if item.estimated_budget else 0
        old_approved_budget = float(item.approved_budget) if item.approved_budget else None
        
        # Clear approved_budget (manager must revise)
        item.approved_budget = None
        cls._increment_item_version(item)
        
        # Audit
        WorkflowAuditLogger.log_transition(
            db=db,
            entity_type="requisition_item",
            entity_id=item_id,
            action="ITEM_BUDGET_REJECTED",
            prev_status=item.item_status,
            new_status=item.item_status,
            performed_by=user_id,
            user_roles=user_roles,
            reason=reason,
            metadata={
                "estimated_budget": old_estimated_budget,
                "previous_approved_budget": old_approved_budget,
                "currency": item.currency,
            },
        )
        
        return item
    
    @classmethod
    def _recalculate_header_budget_status(
        cls,
        db: Session,
        requisition: Requisition,
        changed_by: int,
        user_roles: List[str],
    ) -> Optional[RequisitionStatus]:
        """
        Recalculate header status based on item budget approvals.
        
        Called after budget approval/rejection.
        
        Rules:
        - If ALL items have approved_budget > 0 → header transitions to PENDING_HR
        - Otherwise → header remains PENDING_BUDGET
        
        Args:
            db: Database session
            requisition: Locked requisition
            changed_by: User ID
            user_roles: User roles
            
        Returns:
            New status if changed, None otherwise
        """
        current_status = RequisitionWorkflowEngine._parse_status(requisition.overall_status)
        
        # Only recalculate for PENDING_BUDGET headers
        if current_status != RequisitionStatus.PENDING_BUDGET:
            return None
        
        # Get all items for this requisition
        items = (
            db.query(RequisitionItem)
            .filter(RequisitionItem.req_id == requisition.req_id)
            .all()
        )
        
        if not items:
            return None
        
        # Check if all items have approved budgets
        all_approved = all(
            item.approved_budget is not None and float(item.approved_budget) > 0
            for item in items
        )
        
        if all_approved:
            # Transition header to PENDING_HR
            target_status = RequisitionStatus.PENDING_HR
            
            with workflow_transition_context():
                old_status = requisition.overall_status
                RequisitionWorkflowEngine._set_status(requisition, target_status.value)
                requisition.budget_approved_by = changed_by
                RequisitionWorkflowEngine._increment_version(requisition)
                
                # Calculate totals for audit
                total_estimated = sum(float(i.estimated_budget or 0) for i in items)
                total_approved = sum(float(i.approved_budget or 0) for i in items)
                
                # Audit
                WorkflowAuditLogger.log_transition(
                    db=db,
                    entity_type="requisition",
                    entity_id=requisition.req_id,
                    action="ALL_BUDGETS_APPROVED",
                    prev_status=old_status,
                    new_status=target_status.value,
                    performed_by=changed_by,
                    user_roles=user_roles,
                    metadata={
                        "trigger": "all_item_budgets_approved",
                        "total_estimated_budget": total_estimated,
                        "total_approved_budget": total_approved,
                        "item_count": len(items),
                    },
                )
                WorkflowAuditLogger.log_status_history(
                    db=db,
                    req_id=requisition.req_id,
                    old_status=old_status,
                    new_status=target_status.value,
                    changed_by=changed_by,
                    justification="All item budgets approved",
                )
            
            return target_status
        
        return None
