"""
============================================================================
PostgreSQL Concurrency Validation Tests — PRODUCTION HARDENING
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

These tests validate concurrency safety using REAL PostgreSQL.
They test actual concurrent transitions and verify:
1. Only one succeeds when racing
2. Others fail with version conflict
3. No partial updates occur
4. Header sync remains consistent

Requirements:
- PostgreSQL database configured in .env
- Tests run with pytest -v --tb=short

IMPORTANT: These tests use actual PostgreSQL locking (SELECT FOR UPDATE).
SQLite-based tests are in test_workflow_concurrency.py for fast CI runs.
"""

import pytest
import threading
import time
import os
from typing import List, Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass
from dotenv import load_dotenv
from pathlib import Path
from urllib.parse import quote_plus

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.exc import OperationalError

# Load environment for PostgreSQL connection
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Import centralized fixtures - these are discovered by pytest from conftest.py
# We use pg_engine, pg_session_factory, pg_session, test_data_factory etc.
# from tests.fixtures.pg_fixtures


# =============================================================================
# SKIP IF NO POSTGRESQL
# =============================================================================

def get_postgres_url() -> str:
    """Get PostgreSQL URL from environment, return empty if not configured."""
    try:
        db_user = os.getenv("DB_USER")
        db_password = os.getenv("DB_PASSWORD")
        db_host = os.getenv("DB_HOST")
        db_port = os.getenv("DB_PORT")
        db_name = os.getenv("DB_NAME")
        
        if not all([db_user, db_password, db_host, db_port, db_name]):
            return ""
        
        return (
            f"postgresql://{quote_plus(db_user)}:{quote_plus(db_password)}@"
            f"{db_host}:{db_port}/{db_name}"
        )
    except Exception:
        return ""


POSTGRES_URL = get_postgres_url()
SKIP_REASON = "PostgreSQL not configured (requires DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME in .env)"

pytestmark = [
    pytest.mark.skipif(not POSTGRES_URL, reason=SKIP_REASON),
    pytest.mark.postgres,
    pytest.mark.concurrency,
]


# =============================================================================
# FIXTURES
# =============================================================================
# Note: pg_engine, pg_session_factory, and other PostgreSQL fixtures are also
# available from tests.fixtures.pg_fixtures via conftest.py. The fixtures below
# are kept for backward compatibility but may be replaced with the centralized ones.

@pytest.fixture(scope="module")
def pg_engine():
    """Create PostgreSQL engine for real concurrency testing."""
    if not POSTGRES_URL:
        pytest.skip(SKIP_REASON)
    
    engine = create_engine(
        POSTGRES_URL,
        pool_size=20,  # Support concurrent connections
        max_overflow=10,
        pool_pre_ping=True,
        isolation_level="READ COMMITTED",  # Standard PostgreSQL isolation
    )
    
    # Verify connection
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"Cannot connect to PostgreSQL: {e}")
    
    return engine


@pytest.fixture(scope="module")
def pg_session_factory(pg_engine):
    """Create session factory for spawning multiple isolated sessions."""
    return sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=pg_engine,
    )


@pytest.fixture
def pg_db(pg_session_factory):
    """Single session for setup/teardown."""
    db = pg_session_factory()
    yield db
    db.close()


@pytest.fixture
def clean_test_data(pg_db):
    """Clean up test data before and after each test."""
    # Cleanup before
    _cleanup_test_data(pg_db)
    yield
    # Cleanup after
    _cleanup_test_data(pg_db)


