"""
============================================================================
ITEM BUDGET WORKFLOW TEST SUITE
============================================================================

RBM Resource Fulfillment Module — Item-Level Budget Workflow Tests

Comprehensive test coverage for:
- Budget editing (estimated_budget, currency)
- Budget approval
- Budget rejection
- Partial approval scenarios
- Header sync after all budgets approved
- Transaction safety
- Authorization checks
- Validation rules
"""

import pytest
from decimal import Decimal
from unittest.mock import Mock, patch, MagicMock
from sqlalchemy.orm import Session

from services.requisition.workflow_matrix import (
    RequisitionStatus,
    RequisitionItemStatus,
    SystemRole,
    ITEM_BUDGET_EDITABLE_HEADER_STATES,
    ITEM_BUDGET_APPROVABLE_HEADER_STATES,
    ITEM_BUDGET_EDIT_AUTHORITY,
    ITEM_BUDGET_APPROVE_AUTHORITY,
)

from services.requisition.workflow_exceptions import (
    WorkflowException,
    AuthorizationException,
    EntityLockedException,
    ValidationException,
    EntityNotFoundException,
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
def mock_requisition_draft():
    """Create a mock requisition in DRAFT status."""
    req = Mock()
    req.req_id = 1
    req.overall_status = RequisitionStatus.DRAFT.value
    req.raised_by = 100
    req.assigned_ta = None
    req.budget_approved_by = None
    req.approved_by = None
    req.version = 1
    return req


@pytest.fixture
def mock_requisition_pending_budget():
    """Create a mock requisition in PENDING_BUDGET status."""
    req = Mock()
    req.req_id = 1
    req.overall_status = RequisitionStatus.PENDING_BUDGET.value
    req.raised_by = 100
    req.assigned_ta = None
    req.budget_approved_by = None
    req.approved_by = None
    req.version = 1
    return req


@pytest.fixture
def mock_requisition_active():
    """Create a mock requisition in ACTIVE status."""
    req = Mock()
    req.req_id = 1
    req.overall_status = RequisitionStatus.ACTIVE.value
    req.raised_by = 100
    req.assigned_ta = 200
    req.budget_approved_by = 100
    req.approved_by = 200
    req.version = 3
    return req


@pytest.fixture
def mock_item_no_budget():
    """Create a mock item with no budget set."""
    item = Mock()
    item.item_id = 1
    item.req_id = 1
    item.item_status = RequisitionItemStatus.PENDING.value
    item.estimated_budget = Decimal('0')
    item.approved_budget = None
    item.currency = 'INR'
    item.version = 1
    return item


@pytest.fixture
def mock_item_with_budget():
    """Create a mock item with estimated budget set."""
    item = Mock()
    item.item_id = 1
    item.req_id = 1
    item.item_status = RequisitionItemStatus.PENDING.value
    item.estimated_budget = Decimal('50000.00')
    item.approved_budget = None
    item.currency = 'INR'
    item.version = 1
    return item


@pytest.fixture
def mock_item_budget_approved():
    """Create a mock item with approved budget."""
    item = Mock()
    item.item_id = 1
    item.req_id = 1
    item.item_status = RequisitionItemStatus.PENDING.value
    item.estimated_budget = Decimal('50000.00')
    item.approved_budget = Decimal('50000.00')
    item.currency = 'INR'
    item.version = 2
    return item


# ============================================================================
# BUDGET EDITING TESTS
# ============================================================================

class TestBudgetEditing:
    """Test budget editing functionality."""
    
    def test_edit_budget_success_in_draft(
        self, mock_db, mock_item_no_budget, mock_requisition_draft
    ):
        """Test successful budget editing when header is in DRAFT."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_draft]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=75000.00,
                currency='INR',
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert float(result.estimated_budget) == 75000.00
        assert result.currency == 'INR'
    
    def test_edit_budget_success_in_pending_budget(
        self, mock_db, mock_item_no_budget, mock_requisition_pending_budget
    ):
        """Test successful budget editing when header is in PENDING_BUDGET."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_pending_budget]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=60000.00,
                currency='USD',
                user_id=200,
                user_roles=['HR'],
            )
        
        assert float(result.estimated_budget) == 60000.00
        assert result.currency == 'USD'
    
    def test_edit_budget_fails_when_header_active(
        self, mock_db, mock_item_no_budget, mock_requisition_active
    ):
        """Test budget editing fails when header is ACTIVE."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_active]
        
        with pytest.raises(EntityLockedException) as exc_info:
            RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=50000.00,
                currency='INR',
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert 'Active' in exc_info.value.message
    
    def test_edit_budget_fails_when_already_approved(
        self, mock_db, mock_item_budget_approved, mock_requisition_pending_budget
    ):
        """Test budget editing fails when budget already approved."""
        mock_db.first.side_effect = [mock_item_budget_approved, mock_requisition_pending_budget]
        
        with pytest.raises(EntityLockedException) as exc_info:
            RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=60000.00,
                currency='INR',
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert 'approved' in exc_info.value.message.lower()
    
    def test_edit_budget_requires_positive_amount(
        self, mock_db, mock_item_no_budget, mock_requisition_draft
    ):
        """Test budget editing requires positive amount."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_draft]
        
        with pytest.raises(ValidationException) as exc_info:
            RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=0,
                currency='INR',
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert 'greater than 0' in exc_info.value.message
    
    def test_edit_budget_validates_currency_format(
        self, mock_db, mock_item_no_budget, mock_requisition_draft
    ):
        """Test budget editing validates currency format."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_draft]
        
        with pytest.raises(ValidationException) as exc_info:
            RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=50000.00,
                currency='invalid',  # lowercase, should fail
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert 'currency' in exc_info.value.message.lower()
    
    def test_edit_budget_requires_authorization(
        self, mock_db, mock_item_no_budget, mock_requisition_draft
    ):
        """Test budget editing requires authorized role."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_draft]
        
        with pytest.raises(AuthorizationException):
            RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=50000.00,
                currency='INR',
                user_id=300,
                user_roles=['TA'],  # TA cannot edit budget
            )


