from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_role, require_any_role
from db.models.employee import Employee
from db.models.department import Department
from db.models.location import Location
from db.models.employee_assignment import EmployeeAssignment
from db.models.audit_log import AuditLog
from schemas.org import (
    DepartmentCreate, DepartmentResponse,
    LocationCreate, LocationResponse,
    AssignmentCreate, AssignmentResponse
)

from schemas.department import DepartmentUpdate
from schemas.location import LocationUpdate
from schemas.employee_assignment import AssignmentEnd

router = APIRouter(tags=["Organization"])
# ---------- DEPARTMENTS ----------
@router.post("/departments/", response_model=DepartmentResponse)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    existing = db.query(Department).filter(
        Department.department_name == payload.department_name
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Department already exists")

    dept = Department(department_name=payload.department_name)
    db.add(dept)
    db.commit()
    db.refresh(dept)

    audit = AuditLog(
        entity_name="department",
        entity_id=str(dept.department_id),
        action="CREATE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()
    return dept


@router.get("/departments/", response_model=list[DepartmentResponse])
def list_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR", "Manager"))
):
    departments = db.query(Department).all()

    audit_logs = (
        db.query(AuditLog)
        .filter(AuditLog.entity_name == "department", AuditLog.action == "CREATE")
        .all()
    )
    audit_by_entity = {log.entity_id: log for log in audit_logs}
    user_ids = {log.performed_by for log in audit_logs if log.performed_by}
    users_by_id = {
        user.user_id: user.username
        for user in db.query(User).filter(User.user_id.in_(user_ids)).all()
    } if user_ids else {}

    response: list[DepartmentResponse] = []
    for dept in departments:
        audit = audit_by_entity.get(str(dept.department_id))
        response.append(
            DepartmentResponse(
                department_id=dept.department_id,
                department_name=dept.department_name,
                created_by=users_by_id.get(audit.performed_by) if audit else None,
                created_at=audit.performed_at if audit else None,
            )
        )

    return response

# ---------- LOCATIONS ----------
@router.post("/locations/", response_model=LocationResponse)
def create_location(
    payload: LocationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    loc = Location(city=payload.city, country=payload.country)
    db.add(loc)
    db.commit()
    db.refresh(loc)

    audit = AuditLog(
        entity_name="location",
        entity_id=str(loc.location_id),
        action="CREATE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()
    return loc


@router.get("/locations/", response_model=list[LocationResponse])
def list_locations(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR", "Manager"))
):
    locations = db.query(Location).all()

    audit_logs = (
        db.query(AuditLog)
        .filter(AuditLog.entity_name == "location", AuditLog.action == "CREATE")
        .all()
    )
    audit_by_entity = {log.entity_id: log for log in audit_logs}
    user_ids = {log.performed_by for log in audit_logs if log.performed_by}
    users_by_id = {
        user.user_id: user.username
        for user in db.query(User).filter(User.user_id.in_(user_ids)).all()
    } if user_ids else {}

    response: list[LocationResponse] = []
    for loc in locations:
        audit = audit_by_entity.get(str(loc.location_id))
        response.append(
            LocationResponse(
                location_id=loc.location_id,
                city=loc.city,
                country=loc.country,
                created_by=users_by_id.get(audit.performed_by) if audit else None,
                created_at=audit.performed_at if audit else None,
            )
        )

    return response

#EMPLOYEE ASSIGNMENTS API Assign Employee

@router.post(
    "/employees/{emp_id}/assignments",
    response_model=AssignmentResponse
)
def assign_employee(
    emp_id: str,
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager"))
):
    employee = db.query(Employee).filter(Employee.emp_id == emp_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    assignment = EmployeeAssignment(
        emp_id=emp_id,
        department_id=payload.department_id,
        manager_id=payload.manager_id,
        location_id=payload.location_id,
        start_date=payload.start_date,
        end_date=payload.end_date
    )


    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment
#View Assignment History
@router.get(
    "/employees/{emp_id}/assignments",
    response_model=list[AssignmentResponse]
)
def get_assignment_history(
    emp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee"))
):
    return (
        db.query(EmployeeAssignment)
        .filter(EmployeeAssignment.emp_id == emp_id)
        .order_by(EmployeeAssignment.start_date.desc())
        .all()
    )
#Update Department
@router.patch(
    "/departments/{department_id}",
    response_model=DepartmentResponse
)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    dept = db.query(Department).filter(
        Department.department_id == department_id
    ).first()

    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    dept.department_name = payload.department_name
    db.commit()
    db.refresh(dept)

    audit = AuditLog(
        entity_name="department",
        entity_id=str(dept.department_id),
        action="UPDATE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()

    return dept
#Update Location
@router.patch(
    "/locations/{location_id}",
    response_model=LocationResponse
)
def update_location(
    location_id: int,
    payload: LocationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    loc = db.query(Location).filter(
        Location.location_id == location_id
    ).first()

    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    if payload.city is not None:
        loc.city = payload.city
    if payload.country is not None:
        loc.country = payload.country

    db.commit()
    db.refresh(loc)

    audit = AuditLog(
        entity_name="location",
        entity_id=str(loc.location_id),
        action="UPDATE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()

    return loc


@router.delete("/departments/{department_id}")
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    dept = db.query(Department).filter(
        Department.department_id == department_id
    ).first()

    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")

    db.delete(dept)
    db.commit()

    audit = AuditLog(
        entity_name="department",
        entity_id=str(department_id),
        action="DELETE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()

    return {"message": "Department deleted"}


@router.delete("/locations/{location_id}")
def delete_location(
    location_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    loc = db.query(Location).filter(
        Location.location_id == location_id
    ).first()

    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")

    db.delete(loc)
    db.commit()

    audit = AuditLog(
        entity_name="location",
        entity_id=str(location_id),
        action="DELETE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()

    return {"message": "Location deleted"}

@router.patch(
    "/assignments/{assignment_id}/end",
    response_model=AssignmentResponse
)
def end_assignment(
    assignment_id: int,
    payload: AssignmentEnd,
    db: Session = Depends(get_db)
):
    assignment = db.query(EmployeeAssignment).filter(
        EmployeeAssignment.assignment_id == assignment_id
    ).first()

    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if assignment.end_date:
        raise HTTPException(
            status_code=400,
            detail="Assignment already closed"
        )

    if payload.end_date < assignment.start_date:
        raise HTTPException(
            status_code=400,
            detail="End date cannot be before start date"
        )

    assignment.end_date = payload.end_date
    db.commit()
    db.refresh(assignment)
    return assignment
