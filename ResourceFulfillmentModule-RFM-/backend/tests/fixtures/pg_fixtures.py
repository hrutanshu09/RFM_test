"""
============================================================================
PostgreSQL Test Fixtures — Production-Grade Testing Infrastructure
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module provides production-grade pytest fixtures for PostgreSQL testing:
1. Real PostgreSQL engine with proper connection pooling
2. Transaction isolation using SAVEPOINTs
3. Concurrency-safe session factories
4. Complete test data creation helpers

USAGE:
    pytest tests/test_postgres_concurrency.py -v
    pytest tests/test_chaos.py -v

REQUIREMENTS:
    - PostgreSQL database configured in backend/.env
    - DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME environment variables
"""

import os
import pytest
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Callable, Any
from urllib.parse import quote_plus
import threading

from dotenv import load_dotenv
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker, scoped_session
from sqlalchemy.pool import QueuePool

# Load environment - go up from tests/fixtures to backend, then load .env
_backend_dir = Path(__file__).resolve().parent.parent.parent
load_dotenv(_backend_dir / ".env")


# =============================================================================
# DATABASE URL CONFIGURATION
# =============================================================================

def get_postgres_url() -> str:
    """
    Build PostgreSQL connection URL from environment variables.
    
    Returns:
        PostgreSQL connection string or empty string if not configured.
    """
    try:
        db_user = os.getenv("DB_USER")
        db_password = os.getenv("DB_PASSWORD")
        db_host = os.getenv("DB_HOST", "localhost")
        db_port = os.getenv("DB_PORT", "5432")
        db_name = os.getenv("DB_NAME")
        
        if not all([db_user, db_password, db_name]):
            return ""
        
        return (
            f"postgresql://{quote_plus(db_user)}:{quote_plus(db_password)}@"
            f"{db_host}:{db_port}/{db_name}"
        )
    except Exception:
        return ""


POSTGRES_URL = get_postgres_url()
SKIP_REASON = "PostgreSQL not configured (set DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME in .env)"


# =============================================================================
# TEST DATA CONFIGURATION
# =============================================================================

@dataclass
class TestUserConfig:
    """Configuration for a test user."""
    user_id: int
    username: str
    role_name: str
    password_hash: str = "test_hash_$2b$12$placeholder"  # bcrypt-like placeholder


@dataclass
class TestEmployeeConfig:
    """Configuration for a test employee."""
    emp_id: str
    full_name: str
    rbm_email: str
    emp_status: str = "Active"


@dataclass
class TestRequisitionConfig:
    """Configuration for a test requisition."""
    req_id: int
    raised_by: int
    overall_status: str = "Draft"
    version: int = 1
    project_name: str = "Test Project"
    client_name: str = "Test Client"
    priority: str = "Medium"


@dataclass
class TestRequisitionItemConfig:
    """Configuration for a test requisition item."""
    item_id: int
    req_id: int
    role_position: str
    job_description: str
    item_status: str = "Pending"
    version: int = 1
    assigned_ta: Optional[int] = None


# Default test configurations
DEFAULT_USERS = [
    TestUserConfig(user_id=9001, username="test_manager_1", role_name="Manager"),
    TestUserConfig(user_id=9002, username="test_hr_1", role_name="HR"),
    TestUserConfig(user_id=9003, username="test_ta_1", role_name="TA"),
    TestUserConfig(user_id=9004, username="test_admin_1", role_name="Admin"),
    TestUserConfig(user_id=9005, username="test_manager_2", role_name="Manager"),
    TestUserConfig(user_id=9006, username="test_hr_2", role_name="HR"),
    TestUserConfig(user_id=9007, username="test_ta_2", role_name="TA"),
]

DEFAULT_EMPLOYEES = [
    TestEmployeeConfig(emp_id="TEST-EMP-001", full_name="Test Employee One", rbm_email="test.emp1@rbm.test"),
    TestEmployeeConfig(emp_id="TEST-EMP-002", full_name="Test Employee Two", rbm_email="test.emp2@rbm.test"),
    TestEmployeeConfig(emp_id="TEST-EMP-003", full_name="Test Employee Three", rbm_email="test.emp3@rbm.test"),
]