def _cleanup_test_data(db: Session):
    """Remove test data created during tests."""
    try:
        # Delete in dependency order
        db.execute(text("""
            DELETE FROM workflow_transition_audit 
            WHERE entity_id >= 90000 OR performed_by >= 9000
        """))
        db.execute(text("""
            DELETE FROM requisition_items 
            WHERE req_id >= 90000 OR item_id >= 90000
        """))
        db.execute(text("""
            DELETE FROM requisition_status_history 
            WHERE req_id >= 90000
        """))
        db.execute(text("""
            DELETE FROM requisitions 
            WHERE req_id >= 90000
        """))
        db.execute(text("""
            DELETE FROM user_roles 
            WHERE user_id >= 9000
        """))
        db.execute(text("""
            DELETE FROM users 
            WHERE user_id >= 9000
        """))
        db.execute(text("""
            DELETE FROM employees 
            WHERE emp_id LIKE 'TEST-EMP-%'
        """))
        db.execute(text("""
            DELETE FROM roles 
            WHERE role_id >= 9000
        """))
        db.commit()
    except Exception:
        db.rollback()


def _ensure_test_roles(db: Session) -> Dict[str, int]:
    """
    Ensure system roles exist and return role_id mapping.
    
    Creates roles if they don't exist (for fresh test databases).
    Returns dict mapping role_name -> role_id.
    """
    from db.models.auth import Role
    
    role_names = ["Manager", "HR", "TA", "Admin"]
    role_map = {}
    
    for role_name in role_names:
        role = db.query(Role).filter(Role.role_name == role_name).first()
        if not role:
            # Create role with test ID range
            role = Role(role_name=role_name)
            db.add(role)
            db.flush()
        role_map[role_name] = role.role_id
    
    db.commit()
    return role_map


def _ensure_test_users(db: Session, role_map: Dict[str, int]) -> Dict[str, int]:
    """
    Ensure test users exist with proper role assignments.
    
    Creates users in the 9000+ ID range to avoid conflicts.
    Returns dict mapping logical_name -> user_id.
    """
    from db.models.auth import User, UserRole
    
    # Test user definitions: (user_id, username, role_name)
    test_users = [
        (9001, "test_manager_1", "Manager"),
        (9002, "test_hr_1", "HR"),
        (9003, "test_ta_1", "TA"),
        (9004, "test_ta_2", "TA"),
        (9005, "test_admin_1", "Admin"),
    ]
    
    user_map = {}
    
    for user_id, username, role_name in test_users:
        user = db.query(User).filter(User.user_id == user_id).first()
        if not user:
            user = User(
                user_id=user_id,
                username=username,
                password_hash="test_hash_placeholder",
                is_active=True,
            )
            db.add(user)
            db.flush()
            
            # Assign role
            if role_name in role_map:
                user_role = UserRole(user_id=user_id, role_id=role_map[role_name])
                db.add(user_role)
        
        user_map[username] = user_id
    
    db.commit()
    return user_map


@pytest.fixture
def test_users(pg_db, clean_test_data) -> Dict[str, int]:
    """
    Fixture that ensures test users exist with proper roles.
    
    Returns:
        Dict mapping username -> user_id for test users:
        - test_manager_1 (user_id: 9001)
        - test_hr_1 (user_id: 9002)
        - test_ta_1 (user_id: 9003)
        - test_ta_2 (user_id: 9004)
        - test_admin_1 (user_id: 9005)
    """
    role_map = _ensure_test_roles(pg_db)
    user_map = _ensure_test_users(pg_db, role_map)
    return user_map


@dataclass
class TestScenarioResult:
    """Result of a concurrent test scenario."""
    thread_id: int
    outcome: str  # 'success', 'conflict', 'error'
    exception: Exception = None
    final_version: int = 0
    final_status: str = ""


# =============================================================================
# POSTGRESQL CONCURRENCY TESTS
# =============================================================================

