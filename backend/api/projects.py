from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import sqlalchemy as sa
from typing import List
import json
from datetime import datetime, timezone

from db.session import get_db
from db.models.projects import Project, ProjectManager, ProjectTimeline, EmployeeProjectAssignment
from db.models.audit_log import AuditLog
from schemas.projects import (
    ProjectCreate, ProjectUpdate, ProjectResponse,
    ProjectApprovalRequest,
    ProjectManagerCreate, ProjectManagerUpdate, ProjectManagerResponse,
    ProjectTimelineCreate, ProjectTimelineUpdate, ProjectTimelineResponse,
    EmployeeProjectAssignmentCreate, EmployeeProjectAssignmentUpdate, EmployeeProjectAssignmentResponse,
    AssignmentApprovalRequest,
)
from utils.dependencies import get_current_user, get_current_user_roles
from db.models.auth import User
from db.models.auth import User as AuthUser # Required for join
router = APIRouter(prefix="/projects", tags=["projects"])

FULL_ACCESS_ROLES = {"admin", "owner"}
ASSIGNMENT_WRITE_ROLES = {"admin", "owner", "hr", "ta", "manager", "pm"}


def _normalized_roles(roles: List[str]) -> set[str]:
    return {r.lower() for r in roles}


def _has_full_access(roles: List[str]) -> bool:
    return bool(_normalized_roles(roles) & FULL_ACCESS_ROLES)


def _can_write_assignments(roles: List[str]) -> bool:
    normalized = _normalized_roles(roles)
    return bool(normalized & ASSIGNMENT_WRITE_ROLES)


def _assert_full_access(roles: List[str]) -> None:
    if not _has_full_access(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Admin or Owner role required.",
        )


def _is_manager_role(roles: List[str]) -> bool:
    return "manager" in _normalized_roles(roles)


def _is_manager_assigned_to_project(db: Session, project_id: int, user_id: int) -> bool:
    return (
        db.query(ProjectManager.id)
        .filter(
            ProjectManager.project_id == project_id,
            ProjectManager.manager_user_id == user_id,
            ProjectManager.is_active == True,
        )
        .first()
        is not None
    )


def _build_project_response_dict(
    project: Project,
    manager_name: str | None,
    manager_user_id: int | None,
    planned_start_date,
    planned_end_date,
    actual_start_date,
    actual_end_date,
    can_current_user_approve: bool = False,
) -> dict:
    project_dict = {c.name: getattr(project, c.name) for c in project.__table__.columns}
    project_dict["manager_name"] = manager_name
    project_dict["manager_user_id"] = manager_user_id
    project_dict["planned_start_date"] = planned_start_date
    project_dict["planned_end_date"] = planned_end_date
    project_dict["actual_start_date"] = actual_start_date
    project_dict["actual_end_date"] = actual_end_date
    project_dict["can_current_user_approve"] = can_current_user_approve
    return project_dict


def _build_assignment_response_dict(
    assignment: EmployeeProjectAssignment,
    can_current_user_approve: bool = False,
) -> dict:
    assignment_dict = {c.name: getattr(assignment, c.name) for c in assignment.__table__.columns}
    assignment_dict["can_current_user_approve"] = can_current_user_approve
    return assignment_dict


def log_audit(db: Session, user_id: int, action: str, entity_name: str, entity_id: int, old_val=None, new_val=None):
    """Helper to record actions in the AuditLog table."""
    audit = AuditLog(
        action=action,
        entity_name=entity_name,
        entity_id=str(entity_id),
        performed_by=user_id,
        old_value=json.dumps(old_val, default=str) if old_val else None,
        new_value=json.dumps(new_val, default=str) if new_val else None
    )
    db.add(audit)

# --- 1. Project CRUD ---