# =============================================================================
# TEST DATA IDS (Reserved Range: 9000-9999)
# =============================================================================

class TestDataIDs:
    """
    Reserved ID ranges for test data.
    
    Using high IDs (9000+) to avoid conflicts with production data.
    All test data should use IDs from these ranges.
    """
    # Users: 9001-9099
    USER_START = 9001
    USER_END = 9099
    
    # Roles: 9001-9010
    ROLE_START = 9001
    ROLE_END = 9010
    
    # Company Roles: 9001-9010
    COMPANY_ROLE_START = 9001
    COMPANY_ROLE_END = 9010
    
    # Employees: TEST-EMP-001 to TEST-EMP-099
    EMPLOYEE_PREFIX = "TEST-EMP-"
    
    # Requisitions: 90001-99999
    REQUISITION_START = 90001
    REQUISITION_END = 99999
    
    # Requisition Items: 90001-99999
    ITEM_START = 90001
    ITEM_END = 99999


# =============================================================================
# ENGINE AND SESSION FIXTURES
# =============================================================================

@pytest.fixture(scope="session")
def pg_engine():
    """
    Create PostgreSQL engine (session-scoped).
    
    The engine is shared across all tests in the session for efficiency.
    Connection pooling is configured for concurrent access.
    """
    if not POSTGRES_URL:
        pytest.skip(SKIP_REASON)
    
    engine = create_engine(
        POSTGRES_URL,
        poolclass=QueuePool,
        pool_size=20,
        max_overflow=30,
        pool_pre_ping=True,
        pool_recycle=3600,
        isolation_level="READ COMMITTED",
    )
    
    # Verify connection
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT version()"))
            version = result.scalar()
            print(f"\n[PostgreSQL Test Engine] Connected to: {version[:50]}...")
    except Exception as e:
        pytest.skip(f"Cannot connect to PostgreSQL: {e}")
    
    yield engine
    
    # Cleanup on session end
    engine.dispose()


@pytest.fixture(scope="session")
def pg_session_factory(pg_engine):
    """
    Create session factory (session-scoped).
    
    This factory is used to create new sessions for each test.
    Sessions are NOT shared between threads.
    """
    return sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=pg_engine,
        expire_on_commit=False,  # Prevent lazy loading issues after commit
    )


@pytest.fixture(scope="session")
def pg_scoped_session(pg_engine):
    """
    Create thread-local scoped session (session-scoped).
    
    Use this for concurrent tests where each thread needs its own session.
    """
    factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=pg_engine,
        expire_on_commit=False,
    )
    return scoped_session(factory)


@pytest.fixture
def pg_session(pg_session_factory):
    """
    Create isolated session with transaction rollback (function-scoped).
    
    Each test gets a fresh session with a SAVEPOINT. After the test,
    the SAVEPOINT is rolled back, ensuring complete isolation.
    
    Note: If the test commits, the savepoint/transaction is already closed,
    so we handle that gracefully in cleanup.
    """
    session = pg_session_factory()
    
    # Start a transaction
    session.begin()
    
    # Create a savepoint for rollback
    savepoint = session.begin_nested()
    
    yield session
    
    # Cleanup - handle cases where test committed or rolled back
    try:
        if savepoint.is_active:
            savepoint.rollback()
    except Exception:
        pass
    
    try:
        if session.is_active:
            session.rollback()
    except Exception:
        pass
    
    session.close()


@pytest.fixture
def pg_session_pair(pg_session_factory):
    """
    Create two isolated sessions for testing concurrent operations.
    
    Both sessions share the same visibility rules but have separate
    transactions for true concurrency testing.
    """
    session1 = pg_session_factory()
    session2 = pg_session_factory()
    
    yield session1, session2
    
    # Cleanup
    session1.rollback()
    session1.close()
    session2.rollback()
    session2.close()


# =============================================================================
# CONCURRENT SESSION FACTORY
# =============================================================================

