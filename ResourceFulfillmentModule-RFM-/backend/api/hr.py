from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, distinct, func
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from db.models.employee import Employee
from db.models.employee_contact import EmployeeContact
from db.models.employee_skill import EmployeeSkill
from db.models.employee_education import EmployeeEducation
from db.models.employee_finance import EmployeeFinance
from db.models.skill import Skill

from schemas.hr_employee import HREmployeeProfile
from schemas.skill_overview import SkillOverviewResponse
from utils.dependencies import require_any_role


router = APIRouter(prefix="/hr", tags=["HR"])


@router.get("/employees", response_model=list[HREmployeeProfile])
def hr_list_employee_profiles(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    employees = db.query(Employee).all()

    profiles: list[HREmployeeProfile] = []
    for emp in employees:
        contacts = db.query(EmployeeContact).filter_by(emp_id=emp.emp_id).all()
        skills = db.query(EmployeeSkill).filter_by(emp_id=emp.emp_id).all()
        education = db.query(EmployeeEducation).filter_by(emp_id=emp.emp_id).all()
        finance = db.query(EmployeeFinance).filter_by(emp_id=emp.emp_id).first()

        profiles.append(
            HREmployeeProfile(
                employee=emp,
                contacts=contacts,
                skills=skills,
                education=education,
                finance=finance,
            )
        )

    return profiles


@router.get("/employees/{emp_id}", response_model=HREmployeeProfile)
def hr_get_employee_profile(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager")),
):
    emp = db.query(Employee).filter(Employee.emp_id == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    contacts = db.query(EmployeeContact).filter_by(emp_id=emp.emp_id).all()
    skills = db.query(EmployeeSkill).filter_by(emp_id=emp.emp_id).all()
    education = db.query(EmployeeEducation).filter_by(emp_id=emp.emp_id).all()
    finance = db.query(EmployeeFinance).filter_by(emp_id=emp.emp_id).first()

    return HREmployeeProfile(
        employee=emp,
        contacts=contacts,
        skills=skills,
        education=education,
        finance=finance,
    )


@router.get("/skills-summary", response_model=list[SkillOverviewResponse])
def hr_skills_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    rows = (
        db.query(
            Skill.skill_id,
            Skill.skill_name,
            func.count(distinct(EmployeeSkill.emp_id)).label("total_employees"),
            func.coalesce(
                func.sum(
                    case(
                        (EmployeeSkill.proficiency_level == "Junior", 1),
                        else_=0,
                    )
                ),
                0,
            ).label("junior"),
            func.coalesce(
                func.sum(
                    case(
                        (EmployeeSkill.proficiency_level == "Mid", 1),
                        else_=0,
                    )
                ),
                0,
            ).label("mid"),
            func.coalesce(
                func.sum(
                    case(
                        (EmployeeSkill.proficiency_level == "Senior", 1),
                        else_=0,
                    )
                ),
                0,
            ).label("senior"),
        )
        .outerjoin(EmployeeSkill, EmployeeSkill.skill_id == Skill.skill_id)
        .group_by(Skill.skill_id, Skill.skill_name)
        .order_by(Skill.skill_name)
        .all()
    )

    response: list[SkillOverviewResponse] = []
    for row in rows:
        response.append(
            SkillOverviewResponse(
                skill_id=row.skill_id,
                skill_name=row.skill_name,
                total_employees=int(row.total_employees or 0),
                proficiency={
                    "junior": int(row.junior or 0),
                    "mid": int(row.mid or 0),
                    "senior": int(row.senior or 0),
                },
            )
        )

    return response

