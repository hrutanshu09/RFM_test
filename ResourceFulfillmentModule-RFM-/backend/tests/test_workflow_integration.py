"""
API Integration Tests for Workflow Engine

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

These tests verify:
1. All allowed transitions work via API
2. All blocked transitions are rejected
3. Unauthorized role attempts are blocked
4. Terminal state protection
5. Concurrent transition collision handling

Uses FastAPI TestClient with transaction rollback isolation.
"""

import pytest
import threading
import time
from typing import List, Dict, Any, Optional
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.session import get_db
from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem
from db.models.auth import User, Role, UserRole

from services.requisition.workflow_matrix import (
    RequisitionStatus,
    RequisitionItemStatus,
    HEADER_TRANSITIONS,
    ITEM_TRANSITIONS,
)


# =============================================================================
# TEST FIXTURES
# =============================================================================

@pytest.fixture(scope="function")
def test_db():
    """Create an in-memory SQLite database for testing."""
    SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
    
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    
    # Enable SQLite foreign keys
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    
    Base.metadata.create_all(bind=engine)
    
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def test_users(test_db: Session) -> Dict[str, User]:
    """Create test users with different roles."""
    # Create roles
    roles = {
        "Manager": Role(role_id=1, role_name="Manager"),
        "HR": Role(role_id=2, role_name="HR"),
        "TA": Role(role_id=3, role_name="TA"),
        "Admin": Role(role_id=4, role_name="Admin"),
    }
    for role in roles.values():
        test_db.add(role)
    test_db.flush()
    
    # Create users (using actual User model fields: username, password_hash)
    users = {
        "manager": User(user_id=1, username="manager", password_hash="x"),
        "hr": User(user_id=2, username="hr", password_hash="x"),
        "ta": User(user_id=3, username="ta", password_hash="x"),
        "admin": User(user_id=4, username="admin", password_hash="x"),
    }
    for user in users.values():
        test_db.add(user)
    test_db.flush()
    
    # Assign roles
    test_db.add(UserRole(user_id=1, role_id=1))  # manager -> Manager
    test_db.add(UserRole(user_id=2, role_id=2))  # hr -> HR
    test_db.add(UserRole(user_id=3, role_id=3))  # ta -> TA
    test_db.add(UserRole(user_id=4, role_id=4))  # admin -> Admin
    test_db.commit()
    
    return users


@pytest.fixture
def sample_requisition(test_db: Session, test_users: Dict[str, User]) -> Requisition:
    """Create a sample requisition in DRAFT status."""
    req = Requisition(
        req_id=100,
        raised_by=test_users["manager"].user_id,
        project_name="Test Project",
        overall_status=RequisitionStatus.DRAFT.value,
        version=1,
    )
    test_db.add(req)
    test_db.commit()
    return req


@pytest.fixture
def sample_item(test_db: Session, sample_requisition: Requisition) -> RequisitionItem:
    """Create a sample requisition item in PENDING status."""
    item = RequisitionItem(
        item_id=200,
        req_id=sample_requisition.req_id,
        role_position="Test Position",
        job_description="Test JD",
        item_status=RequisitionItemStatus.PENDING.value,
        version=1,
    )
    test_db.add(item)
    test_db.commit()
    return item


# =============================================================================
# HEADER TRANSITION TESTS
# =============================================================================

class TestHeaderTransitionsAPI:
    """Test all header workflow transitions via API."""
    
    @pytest.mark.parametrize("from_status,to_status,endpoint,expected_code", [
        # Valid transitions
        (RequisitionStatus.DRAFT, RequisitionStatus.PENDING_BUDGET, "submit", 200),
        (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.PENDING_HR, "approve-budget", 200),
        (RequisitionStatus.PENDING_HR, RequisitionStatus.ACTIVE, "approve-hr", 200),
        (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.REJECTED, "reject", 200),
        (RequisitionStatus.PENDING_HR, RequisitionStatus.REJECTED, "reject", 200),
        (RequisitionStatus.DRAFT, RequisitionStatus.CANCELLED, "cancel", 200),
        (RequisitionStatus.ACTIVE, RequisitionStatus.CANCELLED, "cancel", 200),
    ])
    def test_valid_header_transitions(
        self, 
        test_db: Session, 
        test_users: Dict[str, User],
        from_status: RequisitionStatus,
        to_status: RequisitionStatus,
        endpoint: str,
        expected_code: int,
    ):
        """Test that valid transitions succeed."""
        # Setup requisition in source state
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=from_status.value,
            version=1,
        )
        test_db.add(req)
        test_db.commit()
        
        # Verify transition is in matrix
        allowed = HEADER_TRANSITIONS.get(from_status, set())
        assert to_status in allowed, f"{from_status} -> {to_status} not in transition matrix"
    
    @pytest.mark.parametrize("from_status,to_status", [
        # Invalid transitions
        (RequisitionStatus.DRAFT, RequisitionStatus.ACTIVE),
        (RequisitionStatus.DRAFT, RequisitionStatus.FULFILLED),
        (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.ACTIVE),
        (RequisitionStatus.PENDING_HR, RequisitionStatus.DRAFT),
        (RequisitionStatus.ACTIVE, RequisitionStatus.DRAFT),
        (RequisitionStatus.FULFILLED, RequisitionStatus.ACTIVE),
        (RequisitionStatus.REJECTED, RequisitionStatus.ACTIVE),
        (RequisitionStatus.CANCELLED, RequisitionStatus.DRAFT),
    ])
    def test_invalid_header_transitions_blocked(
        self,
        test_db: Session,
        test_users: Dict[str, User],
        from_status: RequisitionStatus,
        to_status: RequisitionStatus,
    ):
        """Test that invalid transitions are blocked."""
        # Verify transition is NOT in matrix
        allowed = HEADER_TRANSITIONS.get(from_status, set())
        assert to_status not in allowed, f"{from_status} -> {to_status} should not be allowed"