class ConcurrentSessionFactory:
    """
    Factory for creating isolated sessions in concurrent tests.
    
    Each session is completely independent with its own transaction.
    Provides context manager for automatic cleanup.
    """
    
    def __init__(self, session_factory):
        self.session_factory = session_factory
        self._sessions: List[Session] = []
        self._lock = threading.Lock()
    
    def create_session(self) -> Session:
        """Create a new isolated session."""
        session = self.session_factory()
        with self._lock:
            self._sessions.append(session)
        return session
    
    @contextmanager
    def session_context(self):
        """
        Context manager for session lifecycle.
        
        Usage:
            with factory.session_context() as db:
                # use db
            # session automatically cleaned up
        """
        session = self.create_session()
        try:
            yield session
        except Exception:
            session.rollback()
            raise
        finally:
            session.rollback()
            session.close()
            with self._lock:
                if session in self._sessions:
                    self._sessions.remove(session)
    
    def cleanup_all(self):
        """Rollback and close all sessions."""
        with self._lock:
            for session in self._sessions:
                try:
                    session.rollback()
                    session.close()
                except Exception:
                    pass
            self._sessions.clear()


@pytest.fixture
def concurrent_session_factory(pg_session_factory):
    """
    Provide ConcurrentSessionFactory for multi-threaded tests.
    
    Automatically cleans up all sessions after the test.
    """
    factory = ConcurrentSessionFactory(pg_session_factory)
    yield factory
    factory.cleanup_all()


# =============================================================================
# TEST DATA CREATION HELPERS
# =============================================================================

