from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from api.projects import (
    assign_employee_to_project,
    create_project,
    recommend_employees_by_skill,
    search_employees_by_skill,
)
from db.base import Base
from db.models.auth import User
from db.models.employee import Employee
from db.models.employee_skill import EmployeeSkill
from db.models.projects import EmployeeProjectAssignment
from db.models.skill import Skill
from schemas.projects import (
    EmployeeProjectAssignmentCreate,
    ProjectCreate,
    SkillRecommendationRequest,
)


@pytest.fixture(scope="function")
def db() -> Session:
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
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = testing_session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def users(db: Session) -> dict[str, User]:
    admin = User(user_id=2001, username="admin_skill", password_hash="x")
    hr = User(user_id=2002, username="hr_skill", password_hash="x")
    employee_role_user = User(user_id=2003, username="employee_skill", password_hash="x")
    db.add_all([admin, hr, employee_role_user])
    db.commit()
    return {"admin": admin, "hr": hr, "employee": employee_role_user}


def _seed_employees_and_skills(db: Session) -> None:
    db.add_all(
        [
            Employee(emp_id="RBM-1001", full_name="Alice Python", rbm_email="alice@example.com", emp_status="Active"),
            Employee(emp_id="RBM-1002", full_name="Bob React", rbm_email="bob@example.com", emp_status="Active"),
            Employee(emp_id="RBM-1003", full_name="Cara Fullstack", rbm_email="cara@example.com", emp_status="Active"),
        ]
    )
    db.add_all(
        [
            Skill(skill_id=301, skill_name="Python", normalized_name="python"),
            Skill(skill_id=302, skill_name="React", normalized_name="react"),
            Skill(skill_id=303, skill_name="React Native", normalized_name="react native"),
            Skill(skill_id=304, skill_name="FastAPI", normalized_name="fastapi"),
        ]
    )
    db.add_all(
        [
            EmployeeSkill(emp_id="RBM-1001", skill_id=301),
            EmployeeSkill(emp_id="RBM-1001", skill_id=304),
            EmployeeSkill(emp_id="RBM-1002", skill_id=302),
            EmployeeSkill(emp_id="RBM-1003", skill_id=303),
        ]
    )
    db.commit()


def _create_project(db: Session, admin: User, name: str) -> int:
    project = create_project(
        project=ProjectCreate(
            project_name=name,
            client_name="Client",
            project_status="Active",
            description="Skill matching test",
        ),
        db=db,
        current_user=admin,
        roles=["Admin"],
    )
    return project.project_id


def test_skill_search_returns_exact_match_and_status(db: Session, users: dict[str, User]):
    _seed_employees_and_skills(db)
    project_id = _create_project(db, users["admin"], "Search Project")

    db.add(
        EmployeeProjectAssignment(
            emp_id="RBM-1002",
            project_id=project_id,
            allocation_pct=Decimal("50"),
            start_date=date(2026, 3, 1),
            status="Active",
            is_billable=False,
            timesheet_required=True,
            approval_status="Approved",
        )
    )
    db.commit()

    response = search_employees_by_skill(
        project_id=project_id,
        query="React",
        limit=10,
        db=db,
        current_user=users["hr"],
        roles=["HR"],
    )

    assert len(response.results) >= 1
    bob = next((row for row in response.results if row.emp_id == "RBM-1002"), None)
    assert bob is not None
    assert "React" in bob.matched_skills
    assert bob.match_type == "exact"
    assert bob.status == "Already allocated to this project"


def test_skill_search_no_match_returns_empty(db: Session, users: dict[str, User]):
    _seed_employees_and_skills(db)
    project_id = _create_project(db, users["admin"], "No Match Project")

    response = search_employees_by_skill(
        project_id=project_id,
        query="Cobol",
        limit=10,
        db=db,
        current_user=users["hr"],
        roles=["HR"],
    )
    assert response.results == []


def test_recommendation_excludes_same_project_assignments_by_default(db: Session, users: dict[str, User]):
    _seed_employees_and_skills(db)
    project_id = _create_project(db, users["admin"], "Recommendation Project")
    other_project_id = _create_project(db, users["admin"], "Other Project")

    db.add_all(
        [
            EmployeeProjectAssignment(
                emp_id="RBM-1002",
                project_id=project_id,
                allocation_pct=Decimal("60"),
                start_date=date(2026, 3, 1),
                status="Active",
                is_billable=False,
                timesheet_required=True,
                approval_status="Approved",
            ),
            EmployeeProjectAssignment(
                emp_id="RBM-1001",
                project_id=other_project_id,
                allocation_pct=Decimal("40"),
                start_date=date(2026, 3, 1),
                status="Active",
                is_billable=False,
                timesheet_required=True,
                approval_status="Approved",
            ),
        ]
    )
    db.commit()

    response = recommend_employees_by_skill(
        project_id=project_id,
        payload=SkillRecommendationRequest(
            requested_skills=["React", "Python"],
            required_count=3,
        ),
        db=db,
        current_user=users["hr"],
        roles=["HR"],
    )

    recommended_emp_ids = [row.emp_id for row in response.results]
    assert "RBM-1002" not in recommended_emp_ids
    assert "RBM-1001" in recommended_emp_ids


def test_skill_endpoints_require_assignment_permissions(db: Session, users: dict[str, User]):
    _seed_employees_and_skills(db)
    project_id = _create_project(db, users["admin"], "Permission Project")

    with pytest.raises(HTTPException) as exc:
        search_employees_by_skill(
            project_id=project_id,
            query="Python",
            limit=10,
            db=db,
            current_user=users["employee"],
            roles=["Employee"],
        )

    assert exc.value.status_code == 403


def test_duplicate_same_project_assignment_is_blocked(db: Session, users: dict[str, User]):
    _seed_employees_and_skills(db)
    project_id = _create_project(db, users["admin"], "Duplicate Guard Project")

    assignment_payload = EmployeeProjectAssignmentCreate(
        emp_id="RBM-1001",
        project_id=project_id,
        role="Backend Engineer",
        allocation_pct=Decimal("100"),
        start_date=date(2026, 3, 1),
        status="Active",
        is_billable=False,
        timesheet_required=True,
        send_for_approval=False,
    )

    assign_employee_to_project(
        assignment=assignment_payload,
        db=db,
        current_user=users["hr"],
        roles=["HR"],
    )

    with pytest.raises(HTTPException) as exc:
        assign_employee_to_project(
            assignment=assignment_payload,
            db=db,
            current_user=users["hr"],
            roles=["HR"],
        )

    assert exc.value.status_code == 409
