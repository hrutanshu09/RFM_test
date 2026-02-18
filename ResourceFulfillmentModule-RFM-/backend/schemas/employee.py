from datetime import date
from typing import Optional, Literal
from pydantic import BaseModel, EmailStr


class EmployeeCreate(BaseModel):
    emp_id: str
    full_name: str
    rbm_email: EmailStr
    dob: Optional[date] = None
    gender: Optional[str] = None
    doj: Optional[date] = None


class EmployeeUpdate(BaseModel):
    full_name: Optional[str] = None
    dob: Optional[date] = None
    gender: Optional[str] = None
    doj: Optional[date] = None


class EmployeeStatusUpdate(BaseModel):
    emp_status: Literal["Onboarding", "Active", "On Leave", "Exited"]


class EmployeeResponse(BaseModel):
    emp_id: str
    full_name: str
    rbm_email: EmailStr
    emp_status: str
    dob: Optional[date] = None
    gender: Optional[str] = None
    doj: Optional[date] = None
    company_role_id: Optional[int] = None

    class Config:
        from_attributes = True


class NextEmployeeIdResponse(BaseModel):
    emp_id: str