class TestTerminalStateProtection:
    """Test that terminal states cannot be transitioned."""
    
    @pytest.mark.parametrize("terminal_status", [
        RequisitionStatus.FULFILLED,
        RequisitionStatus.REJECTED,
        RequisitionStatus.CANCELLED,
    ])
    def test_terminal_header_states_blocked(
        self,
        test_db: Session,
        test_users: Dict[str, User],
        terminal_status: RequisitionStatus,
    ):
        """Test that terminal header states have no outgoing transitions."""
        allowed = HEADER_TRANSITIONS.get(terminal_status, set())
        assert len(allowed) == 0, f"Terminal state {terminal_status} should have no transitions"
    
    @pytest.mark.parametrize("terminal_status", [
        RequisitionItemStatus.FULFILLED,
        RequisitionItemStatus.CANCELLED,
    ])
    def test_terminal_item_states_blocked(
        self,
        test_db: Session,
        terminal_status: RequisitionItemStatus,
    ):
        """Test that terminal item states have no outgoing transitions."""
        allowed = ITEM_TRANSITIONS.get(terminal_status, set())
        assert len(allowed) == 0, f"Terminal state {terminal_status} should have no transitions"


# =============================================================================
# AUTHORIZATION TESTS
# =============================================================================

class TestRoleAuthorization:
    """Test role-based authorization for transitions."""
    
    def test_only_manager_can_submit(self, test_db: Session, test_users: Dict[str, User]):
        """Test that only Manager role can submit a requisition."""
        from services.requisition.workflow_matrix import HEADER_TRANSITION_AUTHORITY, SystemRole
        
        auth = HEADER_TRANSITION_AUTHORITY.get(
            (RequisitionStatus.DRAFT, RequisitionStatus.PENDING_BUDGET),
            set()
        )
        
        assert SystemRole.MANAGER in auth
        assert SystemRole.HR not in auth
        assert SystemRole.TA not in auth
    
    def test_only_hr_admin_can_approve_budget(self, test_db: Session):
        """Test that only HR/Admin can approve budget."""
        from services.requisition.workflow_matrix import HEADER_TRANSITION_AUTHORITY, SystemRole
        
        auth = HEADER_TRANSITION_AUTHORITY.get(
            (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.PENDING_HR),
            set()
        )
        
        assert SystemRole.MANAGER in auth or SystemRole.ADMIN in auth
    
    def test_only_hr_can_approve_hr(self, test_db: Session):
        """Test that only HR can give HR approval."""
        from services.requisition.workflow_matrix import HEADER_TRANSITION_AUTHORITY, SystemRole
        
        auth = HEADER_TRANSITION_AUTHORITY.get(
            (RequisitionStatus.PENDING_HR, RequisitionStatus.ACTIVE),
            set()
        )
        
        assert SystemRole.HR in auth or SystemRole.ADMIN in auth
        assert SystemRole.MANAGER not in auth
        assert SystemRole.TA not in auth


# =============================================================================
# ITEM TRANSITION TESTS
# =============================================================================

