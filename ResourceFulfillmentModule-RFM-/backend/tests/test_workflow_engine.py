"""
============================================================================
WORKFLOW ENGINE TEST SUITE
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

Comprehensive test coverage for:
- All allowed transitions
- All invalid transitions
- Role violations
- Terminal state protection
- Header synchronization correctness
- Optimistic lock conflict
- Pessimistic lock behavior
- Audit logging validation
"""

import pytest
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock
from sqlalchemy.orm import Session

from services.requisition.workflow_matrix import (
    RequisitionStatus,
    RequisitionItemStatus,
    SystemRole,
    HEADER_TRANSITIONS,
    ITEM_TRANSITIONS,
    HEADER_TERMINAL_STATES,
    ITEM_TERMINAL_STATES,
    is_valid_header_transition,
    is_valid_item_transition,
    is_header_terminal,
    is_item_terminal,
    is_backward_item_transition,
)

from services.requisition.workflow_exceptions import (
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

from services.requisition.workflow_engine_v2 import (
    RequisitionWorkflowEngine,
    RequisitionItemWorkflowEngine,
    WorkflowAuditLogger,
)


# ============================================================================
# FIXTURES
# ============================================================================

@pytest.fixture
def mock_db():
    """Create a mock database session."""
    db = Mock(spec=Session)
    db.query = Mock(return_value=db)
    db.filter = Mock(return_value=db)
    db.with_for_update = Mock(return_value=db)
    db.first = Mock()
    db.all = Mock(return_value=[])
    db.add = Mock()
    db.flush = Mock()
    db.commit = Mock()
    db.rollback = Mock()
    return db


@pytest.fixture
def mock_requisition():
    """Create a mock requisition."""
    req = Mock()
    req.req_id = 1
    req.overall_status = RequisitionStatus.DRAFT.value
    req.raised_by = 100
    req.assigned_ta = None
    req.budget_approved_by = None
    req.approved_by = None
    req.rejection_reason = None
    req.version = 1
    return req


@pytest.fixture
def mock_item():
    """Create a mock requisition item."""
    item = Mock()
    item.item_id = 1
    item.req_id = 1
    item.item_status = RequisitionItemStatus.PENDING.value
    item.assigned_ta = None
    item.assigned_emp_id = None
    return item


# ============================================================================
# WORKFLOW MATRIX TESTS
# ============================================================================

class TestWorkflowMatrix:
    """Test the workflow matrix definitions."""
    
    def test_all_header_states_defined(self):
        """Ensure all header states have transition definitions."""
        for status in RequisitionStatus:
            assert status in HEADER_TRANSITIONS, f"Missing transitions for {status}"
    
    def test_all_item_states_defined(self):
        """Ensure all item states have transition definitions."""
        for status in RequisitionItemStatus:
            assert status in ITEM_TRANSITIONS, f"Missing transitions for {status}"
    
    def test_terminal_header_states_have_no_transitions(self):
        """Terminal header states should have empty transition sets."""
        for status in HEADER_TERMINAL_STATES:
            assert len(HEADER_TRANSITIONS[status]) == 0, \
                f"Terminal state {status} should have no outbound transitions"
    
    def test_terminal_item_states_have_no_transitions(self):
        """Terminal item states should have empty transition sets."""
        for status in ITEM_TERMINAL_STATES:
            assert len(ITEM_TRANSITIONS[status]) == 0, \
                f"Terminal state {status} should have no outbound transitions"
    
    def test_header_terminal_states(self):
        """Verify correct header terminal states."""
        expected = {
            RequisitionStatus.FULFILLED,
            RequisitionStatus.REJECTED,
            RequisitionStatus.CANCELLED,
        }
        assert HEADER_TERMINAL_STATES == frozenset(expected)
    
    def test_item_terminal_states(self):
        """Verify correct item terminal states."""
        expected = {
            RequisitionItemStatus.FULFILLED,
            RequisitionItemStatus.CANCELLED,
        }
        assert ITEM_TERMINAL_STATES == frozenset(expected)


# ============================================================================
# HEADER TRANSITION VALIDATION TESTS
# ============================================================================

class TestHeaderTransitionValidation:
    """Test header transition validation logic."""
    
    @pytest.mark.parametrize("from_status,to_status", [
        (RequisitionStatus.DRAFT, RequisitionStatus.PENDING_BUDGET),
        (RequisitionStatus.DRAFT, RequisitionStatus.CANCELLED),
        (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.PENDING_HR),
        (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.REJECTED),
        (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.CANCELLED),
        (RequisitionStatus.PENDING_HR, RequisitionStatus.ACTIVE),
        (RequisitionStatus.PENDING_HR, RequisitionStatus.REJECTED),
        (RequisitionStatus.PENDING_HR, RequisitionStatus.CANCELLED),
        (RequisitionStatus.ACTIVE, RequisitionStatus.FULFILLED),
        (RequisitionStatus.ACTIVE, RequisitionStatus.CANCELLED),
    ])
    def test_valid_header_transitions(self, from_status, to_status):
        """Test all valid header transitions are recognized."""
        assert is_valid_header_transition(from_status, to_status) is True
    
    @pytest.mark.parametrize("from_status,to_status", [
        (RequisitionStatus.DRAFT, RequisitionStatus.ACTIVE),
        (RequisitionStatus.DRAFT, RequisitionStatus.FULFILLED),
        (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.ACTIVE),
        (RequisitionStatus.PENDING_HR, RequisitionStatus.DRAFT),
        (RequisitionStatus.ACTIVE, RequisitionStatus.DRAFT),
        (RequisitionStatus.FULFILLED, RequisitionStatus.ACTIVE),
        (RequisitionStatus.REJECTED, RequisitionStatus.ACTIVE),
        (RequisitionStatus.CANCELLED, RequisitionStatus.DRAFT),
    ])
    def test_invalid_header_transitions(self, from_status, to_status):
        """Test invalid header transitions are rejected."""
        assert is_valid_header_transition(from_status, to_status) is False
    
    @pytest.mark.parametrize("status", [
        RequisitionStatus.FULFILLED,
        RequisitionStatus.REJECTED,
        RequisitionStatus.CANCELLED,
    ])
    def test_is_header_terminal(self, status):
        """Test terminal state detection."""
        assert is_header_terminal(status) is True
    
    @pytest.mark.parametrize("status", [
        RequisitionStatus.DRAFT,
        RequisitionStatus.PENDING_BUDGET,
        RequisitionStatus.PENDING_HR,
        RequisitionStatus.ACTIVE,
    ])
    def test_is_not_header_terminal(self, status):
        """Test non-terminal state detection."""
        assert is_header_terminal(status) is False


# ============================================================================
# ITEM TRANSITION VALIDATION TESTS
# ============================================================================

class TestItemTransitionValidation:
    """Test item transition validation logic."""
    
    @pytest.mark.parametrize("from_status,to_status", [
        (RequisitionItemStatus.PENDING, RequisitionItemStatus.SOURCING),
        (RequisitionItemStatus.PENDING, RequisitionItemStatus.CANCELLED),
        (RequisitionItemStatus.SOURCING, RequisitionItemStatus.SHORTLISTED),
        (RequisitionItemStatus.SOURCING, RequisitionItemStatus.CANCELLED),
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.INTERVIEWING),
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.SOURCING),
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.CANCELLED),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.OFFERED),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.SHORTLISTED),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.CANCELLED),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.FULFILLED),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.INTERVIEWING),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.CANCELLED),
    ])
    def test_valid_item_transitions(self, from_status, to_status):
        """Test all valid item transitions are recognized."""
        assert is_valid_item_transition(from_status, to_status) is True
    
    @pytest.mark.parametrize("from_status,to_status", [
        (RequisitionItemStatus.PENDING, RequisitionItemStatus.FULFILLED),
        (RequisitionItemStatus.PENDING, RequisitionItemStatus.OFFERED),
        (RequisitionItemStatus.SOURCING, RequisitionItemStatus.PENDING),
        (RequisitionItemStatus.SOURCING, RequisitionItemStatus.FULFILLED),
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.PENDING),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.PENDING),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.PENDING),
        (RequisitionItemStatus.FULFILLED, RequisitionItemStatus.PENDING),
        (RequisitionItemStatus.CANCELLED, RequisitionItemStatus.PENDING),
    ])
    def test_invalid_item_transitions(self, from_status, to_status):
        """Test invalid item transitions are rejected."""
        assert is_valid_item_transition(from_status, to_status) is False
    
    @pytest.mark.parametrize("from_status,to_status", [
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.SOURCING),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.SHORTLISTED),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.INTERVIEWING),
    ])
    def test_backward_transitions_detected(self, from_status, to_status):
        """Test backward transitions are correctly identified."""
        assert is_backward_item_transition(from_status, to_status) is True
    
    @pytest.mark.parametrize("from_status,to_status", [
        (RequisitionItemStatus.SOURCING, RequisitionItemStatus.SHORTLISTED),
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.INTERVIEWING),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.OFFERED),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.FULFILLED),
    ])
    def test_forward_transitions_not_backward(self, from_status, to_status):
        """Test forward transitions are not marked as backward."""
        assert is_backward_item_transition(from_status, to_status) is False