@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    project: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    """
    Create a project header.  If the caller supplied a manager_user_id
    we also insert the corresponding project_managers row in the same
    transaction.
    """
    _assert_full_access(roles)

    has_start = project.planned_start_date is not None
    has_end = project.planned_end_date is not None
    has_actual_start = project.actual_start_date is not None
    has_actual_end = project.actual_end_date is not None
    if has_start != has_end:
        raise HTTPException(
            status_code=400,
            detail="Provide both planned_start_date and planned_end_date together",
        )
    if has_start and project.planned_end_date < project.planned_start_date:
        raise HTTPException(
            status_code=400,
            detail="planned_end_date cannot be before planned_start_date",
        )
    if has_actual_start and has_actual_end and project.actual_end_date < project.actual_start_date:
        raise HTTPException(
            status_code=400,
            detail="actual_end_date cannot be before actual_start_date",
        )

    # build project model without manager/timeline helper fields
    proj_data = project.model_dump(
        exclude={
            "manager_user_id",
            "planned_start_date",
            "planned_end_date",
            "actual_start_date",
            "actual_end_date",
        }
    )
    proj_data["approval_status"] = "Pending"
    proj_data["approved_by_manager_id"] = None
    proj_data["approved_at"] = None
    proj_data["approval_note"] = None
    db_project = Project(**proj_data)
    db.add(db_project)
    db.flush()                         # get project_id now

    # create assignment row if manager chosen
    if project.manager_user_id:
        db.add(
            ProjectManager(
                project_id=db_project.project_id,
                manager_user_id=project.manager_user_id,
                role="Primary PM",                   # default role
                assigned_from=sa.func.current_date(),
                is_active=True,
            )
        )

    if has_start and has_end:
        db.add(
            ProjectTimeline(
                project_id=db_project.project_id,
                start_date=project.planned_start_date,
                planned_start_date=project.planned_start_date,
                planned_end_date=project.planned_end_date,
                actual_start_date=project.actual_start_date,
                actual_end_date=project.actual_end_date,
                version_number=1,
                is_current=True,
            )
        )

    db.commit()
    db.refresh(db_project)
    return db_project

@router.get("/", response_model=List[ProjectResponse])
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    # Join with active manager, and current timeline metadata
    results = db.query(
        Project,
        AuthUser.username.label("manager_name"),
        ProjectManager.manager_user_id.label("manager_user_id"),
        ProjectTimeline.planned_start_date.label("planned_start_date"),
        ProjectTimeline.planned_end_date.label("planned_end_date"),
        ProjectTimeline.actual_start_date.label("actual_start_date"),
        ProjectTimeline.actual_end_date.label("actual_end_date"),
    ).outerjoin(
        ProjectManager, 
        (Project.project_id == ProjectManager.project_id) & (ProjectManager.is_active == True)
    ).outerjoin(
        ProjectTimeline,
        (Project.project_id == ProjectTimeline.project_id) & (ProjectTimeline.is_current == True)
    ).outerjoin(
        AuthUser, ProjectManager.manager_user_id == AuthUser.user_id
    ).all()
    
    projects_list = []
    manager_role = _is_manager_role(roles)
    for p, manager_name, manager_user_id, planned_start_date, planned_end_date, actual_start_date, actual_end_date in results:
        can_current_user_approve = bool(
            manager_role and manager_user_id == current_user.user_id
        )
        projects_list.append(
            _build_project_response_dict(
                project=p,
                manager_name=manager_name,
                manager_user_id=manager_user_id,
                planned_start_date=planned_start_date,
                planned_end_date=planned_end_date,
                actual_start_date=actual_start_date,
                actual_end_date=actual_end_date,
                can_current_user_approve=can_current_user_approve,
            )
        )
        
    return projects_list