class TestDataFactory:
    """
    Factory for creating test data with proper foreign key relationships.
    
    All created data uses reserved ID ranges to avoid conflicts.
    Data can be easily cleaned up using cleanup_test_data().
    """
    
    def __init__(self, session: Session):
        self.session = session
        self._created_entities: Dict[str, List[Any]] = {
            "users": [],
            "roles": [],
            "user_roles": [],
            "employees": [],
            "company_roles": [],
            "requisitions": [],
            "requisition_items": [],
        }
    
    # -------------------------------------------------------------------------
    # ROLE CREATION
    # -------------------------------------------------------------------------
    
    def create_roles(self) -> Dict[str, int]:
        """
        Create system roles if they don't exist.
        
        Returns:
            Dict mapping role_name to role_id
        """
        from db.models.auth import Role
        
        role_names = ["Manager", "HR", "TA", "Admin"]
        role_map = {}
        
        for idx, role_name in enumerate(role_names, start=TestDataIDs.ROLE_START):
            # Check if role exists
            existing = self.session.query(Role).filter(Role.role_name == role_name).first()
            
            if existing:
                role_map[role_name] = existing.role_id
            else:
                role = Role(role_id=idx, role_name=role_name)
                self.session.add(role)
                self._created_entities["roles"].append(role)
                role_map[role_name] = idx
        
        self.session.flush()
        return role_map
    
    def create_company_roles(self) -> Dict[str, int]:
        """
        Create company roles for employee assignments.
        
        Returns:
            Dict mapping role_name to role_id
        """
        from db.models.company_role import CompanyRole
        
        role_names = ["Software Engineer", "Project Manager", "QA Engineer", "DevOps"]
        role_map = {}
        
        for idx, role_name in enumerate(role_names, start=TestDataIDs.COMPANY_ROLE_START):
            existing = self.session.query(CompanyRole).filter(CompanyRole.role_name == role_name).first()
            
            if existing:
                role_map[role_name] = existing.role_id
            else:
                role = CompanyRole(role_id=idx, role_name=role_name)
                self.session.add(role)
                self._created_entities["company_roles"].append(role)
                role_map[role_name] = idx
        
        self.session.flush()
        return role_map
    
    # -------------------------------------------------------------------------
    # USER CREATION
    # -------------------------------------------------------------------------
    
    def create_user(
        self,
        user_id: int,
        username: str,
        role_name: str,
        password_hash: str = "test_hash_placeholder",
    ) -> "User":
        """
        Create a user with the specified role.
        
        Args:
            user_id: Unique user ID (use TestDataIDs range)
            username: Unique username
            role_name: Role to assign (Manager, HR, TA, Admin)
            password_hash: Password hash (default: placeholder)
            
        Returns:
            Created User object
        """
        from db.models.auth import User, Role, UserRole
        
        # Create user
        user = User(
            user_id=user_id,
            username=username,
            password_hash=password_hash,
            is_active=True,
        )
        self.session.add(user)
        self._created_entities["users"].append(user)
        self.session.flush()
        
        # Find role
        role = self.session.query(Role).filter(Role.role_name == role_name).first()
        if role:
            user_role = UserRole(user_id=user_id, role_id=role.role_id)
            self.session.add(user_role)
            self._created_entities["user_roles"].append(user_role)
            self.session.flush()
        
        return user
    
    def create_test_users(
        self,
        configs: Optional[List[TestUserConfig]] = None
    ) -> Dict[str, "User"]:
        """
        Create multiple test users.
        
        Args:
            configs: List of user configurations (default: DEFAULT_USERS)
            
        Returns:
            Dict mapping username to User object
        """
        if configs is None:
            configs = DEFAULT_USERS
        
        # Ensure roles exist
        self.create_roles()
        
        users = {}
        for config in configs:
            # Check if user already exists
            from db.models.auth import User
            existing = self.session.query(User).filter(User.user_id == config.user_id).first()
            
            if existing:
                users[config.username] = existing
            else:
                user = self.create_user(
                    user_id=config.user_id,
                    username=config.username,
                    role_name=config.role_name,
                    password_hash=config.password_hash,
                )
                users[config.username] = user
        
        return users
    
    # -------------------------------------------------------------------------
    # EMPLOYEE CREATION
    # -------------------------------------------------------------------------
    
    def create_employee(
        self,
        emp_id: str,
        full_name: str,
        rbm_email: str,
        emp_status: str = "Active",
        company_role_id: Optional[int] = None,
    ) -> "Employee":
        """
        Create an employee.
        
        Args:
            emp_id: Unique employee ID (e.g., "TEST-EMP-001")
            full_name: Employee full name
            rbm_email: Unique email address
            emp_status: Status (Active, Onboarding, On Leave, Exited)
            company_role_id: Optional company role FK
            
        Returns:
            Created Employee object
        """
        from db.models.employee import Employee
        
        employee = Employee(
            emp_id=emp_id,
            full_name=full_name,
            rbm_email=rbm_email,
            emp_status=emp_status,
            company_role_id=company_role_id,
        )
        self.session.add(employee)
        self._created_entities["employees"].append(employee)
        self.session.flush()
        
        return employee
    
    def create_test_employees(
        self,
        configs: Optional[List[TestEmployeeConfig]] = None
    ) -> Dict[str, "Employee"]:
        """
        Create multiple test employees.
        
        Args:
            configs: List of employee configurations (default: DEFAULT_EMPLOYEES)
            
        Returns:
            Dict mapping emp_id to Employee object
        """
        if configs is None:
            configs = DEFAULT_EMPLOYEES
        
        employees = {}
        for config in configs:
            from db.models.employee import Employee
            existing = self.session.query(Employee).filter(Employee.emp_id == config.emp_id).first()
            
            if existing:
                employees[config.emp_id] = existing
            else:
                employee = self.create_employee(
                    emp_id=config.emp_id,
                    full_name=config.full_name,
                    rbm_email=config.rbm_email,
                    emp_status=config.emp_status,
                )
                employees[config.emp_id] = employee
        
        return employees
    
    # -------------------------------------------------------------------------
    # REQUISITION CREATION
    # -------------------------------------------------------------------------
    
    def create_requisition(
        self,
        req_id: int,
        raised_by: int,
        overall_status: str = "Draft",
        version: int = 1,
        project_name: str = "Test Project",
        client_name: str = "Test Client",
        priority: str = "Medium",
        assigned_ta: Optional[int] = None,
    ) -> "Requisition":
        """
        Create a requisition with proper foreign keys.
        
        Args:
            req_id: Unique requisition ID (use TestDataIDs range)
            raised_by: User ID who raised the requisition
            overall_status: Initial status (Draft, Pending_Budget, etc.)
            version: Optimistic lock version
            project_name: Project name
            client_name: Client name
            priority: Priority (High, Medium, Low)
            assigned_ta: Optional TA user ID
            
        Returns:
            Created Requisition object
        """
        from db.models.requisition import Requisition
        
        requisition = Requisition(
            req_id=req_id,
            raised_by=raised_by,
            overall_status=overall_status,
            version=version,
            project_name=project_name,
            client_name=client_name,
            priority=priority,
            assigned_ta=assigned_ta,
        )
        self.session.add(requisition)
        self._created_entities["requisitions"].append(requisition)
        self.session.flush()
        
        return requisition
    
    # -------------------------------------------------------------------------
    # REQUISITION ITEM CREATION
    # -------------------------------------------------------------------------
    
    def create_requisition_item(
        self,
        item_id: int,
        req_id: int,
        role_position: str,
        job_description: str,
        item_status: str = "Pending",
        version: int = 1,
        assigned_ta: Optional[int] = None,
        assigned_emp_id: Optional[str] = None,
    ) -> "RequisitionItem":
        """
        Create a requisition item with proper foreign keys.
        
        Args:
            item_id: Unique item ID (use TestDataIDs range)
            req_id: Parent requisition ID
            role_position: Position title
            job_description: Job description
            item_status: Initial status (Pending, Sourcing, etc.)
            version: Optimistic lock version
            assigned_ta: Optional TA user ID
            assigned_emp_id: Optional assigned employee ID
            
        Returns:
            Created RequisitionItem object
        """
        from db.models.requisition_item import RequisitionItem
        
        item = RequisitionItem(
            item_id=item_id,
            req_id=req_id,
            role_position=role_position,
            job_description=job_description,
            item_status=item_status,
            version=version,
            assigned_ta=assigned_ta,
            assigned_emp_id=assigned_emp_id,
        )
        self.session.add(item)
        self._created_entities["requisition_items"].append(item)
        self.session.flush()
        
        return item
    
    # -------------------------------------------------------------------------
    # COMPOSITE DATA CREATION
    # -------------------------------------------------------------------------
    
    def create_complete_test_scenario(
        self,
        req_id: int,
        num_items: int = 3,
        requisition_status: str = "Active",
        item_status: str = "Pending",
    ) -> Dict[str, Any]:
        """
        Create a complete test scenario with all required entities.
        
        Creates:
        - System roles (if not exist)
        - Test users (Manager, HR, TA)
        - Test employees
        - Requisition with items
        
        Args:
            req_id: Base requisition ID
            num_items: Number of items to create
            requisition_status: Initial requisition status
            item_status: Initial item status
            
        Returns:
            Dict with all created entities
        """
        # Create base data
        roles = self.create_roles()
        users = self.create_test_users()
        employees = self.create_test_employees()
        
        # Get a manager user for raised_by
        manager_user = users["test_manager_1"]
        ta_user = users["test_ta_1"]
        
        # Create requisition
        requisition = self.create_requisition(
            req_id=req_id,
            raised_by=manager_user.user_id,
            overall_status=requisition_status,
            assigned_ta=ta_user.user_id if requisition_status in ["Active", "Fulfilled"] else None,
        )
        
        # Create items
        items = []
        for i in range(num_items):
            item = self.create_requisition_item(
                item_id=req_id * 100 + i + 1,  # e.g., 9000101, 9000102, ...
                req_id=req_id,
                role_position=f"Test Role {i + 1}",
                job_description=f"Test job description for role {i + 1}",
                item_status=item_status,
                assigned_ta=ta_user.user_id if item_status != "Pending" else None,
            )
            items.append(item)
        
        self.session.commit()
        
        return {
            "roles": roles,
            "users": users,
            "employees": employees,
            "requisition": requisition,
            "items": items,
            "manager_user": manager_user,
            "ta_user": ta_user,
            "hr_user": users["test_hr_1"],
        }
    
    # -------------------------------------------------------------------------
    # CLEANUP
    # -------------------------------------------------------------------------
    
    def cleanup(self):
        """
        Remove all entities created by this factory.
        
        Deletes in reverse dependency order to avoid FK violations.
        """
        try:
            # Delete in reverse order of dependencies
            for item in self._created_entities["requisition_items"]:
                self.session.delete(item)
            
            for req in self._created_entities["requisitions"]:
                self.session.delete(req)
            
            for emp in self._created_entities["employees"]:
                self.session.delete(emp)
            
            for user_role in self._created_entities["user_roles"]:
                self.session.delete(user_role)
            
            for user in self._created_entities["users"]:
                self.session.delete(user)
            
            # Note: Roles and Company Roles are typically kept
            
            self.session.flush()
        except Exception:
            self.session.rollback()
            raise