# ============================================================================
# EXCEPTION TESTS
# ============================================================================

class TestWorkflowExceptions:
    """Test workflow exception classes."""
    
    def test_invalid_transition_exception(self):
        """Test InvalidTransitionException structure."""
        exc = InvalidTransitionException(
            from_status="Draft",
            to_status="Active",
            entity_type="requisition",
            allowed_transitions=["Pending_Budget", "Cancelled"],
        )
        assert exc.http_status == 400
        assert exc.code == "INVALID_TRANSITION"
        assert "Draft" in exc.message
        assert "Active" in exc.message
        assert exc.details["allowed_transitions"] == ["Pending_Budget", "Cancelled"]
    
    def test_terminal_state_exception(self):
        """Test TerminalStateException structure."""
        exc = TerminalStateException(
            current_status="Fulfilled",
            entity_type="requisition",
            entity_id=123,
        )
        assert exc.http_status == 400
        assert exc.code == "TERMINAL_STATE"
        assert "terminal" in exc.message.lower()
        assert exc.details["terminal"] is True
    
    def test_authorization_exception(self):
        """Test AuthorizationException structure."""
        exc = AuthorizationException(
            action="approve_hr",
            user_roles=["Manager"],
            required_roles=["HR", "Admin"],
        )
        assert exc.http_status == 403
        assert exc.code == "UNAUTHORIZED_TRANSITION"
        assert "Manager" in str(exc.details["user_roles"])
    
    def test_concurrency_conflict_exception(self):
        """Test ConcurrencyConflictException structure."""
        exc = ConcurrencyConflictException(
            entity_type="requisition",
            entity_id=1,
            expected_version=5,
            actual_version=6,
        )
        assert exc.http_status == 409
        assert exc.code == "CONFLICT"
        assert "5" in exc.message
        assert "6" in exc.message
    
    def test_reason_required_exception(self):
        """Test ReasonRequiredException structure."""
        exc = ReasonRequiredException(
            from_status="Shortlisted",
            to_status="Sourcing",
            min_length=10,
        )
        assert exc.http_status == 422
        assert exc.code == "REASON_REQUIRED"
        assert "10" in exc.message
    
    def test_exception_to_dict(self):
        """Test exception serialization."""
        exc = ValidationException(
            field="reason",
            message="Too short",
            value="abc",
        )
        d = exc.to_dict()
        assert d["error"] is True
        assert d["code"] == "VALIDATION_ERROR"
        assert "reason" in d["message"]
        assert d["details"]["field"] == "reason"


