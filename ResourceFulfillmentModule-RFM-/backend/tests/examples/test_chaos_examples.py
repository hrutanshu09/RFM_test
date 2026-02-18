"""
============================================================================
Example Chaos Tests — Demonstrates Resilience Testing Patterns
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module demonstrates:
1. Connection pool exhaustion testing
2. High-load concurrent operations
3. Random failure injection
4. Timeout handling

Run with:
    cd backend
    pytest tests/examples/test_chaos_examples.py -v -m chaos
"""

import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any
from unittest.mock import patch, MagicMock

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, TimeoutError
from sqlalchemy.orm import Session

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.chaos,
]


# =============================================================================
# CONNECTION POOL STRESS TESTS
# =============================================================================

class TestConnectionPoolStress:
    """Tests for connection pool behavior under stress."""
    
    def test_high_concurrent_connections(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Stress test connection pool with many concurrent sessions.
        
        Creates more concurrent operations than pool_size to verify
        overflow handling works correctly.
        """
        # Create base data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=91001,
            requisition_status="Active",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        num_concurrent = 25  # More than pool_size (20)
        results = []
        results_lock = threading.Lock()
        
        def perform_query(op_id: int):
            """Simple query operation."""
            from db.models.requisition import Requisition
            
            try:
                with concurrent_session_factory.session_context() as session:
                    req = session.query(Requisition).filter(
                        Requisition.req_id == req_id
                    ).first()
                    
                    # Small delay to keep connection busy
                    time.sleep(0.05)
                    
                    if req:
                        with results_lock:
                            results.append(("success", op_id, req.overall_status))
                    else:
                        with results_lock:
                            results.append(("not_found", op_id, None))
                            
            except Exception as e:
                with results_lock:
                    results.append(("error", op_id, str(e)))
        
        # Launch many concurrent operations
        with ThreadPoolExecutor(max_workers=num_concurrent) as executor:
            futures = [executor.submit(perform_query, i) for i in range(num_concurrent)]
            for f in as_completed(futures, timeout=30):
                pass
        
        # All should eventually succeed (pool overflow handles extra connections)
        successes = [r for r in results if r[0] == "success"]
        errors = [r for r in results if r[0] == "error"]
        
        assert len(successes) == num_concurrent, (
            f"Expected {num_concurrent} successes, got {len(successes)}. "
            f"Errors: {errors}"
        )
    
    def test_connection_recovery_after_failure(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Test that sessions recover properly after query failures.
        
        Simulates transient failures and verifies pool recovers.
        """
        # Create base data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=91002,
            requisition_status="Active",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        success_count = 0
        failure_count = 0
        
        for i in range(10):
            try:
                with concurrent_session_factory.session_context() as session:
                    if i % 3 == 0:
                        # Intentionally cause a failure
                        session.execute(text("SELECT * FROM nonexistent_table_xyz"))
                    else:
                        # Normal query
                        from db.models.requisition import Requisition
                        req = session.query(Requisition).filter(
                            Requisition.req_id == req_id
                        ).first()
                        assert req is not None
                        success_count += 1
                        
            except Exception:
                failure_count += 1
        
        # Should have expected successes despite failures
        assert success_count >= 6, f"Expected at least 6 successes, got {success_count}"
        assert failure_count >= 3, f"Expected at least 3 failures, got {failure_count}"


# =============================================================================
# RANDOM FAILURE INJECTION
# =============================================================================

class ChaosMonkey:
    """
    Injects random failures into operations.
    
    Simulates various failure scenarios:
    - Network timeouts
    - Query failures
    - Random delays
    """
    
    def __init__(self, failure_rate: float = 0.2):
        self.failure_rate = failure_rate
        self.failure_count = 0
        self.success_count = 0
        self._lock = threading.Lock()
    
    def maybe_fail(self):
        """Randomly raise an exception based on failure_rate."""
        if random.random() < self.failure_rate:
            with self._lock:
                self.failure_count += 1
            
            failure_type = random.choice(["timeout", "error", "delay"])
            
            if failure_type == "timeout":
                raise TimeoutError("Simulated timeout")
            elif failure_type == "error":
                raise OperationalError("Simulated error", None, None)
            else:
                # Long delay
                time.sleep(random.uniform(0.5, 1.0))
        
        with self._lock:
            self.success_count += 1
    
    def get_stats(self) -> Dict[str, int]:
        """Get failure/success statistics."""
        with self._lock:
            return {
                "failures": self.failure_count,
                "successes": self.success_count,
            }


class TestChaosFailureInjection:
    """Tests with random failure injection."""
    
    def test_workflow_resilience_with_random_failures(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Test workflow operations survive random failures.
        
        Injects random failures and verifies the system handles them gracefully.
        """
        # Create multiple requisitions
        for i in range(3):
            scenario = test_data_factory.create_complete_test_scenario(
                req_id=91010 + i,
                requisition_status="Active",
            )
        test_data_factory.session.commit()
        
        chaos = ChaosMonkey(failure_rate=0.3)  # 30% failure rate
        results = []
        results_lock = threading.Lock()
        
        def chaotic_operation(op_id: int):
            """Operation that may randomly fail."""
            from db.models.requisition import Requisition
            
            req_id = 91010 + (op_id % 3)
            
            try:
                with concurrent_session_factory.session_context() as session:
                    # Maybe fail before query
                    chaos.maybe_fail()
                    
                    req = session.query(Requisition).filter(
                        Requisition.req_id == req_id
                    ).first()
                    
                    # Maybe fail after query
                    chaos.maybe_fail()
                    
                    with results_lock:
                        results.append(("success", op_id, req_id))
                        
            except (TimeoutError, OperationalError) as e:
                with results_lock:
                    results.append(("chaos_failure", op_id, str(type(e).__name__)))
            except Exception as e:
                with results_lock:
                    results.append(("unexpected_error", op_id, str(e)))
        
        # Run many operations
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(chaotic_operation, i) for i in range(50)]
            for f in as_completed(futures, timeout=60):
                pass
        
        stats = chaos.get_stats()
        
        # Should have mix of successes and failures
        successes = [r for r in results if r[0] == "success"]
        chaos_failures = [r for r in results if r[0] == "chaos_failure"]
        unexpected = [r for r in results if r[0] == "unexpected_error"]
        
        print(f"\nChaos test results:")
        print(f"  Successes: {len(successes)}")
        print(f"  Chaos failures: {len(chaos_failures)}")
        print(f"  Unexpected errors: {len(unexpected)}")
        print(f"  ChaosMonkey stats: {stats}")
        
        # Some should succeed despite failures
        assert len(successes) > 0, "At least some operations should succeed"
        # No unexpected errors
        assert len(unexpected) == 0, f"Unexpected errors: {unexpected}"


# =============================================================================
# TIMEOUT AND DEADLOCK TESTS
# =============================================================================

class TestTimeoutHandling:
    """Tests for timeout and deadlock scenarios."""
    
    def test_lock_timeout_handling(
        self,
        pg_session_pair,
        test_data_factory,
    ):
        """
        Test handling of lock timeouts.
        
        One session holds a lock, another times out trying to acquire it.
        """
        # Create test data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=91020,
            requisition_status="Draft",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        session_holder, session_waiter = pg_session_pair
        
        from db.models.requisition import Requisition
        
        # Session 1 acquires lock
        req1 = session_holder.query(Requisition).filter(
            Requisition.req_id == req_id
        ).with_for_update().first()
        
        assert req1 is not None
        
        # Session 2 tries to acquire with NOWAIT (should fail immediately)
        lock_failed = False
        try:
            req2 = session_waiter.query(Requisition).filter(
                Requisition.req_id == req_id
            ).with_for_update(nowait=True).first()
            
            # Should not reach here
            pytest.fail("Expected lock timeout error")
            
        except OperationalError as e:
            # Expected: lock not available
            lock_failed = True
            assert "could not obtain lock" in str(e).lower() or "lock" in str(e).lower()
            # Rollback the failed transaction to clear the error state
            session_waiter.rollback()
        
        assert lock_failed, "Lock should have failed with NOWAIT"
        
        # Session 1 releases lock
        session_holder.rollback()
        
        # Now session 2 should be able to acquire
        req2 = session_waiter.query(Requisition).filter(
            Requisition.req_id == req_id
        ).with_for_update(nowait=True).first()
        
        assert req2 is not None
    
    def test_potential_deadlock_detection(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Test for potential deadlock scenarios.
        
        Creates a situation where deadlock could occur and verifies
        PostgreSQL's deadlock detection resolves it.
        """
        # Create two requisitions for cross-locking
        for i in range(2):
            scenario = test_data_factory.create_complete_test_scenario(
                req_id=91030 + i,
                requisition_status="Active",
            )
        test_data_factory.session.commit()
        
        req_id_a = 91030
        req_id_b = 91031
        
        barrier = threading.Barrier(2, timeout=10)
        results = []
        results_lock = threading.Lock()
        
        def thread_a():
            """Lock A then B."""
            from db.models.requisition import Requisition
            
            try:
                with concurrent_session_factory.session_context() as session:
                    # Lock A
                    session.execute(text(
                        f"SELECT * FROM requisitions WHERE req_id = {req_id_a} FOR UPDATE"
                    ))
                    
                    # Wait for thread B to lock B
                    barrier.wait()
                    
                    # Try to lock B (may deadlock)
                    session.execute(text(
                        f"SELECT * FROM requisitions WHERE req_id = {req_id_b} FOR UPDATE NOWAIT"
                    ))
                    
                    session.commit()
                    
                    with results_lock:
                        results.append(("thread_a", "success"))
                        
            except Exception as e:
                with results_lock:
                    results.append(("thread_a", f"error: {type(e).__name__}"))
        
        def thread_b():
            """Lock B then A."""
            from db.models.requisition import Requisition
            
            try:
                with concurrent_session_factory.session_context() as session:
                    # Lock B
                    session.execute(text(
                        f"SELECT * FROM requisitions WHERE req_id = {req_id_b} FOR UPDATE"
                    ))
                    
                    # Wait for thread A to lock A
                    barrier.wait()
                    
                    # Try to lock A (may deadlock)
                    session.execute(text(
                        f"SELECT * FROM requisitions WHERE req_id = {req_id_a} FOR UPDATE NOWAIT"
                    ))
                    
                    session.commit()
                    
                    with results_lock:
                        results.append(("thread_b", "success"))
                        
            except Exception as e:
                with results_lock:
                    results.append(("thread_b", f"error: {type(e).__name__}"))
        
        # Run both threads
        t1 = threading.Thread(target=thread_a)
        t2 = threading.Thread(target=thread_b)
        
        t1.start()
        t2.start()
        
        t1.join(timeout=10)
        t2.join(timeout=10)
        
        # With NOWAIT, either:
        # - One succeeds, one fails (typical case)
        # - Both fail (if perfectly synchronized - both got first lock, both fail on second)
        # The key is NO DEADLOCK occurred (threads completed, didn't hang)
        successes = [r for r in results if "success" in r[1]]
        errors = [r for r in results if "error" in r[1]]
        
        # Both threads should have completed (not hung in deadlock)
        assert len(results) == 2, f"Expected 2 results (no deadlock), got {len(results)}: {results}"
        
        # At least one error should occur (lock contention detected)
        assert len(errors) >= 1, f"Expected at least 1 error (lock contention), got {len(errors)}: {results}"
        
        # At most one can succeed
        assert len(successes) <= 1, f"Expected at most 1 success, got {len(successes)}: {results}"


# =============================================================================
# HIGH LOAD TESTS
# =============================================================================

class TestHighLoad:
    """Tests for system behavior under high load."""
    
    def test_rapid_fire_queries(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Test system stability under rapid query load.
        
        Fires many queries in quick succession.
        """
        # Create test data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=91040,
            num_items=5,
            requisition_status="Active",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        num_queries = 100
        results = []
        results_lock = threading.Lock()
        
        def rapid_query(query_id: int):
            """Execute a quick query."""
            from db.models.requisition import Requisition
            from db.models.requisition_item import RequisitionItem
            
            try:
                with concurrent_session_factory.session_context() as session:
                    # Mix of query types
                    if query_id % 3 == 0:
                        # Count query
                        count = session.query(RequisitionItem).filter(
                            RequisitionItem.req_id == req_id
                        ).count()
                        with results_lock:
                            results.append(("count", count))
                    elif query_id % 3 == 1:
                        # Single fetch
                        req = session.query(Requisition).filter(
                            Requisition.req_id == req_id
                        ).first()
                        with results_lock:
                            results.append(("fetch", req.overall_status if req else None))
                    else:
                        # List query
                        items = session.query(RequisitionItem).filter(
                            RequisitionItem.req_id == req_id
                        ).all()
                        with results_lock:
                            results.append(("list", len(items)))
                            
            except Exception as e:
                with results_lock:
                    results.append(("error", str(e)))
        
        # Fire all queries rapidly
        start_time = time.time()
        
        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(rapid_query, i) for i in range(num_queries)]
            for f in as_completed(futures, timeout=30):
                pass
        
        elapsed = time.time() - start_time
        
        # Analyze results
        counts = [r for r in results if r[0] == "count"]
        fetches = [r for r in results if r[0] == "fetch"]
        lists = [r for r in results if r[0] == "list"]
        errors = [r for r in results if r[0] == "error"]
        
        print(f"\nRapid fire test completed in {elapsed:.2f}s")
        print(f"  Queries: {num_queries}")
        print(f"  QPS: {num_queries / elapsed:.2f}")
        print(f"  Results: counts={len(counts)}, fetches={len(fetches)}, lists={len(lists)}")
        print(f"  Errors: {len(errors)}")
        
        # All should succeed
        assert len(errors) == 0, f"Errors occurred: {errors}"
        assert len(results) == num_queries
    
    def test_mixed_read_write_load(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Test system under mixed read/write workload.
        
        80% reads, 20% writes.
        """
        # Create test data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=91050,
            num_items=5,
            requisition_status="Active",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        num_operations = 50
        read_count = 0
        write_count = 0
        error_count = 0
        counter_lock = threading.Lock()
        
        def mixed_operation(op_id: int):
            """Perform read or write based on probability."""
            nonlocal read_count, write_count, error_count
            
            from db.models.requisition import Requisition
            
            is_write = random.random() < 0.2  # 20% writes
            
            try:
                with concurrent_session_factory.session_context() as session:
                    if is_write:
                        # Write operation with locking
                        req = session.query(Requisition).filter(
                            Requisition.req_id == req_id
                        ).with_for_update(nowait=True).first()
                        
                        if req:
                            req.project_name = f"Updated at {time.time()}"
                            req.version += 1
                            session.commit()
                            
                            with counter_lock:
                                write_count += 1
                    else:
                        # Read operation
                        req = session.query(Requisition).filter(
                            Requisition.req_id == req_id
                        ).first()
                        
                        with counter_lock:
                            read_count += 1
                            
            except OperationalError:
                # Lock contention is expected
                with counter_lock:
                    error_count += 1
            except Exception:
                with counter_lock:
                    error_count += 1
        
        # Run mixed workload
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(mixed_operation, i) for i in range(num_operations)]
            for f in as_completed(futures, timeout=30):
                pass
        
        print(f"\nMixed workload results:")
        print(f"  Reads: {read_count}")
        print(f"  Writes: {write_count}")
        print(f"  Lock conflicts: {error_count}")
        
        # Should have some successful reads and writes
        assert read_count > 0, "Should have some successful reads"
        assert write_count > 0 or error_count > 0, "Writes should succeed or have lock conflicts"
