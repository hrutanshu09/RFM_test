from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_any_role
from db.models.employee_skill import EmployeeSkill
from db.models.employee import Employee
from db.models.skill import Skill
from schemas.employee_skill import (
    EmployeeSkillUpsert,
    EmployeeSkillResponse,
)


router = APIRouter(
    prefix="/employees/{emp_id}/skills",
    tags=["Employee Skills"],
)


@router.get("/", response_model=list[EmployeeSkillResponse])
def list_employee_skills(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee", "TA"))
):
    return (
        db.query(EmployeeSkill)
        .filter(EmployeeSkill.emp_id == emp_id)
        .all()
    )


@router.post("/", response_model=EmployeeSkillResponse)
def upsert_employee_skill(
    emp_id: str,
    payload: EmployeeSkillUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Employee"))
):
    # Ensure employee exists
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Ensure skill exists
    skill = db.query(Skill).filter(Skill.skill_id == payload.skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    record = (
        db.query(EmployeeSkill)
        .filter(
            EmployeeSkill.emp_id == emp_id,
            EmployeeSkill.skill_id == payload.skill_id,
        )
        .first()
    )

    if record:
        # UPDATE existing assignment
        if payload.proficiency_level is not None:
            record.proficiency_level = payload.proficiency_level
        if payload.years_experience is not None:
            record.years_experience = payload.years_experience
    else:
        # INSERT new assignment
        record = EmployeeSkill(
            emp_id=emp_id,
            skill_id=payload.skill_id,
            proficiency_level=payload.proficiency_level,
            years_experience=payload.years_experience,
        )
        db.add(record)

    db.commit()
    db.refresh(record)
    return record


@router.delete("/{skill_id}")
def delete_employee_skill(emp_id: str, skill_id: int, db: Session = Depends(get_db)):
    record = (
        db.query(EmployeeSkill)
        .filter(
            EmployeeSkill.emp_id == emp_id,
            EmployeeSkill.skill_id == skill_id,
        )
        .first()
    )

    if not record:
        raise HTTPException(status_code=404, detail="Skill not assigned")

    db.delete(record)
    db.commit()

    return {"message": "Skill removed from employee"}

