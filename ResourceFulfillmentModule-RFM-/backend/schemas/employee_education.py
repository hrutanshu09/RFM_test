from pydantic import BaseModel
from typing import Optional


class EmployeeEducationCreate(BaseModel):
    qualification: str
    specialization: Optional[str] = None
    institution: Optional[str] = None
    year_completed: Optional[int] = None


class EmployeeEducationUpdate(BaseModel):
    qualification: Optional[str] = None
    specialization: Optional[str] = None
    institution: Optional[str] = None
    year_completed: Optional[int] = None


class EmployeeEducationResponse(EmployeeEducationCreate):
    edu_id: int
    emp_id: str

    class Config:
        from_attributes = True
