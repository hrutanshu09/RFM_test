from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_any_role
from db.models.employee_contact import EmployeeContact
from db.models.employee import Employee
from schemas.employee_contact import (
    EmployeeContactUpsert,
    EmployeeContactResponse
)

router = APIRouter(
    prefix="/employees/{emp_id}/contacts",
    tags=["Employee Contacts"]
)
@router.post("/", response_model=EmployeeContactResponse)
def upsert_contact(
    emp_id: str,
    payload: EmployeeContactUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Employee"))
):
    # Ensure employee exists
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    contact = (
        db.query(EmployeeContact)
        .filter(
            EmployeeContact.emp_id == emp_id,
            EmployeeContact.contact_type == payload.contact_type
        )
        .first()
    )

    if contact:
        # UPDATE
        if payload.email is not None:
            contact.email = payload.email
        if payload.phone is not None:
            contact.phone = payload.phone
        if payload.address is not None:
            contact.address = payload.address
    else:
        # INSERT
        contact = EmployeeContact(
            emp_id=emp_id,
            contact_type=payload.contact_type,
            email=payload.email,
            phone=payload.phone,
            address=payload.address
        )
        db.add(contact)

    db.commit()
    db.refresh(contact)

    return contact

@router.get("/", response_model=list[EmployeeContactResponse])
def list_contacts(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee"))
):
    return (
        db.query(EmployeeContact)
        .filter(EmployeeContact.emp_id == emp_id)
        .all()
    )
@router.get("/{contact_type}", response_model=EmployeeContactResponse)
def get_contact(
    emp_id: str,
    contact_type: str,
    db: Session = Depends(get_db)
):
    contact = (
        db.query(EmployeeContact)
        .filter(
            EmployeeContact.emp_id == emp_id,
            EmployeeContact.contact_type == contact_type
        )
        .first()
    )

    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    return contact
@router.delete("/{contact_type}")
def delete_contact(
    emp_id: str,
    contact_type: str,
    db: Session = Depends(get_db)
):
    contact = (
        db.query(EmployeeContact)
        .filter(
            EmployeeContact.emp_id == emp_id,
            EmployeeContact.contact_type == contact_type
        )
        .first()
    )

    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    db.delete(contact)
    db.commit()

    return {"message": "Contact deleted successfully"}