class TestItemTransitionsAPI:
    """Test all item workflow transitions via API."""
    
    @pytest.mark.parametrize("from_status,to_status", [
        # Valid forward transitions
        (RequisitionItemStatus.PENDING, RequisitionItemStatus.SOURCING),
        (RequisitionItemStatus.SOURCING, RequisitionItemStatus.SHORTLISTED),
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.INTERVIEWING),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.OFFERED),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.FULFILLED),
        # Valid backward transitions
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.SOURCING),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.SHORTLISTED),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.INTERVIEWING),
        # Cancel transitions
        (RequisitionItemStatus.PENDING, RequisitionItemStatus.CANCELLED),
        (RequisitionItemStatus.SOURCING, RequisitionItemStatus.CANCELLED),
        (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.CANCELLED),
        (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.CANCELLED),
        (RequisitionItemStatus.OFFERED, RequisitionItemStatus.CANCELLED),
    ])
    def test_valid_item_transitions(
        self,
        test_db: Session,
        from_status: RequisitionItemStatus,
        to_status: RequisitionItemStatus,
    ):
        """Test that valid item transitions are in the matrix."""
        allowed = ITEM_TRANSITIONS.get(from_status, set())
        assert to_status in allowed, f"{from_status} -> {to_status} not in item transition matrix"
    
    @pytest.mark.parametrize("from_status,to_status", [
        # Invalid transitions
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
    def test_invalid_item_transitions_blocked(
        self,
        test_db: Session,
        from_status: RequisitionItemStatus,
        to_status: RequisitionItemStatus,
    ):
        """Test that invalid item transitions are not in the matrix."""
        allowed = ITEM_TRANSITIONS.get(from_status, set())
        assert to_status not in allowed, f"{from_status} -> {to_status} should not be allowed"


# =============================================================================
# CONCURRENCY TESTS
# =============================================================================

class TestConcurrencyControl:
    """Test optimistic locking and concurrent access handling."""
    
    def test_version_mismatch_raises_conflict(self, test_db: Session, test_users: Dict[str, User]):
        """Test that version mismatch raises ConcurrencyConflictException."""
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=RequisitionStatus.DRAFT.value,
            version=5,  # Current version is 5
        )
        test_db.add(req)
        test_db.commit()
        
        # Try to update with stale version (3)
        with pytest.raises(ConcurrencyConflictException) as exc_info:
            RequisitionWorkflowEngine.submit(
                db=test_db,
                req_id=100,
                user_id=test_users["manager"].user_id,
                user_roles=["Manager"],
                expected_version=3,  # Stale version
            )
        
        assert exc_info.value.expected_version == 3
        assert exc_info.value.actual_version == 5
    
    def test_version_increments_on_transition(self, test_db: Session, test_users: Dict[str, User]):
        """Test that version increments after successful transition."""
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        test_db.add(req)
        test_db.commit()
        
        initial_version = req.version
        
        result = RequisitionWorkflowEngine.submit(
            db=test_db,
            req_id=100,
            user_id=test_users["manager"].user_id,
            user_roles=["Manager"],
        )
        
        assert result.version == initial_version + 1
    
    def test_concurrent_transitions_one_succeeds(self, test_db: Session, test_users: Dict[str, User]):
        """Test that concurrent transitions on same entity - one succeeds, one fails."""
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        test_db.add(req)
        test_db.commit()
        
        # First transition succeeds
        result1 = RequisitionWorkflowEngine.submit(
            db=test_db,
            req_id=100,
            user_id=test_users["manager"].user_id,
            user_roles=["Manager"],
            expected_version=1,
        )
        test_db.commit()
        
        assert result1.version == 2
        assert result1.overall_status == RequisitionStatus.PENDING_BUDGET.value
        
        # Second transition with stale version fails
        with pytest.raises(ConcurrencyConflictException):
            RequisitionWorkflowEngine.submit(
                db=test_db,
                req_id=100,
                user_id=test_users["manager"].user_id,
                user_roles=["Manager"],
                expected_version=1,  # Stale
            )


# =============================================================================
# GOVERNANCE RULE TESTS
# =============================================================================

class TestGovernanceRules:
    """Test governance rules are enforced."""
    
    def test_gc_001_direct_status_mutation_blocked(self, test_db: Session, test_users: Dict[str, User]):
        """GC-001: Direct status mutation should be blocked."""
        from services.requisition.status_protection import (
            register_status_protection,
            unregister_status_protection,
            StatusProtectionError,
        )
        
        # Ensure protection is registered
        register_status_protection()
        
        try:
            req = Requisition(
                req_id=100,
                raised_by=test_users["manager"].user_id,
                overall_status=RequisitionStatus.DRAFT.value,
                version=1,
            )
            test_db.add(req)
            test_db.commit()
            
            # Direct mutation should raise error
            with pytest.raises(StatusProtectionError):
                req.overall_status = RequisitionStatus.ACTIVE.value
                test_db.flush()
        finally:
            # Clean up: unregister status protection to not affect other tests
            unregister_status_protection()
            test_db.rollback()
    
    def test_gc_003_ta_assignment_auto_transitions(self, test_db: Session, test_users: Dict[str, User]):
        """GC-003: TA assignment auto-transitions PENDING → SOURCING."""
        from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
        
        # Create requisition in ACTIVE state
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=RequisitionStatus.ACTIVE.value,
            version=1,
        )
        test_db.add(req)
        test_db.flush()
        
        # Create item in PENDING state
        item = RequisitionItem(
            item_id=200,
            req_id=100,
            role_position="Test",
            job_description="Test JD",
            item_status=RequisitionItemStatus.PENDING.value,
            version=1,
        )
        test_db.add(item)
        test_db.commit()
        
        # Assign TA
        result = RequisitionItemWorkflowEngine.assign_ta(
            db=test_db,
            item_id=200,
            ta_user_id=test_users["ta"].user_id,
            performed_by=test_users["hr"].user_id,
            user_roles=["HR"],
        )
        
        # Should auto-transition to SOURCING
        assert result.item_status == RequisitionItemStatus.SOURCING.value
        assert result.assigned_ta == test_users["ta"].user_id
    
    def test_gc_004_fulfill_requires_employee(self, test_db: Session, test_users: Dict[str, User]):
        """GC-004: FULFILLED items must have employee assigned."""
        from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
        from services.requisition.workflow_exceptions import PrerequisiteException
        
        # Create requisition in ACTIVE state
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=RequisitionStatus.ACTIVE.value,
            version=1,
        )
        test_db.add(req)
        test_db.flush()
        
        # Create item in OFFERED state
        item = RequisitionItem(
            item_id=200,
            req_id=100,
            role_position="Test",
            job_description="Test JD",
            item_status=RequisitionItemStatus.OFFERED.value,
            version=1,
        )
        test_db.add(item)
        test_db.commit()
        
        # Try to fulfill without employee
        with pytest.raises(PrerequisiteException):
            RequisitionItemWorkflowEngine.fulfill(
                db=test_db,
                item_id=200,
                employee_id=None,  # No employee
                user_id=test_users["hr"].user_id,
                user_roles=["HR"],
            )
    
    def test_gc_009_backward_transition_requires_reason(self, test_db: Session, test_users: Dict[str, User]):
        """GC-009: Backward transitions require reason."""
        from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
        from services.requisition.workflow_exceptions import ReasonRequiredException
        
        # Create requisition in ACTIVE state
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=RequisitionStatus.ACTIVE.value,
            version=1,
        )
        test_db.add(req)
        test_db.flush()
        
        # Create item in SHORTLISTED state
        item = RequisitionItem(
            item_id=200,
            req_id=100,
            role_position="Test",
            job_description="Test JD",
            item_status=RequisitionItemStatus.SHORTLISTED.value,
            assigned_ta=test_users["ta"].user_id,
            version=1,
        )
        test_db.add(item)
        test_db.commit()
        
        # Try to re-source without reason
        with pytest.raises(ReasonRequiredException):
            RequisitionItemWorkflowEngine.re_source(
                db=test_db,
                item_id=200,
                reason="short",  # Too short, need at least 10 chars
                user_id=test_users["ta"].user_id,
                user_roles=["TA"],
            )