# ============================================================================
# REQUISITION WORKFLOW ENGINE TESTS
# ============================================================================

class TestRequisitionWorkflowEngine:
    """Test RequisitionWorkflowEngine operations."""
    
    def test_submit_from_draft(self, mock_db, mock_requisition):
        """Test submit transition from DRAFT to PENDING_BUDGET."""
        mock_requisition.overall_status = RequisitionStatus.DRAFT.value
        mock_db.first.return_value = mock_requisition
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.submit(
                    db=mock_db,
                    req_id=1,
                    user_id=100,
                    user_roles=["Manager"],
                )
        
        assert result.overall_status == RequisitionStatus.PENDING_BUDGET.value
    
    def test_submit_requires_manager_role(self, mock_db, mock_requisition):
        """Test that submit requires Manager role."""
        mock_requisition.overall_status = RequisitionStatus.DRAFT.value
        mock_db.first.return_value = mock_requisition
        
        with pytest.raises(AuthorizationException) as exc_info:
            RequisitionWorkflowEngine.submit(
                db=mock_db,
                req_id=1,
                user_id=100,
                user_roles=["TA"],
            )
        
        assert exc_info.value.http_status == 403
    
    def test_submit_from_non_draft_fails(self, mock_db, mock_requisition):
        """Test that submit fails from non-DRAFT status."""
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        mock_db.first.return_value = mock_requisition
        
        with pytest.raises(InvalidTransitionException):
            RequisitionWorkflowEngine.submit(
                db=mock_db,
                req_id=1,
                user_id=100,
                user_roles=["Manager"],
            )
    
    def test_approve_budget_transition(self, mock_db, mock_requisition):
        """Test budget approval transition."""
        mock_requisition.overall_status = RequisitionStatus.PENDING_BUDGET.value
        mock_db.first.return_value = mock_requisition
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.approve_budget(
                    db=mock_db,
                    req_id=1,
                    user_id=100,
                    user_roles=["Manager"],
                )
        
        assert result.overall_status == RequisitionStatus.PENDING_HR.value
        assert result.budget_approved_by == 100
    
    def test_approve_hr_transition(self, mock_db, mock_requisition):
        """Test HR approval transition."""
        mock_requisition.overall_status = RequisitionStatus.PENDING_HR.value
        mock_db.first.return_value = mock_requisition
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.approve_hr(
                    db=mock_db,
                    req_id=1,
                    user_id=200,
                    user_roles=["HR"],
                )
        
        assert result.overall_status == RequisitionStatus.ACTIVE.value
        assert result.approved_by == 200
    
    def test_approve_hr_requires_hr_role(self, mock_db, mock_requisition):
        """Test that HR approval requires HR role."""
        mock_requisition.overall_status = RequisitionStatus.PENDING_HR.value
        mock_db.first.return_value = mock_requisition
        
        with pytest.raises(AuthorizationException):
            RequisitionWorkflowEngine.approve_hr(
                db=mock_db,
                req_id=1,
                user_id=100,
                user_roles=["Manager"],
            )
    
    def test_reject_requires_reason(self, mock_db, mock_requisition):
        """Test that rejection requires reason."""
        mock_requisition.overall_status = RequisitionStatus.PENDING_BUDGET.value
        mock_db.first.return_value = mock_requisition
        
        with pytest.raises(ValidationException) as exc_info:
            RequisitionWorkflowEngine.reject(
                db=mock_db,
                req_id=1,
                user_id=100,
                user_roles=["Manager"],
                reason="short",
            )
        
        assert "10 characters" in exc_info.value.message
    
    def test_reject_with_valid_reason(self, mock_db, mock_requisition):
        """Test rejection with valid reason."""
        mock_requisition.overall_status = RequisitionStatus.PENDING_BUDGET.value
        mock_db.first.return_value = mock_requisition
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.reject(
                    db=mock_db,
                    req_id=1,
                    user_id=100,
                    user_roles=["Manager"],
                    reason="Budget constraints prevent approval at this time",
                )
        
        assert result.overall_status == RequisitionStatus.REJECTED.value
        assert "Budget constraints" in result.rejection_reason
    
    def test_cancel_transitions_to_cancelled(self, mock_db, mock_requisition):
        """Test cancellation from various states."""
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        mock_db.first.return_value = mock_requisition
        mock_db.all.return_value = []  # No items
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.cancel(
                    db=mock_db,
                    req_id=1,
                    user_id=100,
                    user_roles=["Manager"],
                    reason="Project cancelled due to strategic change",
                )
        
        assert result.overall_status == RequisitionStatus.CANCELLED.value
    
    def test_terminal_state_cannot_transition(self, mock_db, mock_requisition):
        """Test that terminal states cannot be transitioned."""
        mock_requisition.overall_status = RequisitionStatus.FULFILLED.value
        mock_db.first.return_value = mock_requisition
        
        with pytest.raises(TerminalStateException):
            RequisitionWorkflowEngine.cancel(
                db=mock_db,
                req_id=1,
                user_id=100,
                user_roles=["Admin"],
                reason="This should fail because status is terminal",
            )
    
    def test_version_mismatch_raises_conflict(self, mock_db, mock_requisition):
        """Test optimistic locking version check."""
        mock_requisition.overall_status = RequisitionStatus.DRAFT.value
        mock_requisition.version = 5
        mock_db.first.return_value = mock_requisition
        
        with pytest.raises(ConcurrencyConflictException) as exc_info:
            RequisitionWorkflowEngine.submit(
                db=mock_db,
                req_id=1,
                user_id=100,
                user_roles=["Manager"],
                expected_version=3,
            )
        
        assert exc_info.value.expected_version == 3
        assert exc_info.value.actual_version == 5
    
    def test_version_incremented_on_transition(self, mock_db, mock_requisition):
        """Test that version is incremented after transition."""
        mock_requisition.overall_status = RequisitionStatus.DRAFT.value
        mock_requisition.version = 1
        mock_db.first.return_value = mock_requisition
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.submit(
                    db=mock_db,
                    req_id=1,
                    user_id=100,
                    user_roles=["Manager"],
                )
        
        assert result.version == 2


