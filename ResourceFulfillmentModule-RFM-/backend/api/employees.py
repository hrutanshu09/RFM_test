from db.models.user_employee_map import UserEmployeeMap

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_any_role

from db.models.employee import Employee
from db.models.employee_assignment import EmployeeAssignment
from db.models.department import Department
from db.models.employee_skill import EmployeeSkill
from db.models.employee_contact import EmployeeContact
from db.models.employee_education import EmployeeEducation
from db.models.employee_availability import EmployeeAvailability
from db.models.employee_finance import EmployeeFinance
from db.models.skill import Skill
from db.models.company_role import CompanyRole
from schemas.employee import (
    EmployeeCreate,
    EmployeeUpdate,
    EmployeeStatusUpdate,
    EmployeeResponse,
    NextEmployeeIdResponse
)
from schemas.employee_onboard import EmployeeOnboard, EmployeeOnboardResponse
from sqlalchemy.exc import SQLAlchemyError, IntegrityError

router = APIRouter(prefix="/employees", tags=["Employees"])


def _format_employee_id(next_number: int) -> str:
    return f"RBM-{str(next_number).zfill(4)}"


def _get_next_employee_id(existing_ids: list[str]) -> str:
    numbers: set[int] = set()
    for emp_id in existing_ids:
        matches = re.findall(r"\d+", emp_id or "")
        if not matches:
            continue
        value = int(matches[0])
        if value > 0:
            numbers.add(value)

    candidate = 6
    while candidate in numbers:
        candidate += 1

    return _format_employee_id(candidate)


