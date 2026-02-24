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
from utils.dependencies import get_current_user
from db.models.auth import User

router = APIRouter(prefix="/projects", tags=["Project Management"])

def log_audit(db: Session, user_id: int, action: str, entity_name: str, entity_id: int, old_val=None, new_val=None):
    """Helper to record actions in the AuditLog table as per design plan."""
    audit = AuditLog(
        action=action,
        entity_name=entity_name,
        entity_id=str(entity_id),
        performed_by=user_id,
        old_value=json.dumps(old_val) if old_val else None,
        new_value=json.dumps(new_val) if new_val else None
    )
    db.add(audit)

# --- Project CRUD ---

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
def get_project(project_id: int, db: Session = Depends(get_db)):
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

@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_project = db.query(Project).filter(Project.project_id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    old_data = {c.name: getattr(db_project, c.name) for c in db_project.__table__.columns}
    db.delete(db_project)
    log_audit(db, current_user.user_id, "DELETE", "Project", project_id, old_val=old_data)
    db.commit()
    return None

# --- Project Manager Assignments ---

@router.post("/managers", response_model=ProjectManagerResponse)
def add_project_manager(manager: ProjectManagerCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_mgr = ProjectManager(**manager.model_dump())
    db.add(db_mgr)
    db.commit()
    db.refresh(db_mgr)
    
    log_audit(db, current_user.user_id, "CREATE", "ProjectManager", db_mgr.id, new_val=manager.model_dump())
    db.commit()
    return db_mgr

# --- Project Timelines ---

@router.post("/timelines", response_model=ProjectTimelineResponse)
def create_project_timeline(timeline: ProjectTimelineCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # If this is the current timeline, deactivate previous current timelines for this project
    if timeline.is_current:
        db.query(ProjectTimeline).filter(
            ProjectTimeline.project_id == timeline.project_id,
            ProjectTimeline.is_current == True
        ).update({"is_current": False})
    
    # Calculate version number based on existing timeline records
    version = db.query(ProjectTimeline).filter(ProjectTimeline.project_id == timeline.project_id).count() + 1
    db_timeline = ProjectTimeline(**timeline.model_dump(), version_number=version)
    
    db.add(db_timeline)
    db.commit()
    db.refresh(db_timeline)
    
    log_audit(db, current_user.user_id, "CREATE", "ProjectTimeline", db_timeline.timeline_id, new_val=timeline.model_dump())
    db.commit()
    return db_timeline

# --- Employee Project Assignments ---

@router.post("/assignments", response_model=EmployeeProjectAssignmentResponse)
def assign_employee_to_project(assignment: EmployeeProjectAssignmentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_asgn = EmployeeProjectAssignment(**assignment.model_dump())
    db.add(db_asgn)
    db.commit()
    db.refresh(db_asgn)
    
    log_audit(db, current_user.user_id, "CREATE", "EmployeeProjectAssignment", db_asgn.assignment_id, new_val=assignment.model_dump())
    db.commit()
    return db_asgn