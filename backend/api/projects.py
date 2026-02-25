from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import json
import sqlalchemy as sa

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

router = APIRouter(prefix="/projects", tags=["Project Management"])

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
def create_project(project: ProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_project = Project(**project.model_dump())
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    
    log_audit(db, current_user.user_id, "CREATE", "Project", db_project.project_id, new_val=project.model_dump())
    db.commit()
    return db_project

@router.get("/", response_model=List[ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).all()

@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    project = db.query(Project).filter(Project.project_id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: int, project_update: ProjectUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_project = db.query(Project).filter(Project.project_id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    old_data = {c.name: getattr(db_project, c.name) for c in db_project.__table__.columns}
    update_data = project_update.model_dump(exclude_unset=True)
    
    for key, value in update_data.items():
        setattr(db_project, key, value)
    
    log_audit(db, current_user.user_id, "UPDATE", "Project", project_id, old_val=old_data, new_val=update_data)
    db.commit()
    db.refresh(db_project)
    return db_project

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
    if timeline.is_current:
        db.query(ProjectTimeline).filter(
            ProjectTimeline.project_id == timeline.project_id,
            ProjectTimeline.is_current == True
        ).update({"is_current": False})
    
    version = db.query(ProjectTimeline).filter(ProjectTimeline.project_id == timeline.project_id).count() + 1
    db_timeline = ProjectTimeline(**timeline.model_dump(), version_number=version)
    
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

from db.models.auth import User as AuthUser # Required for join

@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(project: ProjectCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # 1. Create project, excluding manager_user_id from the main projects table
    project_data = project.model_dump(exclude={"manager_user_id"})
    db_project = Project(**project_data)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    
    # 2. If a manager was selected, create the entry in project_managers
    if project.manager_user_id:
        db_mgr = ProjectManager(
            project_id=db_project.project_id,
            manager_user_id=project.manager_user_id,
            role="Primary PM",
            assigned_from=sa.func.current_date(),
            is_active=True
        )
        db.add(db_mgr)
        db.commit()

    log_audit(db, current_user.user_id, "CREATE", "Project", db_project.project_id, new_val=project.model_dump())
    db.commit()
    return db_project

@router.get("/", response_model=List[ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    # Join with ProjectManager and User to get the manager's username
    results = db.query(
        Project,
        AuthUser.username.label("manager_name")
    ).outerjoin(
        ProjectManager, 
        (Project.project_id == ProjectManager.project_id) & (ProjectManager.is_active == True)
    ).outerjoin(
        AuthUser, ProjectManager.manager_user_id == AuthUser.user_id
    ).all()
    
    projects_list = []
    for p, manager_name in results:
        project_dict = {c.name: getattr(p, c.name) for c in p.__table__.columns}
        project_dict["manager_name"] = manager_name
        projects_list.append(project_dict)
        
    return projects_list