@pytest.fixture
def test_data_factory(pg_session) -> TestDataFactory:
    """
    Provide TestDataFactory with automatic cleanup.
    
    Creates factory bound to the test session.
    Data is automatically cleaned up after the test.
    """
    factory = TestDataFactory(pg_session)
    yield factory
    # Cleanup happens via session rollback in pg_session fixture


# =============================================================================
# SQL-BASED CLEANUP (For shared data)
# =============================================================================

def cleanup_test_data(session: Session):
    """
    Clean up all test data using SQL DELETE.
    
    Uses reserved ID ranges to identify test data.
    Safe to run in any order due to CASCADE deletes where configured.
    """
    try:
        # Delete in dependency order
        session.execute(text("""
            DELETE FROM workflow_transition_audit 
            WHERE entity_id >= 90000 OR performed_by >= 9000
        """))
        
        session.execute(text("""
            DELETE FROM requisition_status_history 
            WHERE req_id >= 90000
        """))
        
        session.execute(text("""
            DELETE FROM requisition_items 
            WHERE req_id >= 90000 OR item_id >= 90000
        """))
        
        session.execute(text("""
            DELETE FROM requisitions 
            WHERE req_id >= 90000
        """))
        
        session.execute(text("""
            DELETE FROM employees 
            WHERE emp_id LIKE 'TEST-EMP-%'
        """))
        
        session.execute(text("""
            DELETE FROM user_roles 
            WHERE user_id >= 9000
        """))
        
        session.execute(text("""
            DELETE FROM users 
            WHERE user_id >= 9000
        """))
        
        session.commit()
    except Exception:
        session.rollback()
        raise


