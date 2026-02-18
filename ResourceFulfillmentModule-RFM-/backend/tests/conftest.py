"""
Pytest configuration and shared fixtures for backend tests.
"""

import pytest
from unittest.mock import Mock, MagicMock
from sqlalchemy.orm import Session

# =============================================================================
# IMPORT POSTGRESQL FIXTURES
# =============================================================================
# These fixtures are imported from the fixtures package and made available
# to all tests via pytest's fixture discovery mechanism.

try:
    from tests.fixtures.pg_fixtures import (
        # Engine & Session fixtures
        pg_engine,
        pg_session_factory,
        pg_scoped_session,
        pg_session,
        pg_session_pair,
        concurrent_session_factory,
        # Test data fixtures
        test_data_factory,
        clean_test_data,
        test_users,
        test_employees,
        test_scenario,
        # Configuration
        POSTGRES_URL,
        SKIP_REASON,
        TestDataIDs,
    )
    PG_FIXTURES_AVAILABLE = True
except ImportError:
    PG_FIXTURES_AVAILABLE = False


# =============================================================================
# CHAOS TEST CLEANUP
# =============================================================================

@pytest.fixture(autouse=True)
def cleanup_chaos_test_data(request, pg_engine):
    """
    Auto-cleanup fixture for chaos and concurrency tests.
    
    These tests may commit data directly (not wrapped in savepoints) to test
    real concurrency behavior. This fixture cleans up both before and after 
    each test to ensure test isolation.
    
    Only runs for tests marked with 'chaos' or 'concurrency' markers,
    or tests that use concurrent_session_factory.
    """
    # Check if this test needs cleanup
    markers = [marker.name for marker in request.node.iter_markers()]
    needs_cleanup = 'chaos' in markers or 'concurrency' in markers or 'postgres' in markers
    
    if not needs_cleanup:
        yield
        return
    
    if not PG_FIXTURES_AVAILABLE or pg_engine is None:
        yield
        return
    
    def do_cleanup():
        """Clean up all test data from reserved ID ranges."""
        try:
            from sqlalchemy import text
            with pg_engine.connect() as conn:
                # Delete in FK dependency order
                conn.execute(text("DELETE FROM workflow_transition_audit WHERE entity_id >= 90000 OR performed_by >= 9000"))
                conn.execute(text("DELETE FROM requisition_items WHERE req_id >= 90000 OR item_id >= 90000"))
                conn.execute(text("DELETE FROM requisition_status_history WHERE req_id >= 90000"))
                conn.execute(text("DELETE FROM requisitions WHERE req_id >= 90000"))
                conn.execute(text("DELETE FROM employees WHERE emp_id LIKE 'TEST-EMP-%'"))
                conn.execute(text("DELETE FROM user_roles WHERE user_id >= 9000"))
                conn.execute(text("DELETE FROM users WHERE user_id >= 9000"))
                conn.commit()
        except Exception as e:
            # Don't fail test if cleanup fails (may already be clean)
            print(f"Test data cleanup warning: {e}")
    
    # Clean BEFORE test (in case previous test left data)
    do_cleanup()
    
    # Run the test
    yield
    
    # Clean AFTER test (for this test's data)
    do_cleanup()


@pytest.fixture
def mock_db():
    """
    Create a mock database session for unit tests.
    
    This fixture provides a mock Session object that can be used
    to test database operations without actually hitting the database.
    """
    db = Mock(spec=Session)
    
    # Setup chainable query methods
    db.query = Mock(return_value=db)
    db.filter = Mock(return_value=db)
    db.filter_by = Mock(return_value=db)
    db.with_for_update = Mock(return_value=db)
    db.options = Mock(return_value=db)
    db.join = Mock(return_value=db)
    db.outerjoin = Mock(return_value=db)
    db.order_by = Mock(return_value=db)
    db.limit = Mock(return_value=db)
    db.offset = Mock(return_value=db)
    db.distinct = Mock(return_value=db)
    
    # Setup terminal methods
    db.first = Mock(return_value=None)
    db.one = Mock()
    db.one_or_none = Mock(return_value=None)
    db.all = Mock(return_value=[])
    db.count = Mock(return_value=0)
    db.scalar = Mock(return_value=None)
    
    # Setup mutation methods
    db.add = Mock()
    db.add_all = Mock()
    db.delete = Mock()
    db.merge = Mock()
    db.flush = Mock()
    db.commit = Mock()
    db.rollback = Mock()
    db.refresh = Mock()
    db.expire = Mock()
    db.expire_all = Mock()
    db.expunge = Mock()
    db.expunge_all = Mock()
    
    # Setup context manager
    db.__enter__ = Mock(return_value=db)
    db.__exit__ = Mock(return_value=False)
    
    return db