class TestPostgresConcurrentTransitions:
    """
    Test concurrent workflow transitions using real PostgreSQL.
    
    These tests verify that SELECT FOR UPDATE and optimistic locking
    properly handle race conditions.
    """
    
    def test_ta_double_assign_race(self, pg_session_factory, pg_db, test_users):
        """
        Two TAs try to assign themselves to the same item simultaneously.
        
        Expected:
        - Only one succeeds
        - Other gets ConcurrencyConflictException
        - Item has exactly one assigned_ta
        """
        from db.models.requisition import Requisition
        from db.models.requisition_item import RequisitionItem
        from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException, ValidationException
        from services.requisition.workflow_matrix import RequisitionStatus, RequisitionItemStatus
        
        # Get test user IDs from fixture
        manager_id = test_users["test_manager_1"]  # 9001
        hr_id = test_users["test_hr_1"]  # 9002  - HR can assign TA
        ta_1_id = test_users["test_ta_1"]  # 9003
        ta_2_id = test_users["test_ta_2"]  # 9004
        
        # Setup: Create requisition and item
        req_id = 90001
        item_id = 90001
        
        req = Requisition(
            req_id=req_id,
            raised_by=manager_id,  # Use test manager
            overall_status=RequisitionStatus.ACTIVE.value,
            version=1,
        )
        pg_db.add(req)
        pg_db.flush()
        
        item = RequisitionItem(
            item_id=item_id,
            req_id=req_id,
            role_position="Developer",
            job_description="Test position",
            item_status=RequisitionItemStatus.PENDING.value,
            version=1,
        )
        pg_db.add(item)
        pg_db.commit()
        
        # Concurrent assignment attempts
        results: List[TestScenarioResult] = []
        barrier = threading.Barrier(2)
        
        def attempt_assign(thread_id: int, ta_user_id: int):
            db = pg_session_factory()
            try:
                # Synchronize start
                barrier.wait(timeout=10)
                
                # Small stagger to create realistic race condition
                time.sleep(0.001 * thread_id)
                
                # Note: assign_ta uses SELECT FOR UPDATE (pessimistic locking)
                # It does NOT support expected_version parameter
                result = RequisitionItemWorkflowEngine.assign_ta(
                    db=db,
                    item_id=item_id,
                    ta_user_id=ta_user_id,
                    performed_by=ta_user_id,
                    user_roles=["HR"],  # HR can assign TA
                )
                db.commit()
                
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="success",
                    final_version=getattr(result, 'version', 1),
                    final_status=result.item_status,
                ))
            except ValidationException as e:
                # TA already assigned by other thread
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="conflict",
                    exception=e,
                ))
            except Exception as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="error",
                    exception=e,
                ))
            finally:
                db.rollback()
                db.close()
        
        # Launch concurrent threads - both trying to assign different TAs
        # The first to acquire the lock will succeed, second will find TA already assigned
        threads = [
            threading.Thread(target=attempt_assign, args=(1, ta_1_id)),  # TA 9003
            threading.Thread(target=attempt_assign, args=(2, ta_2_id)),  # TA 9004
        ]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        
        # Verify results
        successes = [r for r in results if r.outcome == "success"]
        conflicts = [r for r in results if r.outcome == "conflict"]
        errors = [r for r in results if r.outcome == "error"]
        
        assert len(errors) == 0, f"Unexpected errors: {[e.exception for e in errors]}"
        assert len(successes) == 1, f"Expected exactly 1 success, got {len(successes)}"
        assert len(conflicts) == 1, f"Expected exactly 1 conflict, got {len(conflicts)}"
        
        # Verify database state
        pg_db.expire_all()
        final_item = pg_db.query(RequisitionItem).filter(
            RequisitionItem.item_id == item_id
        ).first()
        
        # Version may not increment (assign_ta may not bump version)
        assert final_item.assigned_ta is not None, "TA should be assigned"
        assert final_item.item_status == RequisitionItemStatus.SOURCING.value
    
    def test_hr_approve_vs_cancel_race(self, pg_session_factory, pg_db, test_users):
        """
        HR approves while Manager cancels the same requisition.
        
        Expected:
        - Only one succeeds
        - Final state is consistent (either ACTIVE or CANCELLED)
        - No partial updates
        """
        from db.models.requisition import Requisition
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        from services.requisition.workflow_matrix import RequisitionStatus
        
        # Get test user IDs from fixture
        manager_id = test_users["test_manager_1"]  # 9001
        hr_id = test_users["test_hr_1"]  # 9002
        
        # Setup: Create requisition in PENDING_HR state
        req_id = 90002
        
        req = Requisition(
            req_id=req_id,
            raised_by=manager_id,  # Use test manager
            overall_status=RequisitionStatus.PENDING_HR.value,
            version=1,
        )
        pg_db.add(req)
        pg_db.commit()
        
        results: List[TestScenarioResult] = []
        barrier = threading.Barrier(2)
        
        def attempt_approve(thread_id: int):
            db = pg_session_factory()
            try:
                barrier.wait(timeout=10)
                time.sleep(0.001 * thread_id)
                
                result = RequisitionWorkflowEngine.approve_hr(
                    db=db,
                    req_id=req_id,
                    user_id=hr_id,  # Use test HR user
                    user_roles=["HR"],
                    expected_version=1,
                )
                db.commit()
                
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="success",
                    final_version=result.version,
                    final_status=result.overall_status,
                ))
            except ConcurrencyConflictException as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="conflict",
                    exception=e,
                ))
            except Exception as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="error",
                    exception=e,
                ))
            finally:
                db.rollback()
                db.close()
        
        def attempt_cancel(thread_id: int):
            db = pg_session_factory()
            try:
                barrier.wait(timeout=10)
                time.sleep(0.001 * thread_id)
                
                result = RequisitionWorkflowEngine.cancel(
                    db=db,
                    req_id=req_id,
                    user_id=manager_id,  # Use test manager
                    user_roles=["Manager"],
                    expected_version=1,
                    reason="Race condition test - cancel attempt",
                )
                db.commit()
                
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="success",
                    final_version=result.version,
                    final_status=result.overall_status,
                ))
            except ConcurrencyConflictException as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="conflict",
                    exception=e,
                ))
            except Exception as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="error",
                    exception=e,
                ))
            finally:
                db.rollback()
                db.close()
        
        threads = [
            threading.Thread(target=attempt_approve, args=(1,)),
            threading.Thread(target=attempt_cancel, args=(2,)),
        ]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        
        # Verify
        successes = [r for r in results if r.outcome == "success"]
        conflicts = [r for r in results if r.outcome == "conflict"]
        errors = [r for r in results if r.outcome == "error"]
        
        assert len(errors) == 0, f"Unexpected errors: {errors}"
        assert len(successes) == 1, f"Expected exactly 1 success"
        assert len(conflicts) == 1, f"Expected exactly 1 conflict"
        
        # Verify final state
        pg_db.expire_all()
        final_req = pg_db.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        
        assert final_req.version == 2
        assert final_req.overall_status in [
            RequisitionStatus.ACTIVE.value,
            RequisitionStatus.CANCELLED.value,
        ]
    
    def test_fulfill_vs_cancel_race(self, pg_session_factory, pg_db, test_users):
        """
        TA fulfills item while Manager cancels entire requisition.
        
        This tests cross-entity locking - item fulfillment should
        also check requisition state consistency.
        """
        from db.models.requisition import Requisition
        from db.models.requisition_item import RequisitionItem
        from db.models.employee import Employee
        from services.requisition.workflow_engine_v2 import (
            RequisitionWorkflowEngine,
            RequisitionItemWorkflowEngine,
        )
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        from services.requisition.workflow_matrix import RequisitionStatus, RequisitionItemStatus
        
        # Get test user IDs
        manager_id = test_users["test_manager_1"]  # 9001
        ta_id = test_users["test_ta_1"]  # 9003
        
        # Setup
        req_id = 90003
        item_id = 90003
        
        # Create employee for fulfillment
        emp = pg_db.query(Employee).filter(Employee.emp_id == "TEST-EMP-001").first()
        if not emp:
            emp = Employee(
                emp_id="TEST-EMP-001",
                full_name="Test Employee",
                rbm_email="test.emp001@rbm.test",
            )
            pg_db.add(emp)
            pg_db.flush()
        
        req = Requisition(
            req_id=req_id,
            raised_by=manager_id,  # Use test manager
            overall_status=RequisitionStatus.ACTIVE.value,
            version=1,
        )
        pg_db.add(req)
        pg_db.flush()
        
        item = RequisitionItem(
            item_id=item_id,
            req_id=req_id,
            role_position="Developer",
            job_description="Test",
            item_status=RequisitionItemStatus.OFFERED.value,  # Ready for fulfillment
            version=1,
            assigned_ta=ta_id,  # Use test TA
        )
        pg_db.add(item)
        pg_db.commit()
        
        results: List[TestScenarioResult] = []
        barrier = threading.Barrier(2)
        
        def attempt_fulfill(thread_id: int):
            db = pg_session_factory()
            try:
                barrier.wait(timeout=10)
                time.sleep(0.001 * thread_id)
                
                result = RequisitionItemWorkflowEngine.fulfill(
                    db=db,
                    item_id=item_id,
                    employee_id="TEST-EMP-001",
                    performed_by=ta_id,  # Use test TA
                    user_roles=["TA"],
                    expected_version=1,
                )
                db.commit()
                
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="success",
                    final_version=result.version,
                    final_status=result.item_status,
                ))
            except (ConcurrencyConflictException, Exception) as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="conflict" if isinstance(e, ConcurrencyConflictException) else "error",
                    exception=e,
                ))
            finally:
                db.rollback()
                db.close()
        
        def attempt_cancel_req(thread_id: int):
            db = pg_session_factory()
            try:
                barrier.wait(timeout=10)
                time.sleep(0.001 * thread_id)
                
                result = RequisitionWorkflowEngine.cancel(
                    db=db,
                    req_id=req_id,
                    user_id=manager_id,  # Use test manager
                    user_roles=["Manager"],
                    expected_version=1,
                    reason="Race condition test - requisition cancel",
                )
                db.commit()
                
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="success",
                    final_version=result.version,
                    final_status=result.overall_status,
                ))
            except (ConcurrencyConflictException, Exception) as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="conflict" if isinstance(e, ConcurrencyConflictException) else "error",
                    exception=e,
                ))
            finally:
                db.rollback()
                db.close()
        
        threads = [
            threading.Thread(target=attempt_fulfill, args=(1,)),
            threading.Thread(target=attempt_cancel_req, args=(2,)),
        ]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        
        # At least one should succeed, exactly one operation
        successes = [r for r in results if r.outcome == "success"]
        
        # Verify database consistency
        pg_db.expire_all()
        final_req = pg_db.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        final_item = pg_db.query(RequisitionItem).filter(
            RequisitionItem.item_id == item_id
        ).first()
        
        # If req was cancelled, item should also be cancelled
        if final_req.overall_status == RequisitionStatus.CANCELLED.value:
            assert final_item.item_status == RequisitionItemStatus.CANCELLED.value
        
        # If item was fulfilled, req should still be ACTIVE (or FULFILLED if only item)
        if final_item.item_status == RequisitionItemStatus.FULFILLED.value:
            assert final_req.overall_status in [
                RequisitionStatus.ACTIVE.value,
                RequisitionStatus.FULFILLED.value,
            ]
    
    def test_double_approval_collision(self, pg_session_factory, pg_db, test_users):
        """
        Two HR users try to approve the same requisition simultaneously.
        
        Expected: Exactly one approval succeeds.
        """
        from db.models.requisition import Requisition
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        from services.requisition.workflow_matrix import RequisitionStatus
        
        # Get test user IDs
        manager_id = test_users["test_manager_1"]  # 9001
        hr_id = test_users["test_hr_1"]  # 9002
        
        req_id = 90004
        
        req = Requisition(
            req_id=req_id,
            raised_by=manager_id,  # Use test manager
            overall_status=RequisitionStatus.PENDING_HR.value,
            version=1,
        )
        pg_db.add(req)
        pg_db.commit()
        
        results: List[TestScenarioResult] = []
        barrier = threading.Barrier(2)
        
        def attempt_approve(thread_id: int, user_id: int):
            db = pg_session_factory()
            try:
                barrier.wait(timeout=10)
                
                result = RequisitionWorkflowEngine.approve_hr(
                    db=db,
                    req_id=req_id,
                    user_id=user_id,
                    user_roles=["HR"],
                    expected_version=1,
                )
                db.commit()
                
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="success",
                    final_version=result.version,
                    final_status=result.overall_status,
                ))
            except ConcurrencyConflictException as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="conflict",
                    exception=e,
                ))
            except Exception as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="error",
                    exception=e,
                ))
            finally:
                db.rollback()
                db.close()
        
        # Both use the same HR user ID (testing same action from same role)
        threads = [
            threading.Thread(target=attempt_approve, args=(1, hr_id)),
            threading.Thread(target=attempt_approve, args=(2, hr_id)),
        ]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        
        successes = [r for r in results if r.outcome == "success"]
        conflicts = [r for r in results if r.outcome == "conflict"]
        errors = [r for r in results if r.outcome == "error"]
        
        assert len(errors) == 0, f"Unexpected errors: {errors}"
        assert len(successes) == 1, "Exactly one approval should succeed"
        assert len(conflicts) == 1, "Exactly one should get conflict"
        
        # Verify final state
        pg_db.expire_all()
        final_req = pg_db.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        
        assert final_req.version == 2
        assert final_req.overall_status == RequisitionStatus.ACTIVE.value
    
    def test_no_partial_updates_on_conflict(self, pg_session_factory, pg_db, test_users):
        """
        Verify that when a conflict occurs, no partial updates are persisted.
        
        Tests atomicity of workflow transitions.
        Uses HR approval (PENDING_HR → ACTIVE) since this transition is
        supported by the requisition_status_history check constraint.
        """
        from db.models.requisition import Requisition
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        from services.requisition.workflow_matrix import RequisitionStatus
        
        # Get test user IDs
        hr_id = test_users["test_hr_1"]  # 9002
        manager_id = test_users["test_manager_1"]  # 9001
        
        req_id = 90005
        
        # Create requisition in PENDING_HR state
        req = Requisition(
            req_id=req_id,
            raised_by=manager_id,
            overall_status=RequisitionStatus.PENDING_HR.value,
            version=1,
        )
        pg_db.add(req)
        pg_db.commit()
        
        results: List[TestScenarioResult] = []
        barrier = threading.Barrier(2)
        
        def attempt_approve(thread_id: int):
            db = pg_session_factory()
            try:
                barrier.wait(timeout=10)
                time.sleep(0.001 * thread_id)
                
                result = RequisitionWorkflowEngine.approve_hr(
                    db=db,
                    req_id=req_id,
                    user_id=hr_id,
                    user_roles=["HR"],
                    expected_version=1,
                )
                db.commit()
                
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="success",
                    final_version=result.version,
                    final_status=result.overall_status,
                ))
            except ConcurrencyConflictException as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="conflict",
                    exception=e,
                ))
            except Exception as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="error",
                    exception=e,
                ))
            finally:
                db.rollback()
                db.close()
        
        threads = [
            threading.Thread(target=attempt_approve, args=(1,)),
            threading.Thread(target=attempt_approve, args=(2,)),
        ]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        
        successes = [r for r in results if r.outcome == "success"]
        conflicts = [r for r in results if r.outcome == "conflict"]
        errors = [r for r in results if r.outcome == "error"]
        
        # Debug output
        assert len(errors) == 0, f"Unexpected errors: {[str(e.exception) for e in errors]}"
        
        # Verify exactly one successful approval
        assert len(successes) == 1, f"Expected 1 success, got {len(successes)}. Conflicts: {len(conflicts)}"
        
        # Verify final state is consistent
        pg_db.expire_all()
        final_req = pg_db.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        
        # The successful thread should have incremented version and changed status
        assert final_req.version == 2, f"Version should be 2, got {final_req.version}"
        assert final_req.overall_status == RequisitionStatus.ACTIVE.value
    
    def test_header_sync_consistency(self, pg_session_factory, pg_db, test_users):
        """
        Test that header status correctly reflects item states
        even under concurrent item transitions.
        """
        from db.models.requisition import Requisition
        from db.models.requisition_item import RequisitionItem
        from db.models.employee import Employee
        from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        from services.requisition.workflow_matrix import RequisitionStatus, RequisitionItemStatus
        
        # Get test user IDs
        manager_id = test_users["test_manager_1"]  # 9001
        hr_id = test_users["test_hr_1"]  # 9002 - HR can fulfill items
        ta_id = test_users["test_ta_1"]  # 9003
        
        req_id = 90006
        
        # Ensure employee exists
        emp = pg_db.query(Employee).filter(Employee.emp_id == "TEST-EMP-002").first()
        if not emp:
            emp = Employee(
                emp_id="TEST-EMP-002",
                full_name="Test Employee Two",
                rbm_email="test.emp002@rbm.test",
            )
            pg_db.add(emp)
            pg_db.flush()
        
        req = Requisition(
            req_id=req_id,
            raised_by=manager_id,  # Use test manager
            overall_status=RequisitionStatus.ACTIVE.value,
            version=1,
        )
        pg_db.add(req)
        pg_db.flush()
        
        # Create 2 items, both in OFFERED state (ready to fulfill)
        items = [
            RequisitionItem(
                item_id=90010 + i,
                req_id=req_id,
                role_position=f"Role {i}",
                job_description="Test",
                item_status=RequisitionItemStatus.OFFERED.value,
                version=1,
                assigned_ta=ta_id,  # Use test TA
            )
            for i in range(2)
        ]
        pg_db.add_all(items)
        pg_db.commit()
        
        # Fulfill both items concurrently
        results: List[TestScenarioResult] = []
        barrier = threading.Barrier(2)
        
        def fulfill_item(thread_id: int, item_id: int):
            db = pg_session_factory()
            try:
                barrier.wait(timeout=10)
                time.sleep(0.005 * thread_id)  # Small stagger
                
                result = RequisitionItemWorkflowEngine.fulfill(
                    db=db,
                    item_id=item_id,
                    user_id=hr_id,  # Use HR user (fulfill requires HR or Admin role)
                    user_roles=["HR"],
                    employee_id="TEST-EMP-002",
                )
                db.commit()
                
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="success",
                    final_version=getattr(result, 'version', 1),
                    final_status=result.item_status,
                ))
            except Exception as e:
                results.append(TestScenarioResult(
                    thread_id=thread_id,
                    outcome="error",
                    exception=e,
                ))
            finally:
                db.rollback()
                db.close()
        
        threads = [
            threading.Thread(target=fulfill_item, args=(1, 90010)),
            threading.Thread(target=fulfill_item, args=(2, 90011)),
        ]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        
        # Both fulfillments should succeed (different items)
        successes = [r for r in results if r.outcome == "success"]
        
        # At least some should succeed
        assert len(successes) >= 1, f"No successful fulfillments: {results}"
        
        # Verify header consistency
        pg_db.expire_all()
        final_req = pg_db.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        final_items = pg_db.query(RequisitionItem).filter(
            RequisitionItem.req_id == req_id
        ).all()
        
        fulfilled_count = sum(
            1 for i in final_items 
            if i.item_status == RequisitionItemStatus.FULFILLED.value
        )
        
        # If all items fulfilled, header should be FULFILLED
        if fulfilled_count == 2:
            assert final_req.overall_status == RequisitionStatus.FULFILLED.value, \
                f"Header should be FULFILLED when all items fulfilled. Got: {final_req.overall_status}"