# ============================================================================
# BUDGET APPROVAL TESTS
# ============================================================================

class TestBudgetApproval:
    """Test budget approval functionality."""
    
    def test_approve_budget_success(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget
    ):
        """Test successful budget approval."""
        # Setup: item with budget, header in PENDING_BUDGET
        mock_db.first.side_effect = [
            mock_item_with_budget,
            mock_requisition_pending_budget,
        ]
        mock_db.all.return_value = [mock_item_with_budget]  # For header recalculation
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.approve_budget(
                db=mock_db,
                item_id=1,
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert result.approved_budget == result.estimated_budget
    
    def test_approve_budget_fails_when_no_estimated_budget(
        self, mock_db, mock_item_no_budget, mock_requisition_pending_budget
    ):
        """Test approval fails when estimated_budget is 0."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_pending_budget]
        
        with pytest.raises(ValidationException) as exc_info:
            RequisitionItemWorkflowEngine.approve_budget(
                db=mock_db,
                item_id=1,
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert 'greater than 0' in exc_info.value.message
    
    def test_approve_budget_fails_when_already_approved(
        self, mock_db, mock_item_budget_approved, mock_requisition_pending_budget
    ):
        """Test approval fails when budget already approved."""
        mock_db.first.side_effect = [mock_item_budget_approved, mock_requisition_pending_budget]
        
        with pytest.raises(ValidationException) as exc_info:
            RequisitionItemWorkflowEngine.approve_budget(
                db=mock_db,
                item_id=1,
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert 'already been approved' in exc_info.value.message
    
    def test_approve_budget_fails_when_header_not_pending_budget(
        self, mock_db, mock_item_with_budget, mock_requisition_active
    ):
        """Test approval fails when header is not in PENDING_BUDGET."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_active]
        
        with pytest.raises(EntityLockedException) as exc_info:
            RequisitionItemWorkflowEngine.approve_budget(
                db=mock_db,
                item_id=1,
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert 'Pending_Budget' in exc_info.value.message
    
    def test_approve_budget_requires_authorization(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget
    ):
        """Test budget approval requires authorized role."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_pending_budget]
        
        with pytest.raises(AuthorizationException):
            RequisitionItemWorkflowEngine.approve_budget(
                db=mock_db,
                item_id=1,
                user_id=300,
                user_roles=['TA'],  # TA cannot approve budget
            )


# ============================================================================
# BUDGET REJECTION TESTS
# ============================================================================

class TestBudgetRejection:
    """Test budget rejection functionality."""
    
    def test_reject_budget_success(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget
    ):
        """Test successful budget rejection."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_pending_budget]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.reject_budget(
                db=mock_db,
                item_id=1,
                user_id=200,
                user_roles=['HR'],
                reason='Budget exceeds department allocation limit',
            )
        
        assert result.approved_budget is None
    
    def test_reject_budget_requires_reason(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget
    ):
        """Test rejection requires reason of minimum length."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_pending_budget]
        
        with pytest.raises(ValidationException) as exc_info:
            RequisitionItemWorkflowEngine.reject_budget(
                db=mock_db,
                item_id=1,
                user_id=200,
                user_roles=['HR'],
                reason='Too short',  # Less than 10 chars
            )
        
        assert '10 characters' in exc_info.value.message
    
    def test_reject_budget_requires_authorization(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget
    ):
        """Test budget rejection requires authorized role."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_pending_budget]
        
        with pytest.raises(AuthorizationException):
            RequisitionItemWorkflowEngine.reject_budget(
                db=mock_db,
                item_id=1,
                user_id=300,
                user_roles=['TA'],  # TA cannot reject budget
                reason='This reason is long enough for validation',
            )


# ============================================================================
# HEADER SYNC TESTS (After All Budgets Approved)
# ============================================================================

class TestHeaderBudgetSync:
    """Test header synchronization after budget approvals."""
    
    def test_header_transitions_to_pending_hr_when_all_approved(
        self, mock_db, mock_requisition_pending_budget
    ):
        """Test header transitions to PENDING_HR when all items have approved budgets."""
        # Create items where all will be approved
        item1 = Mock()
        item1.item_id = 1
        item1.req_id = 1
        item1.estimated_budget = Decimal('50000.00')
        item1.approved_budget = Decimal('50000.00')  # Already approved
        
        item2 = Mock()
        item2.item_id = 2
        item2.req_id = 1
        item2.estimated_budget = Decimal('30000.00')
        item2.approved_budget = None  # Will be approved
        item2.currency = 'INR'
        item2.version = 1
        
        # After approval, item2 becomes approved
        def update_item2_budget():
            item2.approved_budget = item2.estimated_budget
        
        mock_db.first.side_effect = [item2, mock_requisition_pending_budget]
        mock_db.all.return_value = [item1, item2]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            with patch.object(WorkflowAuditLogger, 'log_status_history'):
                result = RequisitionItemWorkflowEngine.approve_budget(
                    db=mock_db,
                    item_id=2,
                    user_id=100,
                    user_roles=['Manager'],
                )
        
        # Header should now be in PENDING_HR
        assert mock_requisition_pending_budget.overall_status == RequisitionStatus.PENDING_HR.value
    
    def test_header_remains_pending_budget_with_partial_approval(
        self, mock_db, mock_requisition_pending_budget
    ):
        """Test header remains PENDING_BUDGET when not all items approved."""
        # Create items where only one is approved
        item1 = Mock()
        item1.item_id = 1
        item1.req_id = 1
        item1.estimated_budget = Decimal('50000.00')
        item1.approved_budget = None  # Will be approved
        item1.currency = 'INR'
        item1.version = 1
        
        item2 = Mock()
        item2.item_id = 2
        item2.req_id = 1
        item2.estimated_budget = Decimal('30000.00')
        item2.approved_budget = None  # Still pending
        
        mock_db.first.side_effect = [item1, mock_requisition_pending_budget]
        
        # After item1 approval, item2 still not approved
        def get_all_items():
            item1.approved_budget = item1.estimated_budget
            return [item1, item2]
        
        mock_db.all.side_effect = get_all_items
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.approve_budget(
                db=mock_db,
                item_id=1,
                user_id=100,
                user_roles=['Manager'],
            )
        
        # Header should remain PENDING_BUDGET (partial approval)
        assert mock_requisition_pending_budget.overall_status == RequisitionStatus.PENDING_BUDGET.value


# ============================================================================
# AUDIT LOGGING TESTS
# ============================================================================

class TestBudgetAuditLogging:
    """Test audit logging for budget operations."""
    
    def test_budget_edit_creates_audit_log(
        self, mock_db, mock_item_no_budget, mock_requisition_draft
    ):
        """Test that budget editing creates audit log entry."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_draft]
        
        with patch.object(WorkflowAuditLogger, 'log_transition') as mock_log:
            RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=50000.00,
                currency='INR',
                user_id=100,
                user_roles=['Manager'],
            )
        
        mock_log.assert_called_once()
        call_kwargs = mock_log.call_args.kwargs
        assert call_kwargs['action'] == 'ITEM_BUDGET_EDITED'
        assert call_kwargs['entity_type'] == 'requisition_item'
        assert 'previous_estimated_budget' in call_kwargs['metadata']
        assert 'new_estimated_budget' in call_kwargs['metadata']
    
    def test_budget_approval_creates_audit_log(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget
    ):
        """Test that budget approval creates audit log entry."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_pending_budget]
        mock_db.all.return_value = [mock_item_with_budget]
        
        with patch.object(WorkflowAuditLogger, 'log_transition') as mock_log:
            RequisitionItemWorkflowEngine.approve_budget(
                db=mock_db,
                item_id=1,
                user_id=100,
                user_roles=['Manager'],
            )
        
        # Should be called at least once for the item approval
        assert mock_log.call_count >= 1
        
        # Find the approval call
        approval_call = None
        for call in mock_log.call_args_list:
            if call.kwargs.get('action') == 'ITEM_BUDGET_APPROVED':
                approval_call = call
                break
        
        assert approval_call is not None
        assert 'estimated_budget' in approval_call.kwargs['metadata']
        assert 'approved_budget' in approval_call.kwargs['metadata']
    
    def test_budget_rejection_creates_audit_log(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget
    ):
        """Test that budget rejection creates audit log entry."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_pending_budget]
        
        with patch.object(WorkflowAuditLogger, 'log_transition') as mock_log:
            RequisitionItemWorkflowEngine.reject_budget(
                db=mock_db,
                item_id=1,
                user_id=200,
                user_roles=['HR'],
                reason='Budget exceeds approved allocation limits',
            )
        
        mock_log.assert_called_once()
        call_kwargs = mock_log.call_args.kwargs
        assert call_kwargs['action'] == 'ITEM_BUDGET_REJECTED'
        assert call_kwargs['reason'] == 'Budget exceeds approved allocation limits'


# ============================================================================
# ROLE AUTHORIZATION MATRIX TESTS
# ============================================================================

class TestBudgetRoleAuthorization:
    """Test role-based authorization for budget operations."""
    
    @pytest.mark.parametrize("role,should_pass", [
        ("Manager", True),
        ("HR", True),
        ("Admin", True),
        ("TA", False),
        ("Employee", False),
    ])
    def test_budget_edit_authorization(
        self, mock_db, mock_item_no_budget, mock_requisition_draft, role, should_pass
    ):
        """Test budget edit authorization for different roles."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_draft]
        
        if should_pass:
            with patch.object(WorkflowAuditLogger, 'log_transition'):
                result = RequisitionItemWorkflowEngine.edit_budget(
                    db=mock_db,
                    item_id=1,
                    estimated_budget=50000.00,
                    currency='INR',
                    user_id=100,
                    user_roles=[role],
                )
            assert result is not None
        else:
            with pytest.raises(AuthorizationException):
                RequisitionItemWorkflowEngine.edit_budget(
                    db=mock_db,
                    item_id=1,
                    estimated_budget=50000.00,
                    currency='INR',
                    user_id=100,
                    user_roles=[role],
                )
    
    @pytest.mark.parametrize("role,should_pass", [
        ("Manager", True),
        ("HR", True),
        ("Admin", True),
        ("TA", False),
    ])
    def test_budget_approve_authorization(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget, role, should_pass
    ):
        """Test budget approve authorization for different roles."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_pending_budget]
        mock_db.all.return_value = [mock_item_with_budget]
        
        if should_pass:
            with patch.object(WorkflowAuditLogger, 'log_transition'):
                result = RequisitionItemWorkflowEngine.approve_budget(
                    db=mock_db,
                    item_id=1,
                    user_id=100,
                    user_roles=[role],
                )
            assert result is not None
        else:
            with pytest.raises(AuthorizationException):
                RequisitionItemWorkflowEngine.approve_budget(
                    db=mock_db,
                    item_id=1,
                    user_id=100,
                    user_roles=[role],
                )


# ============================================================================
# WORKFLOW MATRIX INTEGRATION TESTS
# ============================================================================

class TestBudgetWorkflowMatrix:
    """Test budget workflow matrix definitions."""
    
    def test_budget_editable_states(self):
        """Test correct states are marked as budget-editable."""
        expected = {
            RequisitionStatus.DRAFT,
            RequisitionStatus.PENDING_BUDGET,
        }
        assert ITEM_BUDGET_EDITABLE_HEADER_STATES == frozenset(expected)
    
    def test_budget_approvable_states(self):
        """Test correct states are marked as budget-approvable."""
        expected = {
            RequisitionStatus.PENDING_BUDGET,
        }
        assert ITEM_BUDGET_APPROVABLE_HEADER_STATES == frozenset(expected)
    
    def test_budget_edit_authority(self):
        """Test correct roles have budget edit authority."""
        expected = {
            SystemRole.MANAGER,
            SystemRole.HR,
            SystemRole.ADMIN,
        }
        assert ITEM_BUDGET_EDIT_AUTHORITY == frozenset(expected)
    
    def test_budget_approve_authority(self):
        """Test correct roles have budget approve authority."""
        expected = {
            SystemRole.MANAGER,
            SystemRole.HR,
            SystemRole.ADMIN,
        }
        assert ITEM_BUDGET_APPROVE_AUTHORITY == frozenset(expected)


# ============================================================================
# TRANSACTION SAFETY TESTS
# ============================================================================

class TestBudgetTransactionSafety:
    """Test transaction safety for budget operations."""
    
    def test_budget_edit_uses_select_for_update(self, mock_db, mock_item_no_budget, mock_requisition_draft):
        """Test that budget editing uses SELECT FOR UPDATE."""
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_draft]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=50000.00,
                currency='INR',
                user_id=100,
                user_roles=['Manager'],
            )
        
        # Verify with_for_update was called
        mock_db.with_for_update.assert_called()
    
    def test_budget_approval_uses_select_for_update(
        self, mock_db, mock_item_with_budget, mock_requisition_pending_budget
    ):
        """Test that budget approval uses SELECT FOR UPDATE."""
        mock_db.first.side_effect = [mock_item_with_budget, mock_requisition_pending_budget]
        mock_db.all.return_value = [mock_item_with_budget]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            RequisitionItemWorkflowEngine.approve_budget(
                db=mock_db,
                item_id=1,
                user_id=100,
                user_roles=['Manager'],
            )
        
        # Verify with_for_update was called at least twice (item and header)
        assert mock_db.with_for_update.call_count >= 2
    
    def test_version_incremented_on_budget_edit(
        self, mock_db, mock_item_no_budget, mock_requisition_draft
    ):
        """Test version is incremented after budget edit."""
        mock_item_no_budget.version = 1
        mock_db.first.side_effect = [mock_item_no_budget, mock_requisition_draft]
        
        with patch.object(WorkflowAuditLogger, 'log_transition'):
            result = RequisitionItemWorkflowEngine.edit_budget(
                db=mock_db,
                item_id=1,
                estimated_budget=50000.00,
                currency='INR',
                user_id=100,
                user_roles=['Manager'],
            )
        
        assert result.version == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