@pytest.fixture
def mock_user():
    """Create a mock user object."""
    user = Mock()
    user.user_id = 1
    user.username = "testuser"
    user.is_active = True
    return user


@pytest.fixture
def mock_requisition():
    """Create a mock requisition object."""
    from services.requisition.workflow_matrix import RequisitionStatus
    
    req = Mock()
    req.req_id = 1
    req.overall_status = RequisitionStatus.DRAFT.value
    req.raised_by = 100
    req.assigned_ta = None
    req.budget_approved_by = None
    req.approved_by = None
    req.rejection_reason = None
    req.version = 1
    req.project_name = "Test Project"
    req.client_name = "Test Client"
    req.priority = "High"
    return req


@pytest.fixture
def mock_requisition_item():
    """Create a mock requisition item object."""
    from services.requisition.workflow_matrix import RequisitionItemStatus
    
    item = Mock()
    item.item_id = 1
    item.req_id = 1
    item.item_status = RequisitionItemStatus.PENDING.value
    item.assigned_ta = None
    item.assigned_emp_id = None
    item.role_position = "Software Engineer"
    item.job_description = "Development role"
    return item


@pytest.fixture
def mock_employee():
    """Create a mock employee object."""
    emp = Mock()
    emp.emp_id = "EMP-001"
    emp.first_name = "John"
    emp.last_name = "Doe"
    emp.email = "john.doe@example.com"
    return emp


# Pytest markers
def pytest_configure(config):
    """Configure custom pytest markers."""
    config.addinivalue_line(
        "markers", "unit: mark test as a unit test"
    )
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )
    config.addinivalue_line(
        "markers", "concurrency: mark test as concurrency test"
    )
    config.addinivalue_line(
        "markers", "postgres: mark test as requiring PostgreSQL"
    )
    config.addinivalue_line(
        "markers", "chaos: mark test as chaos/stress test"
    )


# =============================================================================
# WORKFLOW TEST FIXTURES
# =============================================================================

@pytest.fixture
def mock_workflow_context():
    """
    Provide mock workflow transition context for tests.
    
    This allows tests to bypass status protection when needed.
    """
    from services.requisition.status_protection import workflow_transition_context
    
    with workflow_transition_context():
        yield


# =============================================================================
# TEST DATABASE UTILITIES
# =============================================================================

class TestDatabaseHelper:
    """Helper class for setting up test databases."""
    
    @staticmethod
    def create_test_engine(database_url: str = "sqlite:///:memory:"):
        """Create a test database engine."""
        from sqlalchemy import create_engine, event
        from sqlalchemy.pool import StaticPool
        
        engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False} if "sqlite" in database_url else {},
            poolclass=StaticPool if "sqlite" in database_url else None,
        )
        
        if "sqlite" in database_url:
            @event.listens_for(engine, "connect")
            def set_sqlite_pragma(dbapi_connection, connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()
        
        return engine
    
    @staticmethod
    def create_all_tables(engine):
        """Create all database tables."""
        from db.base import Base
        Base.metadata.create_all(bind=engine)
    
    @staticmethod
    def drop_all_tables(engine):
        """Drop all database tables."""
        from db.base import Base
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_helper():
    """Provide TestDatabaseHelper instance."""
    return TestDatabaseHelper()
