"""
============================================================================
Chaos Testing — Stress Tests for Workflow Engine
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

These tests simulate high-concurrency scenarios to validate:
1. System consistency under stress
2. No invalid states
3. No orphan items
4. Header always matches item states
5. Proper error handling for conflicts

REQUIREMENTS:
- PostgreSQL database configured in .env
- Run with: pytest tests/test_chaos.py -v --tb=short -x
"""

import pytest
import threading
import time
import random
from typing import List, Dict, Any, Tuple, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from collections import Counter
import os
from pathlib import Path
from urllib.parse import quote_plus
from dotenv import load_dotenv

from sqlalchemy import create_engine, text, func
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.exc import OperationalError

# Load environment
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


# =============================================================================
# SKIP IF NO POSTGRESQL
# =============================================================================

def get_postgres_url() -> str:
    """Get PostgreSQL URL from environment."""
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
SKIP_REASON = "PostgreSQL not configured"

pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason=SKIP_REASON)


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class ChaosResult:
    """Result of a single chaos operation."""
    thread_id: int
    operation: str
    entity_type: str
    entity_id: int
    outcome: str  # 'success', 'conflict', 'error', 'invalid'
    duration_ms: float = 0.0
    error_message: str = ""
    final_status: str = ""


@dataclass
class ChaosReport:
    """Aggregate report from chaos test."""
    total_operations: int = 0
    successes: int = 0
    conflicts: int = 0
    errors: int = 0
    invalid_states: int = 0
    orphan_items: int = 0
    header_mismatches: int = 0
    duration_seconds: float = 0.0
    operations_per_second: float = 0.0
    results: List[ChaosResult] = field(default_factory=list)
    
    def add_result(self, result: ChaosResult):
        self.results.append(result)
        self.total_operations += 1
        
        if result.outcome == 'success':
            self.successes += 1
        elif result.outcome == 'conflict':
            self.conflicts += 1
        elif result.outcome == 'error':
            self.errors += 1
        elif result.outcome == 'invalid':
            self.invalid_states += 1
    
    def summary(self) -> Dict:
        return {
            "total_operations": self.total_operations,
            "successes": self.successes,
            "conflicts": self.conflicts,
            "errors": self.errors,
            "invalid_states": self.invalid_states,
            "orphan_items": self.orphan_items,
            "header_mismatches": self.header_mismatches,
            "success_rate": (
                round(self.successes / self.total_operations * 100, 2)
                if self.total_operations > 0 else 0
            ),
            "duration_seconds": round(self.duration_seconds, 2),
            "operations_per_second": round(self.operations_per_second, 2),
        }


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture(scope="module")
def chaos_engine():
    """Create PostgreSQL engine for chaos testing."""
    if not POSTGRES_URL:
        pytest.skip(SKIP_REASON)
    
    engine = create_engine(
        POSTGRES_URL,
        pool_size=30,
        max_overflow=20,
        pool_pre_ping=True,
    )
    
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        pytest.skip(f"Cannot connect to PostgreSQL: {e}")
    
    return engine


@pytest.fixture(scope="module")
def chaos_session_factory(chaos_engine):
    """Session factory for chaos testing."""
    return sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=chaos_engine,
    )


@pytest.fixture
def chaos_db(chaos_session_factory):
    """Single session for setup/teardown."""
    db = chaos_session_factory()
    yield db
    db.close()


@pytest.fixture
def chaos_cleanup(chaos_db):
    """Clean up chaos test data."""
    _cleanup_chaos_data(chaos_db)
    yield
    _cleanup_chaos_data(chaos_db)


def _cleanup_chaos_data(db: Session):
    """Remove chaos test data."""
    try:
        db.execute(text("""
            DELETE FROM workflow_transition_audit 
            WHERE entity_id >= 80000 AND entity_id < 90000
        """))
        db.execute(text("""
            DELETE FROM requisition_items 
            WHERE req_id >= 80000 AND req_id < 90000
        """))
        db.execute(text("""
            DELETE FROM requisition_status_history 
            WHERE req_id >= 80000 AND req_id < 90000
        """))
        db.execute(text("""
            DELETE FROM requisitions 
            WHERE req_id >= 80000 AND req_id < 90000
        """))
        db.commit()
    except Exception:
        db.rollback()


# =============================================================================
# CHAOS TEST: 20 CONCURRENT TRANSITIONS
# =============================================================================

