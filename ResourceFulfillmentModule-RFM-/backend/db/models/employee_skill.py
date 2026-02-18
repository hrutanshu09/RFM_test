from sqlalchemy import Column, String, Integer, DECIMAL, ForeignKey
from db.base import Base


class EmployeeSkill(Base):
    __tablename__ = "employee_skills"

    emp_id = Column(
        String(20),
        ForeignKey("employees.emp_id"),
        primary_key=True
    )

    skill_id = Column(
        Integer,
        ForeignKey("skills.skill_id"),
        primary_key=True
    )

    proficiency_level = Column(String(20), nullable=True)
    years_experience = Column(DECIMAL(4, 1), nullable=True)
