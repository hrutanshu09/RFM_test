from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import sqlalchemy as sa
from typing import List
import json

from db.session import get_db
from db.models.projects import Project, ProjectManager, ProjectTimeline, EmployeeProjectAssignment
from db.models.audit_log import AuditLog
from schemas.projects import (
    ProjectCreate, ProjectUpdate, ProjectResponse,
    ProjectManagerCreate, ProjectManagerUpdate, ProjectManagerResponse,
    ProjectTimelineCreate, ProjectTimelineUpdate, ProjectTimelineResponse,
    EmployeeProjectAssignmentCreate, EmployeeProjectAssignmentUpdate, EmployeeProjectAssignmentResponse
)
from utils.dependencies import get_current_user, get_current_user_roles
from db.models.auth import User
from db.models.auth import User as AuthUser # Required for join
router = APIRouter(prefix="/projects", tags=["projects"])

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
):
    """
    Create a project header.  If the caller supplied a manager_user_id
    we also insert the corresponding project_managers row in the same
    transaction.
    """
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
def list_projects(db: Session = Depends(get_db)):
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
    for p, manager_name, manager_user_id, planned_start_date, planned_end_date, actual_start_date, actual_end_date in results:
        project_dict = {c.name: getattr(p, c.name) for c in p.__table__.columns}
        project_dict["manager_name"] = manager_name
        project_dict["manager_user_id"] = manager_user_id
        project_dict["planned_start_date"] = planned_start_date
        project_dict["planned_end_date"] = planned_end_date
        project_dict["actual_start_date"] = actual_start_date
        project_dict["actual_end_date"] = actual_end_date
        projects_list.append(project_dict)
        
    return projects_list

@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    project_dict = {c.name: getattr(project, c.name) for c in project.__table__.columns}
    project_dict["manager_name"] = manager_name
    project_dict["manager_user_id"] = manager_user_id
    project_dict["planned_start_date"] = planned_start_date
    project_dict["planned_end_date"] = planned_end_date
    project_dict["actual_start_date"] = actual_start_date
    project_dict["actual_end_date"] = actual_end_date
    return project_dict

@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: int, project_update: ProjectUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_project = db.query(Project).filter(Project.project_id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    raw_update = project_update.model_dump(exclude_unset=True)
    update_data = dict(raw_update)

    has_manager_update = "manager_user_id" in raw_update
    manager_user_id = update_data.pop("manager_user_id", None)
    has_planned_start = "planned_start_date" in raw_update
    has_planned_end = "planned_end_date" in raw_update
    has_actual_start = "actual_start_date" in raw_update
    has_actual_end = "actual_end_date" in raw_update
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

    if has_planned_start and has_planned_end:
        current_timeline = db.query(ProjectTimeline).filter(
            ProjectTimeline.project_id == project_id,
            ProjectTimeline.is_current == True,
        ).first()
        if current_timeline:
            current_timeline.start_date = planned_start_date
            current_timeline.planned_start_date = planned_start_date
            current_timeline.planned_end_date = planned_end_date
            if has_actual_start:
                current_timeline.actual_start_date = actual_start_date
            if has_actual_end:
                current_timeline.actual_end_date = actual_end_date
        else:
            db.add(
                ProjectTimeline(
                    project_id=project_id,
                    start_date=planned_start_date,
                    planned_start_date=planned_start_date,
                    planned_end_date=planned_end_date,
                    actual_start_date=actual_start_date if has_actual_start else None,
                    actual_end_date=actual_end_date if has_actual_end else None,
                    version_number=1,
                    is_current=True,
                )
            )
    elif has_actual_start or has_actual_end:
        current_timeline = db.query(ProjectTimeline).filter(
            ProjectTimeline.project_id == project_id,
            ProjectTimeline.is_current == True,
        ).first()
        if current_timeline:
            if has_actual_start:
                current_timeline.actual_start_date = actual_start_date
            if has_actual_end:
                current_timeline.actual_end_date = actual_end_date
    
    log_audit(db, current_user.user_id, "UPDATE", "Project", project_id, old_val=old_data, new_val=update_data)
    db.commit()
    return get_project(project_id, db, current_user)

# --- 2. Project Manager Assignments (REINSTATED) ---

@router.post("/managers", response_model=ProjectManagerResponse)
def add_project_manager(
    manager: ProjectManagerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Assigns an internal manager to a project."""
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
def create_project_timeline(timeline: ProjectTimelineCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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

# --- 4. Employee Project Assignments (With Billing & Masking) ---

@router.post("/assignments", response_model=EmployeeProjectAssignmentResponse)
def assign_employee_to_project(
    assignment: EmployeeProjectAssignmentCreate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles)
):
    assign_data = assignment.model_dump()
    is_admin = any(r.lower() == "admin" for r in roles)
    
    if not is_admin:
        assign_data['billing_rate'] = None

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
    ).all()
    
    is_admin = any(r.lower() == "admin" for r in roles)
    
    if not is_admin:
        for a in assignments:
            a.billing_rate = None
            
    return assignments

@router.patch("/assignments/{assignment_id}", response_model=EmployeeProjectAssignmentResponse)
def update_project_assignment(
    assignment_id: int,
    assignment_update: EmployeeProjectAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    db_assignment = db.query(EmployeeProjectAssignment).filter(
        EmployeeProjectAssignment.assignment_id == assignment_id
    ).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    update_data = assignment_update.model_dump(exclude_unset=True)
    is_admin = any(r.lower() == "admin" for r in roles)
    if not is_admin and "billing_rate" in update_data:
        update_data["billing_rate"] = None

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

    if not is_admin:
        db_assignment.billing_rate = None
    return db_assignment
