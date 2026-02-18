from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
import json

from db.session import get_db
from db.models.auth import User, Role, UserRole
from db.models.employee import Employee
from db.models.skill import Skill
from db.models.location import Location
from db.models.department import Department
from db.models.audit_log import AuditLog
from utils.dependencies import require_role

router = APIRouter(prefix="/admin", tags=["Admin Overview"])


@router.get("/overview")
def get_admin_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin")),
):
    total_users = db.query(func.count(User.user_id)).scalar() or 0
    total_employees = db.query(func.count(Employee.emp_id)).scalar() or 0
    total_skills = db.query(func.count(Skill.skill_id)).scalar() or 0
    total_locations = db.query(func.count(Location.location_id)).scalar() or 0
    total_departments = db.query(func.count(Department.department_id)).scalar() or 0

    roles_rows = (
        db.query(Role.role_name, func.count(UserRole.user_id))
        .outerjoin(UserRole, Role.role_id == UserRole.role_id)
        .group_by(Role.role_name)
        .all()
    )
    roles_breakdown = {role_name: count for role_name, count in roles_rows}

    overview_payload = {
        "total_users": total_users,
        "total_employees": total_employees,
        "total_skills": total_skills,
        "total_locations": total_locations,
        "total_departments": total_departments,
        "roles_breakdown": roles_breakdown,
    }

    audit = AuditLog(
        entity_name="overview",
        entity_id=None,
        action="OVERVIEW_VIEW",
        performed_by=current_user.user_id,
        new_value=json.dumps(overview_payload),
    )
    db.add(audit)
    db.commit()

    return overview_payload
