from pydantic import BaseModel
from typing import Optional, Literal


class EmployeeSkillUpsert(BaseModel):
    skill_id: int
    proficiency_level: Optional[Literal["Junior", "Mid", "Senior"]] = None
    years_experience: Optional[float] = None


class EmployeeSkillResponse(BaseModel):
    emp_id: str
    skill_id: int
    proficiency_level: Optional[str]
    years_experience: Optional[float]

    class Config:
        from_attributes = True