@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    result = db.query(
        Project,
        AuthUser.username.label("manager_name"),
        ProjectManager.manager_user_id.label("manager_user_id"),
        ProjectTimeline.planned_start_date.label("planned_start_date"),
        ProjectTimeline.planned_end_date.label("planned_end_date"),
        ProjectTimeline.actual_start_date.label("actual_start_date"),
        ProjectTimeline.actual_end_date.label("actual_end_date"),
    ).outerjoin(
        ProjectManager,
        (Project.project_id == ProjectManager.project_id) & (ProjectManager.is_active == True)
    ).outerjoin(
        ProjectTimeline,
        (Project.project_id == ProjectTimeline.project_id) & (ProjectTimeline.is_current == True)
    ).outerjoin(
        AuthUser, ProjectManager.manager_user_id == AuthUser.user_id
    ).filter(
        Project.project_id == project_id
    ).first()

    if not result:
        raise HTTPException(status_code=404, detail="Project not found")

    project, manager_name, manager_user_id, planned_start_date, planned_end_date, actual_start_date, actual_end_date = result
    can_current_user_approve = bool(
        _is_manager_role(roles)
        and _is_manager_assigned_to_project(db, project_id, current_user.user_id)
    )
    return _build_project_response_dict(
        project=project,
        manager_name=manager_name,
        manager_user_id=manager_user_id,
        planned_start_date=planned_start_date,
        planned_end_date=planned_end_date,
        actual_start_date=actual_start_date,
        actual_end_date=actual_end_date,
        can_current_user_approve=can_current_user_approve,
    )

@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: int,
    project_update: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    db_project = db.query(Project).filter(Project.project_id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    raw_update = project_update.model_dump(exclude_unset=True)
    full_access = _has_full_access(roles)

    if not full_access:
        timeline_fields = {
            "planned_start_date",
            "planned_end_date",
            "actual_start_date",
            "actual_end_date",
            "reason_for_change",
        }
        attempted_timeline_update = set(raw_update.keys()) & timeline_fields
        if attempted_timeline_update:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. Only Admin or Owner can update timeline dates.",
            )

    update_data = dict(raw_update)

    has_manager_update = "manager_user_id" in raw_update
    manager_user_id = update_data.pop("manager_user_id", None)
    has_planned_start = "planned_start_date" in raw_update
    has_planned_end = "planned_end_date" in raw_update
    has_actual_start = "actual_start_date" in raw_update
    has_actual_end = "actual_end_date" in raw_update
    reason_for_change = update_data.pop("reason_for_change", None)
    planned_start_date = update_data.pop("planned_start_date", None)
    planned_end_date = update_data.pop("planned_end_date", None)
    actual_start_date = update_data.pop("actual_start_date", None)
    actual_end_date = update_data.pop("actual_end_date", None)

    if has_planned_start != has_planned_end:
        raise HTTPException(
            status_code=400,
            detail="Provide both planned_start_date and planned_end_date together",
        )
    if has_planned_start and ((planned_start_date is None) or (planned_end_date is None)):
        raise HTTPException(
            status_code=400,
            detail="planned_start_date and planned_end_date cannot be null",
        )
    if has_planned_start and planned_end_date < planned_start_date:
        raise HTTPException(
            status_code=400,
            detail="planned_end_date cannot be before planned_start_date",
        )
    if has_actual_start and has_actual_end and actual_start_date and actual_end_date and actual_end_date < actual_start_date:
        raise HTTPException(
            status_code=400,
            detail="actual_end_date cannot be before actual_start_date",
        )

    old_data = {c.name: getattr(db_project, c.name) for c in db_project.__table__.columns}
    for key, value in update_data.items():
        setattr(db_project, key, value)

    if has_manager_update:
        db.query(ProjectManager).filter(
            ProjectManager.project_id == project_id,
            ProjectManager.is_active == True,
        ).update({"is_active": False})
        if manager_user_id:
            db.add(
                ProjectManager(
                    project_id=project_id,
                    manager_user_id=manager_user_id,
                    role="Primary PM",
                    assigned_from=sa.func.current_date(),
                    is_active=True,
                )
            )

    has_timeline_update = has_planned_start or has_planned_end or has_actual_start or has_actual_end
    if has_timeline_update:
        current_timeline = db.query(ProjectTimeline).filter(
            ProjectTimeline.project_id == project_id,
            ProjectTimeline.is_current == True,
        ).first()

        current_planned_start = current_timeline.planned_start_date if current_timeline else None
        current_planned_end = current_timeline.planned_end_date if current_timeline else None
        current_actual_start = current_timeline.actual_start_date if current_timeline else None
        current_actual_end = current_timeline.actual_end_date if current_timeline else None

        next_planned_start = planned_start_date if has_planned_start else current_planned_start
        next_planned_end = planned_end_date if has_planned_end else current_planned_end
        next_actual_start = actual_start_date if has_actual_start else current_actual_start
        next_actual_end = actual_end_date if has_actual_end else current_actual_end

        if next_planned_start is None or next_planned_end is None:
            raise HTTPException(
                status_code=400,
                detail="Project timeline requires planned_start_date and planned_end_date",
            )

        if next_actual_start and next_actual_end and next_actual_end < next_actual_start:
            raise HTTPException(
                status_code=400,
                detail="actual_end_date cannot be before actual_start_date",
            )

        dates_changed = any([
            next_planned_start != current_planned_start,
            next_planned_end != current_planned_end,
            next_actual_start != current_actual_start,
            next_actual_end != current_actual_end,
        ])
        planned_dates_changed = any([
            next_planned_start != current_planned_start,
            next_planned_end != current_planned_end,
        ])

        if (
            planned_dates_changed
            and current_timeline
            and not (reason_for_change and reason_for_change.strip())
        ):
            raise HTTPException(
                status_code=400,
                detail="reason_for_change is required when updating planned timeline dates",
            )

        if dates_changed:
            if current_timeline:
                current_timeline.is_current = False

            next_version = db.query(sa.func.coalesce(sa.func.max(ProjectTimeline.version_number), 0)).filter(
                ProjectTimeline.project_id == project_id
            ).scalar() + 1

            db.add(
                ProjectTimeline(
                    project_id=project_id,
                    start_date=next_planned_start,
                    planned_start_date=next_planned_start,
                    planned_end_date=next_planned_end,
                    actual_start_date=next_actual_start,
                    actual_end_date=next_actual_end,
                    version_number=next_version,
                    reason_for_change=reason_for_change.strip() if reason_for_change else None,
                    is_current=True,
                )
            )

    log_audit(db, current_user.user_id, "UPDATE", "Project", project_id, old_val=old_data, new_val=update_data)
    db.commit()
    return get_project(project_id, db, current_user, roles)