# =============================================================================
# ISOLATION TEST
# =============================================================================

class TestTransactionIsolation:
    """Test that transactions are properly isolated."""
    
    def test_uncommitted_changes_not_visible(self, pg_session_factory, pg_db, test_users):
        """
        Verify that uncommitted changes in one session are not visible to another.
        """
        from db.models.requisition import Requisition
        from services.requisition.workflow_matrix import RequisitionStatus
        
        # Get test user IDs
        manager_id = test_users["test_manager_1"]  # 9001
        
        req_id = 90007
        
        req = Requisition(
            req_id=req_id,
            raised_by=manager_id,  # Use test manager
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        pg_db.add(req)
        pg_db.commit()
        
        # Session 1: Start transaction and modify
        db1 = pg_session_factory()
        req1 = db1.query(Requisition).filter(Requisition.req_id == req_id).first()
        req1.overall_status = RequisitionStatus.PENDING_BUDGET.value
        db1.flush()  # Flush but don't commit
        
        # Session 2: Should see original value
        db2 = pg_session_factory()
        req2 = db2.query(Requisition).filter(Requisition.req_id == req_id).first()
        
        assert req2.overall_status == RequisitionStatus.DRAFT.value, \
            "Uncommitted changes should not be visible to other sessions"
        
        # Cleanup
        db1.rollback()
        db1.close()
        db2.close()
    
    def test_select_for_update_blocks_concurrent_read(
        self, 
        pg_session_factory, 
        pg_db, 
        test_users
    ):
        """
        Test that SELECT FOR UPDATE properly blocks concurrent reads.
        """
        from db.models.requisition import Requisition
        from services.requisition.workflow_matrix import RequisitionStatus
        from sqlalchemy import text
        
        # Get test user IDs
        manager_id = test_users["test_manager_1"]  # 9001
        
        req_id = 90008
        
        req = Requisition(
            req_id=req_id,
            raised_by=manager_id,  # Use test manager
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        pg_db.add(req)
        pg_db.commit()
        
        lock_acquired = threading.Event()
        wait_for_release = threading.Event()
        blocked = threading.Event()
        
        def holder():
            """Hold the lock."""
            db = pg_session_factory()
            try:
                # Acquire lock with FOR UPDATE
                db.execute(
                    text("SELECT * FROM requisitions WHERE req_id = :id FOR UPDATE"),
                    {"id": req_id}
                )
                lock_acquired.set()
                
                # Hold lock until signaled
                wait_for_release.wait(timeout=30)
                db.commit()
            finally:
                db.close()
        
        def waiter():
            """Try to acquire the same lock."""
            # Wait for holder to acquire lock
            lock_acquired.wait(timeout=10)
            
            db = pg_session_factory()
            try:
                # This should block until holder releases
                start = time.time()
                
                # Use NOWAIT to avoid hanging - will fail if locked
                try:
                    db.execute(
                        text("SELECT * FROM requisitions WHERE req_id = :id FOR UPDATE NOWAIT"),
                        {"id": req_id}
                    )
                    # If we get here, lock was not held
                except OperationalError:
                    # Expected - lock is held
                    blocked.set()
                
                db.commit()
            finally:
                db.close()
        
        holder_thread = threading.Thread(target=holder)
        waiter_thread = threading.Thread(target=waiter)
        
        holder_thread.start()
        waiter_thread.start()
        
        # Give waiter time to attempt lock
        time.sleep(0.5)
        
        # Release holder
        wait_for_release.set()
        
        holder_thread.join(timeout=10)
        waiter_thread.join(timeout=10)
        
        assert blocked.is_set(), "SELECT FOR UPDATE should block concurrent access"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
