from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from api.projects import (
    create_project,
    get_project,
    list_projects,
    update_project_approval,
)
from db.base import Base
from db.models.audit_log import AuditLog
from db.models.auth import User
from schemas.projects import ProjectApprovalRequest, ProjectCreate


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
    admin = User(user_id=1001, username="admin_u", password_hash="x")
    manager_a = User(user_id=1002, username="manager_a", password_hash="x")
    manager_b = User(user_id=1003, username="manager_b", password_hash="x")
    hr = User(user_id=1004, username="hr_u", password_hash="x")
    db.add_all([admin, manager_a, manager_b, hr])
    db.commit()
    return {"admin": admin, "manager_a": manager_a, "manager_b": manager_b, "hr": hr}


def _create_sample_project(db: Session, admin: User, manager_user_id: int):
    payload = ProjectCreate(
        project_name="Project Alpha",
        client_name="Client X",
        project_status="Active",
        description="Sample",
        manager_user_id=manager_user_id,
        planned_start_date=date(2026, 3, 1),
        planned_end_date=date(2026, 6, 30),
    )
    return create_project(
        project=payload,
        db=db,
        current_user=admin,
        roles=["Admin"],
    )


def test_admin_create_sets_pending(db: Session, users: dict[str, User]):
    project = _create_sample_project(db, users["admin"], users["manager_a"].user_id)
    assert project.approval_status == "Pending"
    assert project.approved_by_manager_id is None
    assert project.approval_note is None


def test_assigned_manager_can_approve(db: Session, users: dict[str, User]):
    project = _create_sample_project(db, users["admin"], users["manager_a"].user_id)

    updated = update_project_approval(
        project_id=project.project_id,
        payload=ProjectApprovalRequest(approval_status="Approved"),
        db=db,
        current_user=users["manager_a"],
        roles=["Manager"],
    )

    assert updated["approval_status"] == "Approved"
    assert updated["approved_by_manager_id"] == users["manager_a"].user_id
    assert updated["can_current_user_approve"] is False


def test_assigned_manager_can_reject_with_note(db: Session, users: dict[str, User]):
    project = _create_sample_project(db, users["admin"], users["manager_a"].user_id)

    updated = update_project_approval(
        project_id=project.project_id,
        payload=ProjectApprovalRequest(
            approval_status="Rejected",
            approval_note="Budget assumptions need correction.",
        ),
        db=db,
        current_user=users["manager_a"],
        roles=["Manager"],
    )

    assert updated["approval_status"] == "Rejected"
    assert updated["approval_note"] == "Budget assumptions need correction."
    assert updated["approved_by_manager_id"] == users["manager_a"].user_id


def test_unassigned_manager_cannot_approve_returns_403(db: Session, users: dict[str, User]):
    project = _create_sample_project(db, users["admin"], users["manager_a"].user_id)

    with pytest.raises(HTTPException) as exc:
        update_project_approval(
            project_id=project.project_id,
            payload=ProjectApprovalRequest(approval_status="Approved"),
            db=db,
            current_user=users["manager_b"],
            roles=["Manager"],
        )

    assert exc.value.status_code == 403


def test_non_manager_role_cannot_approve_returns_403(db: Session, users: dict[str, User]):
    project = _create_sample_project(db, users["admin"], users["manager_a"].user_id)

    with pytest.raises(HTTPException) as exc:
        update_project_approval(
            project_id=project.project_id,
            payload=ProjectApprovalRequest(approval_status="Approved"),
            db=db,
            current_user=users["hr"],
            roles=["HR"],
        )

    assert exc.value.status_code == 403


def test_list_projects_includes_approval_fields_and_can_current_user_approve(
    db: Session, users: dict[str, User]
):
    project = _create_sample_project(db, users["admin"], users["manager_a"].user_id)

    result = list_projects(
        db=db,
        current_user=users["manager_a"],
        roles=["Manager"],
    )

    assert len(result) == 1
    row = result[0]
    assert row["project_id"] == project.project_id
    assert row["approval_status"] == "Pending"
    assert row["approved_by_manager_id"] is None
    assert row["approval_note"] is None
    assert row["can_current_user_approve"] is True


def test_get_project_includes_approval_fields(db: Session, users: dict[str, User]):
    project = _create_sample_project(db, users["admin"], users["manager_a"].user_id)

    result = get_project(
        project_id=project.project_id,
        db=db,
        current_user=users["manager_a"],
        roles=["Manager"],
    )

    assert result["approval_status"] == "Pending"
    assert result["approved_by_manager_id"] is None
    assert result["approved_at"] is None
    assert result["approval_note"] is None
    assert result["can_current_user_approve"] is True


def test_approval_action_creates_audit_log_entry(db: Session, users: dict[str, User]):
    project = _create_sample_project(db, users["admin"], users["manager_a"].user_id)

    update_project_approval(
        project_id=project.project_id,
        payload=ProjectApprovalRequest(
            approval_status="Rejected",
            approval_note="Timeline mismatch with plan.",
        ),
        db=db,
        current_user=users["manager_a"],
        roles=["Manager"],
    )

    audit = (
        db.query(AuditLog)
        .filter(
            AuditLog.entity_name == "Project",
            AuditLog.entity_id == str(project.project_id),
            AuditLog.action == "APPROVAL_UPDATE",
        )
        .order_by(AuditLog.audit_id.desc())
        .first()
    )
    assert audit is not None
    assert audit.performed_by == users["manager_a"].user_id
    assert '"approval_status": "Rejected"' in (audit.new_value or "")
