# backend/schemas/projects.py
from datetime import date, datetime
from typing import Optional
from decimal import Decimal
from pydantic import BaseModel, Field, ConfigDict

# --- Project Schemas ---
class ProjectCreate(BaseModel):
    project_name: str = Field(..., max_length=200)
    client_name: Optional[str] = Field(None, max_length=200)
    project_status: str = Field(..., max_length=30)
    description: Optional[str] = None

class ProjectUpdate(BaseModel):
    project_name: Optional[str] = Field(None, max_length=200)
    client_name: Optional[str] = Field(None, max_length=200)
    project_status: Optional[str] = Field(None, max_length=30)
    description: Optional[str] = None

class ProjectResponse(BaseModel):
    project_id: int
    project_name: str
    client_name: Optional[str] = None
    project_status: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)

# --- Project Manager Schemas ---
class ProjectManagerCreate(BaseModel):
    project_id: int
    manager_user_id: int
    role: str = Field(..., max_length=50)
    assigned_from: date
    assigned_to: Optional[date] = None
    is_active: Optional[bool] = True

class ProjectManagerUpdate(BaseModel):
    role: Optional[str] = Field(None, max_length=50)
    assigned_from: Optional[date] = None
    assigned_to: Optional[date] = None
    is_active: Optional[bool] = None

class ProjectManagerResponse(BaseModel):
    id: int
    project_id: int
    manager_user_id: int
    role: str
    assigned_from: date
    assigned_to: Optional[date] = None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)

# --- Project Timeline Schemas ---
class ProjectTimelineCreate(BaseModel):
    project_id: int
    start_date: date
    planned_end_date: date
    actual_end_date: Optional[date] = None
    reason_for_change: Optional[str] = None
    is_current: Optional[bool] = True

class ProjectTimelineUpdate(BaseModel):
    start_date: Optional[date] = None
    planned_end_date: Optional[date] = None
    actual_end_date: Optional[date] = None
    reason_for_change: Optional[str] = None
    is_current: Optional[bool] = None

class ProjectTimelineResponse(BaseModel):
    timeline_id: int
    project_id: int
    start_date: date
    planned_end_date: date
    actual_end_date: Optional[date] = None
    version_number: int
    reason_for_change: Optional[str] = None
    is_current: bool

    model_config = ConfigDict(from_attributes=True)

# --- Employee Project Assignment Schemas ---
class EmployeeProjectAssignmentCreate(BaseModel):
    emp_id: str = Field(..., max_length=20)
    project_id: int
    role: Optional[str] = Field(None, max_length=100)
    allocation_pct: Decimal = Field(..., max_digits=5, decimal_places=2)
    start_date: date
    end_date: Optional[date] = None
    status: str = Field(..., max_length=20)

class EmployeeProjectAssignmentUpdate(BaseModel):
    role: Optional[str] = Field(None, max_length=100)
    allocation_pct: Optional[Decimal] = Field(None, max_digits=5, decimal_places=2)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = Field(None, max_length=20)

class EmployeeProjectAssignmentResponse(BaseModel):
    assignment_id: int
    emp_id: str
    project_id: int
    role: Optional[str] = None
    allocation_pct: Decimal
    start_date: date
    end_date: Optional[date] = None
    status: str

    model_config = ConfigDict(from_attributes=True)