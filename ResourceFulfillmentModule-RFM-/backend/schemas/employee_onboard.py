from datetime import date
from typing import Optional, Literal

from pydantic import BaseModel, EmailStr


class OnboardContact(BaseModel):
    type: Literal["work", "personal", "emergency"]
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class OnboardSkill(BaseModel):
    skill_id: int
    proficiency_level: Optional[str] = None
    years_experience: Optional[float] = None


class OnboardEducation(BaseModel):
    qualification: Optional[str] = None
    specialization: Optional[str] = None
    institution: Optional[str] = None
    year_completed: Optional[int] = None


class OnboardAvailability(BaseModel):
    availability_pct: int
    effective_from: date


class OnboardFinance(BaseModel):
    bank_details: Optional[str] = None
    tax_id: Optional[str] = None


class EmployeeOnboard(BaseModel):
    emp_id: str
    full_name: str
    rbm_email: EmailStr
    company_role_id: Optional[int] = None
    dob: Optional[date] = None
    gender: Optional[str] = None
    doj: Optional[date] = None
    contacts: list[OnboardContact] = []
    skills: list[OnboardSkill] = []
    education: list[OnboardEducation] = []
    availability: Optional[OnboardAvailability] = None
    finance: Optional[OnboardFinance] = None


class EmployeeOnboardResponse(BaseModel):
    emp_id: str
    message: str