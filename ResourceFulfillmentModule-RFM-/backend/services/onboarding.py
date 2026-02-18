"""
Create Employee record from a hired candidate (HR Onboarding sync).
Used when a TA marks a candidate as Hired: create Employee, then fulfill requisition item.
"""

import uuid

from sqlalchemy.orm import Session

from db.models.candidate import Candidate
from db.models.employee import Employee


def generate_emp_id() -> str:
    """Generate a unique emp_id (max 20 chars). Format: EMP + 17 hex chars."""
    return "EMP" + uuid.uuid4().hex[:17]


def create_employee_from_candidate(db: Session, candidate: Candidate) -> Employee:
    """
    Create a new Employee from a candidate (onboarding).
    Copies full_name, email as rbm_email; emp_status = "Onboarding".
    Resume remains on candidate record for reference.
    """
    emp_id = generate_emp_id()
    # Ensure rbm_email is unique; if candidate email exists, use it (may need to handle duplicates)
    rbm_email = (candidate.email or "").strip() or f"onboarding-{candidate.candidate_id}@placeholder.local"
    # If duplicate email, append suffix
    existing = db.query(Employee).filter(Employee.rbm_email == rbm_email).first()
    if existing:
        rbm_email = f"onboarding-{candidate.candidate_id}-{uuid.uuid4().hex[:8]}@placeholder.local"
    full_name = (candidate.full_name or "").strip() or "Unknown"
    if len(full_name) > 100:
        full_name = full_name[:100]
    employee = Employee(
        emp_id=emp_id,
        full_name=full_name,
        rbm_email=rbm_email,
        emp_status="Onboarding",
    )
    db.add(employee)
    db.flush()
    return employee