@router.patch("/{project_id}/approval", response_model=ProjectResponse)
def update_project_approval(
    project_id: int,
    payload: ProjectApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    if not _is_manager_role(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Manager role required.",
        )

    db_project = db.query(Project).filter(Project.project_id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not _is_manager_assigned_to_project(db, project_id, current_user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not the assigned manager for this project.",
        )

    old_data = {
        "approval_status": db_project.approval_status,
        "approved_by_manager_id": db_project.approved_by_manager_id,
        "approved_at": db_project.approved_at,
        "approval_note": db_project.approval_note,
    }

    db_project.approval_status = payload.approval_status
    db_project.approved_by_manager_id = current_user.user_id
    db_project.approved_at = datetime.now(timezone.utc)
    db_project.approval_note = payload.approval_note

    new_data = {
        "approval_status": db_project.approval_status,
        "approved_by_manager_id": db_project.approved_by_manager_id,
        "approved_at": db_project.approved_at,
        "approval_note": db_project.approval_note,
    }
    log_audit(
        db=db,
        user_id=current_user.user_id,
        action="APPROVAL_UPDATE",
        entity_name="Project",
        entity_id=project_id,
        old_val=old_data,
        new_val=new_data,
    )
    db.commit()
    return get_project(project_id, db, current_user, roles)

# --- 2. Project Manager Assignments (REINSTATED) ---

@router.post("/managers", response_model=ProjectManagerResponse)
def add_project_manager(
    manager: ProjectManagerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    """Assigns an internal manager to a project."""
    _assert_full_access(roles)

    db_mgr = ProjectManager(**manager.model_dump())
    db.add(db_mgr)
    db.commit()
    db.refresh(db_mgr)
    
    log_audit(db, current_user.user_id, "CREATE", "ProjectManager", db_mgr.id, new_val=manager.model_dump())
    db.commit()
    return db_mgr

@router.get("/{project_id}/managers", response_model=List[ProjectManagerResponse])
def list_project_managers(project_id: int, db: Session = Depends(get_db)):
    """Retrieves all managers assigned to a specific project."""
    return db.query(ProjectManager).filter(ProjectManager.project_id == project_id).all()

# --- 3. Project Timelines ---

@router.post("/timelines", response_model=ProjectTimelineResponse)
def create_project_timeline(
    timeline: ProjectTimelineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    _assert_full_access(roles)

    if timeline.planned_start_date is None:
        raise HTTPException(
            status_code=400,
            detail="planned_start_date is required for timeline",
        )
    if timeline.planned_end_date < timeline.planned_start_date:
        raise HTTPException(
            status_code=400,
            detail="planned_end_date cannot be before planned_start_date",
        )

    if timeline.is_current:
        db.query(ProjectTimeline).filter(
            ProjectTimeline.project_id == timeline.project_id,
            ProjectTimeline.is_current == True
        ).update({"is_current": False})
    
    version = db.query(ProjectTimeline).filter(ProjectTimeline.project_id == timeline.project_id).count() + 1
    timeline_data = timeline.model_dump()
    timeline_data["start_date"] = timeline.planned_start_date
    db_timeline = ProjectTimeline(**timeline_data, version_number=version)
    
    db.add(db_timeline)
    db.commit()
    log_audit(db, current_user.user_id, "CREATE", "ProjectTimeline", db_timeline.timeline_id, new_val=timeline.model_dump())
    db.commit()
    db.refresh(db_timeline)
    return db_timeline


@router.get("/{project_id}/timelines", response_model=List[ProjectTimelineResponse])
def list_project_timelines(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_exists = db.query(Project.project_id).filter(Project.project_id == project_id).first()
    if not project_exists:
        raise HTTPException(status_code=404, detail="Project not found")

    return (
        db.query(ProjectTimeline)
        .filter(ProjectTimeline.project_id == project_id)
        .order_by(ProjectTimeline.version_number.desc(), ProjectTimeline.timeline_id.desc())
        .all()
    )

# --- 4. Employee Project Assignments (With Billing & Masking) ---

@router.post("/assignments", response_model=EmployeeProjectAssignmentResponse)
def assign_employee_to_project(
    assignment: EmployeeProjectAssignmentCreate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles)
):
    if not _can_write_assignments(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Insufficient role for resource assignment updates.",
        )

    assign_data = assignment.model_dump()
    send_for_approval = bool(assign_data.pop("send_for_approval", True))
    full_access = _has_full_access(roles)
    
    if not full_access:
        assign_data['billing_rate'] = None
        assign_data['billing_start_date'] = None
        assign_data['billing_end_date'] = None
        assign_data['billing_project_id'] = None
        assign_data['is_billable'] = False

    if full_access and send_for_approval:
        assign_data["approval_status"] = "Pending"
        assign_data["approved_by_manager_id"] = None
        assign_data["approved_at"] = None
        assign_data["approval_note"] = None
        assign_data["approval_requested_by_user_id"] = current_user.user_id
        assign_data["approval_requested_at"] = datetime.now(timezone.utc)
    else:
        assign_data["approval_status"] = "Approved"
        assign_data["approved_by_manager_id"] = current_user.user_id
        assign_data["approved_at"] = datetime.now(timezone.utc)
        assign_data["approval_note"] = "Auto-approved on assignment create"
        assign_data["approval_requested_by_user_id"] = current_user.user_id
        assign_data["approval_requested_at"] = datetime.now(timezone.utc)

    db_asgn = EmployeeProjectAssignment(**assign_data)
    db.add(db_asgn)
    db.commit()
    db.refresh(db_asgn)
    
    log_audit(db, current_user.user_id, "CREATE", "EmployeeProjectAssignment", db_asgn.assignment_id, new_val=assign_data)
    db.commit()
    return db_asgn

@router.get("/projects/{project_id}/assignments", response_model=List[EmployeeProjectAssignmentResponse])
def list_project_assignments(
    project_id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles)
):
    assignments = db.query(EmployeeProjectAssignment).filter(
        EmployeeProjectAssignment.project_id == project_id
    ).order_by(EmployeeProjectAssignment.assignment_id.asc()).all()
    
    full_access = _has_full_access(roles)
    manager_can_approve_project = _is_manager_role(roles) and _is_manager_assigned_to_project(
        db,
        project_id,
        current_user.user_id,
    )

    response_rows: list[dict] = []
    for assignment in assignments:
        if not full_access:
            assignment.billing_rate = None
        can_current_user_approve = bool(
            manager_can_approve_project and assignment.approval_status == "Pending"
        )
        response_rows.append(
            _build_assignment_response_dict(
                assignment=assignment,
                can_current_user_approve=can_current_user_approve,
            )
        )

    return response_rows

@router.patch("/assignments/{assignment_id}", response_model=EmployeeProjectAssignmentResponse)
def update_project_assignment(
    assignment_id: int,
    assignment_update: EmployeeProjectAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    if not _can_write_assignments(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Insufficient role for resource assignment updates.",
        )

    db_assignment = db.query(EmployeeProjectAssignment).filter(
        EmployeeProjectAssignment.assignment_id == assignment_id
    ).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    update_data = assignment_update.model_dump(exclude_unset=True)
    full_access = _has_full_access(roles)
    if not full_access and "status" in update_data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only Admin or Owner can update assignment status.",
        )

    if not full_access:
        blocked_financial_fields = {
            "billing_rate",
            "billing_start_date",
            "billing_end_date",
            "billing_project_id",
            "is_billable",
        }
        for key in blocked_financial_fields:
            if key in update_data:
                update_data.pop(key)

    old_data = {c.name: getattr(db_assignment, c.name) for c in db_assignment.__table__.columns}
    for key, value in update_data.items():
        setattr(db_assignment, key, value)

    log_audit(
        db,
        current_user.user_id,
        "UPDATE",
        "EmployeeProjectAssignment",
        assignment_id,
        old_val=old_data,
        new_val=update_data,
    )
    db.commit()
    db.refresh(db_assignment)

    if not full_access:
        db_assignment.billing_rate = None
    return db_assignment


@router.patch("/assignments/{assignment_id}/approval", response_model=EmployeeProjectAssignmentResponse)
def update_assignment_approval(
    assignment_id: int,
    payload: AssignmentApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    if not _is_manager_role(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Manager role required.",
        )

    db_assignment = db.query(EmployeeProjectAssignment).filter(
        EmployeeProjectAssignment.assignment_id == assignment_id
    ).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if not _is_manager_assigned_to_project(db, db_assignment.project_id, current_user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not the assigned manager for this project.",
        )

    old_data = {
        "approval_status": db_assignment.approval_status,
        "approved_by_manager_id": db_assignment.approved_by_manager_id,
        "approved_at": db_assignment.approved_at,
        "approval_note": db_assignment.approval_note,
        "status": db_assignment.status,
        "end_date": db_assignment.end_date,
    }

    db_assignment.approval_status = payload.approval_status
    db_assignment.approved_by_manager_id = current_user.user_id
    db_assignment.approved_at = datetime.now(timezone.utc)
    db_assignment.approval_note = payload.approval_note

    if payload.approval_status == "Rejected":
        db_assignment.status = "Ended"
        if db_assignment.end_date is None:
            db_assignment.end_date = sa.func.current_date()

    new_data = {
        "approval_status": db_assignment.approval_status,
        "approved_by_manager_id": db_assignment.approved_by_manager_id,
        "approved_at": db_assignment.approved_at,
        "approval_note": db_assignment.approval_note,
        "status": db_assignment.status,
        "end_date": db_assignment.end_date,
    }
    log_audit(
        db=db,
        user_id=current_user.user_id,
        action="ASGN_APPROVAL_UPD",
        entity_name="EmployeeProjectAssignment",
        entity_id=assignment_id,
        old_val=old_data,
        new_val=new_data,
    )
    db.commit()
    db.refresh(db_assignment)

    can_current_user_approve = db_assignment.approval_status == "Pending"
    return _build_assignment_response_dict(
        assignment=db_assignment,
        can_current_user_approve=can_current_user_approve,
    )
