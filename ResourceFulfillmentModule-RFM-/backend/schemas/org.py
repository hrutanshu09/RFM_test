from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional


# ---------- DEPARTMENTS ----------
class DepartmentCreate(BaseModel):
    department_name: str


class DepartmentResponse(BaseModel):
    department_id: int
    department_name: str
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True



# ---------- LOCATIONS ----------
class LocationCreate(BaseModel):
    city: Optional[str] = None
    country: Optional[str] = None


class LocationResponse(BaseModel):
    location_id: int
    city: Optional[str]
    country: Optional[str]
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ---------- ASSIGNMENTS ----------
class AssignmentCreate(BaseModel):
    department_id: int
    manager_id: Optional[str] = None
    location_id: Optional[int] = None
    start_date: date
    end_date: Optional[date] = None


class AssignmentResponse(BaseModel):
    assignment_id: int
    emp_id: str
    department_id: int
    manager_id: Optional[str]
    location_id: Optional[int]
    start_date: date
    end_date: Optional[date]

    class Config:
        from_attributes = True

class DepartmentUpdate(BaseModel):
    department_name: str

class LocationUpdate(BaseModel):
    city: Optional[str] = None
    country: Optional[str] = None

class AssignmentEnd(BaseModel):
    end_date: date
