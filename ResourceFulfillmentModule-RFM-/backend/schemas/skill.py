from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SkillCreate(BaseModel):
    skill_name: str


class SkillUpdate(BaseModel):
    skill_name: str


class SkillInstantCreate(BaseModel):
    name: str


class SkillResponse(BaseModel):
    skill_id: int
    skill_name: str
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True