@router.get("/next-id", response_model=NextEmployeeIdResponse)
def get_next_employee_id(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    existing_ids = [row[0] for row in db.query(Employee.emp_id).all()]
    return NextEmployeeIdResponse(emp_id=_get_next_employee_id(existing_ids))
# API 1 — Create Employee
@router.post("/", response_model=EmployeeResponse)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    existing = db.query(Employee).filter(
        Employee.emp_id == payload.emp_id
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Employee already exists")

    employee = Employee(
        emp_id=payload.emp_id,
        full_name=payload.full_name,
        rbm_email=payload.rbm_email,
        dob=payload.dob,
        gender=payload.gender,
        doj=payload.doj,
        emp_status="Onboarding"  # Start onboarding when employee is created
    )

    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee
# API 2 — List All Employees
@router.get("/employees")
def list_employees(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee", "TA"))
):
    latest_assignment = (
        db.query(
            EmployeeAssignment.emp_id.label("emp_id"),
            func.max(EmployeeAssignment.assignment_id).label("latest_assignment_id"),
        )
        .group_by(EmployeeAssignment.emp_id)
        .subquery()
    )

    results = (
        db.query(Employee, UserEmployeeMap.user_id, Department.department_name)
        .outerjoin(UserEmployeeMap, UserEmployeeMap.emp_id == Employee.emp_id)
        .outerjoin(
            latest_assignment, latest_assignment.c.emp_id == Employee.emp_id
        )
        .outerjoin(
            EmployeeAssignment,
            EmployeeAssignment.assignment_id
            == latest_assignment.c.latest_assignment_id,
        )
        .outerjoin(Department, Department.department_id == EmployeeAssignment.department_id)
        .all()
    )

    response = []
    for emp, user_id, department_name in results:
        response.append({
            "emp_id": emp.emp_id,
            "full_name": emp.full_name,
            "user_id": user_id,
            "emp_status": emp.emp_status,
            "department_name": department_name
        })

    return response

# API 2b — Validate employee identifiers
@router.get("/validate")
def validate_employee(
    emp_id: str | None = None,
    work_email: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    emp_exists = False
    email_exists = False

    if emp_id:
        emp_exists = (
            db.query(Employee)
            .filter(Employee.emp_id == emp_id)
            .first()
            is not None
        )

    if work_email:
        email_exists = (
            db.query(EmployeeContact)
            .filter(EmployeeContact.email == work_email)
            .first()
            is not None
        )

    return {
        "emp_id_exists": emp_exists,
        "work_email_exists": email_exists,
    }

# API 2c — Multi-table onboarding
@router.post("/onboard", response_model=EmployeeOnboardResponse)
def onboard_employee(
    payload: EmployeeOnboard,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    existing = db.query(Employee).filter(Employee.emp_id == payload.emp_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Employee ID already exists")

    email_exists = (
        db.query(EmployeeContact)
        .filter(EmployeeContact.email == payload.rbm_email)
        .first()
    )
    if email_exists:
        raise HTTPException(status_code=400, detail="Work email already exists")

    if payload.company_role_id:
        role = (
            db.query(CompanyRole)
            .filter(
                CompanyRole.role_id == payload.company_role_id,
                CompanyRole.is_active.is_(True),
            )
            .first()
        )
        if not role:
            raise HTTPException(status_code=400, detail="Invalid company role")

    if payload.contacts:
        contact_types = [contact.type for contact in payload.contacts]
        if len(contact_types) != len(set(contact_types)):
            raise HTTPException(
                status_code=400,
                detail="Duplicate contact types are not allowed",
            )

    if payload.skills:
        skill_ids = [skill.skill_id for skill in payload.skills]
        existing_ids = {
            skill_id
            for (skill_id,) in db.query(Skill.skill_id)
            .filter(Skill.skill_id.in_(skill_ids))
            .all()
        }
        missing = [
            str(skill_id) for skill_id in set(skill_ids) if skill_id not in existing_ids
        ]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid skill_id(s): {', '.join(missing)}",
            )

    try:
        with db.begin_nested():
            employee = Employee(
                emp_id=payload.emp_id,
                full_name=payload.full_name,
                rbm_email=payload.rbm_email,
                dob=payload.dob,
                gender=payload.gender,
                doj=payload.doj,
                emp_status="Onboarding",
                company_role_id=payload.company_role_id,
            )
            db.add(employee)

            for contact in payload.contacts:
                contact_type = contact.type.title()
                db.add(
                    EmployeeContact(
                        emp_id=payload.emp_id,
                        contact_type=contact_type,
                        email=contact.email,
                        phone=contact.phone,
                        address=contact.address,
                    )
                )

            for skill in payload.skills:
                db.add(
                    EmployeeSkill(
                        emp_id=payload.emp_id,
                        skill_id=skill.skill_id,
                        proficiency_level=skill.proficiency_level,
                        years_experience=skill.years_experience,
                    )
                )

            for edu in payload.education:
                db.add(
                    EmployeeEducation(
                        emp_id=payload.emp_id,
                        qualification=edu.qualification,
                        specialization=edu.specialization,
                        institution=edu.institution,
                        year_completed=edu.year_completed,
                    )
                )

            if payload.availability:
                db.add(
                    EmployeeAvailability(
                        emp_id=payload.emp_id,
                        availability_pct=payload.availability.availability_pct,
                        effective_from=payload.availability.effective_from,
                    )
                )

            if payload.finance and (
                payload.finance.bank_details or payload.finance.tax_id
            ):
                db.add(
                    EmployeeFinance(
                        emp_id=payload.emp_id,
                        bank_details=payload.finance.bank_details,
                        tax_id=payload.finance.tax_id,
                    )
                )
        db.commit()
    except IntegrityError as exc:
        detail = str(getattr(exc, "orig", exc))
        raise HTTPException(
            status_code=400,
            detail=f"Failed to onboard employee due to a data constraint: {detail}",
        ) from exc
    except SQLAlchemyError as exc:
        detail = str(getattr(exc, "orig", exc))
        raise HTTPException(
            status_code=400,
            detail=f"Failed to onboard employee. Please verify the data: {detail}",
        ) from exc

    return EmployeeOnboardResponse(
        emp_id=payload.emp_id,
        message="Employee onboarded successfully",
    )

# API 3 — Get Employee by ID
@router.get("/{emp_id}", response_model=EmployeeResponse)
def get_employee(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee"))
):
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()

    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    return employee
    # API 4 — Update Employee Basic Info
@router.patch("/{emp_id}", response_model=EmployeeResponse)
def update_employee(
    emp_id: str,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()

    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(employee, field, value)

    db.commit()
    db.refresh(employee)
    return employee
# API 5 — Change Employee Status
@router.patch("/{emp_id}/status", response_model=EmployeeResponse)
def update_employee_status(
    emp_id: str,
    payload: EmployeeStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()

    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    employee.emp_status = payload.emp_status
    db.commit()
    db.refresh(employee)
    return employee

# API 6 — Complete Onboarding
@router.post("/{emp_id}/complete-onboarding", response_model=EmployeeResponse)
def complete_onboarding(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    """
    Complete employee onboarding by validating prerequisites and marking employee as Active.
    
    Prerequisites:
    - Employee profile must exist
    - Employee status must be "Onboarding"
    - At least one skill must be added
    """
    # 1. Check employee exists
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()
    
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    # 2. Check employee is in Onboarding status
    if employee.emp_status != "Onboarding":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot complete onboarding. Employee status is '{employee.emp_status}'. Only employees with status 'Onboarding' can complete onboarding."
        )
    
    # 3. Check at least one skill exists
    skill_count = db.query(EmployeeSkill).filter(
        EmployeeSkill.emp_id == emp_id
    ).count()
    
    if skill_count == 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot complete onboarding. At least one skill must be added to the employee profile."
        )
    
    # 4. Update status to Active
    employee.emp_status = "Active"
    db.commit()
    db.refresh(employee)
    
    return employee
