from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_any_role
from db.models.employee import Employee
from db.models.employee_availability import EmployeeAvailability
from schemas.employee_availability import (
    AvailabilityCreate,
    AvailabilityResponse,
)


router = APIRouter(
    prefix="/employees",
    tags=["Employee Availability"]
)

@router.post("/{emp_id}/availability")
def add_availability(
    emp_id: str,
    payload: AvailabilityCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee"))
):
    # 1️⃣ Ensure employee exists
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # 2️⃣ Prevent duplicate (same date)
    existing = db.query(EmployeeAvailability).filter(
        EmployeeAvailability.emp_id == emp_id,
        EmployeeAvailability.effective_from == payload.effective_from,
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Availability already exists for this date"
        )

    # 3️⃣ Insert new record
    record = EmployeeAvailability(
        emp_id=emp_id,
        availability_pct=payload.availability_pct,
        effective_from=payload.effective_from,
    )

    db.add(record)
    db.commit()

    return {"message": "Availability added successfully"}

@router.post("/{emp_id}/availability")
def add_availability(
    emp_id: str,
    payload: AvailabilityCreate,
    db: Session = Depends(get_db),
):
    # 1️⃣ Ensure employee exists
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # 2️⃣ Prevent duplicate (same date)
    existing = db.query(EmployeeAvailability).filter(
        EmployeeAvailability.emp_id == emp_id,
        EmployeeAvailability.effective_from == payload.effective_from,
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Availability already exists for this date"
        )

    # 3️⃣ Insert new record
    record = EmployeeAvailability(
        emp_id=emp_id,
        availability_pct=payload.availability_pct,
        effective_from=payload.effective_from,
    )

    db.add(record)
    db.commit()

    return {"message": "Availability added successfully"}


@router.get(
    "/{emp_id}/availability",
    response_model=list[AvailabilityResponse],
)
def get_availability_history(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee", "TA"))
):
    return (
        db.query(EmployeeAvailability)
        .filter(EmployeeAvailability.emp_id == emp_id)
        .order_by(EmployeeAvailability.effective_from)
        .all()
    )