# ============================================================================
# REQUISITION ITEM WORKFLOW ENGINE TESTS
# ============================================================================

class TestRequisitionItemWorkflowEngine:
    """Test RequisitionItemWorkflowEngine operations."""
    
    def test_assign_ta_auto_transitions_pending_to_sourcing(
        self, mock_db, mock_item, mock_requisition
    ):
        """Test GC-003: TA assignment auto-transitions PENDING to SOURCING."""
        mock_item.item_status = RequisitionItemStatus.PENDING.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition, mock_requisition]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(RequisitionWorkflowEngine, 'recalculate_header_status'):
                result = RequisitionItemWorkflowEngine.assign_ta(
                    db=mock_db,
                    item_id=1,
                    ta_user_id=300,
                    performed_by=200,
                    user_roles=["HR"],
                )
        
        assert result.item_status == RequisitionItemStatus.SOURCING.value
        assert result.assigned_ta == 300
    
    def test_assign_ta_requires_hr_or_admin(self, mock_db, mock_item, mock_requisition):
        """Test that TA assignment requires HR or Admin role."""
        mock_item.item_status = RequisitionItemStatus.PENDING.value
        mock_db.first.return_value = mock_item
        
        with pytest.raises(AuthorizationException):
            RequisitionItemWorkflowEngine.assign_ta(
                db=mock_db,
                item_id=1,
                ta_user_id=300,
                performed_by=100,
                user_roles=["Manager"],
            )
    
    def test_shortlist_from_sourcing(self, mock_db, mock_item, mock_requisition):
        """Test shortlist transition from SOURCING."""
        mock_item.item_status = RequisitionItemStatus.SOURCING.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.shortlist(
                db=mock_db,
                item_id=1,
                user_id=300,
                user_roles=["TA"],
                candidate_count=5,
            )
        
        assert result.item_status == RequisitionItemStatus.SHORTLISTED.value
    
    def test_start_interview_from_shortlisted(self, mock_db, mock_item, mock_requisition):
        """Test start interview transition from SHORTLISTED."""
        mock_item.item_status = RequisitionItemStatus.SHORTLISTED.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.start_interview(
                db=mock_db,
                item_id=1,
                user_id=300,
                user_roles=["TA"],
            )
        
        assert result.item_status == RequisitionItemStatus.INTERVIEWING.value
    
    def test_make_offer_from_interviewing(self, mock_db, mock_item, mock_requisition):
        """Test make offer transition from INTERVIEWING."""
        mock_item.item_status = RequisitionItemStatus.INTERVIEWING.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.make_offer(
                db=mock_db,
                item_id=1,
                user_id=300,
                user_roles=["TA"],
                candidate_id="CAND-001",
            )
        
        assert result.item_status == RequisitionItemStatus.OFFERED.value
    
    def test_fulfill_requires_employee_id(self, mock_db, mock_item, mock_requisition):
        """Test GC-004: FULFILLED requires employee_id."""
        mock_item.item_status = RequisitionItemStatus.OFFERED.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition, None]  # No employee found
        
        with pytest.raises(PrerequisiteException) as exc_info:
            RequisitionItemWorkflowEngine.fulfill(
                db=mock_db,
                item_id=1,
                user_id=200,
                user_roles=["HR"],
                employee_id="EMP-999",
            )
        
        assert "employee" in exc_info.value.message.lower()
    
    def test_fulfill_with_valid_employee(self, mock_db, mock_item, mock_requisition):
        """Test fulfill with valid employee assignment."""
        mock_item.item_status = RequisitionItemStatus.OFFERED.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_employee = Mock()
        mock_employee.emp_id = "EMP-001"
        
        mock_db.first.side_effect = [
            mock_item,  # get_locked_item
            mock_requisition,  # validate_header
            mock_employee,  # employee lookup
            None,  # duplicate check
            mock_requisition,  # recalculate
        ]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(RequisitionWorkflowEngine, 'recalculate_header_status'):
                result = RequisitionItemWorkflowEngine.fulfill(
                    db=mock_db,
                    item_id=1,
                    user_id=200,
                    user_roles=["HR"],
                    employee_id="EMP-001",
                )
        
        assert result.item_status == RequisitionItemStatus.FULFILLED.value
        assert result.assigned_emp_id == "EMP-001"
    
    def test_backward_transition_requires_reason(self, mock_db, mock_item, mock_requisition):
        """Test GC-009: Backward transitions require reason."""
        mock_item.item_status = RequisitionItemStatus.SHORTLISTED.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition]
        
        with pytest.raises(ReasonRequiredException):
            RequisitionItemWorkflowEngine.re_source(
                db=mock_db,
                item_id=1,
                user_id=300,
                user_roles=["TA"],
                reason="short",  # Less than 10 chars
            )
    
    def test_re_source_with_valid_reason(self, mock_db, mock_item, mock_requisition):
        """Test re-source backward transition with valid reason."""
        mock_item.item_status = RequisitionItemStatus.SHORTLISTED.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.re_source(
                db=mock_db,
                item_id=1,
                user_id=300,
                user_roles=["TA"],
                reason="No viable candidates in shortlist, need fresh search",
            )
        
        assert result.item_status == RequisitionItemStatus.SOURCING.value
    
    def test_item_change_blocked_when_header_not_active(
        self, mock_db, mock_item, mock_requisition
    ):
        """Test that item changes are blocked when header is not ACTIVE."""
        mock_item.item_status = RequisitionItemStatus.SOURCING.value
        mock_requisition.overall_status = RequisitionStatus.PENDING_HR.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition]
        
        with pytest.raises(EntityLockedException) as exc_info:
            RequisitionItemWorkflowEngine.shortlist(
                db=mock_db,
                item_id=1,
                user_id=300,
                user_roles=["TA"],
            )
        
        assert "ACTIVE" in exc_info.value.message
    
    def test_terminal_item_cannot_be_cancelled(self, mock_db, mock_item, mock_requisition):
        """Test that terminal items cannot be cancelled again."""
        mock_item.item_status = RequisitionItemStatus.FULFILLED.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_db.first.side_effect = [mock_item, mock_requisition]
        
        with pytest.raises(TerminalStateException):
            RequisitionItemWorkflowEngine.cancel(
                db=mock_db,
                item_id=1,
                user_id=100,
                user_roles=["Manager"],
                reason="This should fail because item is already fulfilled",
            )