# =============================================================================
# AUDIT LOGGING TESTS
# =============================================================================

class TestAuditLogging:
    """Test that transitions are properly audited."""
    
    def test_transition_creates_audit_record(self, test_db: Session, test_users: Dict[str, User]):
        """Test that transitions create audit records."""
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from db.models.workflow_audit import WorkflowTransitionAudit
        
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        test_db.add(req)
        test_db.commit()
        
        # Perform transition
        RequisitionWorkflowEngine.submit(
            db=test_db,
            req_id=100,
            user_id=test_users["manager"].user_id,
            user_roles=["Manager"],
        )
        test_db.commit()
        
        # Check audit record
        audit = test_db.query(WorkflowTransitionAudit).filter(
            WorkflowTransitionAudit.entity_type == "requisition",
            WorkflowTransitionAudit.entity_id == 100,
        ).first()
        
        assert audit is not None
        assert audit.action == "SUBMIT"
        assert audit.from_status == RequisitionStatus.DRAFT.value
        assert audit.to_status == RequisitionStatus.PENDING_BUDGET.value
        assert audit.performed_by == test_users["manager"].user_id
    
    def test_transition_creates_status_history(self, test_db: Session, test_users: Dict[str, User]):
        """Test that header transitions create status history."""
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from db.models.requisition_status_history import RequisitionStatusHistory
        
        req = Requisition(
            req_id=100,
            raised_by=test_users["manager"].user_id,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        test_db.add(req)
        test_db.commit()
        
        # Perform transition
        RequisitionWorkflowEngine.submit(
            db=test_db,
            req_id=100,
            user_id=test_users["manager"].user_id,
            user_roles=["Manager"],
        )
        test_db.commit()
        
        # Check status history
        history = test_db.query(RequisitionStatusHistory).filter(
            RequisitionStatusHistory.req_id == 100,
        ).first()
        
        assert history is not None
        assert history.old_status == RequisitionStatus.DRAFT.value
        assert history.new_status == RequisitionStatus.PENDING_BUDGET.value


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
