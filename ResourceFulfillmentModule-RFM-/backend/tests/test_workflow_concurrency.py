"""
Concurrency Collision Tests for Workflow Engine

These tests verify that concurrent access to workflow transitions
is properly handled with optimistic locking.

Tests use threading to simulate concurrent requests.

NOTE: Some tests in this file use SQLite in-memory database which does NOT support
true row-level locking. Tests that rely on SELECT FOR UPDATE locking behavior 
should use PostgreSQL fixtures (test_postgres_concurrency.py).

The tests here primarily verify:
1. Sequential version tracking works
2. Basic thread safety
3. Optimistic locking when expected_version is passed

For full concurrency safety testing with real locking, use:
    pytest tests/test_postgres_concurrency.py -v -m postgres
"""

import pytest
import threading
import time
from typing import List, Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from unittest.mock import patch

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from db.base import Base
from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem
from db.models.auth import User, Role, UserRole

from services.requisition.workflow_matrix import (
    RequisitionStatus,
    RequisitionItemStatus,
)

# Mark all tests - note SQLite limitations
pytestmark = pytest.mark.unit


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture(scope="function")
def test_engine():
    """Create a shared engine for concurrency testing."""
    SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
    
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    
    Base.metadata.create_all(bind=engine)
    return engine


@pytest.fixture
def session_factory(test_engine):
    """Create a session factory for spawning multiple sessions."""
    return sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture
def setup_data(session_factory) -> Dict[str, Any]:
    """Set up test data before concurrency tests."""
    db = session_factory()
    
    try:
        # Create roles
        manager_role = Role(role_id=1, role_name="Manager")
        hr_role = Role(role_id=2, role_name="HR")
        db.add_all([manager_role, hr_role])
        db.flush()
        
        # Create users (using actual User model fields: username, password_hash)
        user1 = User(user_id=1, username="user1", password_hash="x")
        user2 = User(user_id=2, username="user2", password_hash="x")
        db.add_all([user1, user2])
        db.flush()
        
        # Assign roles
        db.add(UserRole(user_id=1, role_id=1))
        db.add(UserRole(user_id=2, role_id=1))
        db.flush()
        
        # Create requisition
        req = Requisition(
            req_id=100,
            raised_by=1,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        db.add(req)
        db.commit()
        
        return {
            "req_id": 100,
            "user1_id": 1,
            "user2_id": 2,
        }
    finally:
        db.close()


# =============================================================================
# CONCURRENCY COLLISION TESTS
# =============================================================================

class TestConcurrencyCollisions:
    """Test concurrent transition attempts on the same entity."""
    
    def test_two_threads_submit_same_requisition(
        self, 
        session_factory, 
        setup_data: Dict[str, Any]
    ):
        """
        Two threads try to submit the same DRAFT requisition simultaneously.
        Expected: Exactly one succeeds, one gets ConcurrencyConflictException.
        """
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        
        results: List[Tuple[str, Any]] = []
        barrier = threading.Barrier(2)
        
        def attempt_submit(user_id: int):
            db = session_factory()
            try:
                # Synchronize threads to start at the same time
                barrier.wait(timeout=5)
                
                result = RequisitionWorkflowEngine.submit(
                    db=db,
                    req_id=setup_data["req_id"],
                    user_id=user_id,
                    user_roles=["Manager"],
                    expected_version=1,  # Both think version is 1
                )
                db.commit()
                results.append(("success", result))
            except ConcurrencyConflictException as e:
                results.append(("conflict", e))
            except Exception as e:
                results.append(("error", e))
            finally:
                db.close()
        
        # Run two threads
        thread1 = threading.Thread(target=attempt_submit, args=(1,))
        thread2 = threading.Thread(target=attempt_submit, args=(2,))
        
        thread1.start()
        thread2.start()
        
        thread1.join(timeout=10)
        thread2.join(timeout=10)
        
        # Assertions
        successes = [r for r in results if r[0] == "success"]
        conflicts = [r for r in results if r[0] == "conflict"]
        
        assert len(successes) == 1, f"Expected exactly 1 success, got {len(successes)}"
        assert len(conflicts) == 1, f"Expected exactly 1 conflict, got {len(conflicts)}"
    
    def test_sequential_transitions_with_version_tracking(
        self,
        session_factory,
        setup_data: Dict[str, Any]
    ):
        """
        Test that version increments correctly through multiple sequential transitions.
        """
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        
        db = session_factory()
        try:
            # Submit: DRAFT -> PENDING_BUDGET
            result1 = RequisitionWorkflowEngine.submit(
                db=db,
                req_id=setup_data["req_id"],
                user_id=1,
                user_roles=["Manager"],
            )
            db.commit()
            assert result1.version == 2
            
            # Approve Budget: PENDING_BUDGET -> PENDING_HR
            result2 = RequisitionWorkflowEngine.approve_budget(
                db=db,
                req_id=setup_data["req_id"],
                user_id=1,
                user_roles=["Manager"],
            )
            db.commit()
            assert result2.version == 3
            
            # Approve HR: PENDING_HR -> ACTIVE
            result3 = RequisitionWorkflowEngine.approve_hr(
                db=db,
                req_id=setup_data["req_id"],
                user_id=1,
                user_roles=["HR", "Manager"],
            )
            db.commit()
            assert result3.version == 4
        finally:
            db.close()
    
    def test_stale_read_causes_conflict_on_write(
        self,
        session_factory,
        setup_data: Dict[str, Any]
    ):
        """
        Simulate: User A reads version, User B transitions, User A tries to transition.
        Expected: User A gets ConcurrencyConflictException.
        """
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException
        
        db_a = session_factory()
        db_b = session_factory()
        
        try:
            # User A reads current version
            req_a = db_a.query(Requisition).filter(
                Requisition.req_id == setup_data["req_id"]
            ).first()
            version_a = req_a.version
            assert version_a == 1
            
            # User B submits and commits
            RequisitionWorkflowEngine.submit(
                db=db_b,
                req_id=setup_data["req_id"],
                user_id=2,
                user_roles=["Manager"],
            )
            db_b.commit()
            
            # User A tries to submit with stale version
            with pytest.raises(ConcurrencyConflictException) as exc_info:
                RequisitionWorkflowEngine.submit(
                    db=db_a,
                    req_id=setup_data["req_id"],
                    user_id=1,
                    user_roles=["Manager"],
                    expected_version=version_a,
                )
            
            assert exc_info.value.expected_version == 1
            assert exc_info.value.actual_version == 2
        finally:
            db_a.close()
            db_b.close()


class TestItemConcurrency:
    """Test concurrent item transitions."""
    
    @pytest.fixture
    def setup_active_requisition(self, session_factory):
        """Create an ACTIVE requisition with multiple items."""
        db = session_factory()
        try:
            # Create requisition
            req = Requisition(
                req_id=200,
                raised_by=1,
                overall_status=RequisitionStatus.ACTIVE.value,
                version=1,
            )
            db.add(req)
            db.flush()
            
            # Create items
            items = []
            for i in range(1, 4):
                item = RequisitionItem(
                    item_id=200 + i,
                    req_id=200,
                    role_position=f"Position {i}",
                    job_description=f"JD {i}",
                    item_status=RequisitionItemStatus.PENDING.value,
                    version=1,
                )
                db.add(item)
                items.append(item.item_id)
            
            db.commit()
            return {"req_id": 200, "item_ids": items}
        finally:
            db.close()
    
    def test_concurrent_item_transitions_different_items(
        self,
        session_factory,
        setup_data: Dict[str, Any],
        setup_active_requisition: Dict[str, Any],
    ):
        """
        Multiple threads transitioning different items on same requisition.
        Expected: All succeed (no conflict since different items).
        """
        from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
        
        results: List[Tuple[str, Any]] = []
        item_ids = setup_active_requisition["item_ids"]
        
        def transition_item(item_id: int):
            db = session_factory()
            try:
                # Assign TA (auto-transitions PENDING -> SOURCING)
                result = RequisitionItemWorkflowEngine.assign_ta(
                    db=db,
                    item_id=item_id,
                    ta_user_id=1,
                    performed_by=1,
                    user_roles=["Manager", "HR"],
                )
                db.commit()
                results.append(("success", item_id, result.item_status))
            except Exception as e:
                results.append(("error", item_id, str(e)))
            finally:
                db.close()
        
        # Run threads for each item
        threads = []
        for item_id in item_ids:
            t = threading.Thread(target=transition_item, args=(item_id,))
            threads.append(t)
            t.start()
        
        for t in threads:
            t.join(timeout=10)
        
        # All should succeed
        successes = [r for r in results if r[0] == "success"]
        assert len(successes) == len(item_ids), f"Expected all items to transition, got {results}"
    
    def test_concurrent_item_transitions_same_item(
        self,
        session_factory,
        setup_active_requisition: Dict[str, Any],
    ):
        """
        Two threads transitioning the same item simultaneously.
        Expected: One succeeds, one gets ValidationException (TA already assigned).
        
        Note: assign_ta uses SELECT FOR UPDATE (pessimistic locking) and does NOT
        support expected_version parameter. The conflict is detected when the second
        thread tries to assign and finds TA already assigned.
        """
        from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
        from services.requisition.workflow_exceptions import ConcurrencyConflictException, ValidationException
        
        item_id = setup_active_requisition["item_ids"][0]
        results: List[Tuple[str, Any]] = []
        barrier = threading.Barrier(2)
        
        def transition_item(ta_user_id: int):
            db = session_factory()
            try:
                barrier.wait(timeout=5)
                
                # Note: assign_ta does NOT accept expected_version parameter
                result = RequisitionItemWorkflowEngine.assign_ta(
                    db=db,
                    item_id=item_id,
                    ta_user_id=ta_user_id,
                    performed_by=1,
                    user_roles=["HR"],
                )
                db.commit()
                results.append(("success", result))
            except ValidationException as e:
                # TA already assigned by other thread
                results.append(("conflict", e))
            except Exception as e:
                results.append(("error", e))
            finally:
                db.close()
        
        thread1 = threading.Thread(target=transition_item, args=(1,))
        thread2 = threading.Thread(target=transition_item, args=(2,))
        
        thread1.start()
        thread2.start()
        
        thread1.join(timeout=10)
        thread2.join(timeout=10)
        
        successes = [r for r in results if r[0] == "success"]
        conflicts = [r for r in results if r[0] == "conflict"]
        errors = [r for r in results if r[0] == "error"]
        
        assert len(errors) == 0, f"Unexpected errors: {errors}"
        assert len(successes) == 1, f"Expected exactly 1 success, got {results}"
        assert len(conflicts) == 1, f"Expected exactly 1 conflict, got {results}"


class TestThreadPoolConcurrency:
    """Test with larger thread pools to stress-test locking."""
    
    def test_many_concurrent_readers_one_writer(
        self,
        session_factory,
        setup_data: Dict[str, Any],
    ):
        """
        Many readers + one writer. Writer should succeed, readers should see
        either old or new version (but consistent data).
        """
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        
        read_results: List[int] = []
        write_result = []
        read_barrier = threading.Barrier(6)  # 5 readers + 1 coordinator
        
        def reader(reader_id: int):
            db = session_factory()
            try:
                read_barrier.wait(timeout=5)
                req = db.query(Requisition).filter(
                    Requisition.req_id == setup_data["req_id"]
                ).first()
                read_results.append(req.version)
            finally:
                db.close()
        
        def writer():
            db = session_factory()
            try:
                time.sleep(0.01)  # Small delay to let some reads happen
                result = RequisitionWorkflowEngine.submit(
                    db=db,
                    req_id=setup_data["req_id"],
                    user_id=1,
                    user_roles=["Manager"],
                )
                db.commit()
                write_result.append(result.version)
            finally:
                db.close()
        
        # Start readers and writer
        threads = []
        for i in range(5):
            t = threading.Thread(target=reader, args=(i,))
            threads.append(t)
        
        writer_thread = threading.Thread(target=writer)
        threads.append(writer_thread)
        
        for t in threads:
            t.start()
        
        read_barrier.wait(timeout=5)  # Coordinator waits
        
        for t in threads:
            t.join(timeout=10)
        
        # Writer should have incremented version
        assert len(write_result) == 1
        assert write_result[0] == 2
        
        # Readers should have seen version 1 or 2 (depending on timing)
        for v in read_results:
            assert v in [1, 2], f"Reader saw unexpected version {v}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