class TestChaosStress:
    """Stress tests with high concurrency."""
    
    def test_20_concurrent_transitions_same_entity(
        self, 
        chaos_session_factory, 
        chaos_db, 
        chaos_cleanup
    ):
        """
        20 threads try to transition the same requisition simultaneously.
        
        Validates:
        - Only some succeed (version conflict for others)
        - Final state is valid
        - No partial updates
        """
        from db.models.requisition import Requisition
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_exceptions import (
            ConcurrencyConflictException,
            InvalidTransitionException,
            TerminalStateException,
        )
        from services.requisition.workflow_matrix import RequisitionStatus
        
        # Setup: Create requisition in DRAFT state
        req_id = 80001
        
        req = Requisition(
            req_id=req_id,
            raised_by=1,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        chaos_db.add(req)
        chaos_db.commit()
        
        # Chaos parameters
        num_threads = 20
        report = ChaosReport()
        barrier = threading.Barrier(num_threads)
        
        def chaos_submit(thread_id: int):
            """Each thread tries to submit the requisition."""
            db = chaos_session_factory()
            start_time = time.perf_counter()
            
            try:
                barrier.wait(timeout=30)
                
                # Small random delay for realistic race
                time.sleep(random.uniform(0, 0.01))
                
                result = RequisitionWorkflowEngine.submit(
                    db=db,
                    req_id=req_id,
                    user_id=thread_id,
                    user_roles=["Manager"],
                    expected_version=1,
                )
                db.commit()
                
                duration = (time.perf_counter() - start_time) * 1000
                
                return ChaosResult(
                    thread_id=thread_id,
                    operation="SUBMIT",
                    entity_type="requisition",
                    entity_id=req_id,
                    outcome="success",
                    duration_ms=duration,
                    final_status=result.overall_status,
                )
                
            except ConcurrencyConflictException as e:
                duration = (time.perf_counter() - start_time) * 1000
                return ChaosResult(
                    thread_id=thread_id,
                    operation="SUBMIT",
                    entity_type="requisition",
                    entity_id=req_id,
                    outcome="conflict",
                    duration_ms=duration,
                    error_message=str(e),
                )
                
            except (InvalidTransitionException, TerminalStateException) as e:
                duration = (time.perf_counter() - start_time) * 1000
                return ChaosResult(
                    thread_id=thread_id,
                    operation="SUBMIT",
                    entity_type="requisition",
                    entity_id=req_id,
                    outcome="conflict",  # Expected if another thread won
                    duration_ms=duration,
                    error_message=str(e),
                )
                
            except Exception as e:
                duration = (time.perf_counter() - start_time) * 1000
                return ChaosResult(
                    thread_id=thread_id,
                    operation="SUBMIT",
                    entity_type="requisition",
                    entity_id=req_id,
                    outcome="error",
                    duration_ms=duration,
                    error_message=str(e),
                )
            finally:
                db.rollback()
                db.close()
        
        # Execute chaos
        start = time.perf_counter()
        
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [
                executor.submit(chaos_submit, i) for i in range(num_threads)
            ]
            
            for future in as_completed(futures, timeout=60):
                result = future.result()
                report.add_result(result)
        
        report.duration_seconds = time.perf_counter() - start
        report.operations_per_second = num_threads / report.duration_seconds
        
        # Verify results
        summary = report.summary()
        print(f"\nChaos Report: {summary}")
        
        # Exactly one success (submitting DRAFT -> PENDING_BUDGET)
        assert report.successes == 1, f"Expected exactly 1 success, got {report.successes}"
        
        # Rest should be conflicts
        assert report.conflicts == num_threads - 1, \
            f"Expected {num_threads - 1} conflicts, got {report.conflicts}"
        
        # No errors
        assert report.errors == 0, f"Unexpected errors: {report.errors}"
        
        # Verify final state
        chaos_db.expire_all()
        final_req = chaos_db.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        
        assert final_req.version == 2, "Version should be exactly 2"
        assert final_req.overall_status == RequisitionStatus.PENDING_BUDGET.value
    
    def test_random_role_transitions(
        self,
        chaos_session_factory,
        chaos_db,
        chaos_cleanup
    ):
        """
        Multiple threads with different roles attempt various transitions.
        
        Simulates real-world scenario where different users
        interact with the same requisition concurrently.
        """
        from db.models.requisition import Requisition
        from db.models.requisition_item import RequisitionItem
        from services.requisition.workflow_engine_v2 import (
            RequisitionWorkflowEngine,
            RequisitionItemWorkflowEngine,
        )
        from services.requisition.workflow_exceptions import WorkflowException
        from services.requisition.workflow_matrix import (
            RequisitionStatus,
            RequisitionItemStatus,
        )
        
        # Setup: Create requisition in ACTIVE state with items
        req_id = 80002
        
        req = Requisition(
            req_id=req_id,
            raised_by=1,
            overall_status=RequisitionStatus.ACTIVE.value,
            version=1,
        )
        chaos_db.add(req)
        chaos_db.flush()
        
        # Create 5 items in PENDING state
        items = []
        for i in range(5):
            item = RequisitionItem(
                item_id=80100 + i,
                req_id=req_id,
                role_position=f"Role {i}",
                job_description="Test",
                item_status=RequisitionItemStatus.PENDING.value,
                version=1,
            )
            chaos_db.add(item)
            items.append(item.item_id)
        
        chaos_db.commit()
        
        # Define operations with different roles
        operations = [
            # TA assignments
            ("assign_ta_item", "TA", lambda db, item_id, user_id, roles: 
                RequisitionItemWorkflowEngine.assign_ta(
                    db, item_id, ta_user_id=user_id, performed_by=user_id, user_roles=roles
                )),
            # Manager cancel
            ("cancel_req", "Manager", lambda db, item_id, user_id, roles:
                RequisitionWorkflowEngine.cancel(
                    db, req_id, user_id=user_id, user_roles=roles, reason="Chaos cancel"
                )),
            # HR cancel item
            ("cancel_item", "HR", lambda db, item_id, user_id, roles:
                RequisitionItemWorkflowEngine.cancel(
                    db, item_id, performed_by=user_id, user_roles=roles, reason="HR cancel"
                )),
        ]
        
        num_threads = 20
        report = ChaosReport()
        barrier = threading.Barrier(num_threads)
        
        def chaos_operation(thread_id: int):
            """Execute random operation."""
            db = chaos_session_factory()
            start_time = time.perf_counter()
            
            # Select random operation and item
            op_name, role, op_func = random.choice(operations)
            item_id = random.choice(items)
            user_id = thread_id + 100
            
            try:
                barrier.wait(timeout=30)
                time.sleep(random.uniform(0, 0.02))
                
                result = op_func(db, item_id, user_id, [role])
                db.commit()
                
                duration = (time.perf_counter() - start_time) * 1000
                
                return ChaosResult(
                    thread_id=thread_id,
                    operation=op_name,
                    entity_type="requisition_item" if "item" in op_name else "requisition",
                    entity_id=item_id if "item" in op_name else req_id,
                    outcome="success",
                    duration_ms=duration,
                )
                
            except WorkflowException as e:
                duration = (time.perf_counter() - start_time) * 1000
                return ChaosResult(
                    thread_id=thread_id,
                    operation=op_name,
                    entity_type="requisition_item" if "item" in op_name else "requisition",
                    entity_id=item_id if "item" in op_name else req_id,
                    outcome="conflict",
                    duration_ms=duration,
                    error_message=str(e),
                )
                
            except Exception as e:
                duration = (time.perf_counter() - start_time) * 1000
                return ChaosResult(
                    thread_id=thread_id,
                    operation=op_name,
                    entity_type="requisition_item" if "item" in op_name else "requisition",
                    entity_id=item_id if "item" in op_name else req_id,
                    outcome="error",
                    duration_ms=duration,
                    error_message=str(e),
                )
            finally:
                db.rollback()
                db.close()
        
        # Execute
        start = time.perf_counter()
        
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [
                executor.submit(chaos_operation, i) for i in range(num_threads)
            ]
            
            for future in as_completed(futures, timeout=60):
                result = future.result()
                report.add_result(result)
        
        report.duration_seconds = time.perf_counter() - start
        
        # Verify consistency
        chaos_db.expire_all()
        
        # Check for invalid states
        final_req = chaos_db.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        
        final_items = chaos_db.query(RequisitionItem).filter(
            RequisitionItem.req_id == req_id
        ).all()
        
        # Validate header status is valid
        valid_statuses = {s.value for s in RequisitionStatus}
        assert final_req.overall_status in valid_statuses, \
            f"Invalid header status: {final_req.overall_status}"
        
        # Validate all item statuses are valid
        valid_item_statuses = {s.value for s in RequisitionItemStatus}
        for item in final_items:
            assert item.item_status in valid_item_statuses, \
                f"Invalid item status: {item.item_status}"
        
        # If header is CANCELLED, all items should be CANCELLED
        if final_req.overall_status == RequisitionStatus.CANCELLED.value:
            for item in final_items:
                assert item.item_status == RequisitionItemStatus.CANCELLED.value, \
                    f"Item {item.item_id} not cancelled when header is cancelled"
        
        summary = report.summary()
        print(f"\nRandom Role Chaos Report: {summary}")
        
        # Some operations should succeed
        assert report.successes > 0, "At least some operations should succeed"
        
        # No catastrophic errors
        assert report.errors == 0, f"Unexpected errors: {report.errors}"
    
    def test_header_item_consistency_under_stress(
        self,
        chaos_session_factory,
        chaos_db,
        chaos_cleanup
    ):
        """
        Stress test specifically for header-item state consistency.
        
        Verifies that header.overall_status always correctly reflects
        the aggregate state of its items.
        """
        from db.models.requisition import Requisition
        from db.models.requisition_item import RequisitionItem
        from db.models.employee import Employee
        from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
        from services.requisition.workflow_exceptions import WorkflowException
        from services.requisition.workflow_matrix import (
            RequisitionStatus,
            RequisitionItemStatus,
        )
        
        req_id = 80003
        
        # Ensure employee exists for fulfillment
        emp = chaos_db.query(Employee).filter(Employee.emp_id == "CHAOS001").first()
        if not emp:
            emp = Employee(
                emp_id="CHAOS001",
                first_name="Chaos",
                last_name="Test",
                email="chaos@test.com",
            )
            chaos_db.add(emp)
            chaos_db.flush()
        
        # Create requisition with multiple items at different stages
        req = Requisition(
            req_id=req_id,
            raised_by=1,
            overall_status=RequisitionStatus.ACTIVE.value,
            version=1,
        )
        chaos_db.add(req)
        chaos_db.flush()
        
        # Create items in various states
        item_configs = [
            (80200, RequisitionItemStatus.OFFERED.value, 10),  # Ready to fulfill
            (80201, RequisitionItemStatus.OFFERED.value, 10),  # Ready to fulfill
            (80202, RequisitionItemStatus.SOURCING.value, 10),
            (80203, RequisitionItemStatus.PENDING.value, None),
        ]
        
        for item_id, status, ta in item_configs:
            item = RequisitionItem(
                item_id=item_id,
                req_id=req_id,
                role_position="Test Role",
                job_description="Test",
                item_status=status,
                version=1,
                assigned_ta=ta,
            )
            chaos_db.add(item)
        
        chaos_db.commit()
        
        # Concurrent fulfillments of the two OFFERED items
        num_threads = 10
        report = ChaosReport()
        barrier = threading.Barrier(num_threads)
        
        def fulfill_item(thread_id: int):
            """Try to fulfill one of the OFFERED items."""
            db = chaos_session_factory()
            start_time = time.perf_counter()
            
            item_id = 80200 if thread_id % 2 == 0 else 80201
            
            try:
                barrier.wait(timeout=30)
                time.sleep(random.uniform(0, 0.01))
                
                result = RequisitionItemWorkflowEngine.fulfill(
                    db=db,
                    item_id=item_id,
                    employee_id="CHAOS001",
                    performed_by=10,
                    user_roles=["TA"],
                )
                db.commit()
                
                duration = (time.perf_counter() - start_time) * 1000
                
                return ChaosResult(
                    thread_id=thread_id,
                    operation="FULFILL",
                    entity_type="requisition_item",
                    entity_id=item_id,
                    outcome="success",
                    duration_ms=duration,
                    final_status=result.item_status,
                )
                
            except WorkflowException as e:
                duration = (time.perf_counter() - start_time) * 1000
                return ChaosResult(
                    thread_id=thread_id,
                    operation="FULFILL",
                    entity_type="requisition_item",
                    entity_id=item_id,
                    outcome="conflict",
                    duration_ms=duration,
                    error_message=str(e),
                )
                
            except Exception as e:
                duration = (time.perf_counter() - start_time) * 1000
                return ChaosResult(
                    thread_id=thread_id,
                    operation="FULFILL",
                    entity_type="requisition_item",
                    entity_id=item_id,
                    outcome="error",
                    duration_ms=duration,
                    error_message=str(e),
                )
            finally:
                db.rollback()
                db.close()
        
        # Execute
        start = time.perf_counter()
        
        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [
                executor.submit(fulfill_item, i) for i in range(num_threads)
            ]
            
            for future in as_completed(futures, timeout=60):
                result = future.result()
                report.add_result(result)
        
        report.duration_seconds = time.perf_counter() - start
        
        # CRITICAL: Verify header-item consistency
        chaos_db.expire_all()
        
        final_req = chaos_db.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        
        final_items = chaos_db.query(RequisitionItem).filter(
            RequisitionItem.req_id == req_id
        ).all()
        
        # Count item states
        fulfilled = sum(1 for i in final_items if i.item_status == RequisitionItemStatus.FULFILLED.value)
        cancelled = sum(1 for i in final_items if i.item_status == RequisitionItemStatus.CANCELLED.value)
        
        # Validate consistency
        if fulfilled + cancelled == len(final_items):
            # All items terminal
            if cancelled == len(final_items):
                assert final_req.overall_status == RequisitionStatus.CANCELLED.value, \
                    "All items cancelled but header not CANCELLED"
            else:
                assert final_req.overall_status == RequisitionStatus.FULFILLED.value, \
                    f"All items terminal but header is {final_req.overall_status}"
        else:
            # Some items still active
            assert final_req.overall_status == RequisitionStatus.ACTIVE.value, \
                f"Active items exist but header is {final_req.overall_status}"
        
        summary = report.summary()
        print(f"\nHeader-Item Consistency Chaos Report: {summary}")
        
        # At least 2 fulfillments should succeed (one per item)
        assert report.successes >= 2, \
            f"Expected at least 2 successful fulfillments, got {report.successes}"


# =============================================================================
# CHAOS TEST: CONSISTENCY VALIDATION
# =============================================================================

class TestChaosConsistency:
    """Validate system consistency after chaos."""
    
    def test_no_orphan_items(self, chaos_session_factory, chaos_db, chaos_cleanup):
        """
        Create items and requisitions concurrently, verify no orphans.
        """
        from db.models.requisition import Requisition
        from db.models.requisition_item import RequisitionItem
        from services.requisition.workflow_matrix import (
            RequisitionStatus,
            RequisitionItemStatus,
        )
        
        # Create requisitions
        for i in range(5):
            req = Requisition(
                req_id=80500 + i,
                raised_by=1,
                overall_status=RequisitionStatus.ACTIVE.value,
                version=1,
            )
            chaos_db.add(req)
        
        chaos_db.commit()
        
        # Query for orphan items (items without valid requisition)
        orphan_count = chaos_db.execute(text("""
            SELECT COUNT(*) FROM requisition_items ri
            WHERE ri.req_id >= 80000 AND ri.req_id < 90000
            AND NOT EXISTS (
                SELECT 1 FROM requisitions r WHERE r.req_id = ri.req_id
            )
        """)).scalar()
        
        assert orphan_count == 0, f"Found {orphan_count} orphan items"
    
    def test_version_monotonic_increase(
        self, 
        chaos_session_factory, 
        chaos_db, 
        chaos_cleanup
    ):
        """
        Verify version columns always increase, never decrease.
        """
        from db.models.requisition import Requisition
        from services.requisition.workflow_engine_v2 import RequisitionWorkflowEngine
        from services.requisition.workflow_matrix import RequisitionStatus
        
        req_id = 80600
        
        req = Requisition(
            req_id=req_id,
            raised_by=1,
            overall_status=RequisitionStatus.DRAFT.value,
            version=1,
        )
        chaos_db.add(req)
        chaos_db.commit()
        
        # Track version history
        versions = [1]
        
        # Perform sequential transitions
        transitions = [
            ("submit", lambda: RequisitionWorkflowEngine.submit(
                chaos_db, req_id, user_id=1, user_roles=["Manager"]
            )),
            ("approve_budget", lambda: RequisitionWorkflowEngine.approve_budget(
                chaos_db, req_id, user_id=1, user_roles=["Manager"]
            )),
            ("approve_hr", lambda: RequisitionWorkflowEngine.approve_hr(
                chaos_db, req_id, user_id=1, user_roles=["HR"]
            )),
        ]
        
        for name, action in transitions:
            result = action()
            chaos_db.commit()
            
            versions.append(result.version)
            
            # Verify monotonic increase
            assert versions[-1] > versions[-2], \
                f"Version decreased after {name}: {versions[-2]} -> {versions[-1]}"
        
        # Verify final version
        assert versions == [1, 2, 3, 4], f"Unexpected version sequence: {versions}"


# =============================================================================
# RUN CHAOS TESTS
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short", "-x"])