# ============================================================================
# HEADER SYNCHRONIZATION TESTS
# ============================================================================

class TestHeaderSynchronization:
    """Test header-item synchronization logic (Section 6.2)."""
    
    def test_recalculate_does_nothing_for_draft(self, mock_db, mock_requisition):
        """Test that DRAFT status is not recalculated."""
        mock_requisition.overall_status = RequisitionStatus.DRAFT.value
        mock_db.first.return_value = mock_requisition
        
        result = RequisitionWorkflowEngine.recalculate_header_status(
            db=mock_db,
            req_id=1,
        )
        
        assert result is None
        assert mock_requisition.overall_status == RequisitionStatus.DRAFT.value
    
    def test_recalculate_does_nothing_for_pending_states(
        self, mock_db, mock_requisition
    ):
        """Test that pending states are not recalculated."""
        for status in [
            RequisitionStatus.PENDING_BUDGET,
            RequisitionStatus.PENDING_HR,
        ]:
            mock_requisition.overall_status = status.value
            mock_db.first.return_value = mock_requisition
            
            result = RequisitionWorkflowEngine.recalculate_header_status(
                db=mock_db,
                req_id=1,
            )
            
            assert result is None
    
    def test_recalculate_to_fulfilled_when_all_items_fulfilled(
        self, mock_db, mock_requisition
    ):
        """Test header transitions to FULFILLED when all items are FULFILLED."""
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        mock_requisition.version = 1
        
        mock_items = [
            Mock(item_status=RequisitionItemStatus.FULFILLED.value),
            Mock(item_status=RequisitionItemStatus.FULFILLED.value),
        ]
        
        mock_db.first.return_value = mock_requisition
        mock_db.all.return_value = mock_items
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.recalculate_header_status(
                    db=mock_db,
                    req_id=1,
                )
        
        assert result == RequisitionStatus.FULFILLED
        assert mock_requisition.overall_status == RequisitionStatus.FULFILLED.value
    
    def test_recalculate_to_cancelled_when_all_items_cancelled(
        self, mock_db, mock_requisition
    ):
        """Test header transitions to CANCELLED when all items are CANCELLED."""
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        mock_requisition.version = 1
        
        mock_items = [
            Mock(item_status=RequisitionItemStatus.CANCELLED.value),
            Mock(item_status=RequisitionItemStatus.CANCELLED.value),
        ]
        
        mock_db.first.return_value = mock_requisition
        mock_db.all.return_value = mock_items
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.recalculate_header_status(
                    db=mock_db,
                    req_id=1,
                )
        
        assert result == RequisitionStatus.CANCELLED
    
    def test_recalculate_remains_active_with_active_items(
        self, mock_db, mock_requisition
    ):
        """Test header remains ACTIVE when there are active items."""
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        mock_items = [
            Mock(item_status=RequisitionItemStatus.SOURCING.value),
            Mock(item_status=RequisitionItemStatus.FULFILLED.value),
        ]
        
        mock_db.first.return_value = mock_requisition
        mock_db.all.return_value = mock_items
        
        result = RequisitionWorkflowEngine.recalculate_header_status(
            db=mock_db,
            req_id=1,
        )
        
        assert result is None  # No change
        assert mock_requisition.overall_status == RequisitionStatus.ACTIVE.value
    
    def test_recalculate_to_cancelled_when_no_items(self, mock_db, mock_requisition):
        """Test header transitions to CANCELLED when there are no items."""
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        mock_requisition.version = 1
        
        mock_db.first.return_value = mock_requisition
        mock_db.all.return_value = []  # No items
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionWorkflowEngine.recalculate_header_status(
                    db=mock_db,
                    req_id=1,
                )
        
        assert result == RequisitionStatus.CANCELLED


