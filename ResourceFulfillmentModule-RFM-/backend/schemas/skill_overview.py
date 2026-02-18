from pydantic import BaseModel


class SkillProficiencyCount(BaseModel):
    junior: int
    mid: int
    senior: int


class SkillOverviewResponse(BaseModel):
    skill_id: int
    skill_name: str
    total_employees: int
    proficiency: SkillProficiencyCount
