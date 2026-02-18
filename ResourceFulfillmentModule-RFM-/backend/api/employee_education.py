from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_any_role
from db.models.employee_education import EmployeeEducation
from schemas.employee_education import (
    EmployeeEducationCreate,
    EmployeeEducationUpdate,
    EmployeeEducationResponse,
)

router = APIRouter(
    prefix="/employees/{emp_id}/education",
    tags=["Employee Education"]
)


@router.post("/", response_model=EmployeeEducationResponse)
def add_education(
    emp_id: str,
    payload: EmployeeEducationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Employee"))
):
    record = EmployeeEducation(emp_id=emp_id, **payload.dict())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/", response_model=list[EmployeeEducationResponse])
def list_education(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee"))
):
    return (
        db.query(EmployeeEducation)
        .filter(EmployeeEducation.emp_id == emp_id)
        .order_by(EmployeeEducation.year_completed.desc())
        .all()
    )


@router.patch("/{edu_id}", response_model=EmployeeEducationResponse)
def update_education(
    emp_id: str,
    edu_id: int,
    payload: EmployeeEducationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Employee"))
):
    record = (
        db.query(EmployeeEducation)
        .filter(
            EmployeeEducation.edu_id == edu_id,
            EmployeeEducation.emp_id == emp_id,
        )
        .first()
    )

    if not record:
        raise HTTPException(status_code=404, detail="Education record not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(record, field, value)

    db.commit()
    db.refresh(record)
    return record


@router.delete("/{edu_id}")
def delete_education(
    emp_id: str,
    edu_id: int,
    db: Session = Depends(get_db),
):
    record = (
        db.query(EmployeeEducation)
        .filter(
            EmployeeEducation.edu_id == edu_id,
            EmployeeEducation.emp_id == emp_id,
        )
        .first()
    )

    if not record:
        raise HTTPException(status_code=404, detail="Education record not found")

    db.delete(record)
    db.commit()

    return {"message": "Education record deleted successfully"}