# ============================================================================
# AUDIT LOGGING TESTS
# ============================================================================

class TestAuditLogging:
    """Test audit logging functionality."""
    
    def test_transition_creates_audit_log(self, mock_db, mock_requisition):
        """Test that transitions create audit log entries."""
        mock_requisition.overall_status = RequisitionStatus.DRAFT.value
        mock_db.first.return_value = mock_requisition
        
        with patch.object(WorkflowAuditLogger, 'log_transition') as mock_log:
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                RequisitionWorkflowEngine.submit(
                    db=mock_db,
                    req_id=1,
                    user_id=100,
                    user_roles=["Manager"],
                )
        
        mock_log.assert_called_once()
        call_args = mock_log.call_args
        assert call_args.kwargs["entity_type"] == "requisition"
        assert call_args.kwargs["action"] == "SUBMIT"
        assert call_args.kwargs["performed_by"] == 100
    
    def test_transition_creates_status_history(self, mock_db, mock_requisition):
        """Test that transitions create status history entries."""
        mock_requisition.overall_status = RequisitionStatus.DRAFT.value
        mock_db.first.return_value = mock_requisition
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history') as mock_history:
                RequisitionWorkflowEngine.submit(
                    db=mock_db,
                    req_id=1,
                    user_id=100,
                    user_roles=["Manager"],
                )
        
        mock_history.assert_called_once()
        call_args = mock_history.call_args
        assert call_args.kwargs["old_status"] == RequisitionStatus.DRAFT.value
        assert call_args.kwargs["new_status"] == RequisitionStatus.PENDING_BUDGET.value