@pytest.fixture
def clean_test_data(pg_session):
    """
    Ensure test data is cleaned before and after each test.
    
    Uses SQL DELETE for reliable cleanup.
    """
    cleanup_test_data(pg_session)
    yield
    cleanup_test_data(pg_session)


# =============================================================================
# CONVENIENCE FIXTURES
# =============================================================================

@pytest.fixture
def test_users(test_data_factory) -> Dict[str, Any]:
    """Create and return default test users."""
    return test_data_factory.create_test_users()


@pytest.fixture
def test_employees(test_data_factory) -> Dict[str, Any]:
    """Create and return default test employees."""
    return test_data_factory.create_test_employees()


@pytest.fixture
def test_scenario(test_data_factory) -> Dict[str, Any]:
    """
    Create complete test scenario with all required entities.
    
    Returns dict with:
    - users: Dict of test users
    - employees: Dict of test employees
    - requisition: Test requisition in ACTIVE state
    - items: List of requisition items
    - manager_user, ta_user, hr_user: Convenience references
    """
    return test_data_factory.create_complete_test_scenario(
        req_id=90001,
        num_items=3,
        requisition_status="Active",
        item_status="Pending",
    )


# =============================================================================
# MODULE EXPORTS
# =============================================================================

__all__ = [
    # Configuration
    "POSTGRES_URL",
    "SKIP_REASON",
    "TestDataIDs",
    "TestUserConfig",
    "TestEmployeeConfig",
    "TestRequisitionConfig",
    "TestRequisitionItemConfig",
    "DEFAULT_USERS",
    "DEFAULT_EMPLOYEES",
    # Fixtures (via pytest)
    "pg_engine",
    "pg_session_factory",
    "pg_scoped_session",
    "pg_session",
    "pg_session_pair",
    "concurrent_session_factory",
    "test_data_factory",
    "clean_test_data",
    "test_users",
    "test_employees",
    "test_scenario",
    # Classes
    "ConcurrentSessionFactory",
    "TestDataFactory",
    # Functions
    "get_postgres_url",
    "cleanup_test_data",
]
