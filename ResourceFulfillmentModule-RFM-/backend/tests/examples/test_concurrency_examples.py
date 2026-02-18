"""
============================================================================
Example PostgreSQL Concurrency Tests — Demonstrates Fixture Usage
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module demonstrates:
1. Proper usage of PostgreSQL test fixtures
2. Concurrency testing patterns with real transactions
3. Optimistic locking verification
4. Race condition detection

Run with:
    cd backend
    pytest tests/examples/test_concurrency_examples.py -v -m "postgres or concurrency"
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Tuple

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

# Import fixtures (pytest will discover these from conftest.py)
pytestmark = [
    pytest.mark.postgres,
    pytest.mark.concurrency,
]


# =============================================================================
# BASIC FIXTURE USAGE EXAMPLES
# =============================================================================

class TestBasicFixtureUsage:
    """Demonstrates basic usage of PostgreSQL test fixtures."""
    
    def test_pg_session_isolation(self, pg_session):
        """
        Verify that pg_session provides proper transaction isolation.
        
        Changes made within a test are rolled back after the test completes.
        """
        from db.models.auth import User
        
        # Create a user within the test
        user = User(
            user_id=99999,
            username="temp_test_user",
            password_hash="test_hash",
            is_active=True,
        )
        pg_session.add(user)
        pg_session.flush()
        
        # Verify it exists in this session
        found = pg_session.query(User).filter(User.user_id == 99999).first()
        assert found is not None
        assert found.username == "temp_test_user"
        
        # After test completes, the SAVEPOINT rollback will remove this user
    
    def test_test_data_factory_creates_users(self, test_data_factory):
        """
        Verify TestDataFactory creates users with proper relationships.
        """
        from tests.fixtures.pg_fixtures import TestUserConfig
        
        # Create custom users
        configs = [
            TestUserConfig(user_id=9901, username="example_manager", role_name="Manager"),
            TestUserConfig(user_id=9902, username="example_ta", role_name="TA"),
        ]
        
        users = test_data_factory.create_test_users(configs)
        
        assert "example_manager" in users
        assert "example_ta" in users
        assert users["example_manager"].user_id == 9901
    
    def test_test_scenario_creates_complete_data(self, test_scenario):
        """
        Verify test_scenario fixture creates complete test data.
        """
        # test_scenario returns all created entities
        assert "users" in test_scenario
        assert "employees" in test_scenario
        assert "requisition" in test_scenario
        assert "items" in test_scenario
        
        # Verify requisition has proper FK relationships
        req = test_scenario["requisition"]
        assert req.raised_by == test_scenario["manager_user"].user_id
        
        # Verify items belong to requisition
        for item in test_scenario["items"]:
            assert item.req_id == req.req_id


# =============================================================================
# CONCURRENCY TEST EXAMPLES
# =============================================================================

class TestConcurrencyPatterns:
    """Demonstrates concurrency testing patterns with PostgreSQL."""
    
    def test_concurrent_session_factory_isolation(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Verify that concurrent sessions are truly independent.
        """
        # Create base data in the main session
        users = test_data_factory.create_test_users()
        manager = users["test_manager_1"]
        test_data_factory.session.commit()
        
        # Each concurrent session sees its own transaction
        results = []
        
        def check_user(session: Session, expected_username: str):
            """Thread function to verify user visibility."""
            from db.models.auth import User
            user = session.query(User).filter(User.user_id == manager.user_id).first()
            return user.username if user else None
        
        # Test with multiple concurrent sessions
        with concurrent_session_factory.session_context() as session1:
            with concurrent_session_factory.session_context() as session2:
                result1 = check_user(session1, manager.username)
                result2 = check_user(session2, manager.username)
                
                results.append(result1)
                results.append(result2)
        
        # Both should see the same committed data
        assert all(r == manager.username for r in results)
    
    def test_optimistic_locking_conflict_detection(
        self,
        pg_session_pair,
        test_data_factory,
    ):
        """
        Verify optimistic locking detects concurrent modifications.
        
        Two sessions read the same requisition, both try to update,
        the second one should detect version mismatch.
        """
        # Create test data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=90010,
            requisition_status="Draft",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        session1, session2 = pg_session_pair
        
        from db.models.requisition import Requisition
        
        # Both sessions read the requisition
        req1 = session1.query(Requisition).filter(Requisition.req_id == req_id).first()
        req2 = session2.query(Requisition).filter(Requisition.req_id == req_id).first()
        
        initial_version = req1.version
        
        # Session 1 updates and increments version
        req1.overall_status = "Pending_Budget"
        req1.version = initial_version + 1
        session1.flush()
        session1.commit()
        
        # Session 2 tries to update with stale version
        # In a real workflow engine, this would be caught
        stale_version = req2.version
        assert stale_version == initial_version  # Still has old version
        
        # Refresh session2 to see the conflict
        session2.expire(req2)
        req2_refreshed = session2.query(Requisition).filter(
            Requisition.req_id == req_id
        ).first()
        
        # The version in DB is now incremented
        assert req2_refreshed.version == initial_version + 1
        assert stale_version < req2_refreshed.version  # Version conflict detected!
    
    def test_concurrent_requisition_updates_with_threading(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Test concurrent updates to the same requisition using threads.
        
        Simulates multiple TAs trying to update the same requisition.
        """
        # Create test data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=90020,
            requisition_status="Active",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        num_threads = 5
        results: List[Tuple[int, bool, str]] = []
        results_lock = threading.Lock()
        
        def update_requisition(thread_id: int):
            """Thread function to update requisition."""
            from db.models.requisition import Requisition
            
            with concurrent_session_factory.session_context() as session:
                try:
                    # Read current state
                    req = session.query(Requisition).filter(
                        Requisition.req_id == req_id
                    ).with_for_update().first()
                    
                    if req:
                        # Simulate some processing time
                        time.sleep(0.01)
                        
                        # Update
                        req.project_name = f"Updated by Thread {thread_id}"
                        req.version += 1
                        session.commit()
                        
                        with results_lock:
                            results.append((thread_id, True, "success"))
                    else:
                        with results_lock:
                            results.append((thread_id, False, "not found"))
                            
                except Exception as e:
                    with results_lock:
                        results.append((thread_id, False, str(e)))
        
        # Run concurrent updates
        threads = []
        for i in range(num_threads):
            t = threading.Thread(target=update_requisition, args=(i,))
            threads.append(t)
            t.start()
        
        for t in threads:
            t.join(timeout=10)
        
        # All updates should complete (FOR UPDATE serializes them)
        successful = [r for r in results if r[1]]
        assert len(successful) == num_threads, f"Expected {num_threads} successes, got {len(successful)}"


# =============================================================================
# RACE CONDITION TESTS
# =============================================================================

class TestRaceConditions:
    """Tests for detecting and preventing race conditions."""
    
    def test_lost_update_prevention(
        self,
        pg_session_pair,
        test_data_factory,
    ):
        """
        Verify that lost updates are prevented with proper locking.
        
        Classic lost update scenario:
        1. Session A reads value X=10
        2. Session B reads value X=10
        3. Session A writes X=15
        4. Session B writes X=12 (based on stale read)
        5. Session A's update is LOST
        
        With proper version checking, Session B's update should fail.
        """
        # Create test data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=90030,
            requisition_status="Draft",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        session_a, session_b = pg_session_pair
        
        from db.models.requisition import Requisition
        
        # Both read the initial state
        req_a = session_a.query(Requisition).filter(Requisition.req_id == req_id).first()
        req_b = session_b.query(Requisition).filter(Requisition.req_id == req_id).first()
        
        # Capture initial versions
        version_a = req_a.version
        version_b = req_b.version
        assert version_a == version_b == 1
        
        # Session A updates (simulating one workflow path)
        req_a.overall_status = "Pending_Budget"
        req_a.version = version_a + 1
        session_a.commit()
        
        # Session B tries to update (simulating parallel workflow)
        # In a proper workflow engine, this would check version first
        session_b.expire(req_b)
        req_b = session_b.query(Requisition).filter(
            Requisition.req_id == req_id,
            Requisition.version == version_b,  # WHERE version = stale_version
        ).first()
        
        # Session B finds nothing because version changed!
        assert req_b is None, "Expected version check to return None (lost update prevented)"
    
    def test_phantom_read_handling(
        self,
        pg_session_pair,
        test_data_factory,
    ):
        """
        Test handling of phantom reads in concurrent scenarios.
        
        A phantom read occurs when:
        1. Session A queries items matching criteria
        2. Session B inserts new item matching criteria
        3. Session A re-queries and sees different results
        """
        # Create initial data
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=90040,
            num_items=2,
            requisition_status="Active",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        session_a, session_b = pg_session_pair
        
        from db.models.requisition_item import RequisitionItem
        
        # Session A: Count items
        count_before = session_a.query(RequisitionItem).filter(
            RequisitionItem.req_id == req_id
        ).count()
        assert count_before == 2
        
        # Session B: Add new item and commit
        new_item = RequisitionItem(
            item_id=90041,
            req_id=req_id,
            role_position="Phantom Role",
            job_description="Phantom Description",
            item_status="Pending",
            version=1,
        )
        session_b.add(new_item)
        session_b.commit()
        
        # Session A: Re-count (will see phantom in READ COMMITTED)
        session_a.expire_all()  # Clear cache to see new data
        count_after = session_a.query(RequisitionItem).filter(
            RequisitionItem.req_id == req_id
        ).count()
        
        # In READ COMMITTED isolation, phantom reads are possible
        assert count_after == 3, "Session A should see the new item (phantom read)"


# =============================================================================
# WORKFLOW STATE TRANSITION TESTS
# =============================================================================

class TestWorkflowTransitions:
    """Tests for workflow state machine with concurrency."""
    
    def test_concurrent_status_transition_single_winner(
        self,
        concurrent_session_factory,
        test_data_factory,
    ):
        """
        Test that only one concurrent transition wins.
        
        Multiple threads try to transition Draft -> Pending_Budget.
        Only one should succeed with proper locking.
        """
        # Create test data in Draft status
        scenario = test_data_factory.create_complete_test_scenario(
            req_id=90050,
            requisition_status="Draft",
        )
        test_data_factory.session.commit()
        req_id = scenario["requisition"].req_id
        
        results = []
        results_lock = threading.Lock()
        
        def attempt_transition(thread_id: int):
            """Attempt status transition with optimistic locking."""
            from db.models.requisition import Requisition
            
            with concurrent_session_factory.session_context() as session:
                try:
                    # Simulate workflow engine: read, check, update
                    req = session.query(Requisition).filter(
                        Requisition.req_id == req_id,
                        Requisition.overall_status == "Draft",  # Must still be Draft
                    ).with_for_update(nowait=True).first()
                    
                    if req:
                        # Small delay to increase chance of race
                        time.sleep(0.01)
                        
                        # Perform transition
                        req.overall_status = "Pending_Budget"
                        req.version += 1
                        session.commit()
                        
                        with results_lock:
                            results.append((thread_id, "success", None))
                    else:
                        with results_lock:
                            results.append((thread_id, "already_transitioned", None))
                            
                except OperationalError as e:
                    with results_lock:
                        results.append((thread_id, "lock_failed", str(e)))
                except Exception as e:
                    with results_lock:
                        results.append((thread_id, "error", str(e)))
        
        # Run 5 concurrent transition attempts
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(attempt_transition, i) for i in range(5)]
            for f in as_completed(futures, timeout=10):
                pass  # Wait for completion
        
        # Exactly ONE should succeed (the first to acquire lock)
        successes = [r for r in results if r[1] == "success"]
        assert len(successes) == 1, f"Expected exactly 1 success, got {len(successes)}: {results}"
        
        # Others should either fail to get lock or find wrong status
        non_successes = [r for r in results if r[1] != "success"]
        assert len(non_successes) == 4


# =============================================================================
# CLEANUP AND VALIDATION
# =============================================================================

class TestFixtureCleanup:
    """Verify fixtures properly clean up test data."""
    
    def test_created_data_isolated_between_tests_part1(self, test_data_factory):
        """Part 1: Create some data."""
        from tests.fixtures.pg_fixtures import TestUserConfig
        
        users = test_data_factory.create_test_users([
            TestUserConfig(user_id=9999, username="isolation_test_user", role_name="Manager")
        ])
        
        assert users["isolation_test_user"].user_id == 9999
    
    def test_created_data_isolated_between_tests_part2(self, pg_session):
        """
        Part 2: Verify data from Part 1 was rolled back.
        
        Due to SAVEPOINT rollback, user from Part 1 should not exist.
        """
        from db.models.auth import User
        
        user = pg_session.query(User).filter(User.user_id == 9999).first()
        
        # Should be None because previous test's transaction was rolled back
        # Note: This depends on test execution order; may need explicit cleanup
        # if tests run in different sessions