# ============================================================================
# ROLE AUTHORIZATION TESTS
# ============================================================================

class TestRoleAuthorization:
    """Test role-based authorization."""
    
    @pytest.mark.parametrize("role,action,should_pass", [
        ("Manager", "submit", True),
        ("Admin", "submit", False),  # Only Manager can submit (not Admin in spec)
        ("HR", "submit", False),
        ("TA", "submit", False),
        ("Manager", "approve_budget", True),
        ("Admin", "approve_budget", True),
        ("HR", "approve_budget", False),
        ("HR", "approve_hr", True),
        ("Admin", "approve_hr", True),
        ("Manager", "approve_hr", False),
    ])
    def test_header_role_authorization(
        self, mock_db, mock_requisition, role, action, should_pass
    ):
        """Test role authorization for header transitions."""
        # Set appropriate starting status
        if action == "submit":
            mock_requisition.overall_status = RequisitionStatus.DRAFT.value
        elif action == "approve_budget":
            mock_requisition.overall_status = RequisitionStatus.PENDING_BUDGET.value
        elif action == "approve_hr":
            mock_requisition.overall_status = RequisitionStatus.PENDING_HR.value
        
        mock_db.first.return_value = mock_requisition
        
        engine_method = getattr(RequisitionWorkflowEngine, action)
        
        if should_pass:
            with patch.object(WorkflowAuditLogger, 'log_transition'):
                with patch.object(WorkflowAuditLogger, 'log_status_history'):
                    result = engine_method(
                        db=mock_db,
                        req_id=1,
                        user_id=100,
                        user_roles=[role],
                    )
            assert result is not None
        else:
            with pytest.raises(AuthorizationException):
                engine_method(
                    db=mock_db,
                    req_id=1,
                    user_id=100,
                    user_roles=[role],
                )


