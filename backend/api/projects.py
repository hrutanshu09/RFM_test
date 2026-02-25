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

# --- Project Timelines ---

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
    db.refresh(db_timeline)
    
    log_audit(db, current_user.user_id, "CREATE", "ProjectTimeline", db_timeline.timeline_id, new_val=timeline.model_dump())
    db.commit()
    return db_timeline

# --- Employee Project Assignments (With Billing & Masking) ---

@router.post("/assignments", response_model=EmployeeProjectAssignmentResponse)
def assign_employee_to_project(
    assignment: EmployeeProjectAssignmentCreate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    # Business Rule: Only Admins can set a billing rate
    assign_data = assignment.model_dump()
    if current_user.role != "Admin":
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
    current_user: User = Depends(get_current_user)
):
    assignments = db.query(EmployeeProjectAssignment).filter(
        EmployeeProjectAssignment.project_id == project_id
    ).all()
    
    # Data Masking: Hide billing rate from non-admins
    if current_user.role != "Admin":
        for a in assignments:
            a.billing_rate = None
            
    return assignments

@router.patch("/assignments/{assignment_id}", response_model=EmployeeProjectAssignmentResponse)
def update_assignment(
    assignment_id: int,
    assignment_update: EmployeeProjectAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    db_asgn = db.query(EmployeeProjectAssignment).filter(EmployeeProjectAssignment.assignment_id == assignment_id).first()
    if not db_asgn:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    old_data = {c.name: getattr(db_asgn, c.name) for c in db_asgn.__table__.columns}
    update_data = assignment_update.model_dump(exclude_unset=True)
    
    # Governance: Prevent non-admins from changing the billing rate
    if "billing_rate" in update_data and current_user.role != "Admin":
        del update_data["billing_rate"]
    
    for key, value in update_data.items():
        setattr(db_asgn, key, value)
    
    log_audit(db, current_user.user_id, "UPDATE", "EmployeeProjectAssignment", assignment_id, old_val=old_data, new_val=update_data)
    db.commit()
    db.refresh(db_asgn)
    
    # Mask rate in response for non-admins
    if current_user.role != "Admin":
        db_asgn.billing_rate = None
        
    return db_asgn