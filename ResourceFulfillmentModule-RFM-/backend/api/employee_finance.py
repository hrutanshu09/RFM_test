from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from db.models.auth import User
from db.models.employee_finance import EmployeeFinance
from schemas.employee_finance import (
    EmployeeFinanceCreate,
    EmployeeFinanceResponse
)
from utils.dependencies import require_any_role

router = APIRouter(
    prefix="/employees/{emp_id}/finance",
    tags=["Employee Finance"]
)

# CREATE or UPDATE
@router.post("/", response_model=EmployeeFinanceResponse)
def create_or_update_finance(
    emp_id: str,
    payload: EmployeeFinanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    record = db.query(EmployeeFinance).filter_by(emp_id=emp_id).first()

    if record:
        record.bank_details = payload.bank_details
        record.tax_id = payload.tax_id
    else:
        record = EmployeeFinance(
            emp_id=emp_id,
            bank_details=payload.bank_details,
            tax_id=payload.tax_id
        )
        db.add(record)

    db.commit()
    db.refresh(record)
    return record


# READ
@router.get("/", response_model=EmployeeFinanceResponse)
def get_finance(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    record = db.query(EmployeeFinance).filter_by(emp_id=emp_id).first()
    if not record:
        return EmployeeFinanceResponse(emp_id=emp_id, bank_details=None, tax_id=None)

    return record