# ============================================================================
# SYSTEM-ONLY TRANSITION TESTS
# ============================================================================

class TestSystemOnlyTransitions:
    """Test system-only transition enforcement."""
    
    def test_manual_active_to_fulfilled_fails(self, mock_db, mock_requisition):
        """Test GC-008: Users cannot manually transition ACTIVE → FULFILLED."""
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        mock_db.first.return_value = mock_requisition
        
        # There's no direct method to transition to FULFILLED
        # Users must wait for auto-recalculation
        # This is enforced by not having a public method for it
        
        # Verify that validation would fail if attempted
        with pytest.raises((SystemOnlyTransitionException, InvalidTransitionException)):
            RequisitionWorkflowEngine._validate_transition(
                current_status=RequisitionStatus.ACTIVE,
                target_status=RequisitionStatus.FULFILLED,
                user_roles=["Admin"],
                is_system=False,
            )
    
    def test_manual_pending_to_sourcing_fails(self, mock_db, mock_item, mock_requisition):
        """Test that users cannot manually transition PENDING → SOURCING."""
        mock_item.item_status = RequisitionItemStatus.PENDING.value
        mock_requisition.overall_status = RequisitionStatus.ACTIVE.value
        
        # The only way to transition to SOURCING is via TA assignment (GC-003)
        with pytest.raises((SystemOnlyTransitionException, InvalidTransitionException)):
            RequisitionItemWorkflowEngine._validate_transition(
                current_status=RequisitionItemStatus.PENDING,
                target_status=RequisitionItemStatus.SOURCING,
                user_roles=["TA"],
                is_system=False,
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
