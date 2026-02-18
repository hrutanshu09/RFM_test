"""
Tests for Requisition Creation + Workflow Submission

Verifies:
1. Creation always produces DRAFT status with version=1
2. No status history row is created on creation
3. Submitting via WorkflowEngine creates correct history row
4. NULL old_status is rejected at application level
5. Status values match RequisitionStatus enum (CHECK-safe)
"""

import pytest
from unittest.mock import Mock, patch, call, MagicMock
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem
from db.models.requisition_status_history import RequisitionStatusHistory
from db.models.audit_log import AuditLog
from db.models.auth import User, Role, UserRole

from services.requisition.workflow_matrix import RequisitionStatus
from services.requisition.workflow_engine_v2 import (
    RequisitionWorkflowEngine,
    WorkflowAuditLogger,
)
from services.requisition.events import RequisitionEvents
from services.requisition.workflow_exceptions import (
    WorkflowException,
    ValidationException,
    InvalidTransitionException,
)


# ============================================================================
# FIXTURES
# ============================================================================

@pytest.fixture(scope="function")
def db():
    """In-memory SQLite database for isolated tests."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _set_pragma(dbapi_conn, _rec):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(bind=engine)
    _Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = _Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seed_users(db: Session):
    """Create basic roles + users needed by workflow."""
    roles = {
        "Manager": Role(role_id=1, role_name="Manager"),
        "HR": Role(role_id=2, role_name="HR"),
        "Admin": Role(role_id=3, role_name="Admin"),
        "TA": Role(role_id=4, role_name="TA"),
    }
    for r in roles.values():
        db.add(r)
    db.flush()

    manager = User(user_id=1, username="manager", password_hash="x")
    db.add(manager)
    db.flush()

    db.add(UserRole(user_id=1, role_id=1))
    db.commit()
    return {"manager": manager}


# ============================================================================
# 1. CREATION ALWAYS PRODUCES DRAFT
# ============================================================================

class TestRequisitionCreation:
    """Step 1 & Step 2: Creation always DRAFT, no history on create."""

    def test_creation_sets_draft_status(self, db: Session, seed_users):
        """Requisition must be created in DRAFT state."""
        req = Requisition(
            raised_by=1,
            project_name="Test",
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()

        assert req.overall_status == "Draft"
        assert req.version == 1

    def test_creation_does_not_insert_history(self, db: Session, seed_users):
        """No status history row should exist after creation."""
        req = Requisition(
            raised_by=1,
            project_name="Test",
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()

        rows = db.query(RequisitionStatusHistory).filter(
            RequisitionStatusHistory.req_id == req.req_id
        ).all()
        assert len(rows) == 0

    def test_creation_version_is_one(self, db: Session, seed_users):
        """Newly created requisition must have version=1."""
        req = Requisition(
            raised_by=1,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()
        db.refresh(req)

        assert req.version == 1


# ============================================================================
# 2. SUBMIT CREATES CORRECT HISTORY
# ============================================================================

class TestSubmitWorkflow:
    """Step 2: Submit is a separate workflow action via engine."""

    def test_submit_transitions_draft_to_pending_budget(self, db: Session, seed_users):
        """Submit must transition DRAFT → PENDING_BUDGET."""
        req = Requisition(
            raised_by=1,
            project_name="Submit Test",
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()

        result = RequisitionWorkflowEngine.submit(
            db=db,
            req_id=req.req_id,
            user_id=1,
            user_roles=["Manager"],
        )
        db.commit()

        assert result.overall_status == RequisitionStatus.PENDING_BUDGET.value

    def test_submit_creates_history_with_valid_statuses(self, db: Session, seed_users):
        """Submit must create history row with old=Draft, new=Pending_Budget."""
        req = Requisition(
            raised_by=1,
            project_name="History Test",
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()

        RequisitionWorkflowEngine.submit(
            db=db,
            req_id=req.req_id,
            user_id=1,
            user_roles=["Manager"],
        )
        db.commit()

        rows = db.query(RequisitionStatusHistory).filter(
            RequisitionStatusHistory.req_id == req.req_id
        ).all()
        assert len(rows) == 1

        row = rows[0]
        assert row.old_status == "Draft"
        assert row.new_status == "Pending_Budget"

    def test_submit_increments_version(self, db: Session, seed_users):
        """Submit must increment version from 1 to 2."""
        req = Requisition(
            raised_by=1,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()

        result = RequisitionWorkflowEngine.submit(
            db=db,
            req_id=req.req_id,
            user_id=1,
            user_roles=["Manager"],
        )
        db.commit()

        assert result.version == 2

    def test_submit_from_non_draft_is_rejected(self, db: Session, seed_users):
        """Submitting from a non-DRAFT status must raise InvalidTransitionException."""
        req = Requisition(
            raised_by=1,
            overall_status=RequisitionStatus.PENDING_BUDGET.value,
            version=1,
        )
        db.add(req)
        db.commit()

        with pytest.raises(InvalidTransitionException):
            RequisitionWorkflowEngine.submit(
                db=db,
                req_id=req.req_id,
                user_id=1,
                user_roles=["Manager"],
            )


# ============================================================================
# 3. NULL OLD_STATUS IS REJECTED
# ============================================================================

class TestHistoryIntegrity:
    """Steps 3 & 4: NULL old_status and invalid statuses are rejected."""

    def test_null_old_status_raises_in_events(self, db: Session):
        """RequisitionEvents.record_status_history must reject old_status=None."""
        with pytest.raises(WorkflowException, match="old_status cannot be NULL"):
            RequisitionEvents.record_status_history(
                db=db,
                req_id=999,
                old_status=None,
                new_status="Pending_Budget",
                changed_by=1,
            )

    def test_null_old_status_raises_in_audit_logger(self, db: Session):
        """WorkflowAuditLogger.log_status_history must reject old_status=None."""
        with pytest.raises(WorkflowException, match="old_status cannot be NULL"):
            WorkflowAuditLogger.log_status_history(
                db=db,
                req_id=999,
                old_status=None,
                new_status="Pending_Budget",
                changed_by=1,
            )

    def test_invalid_old_status_string_rejected_in_events(self, db: Session):
        """Legacy status strings must be rejected by events module."""
        with pytest.raises(WorkflowException, match="not in RequisitionStatus"):
            RequisitionEvents.record_status_history(
                db=db,
                req_id=999,
                old_status="Pending Budget Approval",  # legacy
                new_status="Pending_Budget",
                changed_by=1,
            )

    def test_invalid_new_status_string_rejected_in_events(self, db: Session):
        """Legacy new_status strings must be rejected by events module."""
        with pytest.raises(WorkflowException, match="not in RequisitionStatus"):
            RequisitionEvents.record_status_history(
                db=db,
                req_id=999,
                old_status="Draft",
                new_status="Pending Budget Approval",  # legacy
                changed_by=1,
            )

    def test_invalid_old_status_string_rejected_in_audit_logger(self, db: Session):
        """Legacy status strings must be rejected by WorkflowAuditLogger."""
        with pytest.raises(ValidationException):
            WorkflowAuditLogger.log_status_history(
                db=db,
                req_id=999,
                old_status="Approved & Unassigned",  # legacy
                new_status="Active",
                changed_by=1,
            )

    def test_valid_statuses_accepted(self, db: Session, seed_users):
        """All spec v1.0.0 statuses must pass validation."""
        req = Requisition(
            raised_by=1,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()

        # Should NOT raise
        RequisitionEvents.record_status_history(
            db=db,
            req_id=req.req_id,
            old_status=RequisitionStatus.DRAFT.value,
            new_status=RequisitionStatus.PENDING_BUDGET.value,
            changed_by=1,
        )
        db.commit()

        rows = db.query(RequisitionStatusHistory).filter(
            RequisitionStatusHistory.req_id == req.req_id
        ).all()
        assert len(rows) == 1
        assert rows[0].old_status == "Draft"
        assert rows[0].new_status == "Pending_Budget"


# ============================================================================
# 4. STATUS ENUM COVERAGE
# ============================================================================

class TestStatusEnumValues:
    """Step 4: All enum values match what the CHECK constraint expects."""

    def test_all_requisition_status_values_are_check_safe(self):
        """Every RequisitionStatus enum value must match the DB CHECK list."""
        expected = {
            "Draft",
            "Pending_Budget",
            "Pending_HR",
            "Active",
            "Fulfilled",
            "Rejected",
            "Cancelled",
        }
        actual = {s.value for s in RequisitionStatus}
        assert actual == expected

    def test_draft_is_initial_state(self):
        """DRAFT must be the initial (creation) state."""
        assert RequisitionStatus.DRAFT.value == "Draft"


# ============================================================================
# 5. FULL LIFECYCLE: CREATE → SUBMIT → APPROVE → APPROVE
# ============================================================================

class TestFullLifecycle:
    """End-to-end: Create → Submit → Budget → HR, verifying history at each stage."""

    def test_full_approval_lifecycle(self, db: Session, seed_users):
        """Walk through the full happy path and verify history chain."""
        # Create — no history
        req = Requisition(
            raised_by=1,
            project_name="Lifecycle",
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()

        assert db.query(RequisitionStatusHistory).filter(
            RequisitionStatusHistory.req_id == req.req_id
        ).count() == 0

        # Submit — Draft → Pending_Budget
        RequisitionWorkflowEngine.submit(
            db=db, req_id=req.req_id, user_id=1, user_roles=["Manager"],
        )
        db.commit()
        assert req.overall_status == "Pending_Budget"

        # Budget approve — Pending_Budget → Pending_HR
        RequisitionWorkflowEngine.approve_budget(
            db=db, req_id=req.req_id, user_id=1, user_roles=["Manager"],
        )
        db.commit()
        assert req.overall_status == "Pending_HR"

        # HR approve — Pending_HR → Active
        # Need an HR user
        hr = User(user_id=2, username="hr", password_hash="x")
        db.add(hr)
        hr_role = Role(role_id=2, role_name="HR")
        db.merge(hr_role)
        db.flush()
        db.add(UserRole(user_id=2, role_id=2))
        db.commit()

        RequisitionWorkflowEngine.approve_hr(
            db=db, req_id=req.req_id, user_id=2, user_roles=["HR"],
        )
        db.commit()
        assert req.overall_status == "Active"

        # Verify full history chain
        history = (
            db.query(RequisitionStatusHistory)
            .filter(RequisitionStatusHistory.req_id == req.req_id)
            .order_by(RequisitionStatusHistory.history_id)
            .all()
        )
        assert len(history) == 3

        assert history[0].old_status == "Draft"
        assert history[0].new_status == "Pending_Budget"

        assert history[1].old_status == "Pending_Budget"
        assert history[1].new_status == "Pending_HR"

        assert history[2].old_status == "Pending_HR"
        assert history[2].new_status == "Active"

        # No NULL old_status anywhere
        for row in history:
            assert row.old_status is not None
            assert row.new_status is not None
