from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import json
from sqlalchemy import func, or_

from db.session import get_db
from db.models.auth import User, Role, UserRole
from db.models.user_employee_map import UserEmployeeMap
from db.models.employee import Employee
from utils.dependencies import require_role, require_any_role

from schemas.user import UserCreate, UserAdminUpdate
from schemas.role import AssignRoleRequest
from schemas.user_employee import LinkUserEmployeeRequest

from utils.security import hash_password
from db.models.audit_log import AuditLog

router = APIRouter(prefix="/users", tags=["Users"])
admin_router = APIRouter(prefix="/admin/users", tags=["Admin Users"])


def _get_user_roles(db: Session, user_id: int) -> list[str]:
    roles_result = (
        db.query(Role.role_name)
        .join(UserRole, Role.role_id == UserRole.role_id)
        .filter(UserRole.user_id == user_id)
        .all()
    )
    return [role[0] for role in roles_result]


def _sync_user_employee_link(db: Session, user_id: int, employee_id: str | None):
    """
    Keep the legacy user_employee_map aligned with the new users.employee_id.
    This avoids breaking existing endpoints that rely on the map.
    """
    db.query(UserEmployeeMap).filter(UserEmployeeMap.user_id == user_id).delete()
    if employee_id:
        db.add(UserEmployeeMap(user_id=user_id, emp_id=employee_id))


def _log_user_audit(
    db: Session,
    action: str,
    actor_user_id: int,
    target_user_id: int | None,
    old_value: dict | None = None,
    new_value: dict | None = None,
):
    audit = AuditLog(
        entity_name="user",
        entity_id=str(target_user_id) if target_user_id else None,
        action=action,
        performed_by=actor_user_id,
        target_user_id=target_user_id,
        old_value=json.dumps(old_value) if old_value is not None else None,
        new_value=json.dumps(new_value) if new_value is not None else None,
    )
    db.add(audit)
    db.commit()

'''
# GET /users  → List users with roles
@router.get("/")
def get_users(db: Session = Depends(get_db)):
    results = (
        db.query(User, UserEmployeeMap.emp_id)
        .join(UserEmployeeMap)
        .all()
    )

    response = []
    for user, emp_id in results:
        response.append({
            "user_id": user.user_id,
            "username": user.username,
            "emp_id": emp_id,
            "is_active": user.is_active
        })

    return response
'''
@router.get("/")
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR", "TA"))
):
    results = (
        db.query(
            User.user_id,
            User.username,
            User.is_active,
            func.coalesce(User.employee_id, UserEmployeeMap.emp_id).label("employee_id"),
            func.coalesce(func.array_agg(Role.role_name), []).label("roles")
        )
        .outerjoin(UserEmployeeMap, User.user_id == UserEmployeeMap.user_id)
        .outerjoin(UserRole, User.user_id == UserRole.user_id)
        .outerjoin(Role, Role.role_id == UserRole.role_id)
        .group_by(User.user_id, UserEmployeeMap.emp_id, User.employee_id)
        .all()
    )

    response = []
    for row in results:
        response.append({
            "user_id": row.user_id,
            "username": row.username,
            "emp_id": row.employee_id,      # None if user not linked to employee
            "is_active": row.is_active,
            "roles": row.roles         # [] if no roles
        })

    return response


@admin_router.get("/")
def admin_list_users(
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    query = (
        db.query(
            User.user_id,
            User.username,
            User.is_active,
            func.coalesce(User.employee_id, UserEmployeeMap.emp_id).label("employee_id"),
            Employee.full_name.label("employee_name"),
            Employee.rbm_email.label("employee_email"),
            func.coalesce(func.array_agg(Role.role_name), []).label("roles")
        )
        .outerjoin(UserEmployeeMap, User.user_id == UserEmployeeMap.user_id)
        .outerjoin(Employee, Employee.emp_id == User.employee_id)
        .outerjoin(UserRole, User.user_id == UserRole.user_id)
        .outerjoin(Role, Role.role_id == UserRole.role_id)
    )

    if search:
        like = f"%{search}%"
        query = query.filter(
            or_(
                User.username.ilike(like),
                Employee.emp_id.ilike(like),
                Employee.rbm_email.ilike(like),
                Role.role_name.ilike(like),
            )
        )

    results = (
        query.group_by(
            User.user_id,
            UserEmployeeMap.emp_id,
            User.employee_id,
            Employee.full_name,
            Employee.rbm_email,
        )
        .all()
    )

    response = []
    for row in results:
        response.append({
            "user_id": row.user_id,
            "username": row.username,
            "emp_id": row.employee_id,
            "employee": (
                {
                    "id": row.employee_id,
                    "name": row.employee_name,
                    "email": row.employee_email,
                }
                if row.employee_id
                else None
            ),
            "is_active": row.is_active,
            "roles": row.roles,
        })

    _log_user_audit(
        db=db,
        action="USER_VIEW",
        actor_user_id=current_user.user_id,
        target_user_id=None,
        new_value={"count": len(response)},
    )

    return response


@admin_router.put("/{user_id}")
def admin_update_user(
    user_id: int,
    payload: UserAdminUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_roles = _get_user_roles(db, user_id)
    old_is_active = user.is_active
    old_employee_id = user.employee_id

    if payload.roles is not None:
        db.query(UserRole).filter(UserRole.user_id == user_id).delete()
        for role_name in payload.roles:
            role = db.query(Role).filter(Role.role_name == role_name).first()
            if not role:
                raise HTTPException(status_code=404, detail=f"Role not found: {role_name}")
            db.add(UserRole(user_id=user_id, role_id=role.role_id))

    if payload.is_active is not None:
        user.is_active = payload.is_active

    if payload.employee_id is not None:
        if payload.employee_id == "":
            user.employee_id = None
        else:
            employee = db.query(Employee).filter(Employee.emp_id == payload.employee_id).first()
            if not employee:
                raise HTTPException(status_code=404, detail="Employee not found")
            existing_link = (
                db.query(User)
                .filter(User.employee_id == payload.employee_id, User.user_id != user_id)
                .first()
            )
            if existing_link:
                raise HTTPException(status_code=400, detail="Employee already linked to another user")
            user.employee_id = payload.employee_id

    db.commit()

    if payload.employee_id is not None:
        _sync_user_employee_link(db, user_id, user.employee_id)

    if payload.roles is not None and payload.roles != old_roles:
        _log_user_audit(
            db=db,
            action="USER_ROLE_UPDATE",
            actor_user_id=current_user.user_id,
            target_user_id=user_id,
            old_value={"roles": old_roles},
            new_value={"roles": payload.roles},
        )

    if payload.employee_id is not None and payload.employee_id != old_employee_id:
        _log_user_audit(
            db=db,
            action="USER_EDIT",
            actor_user_id=current_user.user_id,
            target_user_id=user_id,
            old_value={"employee_id": old_employee_id},
            new_value={"employee_id": user.employee_id},
        )

    if payload.is_active is not None and payload.is_active != old_is_active:
        _log_user_audit(
            db=db,
            action="USER_DELETE" if payload.is_active is False else "USER_EDIT",
            actor_user_id=current_user.user_id,
            target_user_id=user_id,
            old_value={"is_active": old_is_active},
            new_value={"is_active": user.is_active},
        )

    return {"message": "User updated"}


@admin_router.delete("/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_state = {
        "roles": _get_user_roles(db, user_id),
        "is_active": user.is_active,
    }

    # Soft delete
    user.is_active = False
    db.commit()

    _log_user_audit(
        db=db,
        action="USER_DELETE",
        actor_user_id=current_user.user_id,
        target_user_id=user_id,
        old_value=old_state,
        new_value={"is_active": False},
    )

    return {"message": "User deactivated"}

# ------------------------------------------------------------------
# POST /users  → Create user
# ------------------------------------------------------------------
@router.post("/")
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):

    # bcrypt hard limit: 72 BYTES
    if len(payload.password.encode("utf-8")) > 72:
        raise HTTPException(
            status_code=400,
            detail="Password too long (maximum 72 bytes)"
        )

    existing_user = (
        db.query(User)
        .filter(User.username == payload.username)
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username already exists"
        )

    hashed_password = hash_password(payload.password)

    new_user = User(
        username=payload.username,
        password_hash=hashed_password,
        is_active=True
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "message": "User created successfully",
        "user_id": new_user.user_id
    }


# ------------------------------------------------------------------
# POST /users/{user_id}/roles  → Assign role
# ------------------------------------------------------------------
@router.post("/{user_id}/roles")
def assign_role_to_user(
    user_id: int,
    payload: AssignRoleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    role = db.query(Role).filter(Role.role_name == payload.role_name).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    existing_assignment = (
        db.query(UserRole)
        .filter(
            UserRole.user_id == user_id,
            UserRole.role_id == role.role_id
        )
        .first()
    )

    if existing_assignment:
        raise HTTPException(
            status_code=400,
            detail="Role already assigned to user"
        )

    user_role = UserRole(
        user_id=user_id,
        role_id=role.role_id
    )

    db.add(user_role)
    db.commit()

    return {
        "message": "Role assigned successfully"
    }


# ------------------------------------------------------------------
# POST /users/link-employee  → Link user to employee
# ------------------------------------------------------------------
@router.post("/link-employee")
def link_user_employee(
    payload: LinkUserEmployeeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Admin"))
):
    # 1. Validate user exists
    user = db.query(User).filter(User.user_id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # 2. Validate employee exists
    employee = db.query(Employee).filter(Employee.emp_id == payload.emp_id).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # 3. Check user already linked
    existing_user_link = (
        db.query(UserEmployeeMap)
        .filter(UserEmployeeMap.user_id == payload.user_id)
        .first()
    )
    if existing_user_link:
        raise HTTPException(status_code=400, detail="User already linked to employee")

    # 4. Check employee already linked
    existing_emp_link = (
        db.query(UserEmployeeMap)
        .filter(UserEmployeeMap.emp_id == payload.emp_id)
        .first()
    )
    if existing_emp_link:
        raise HTTPException(status_code=400, detail="Employee already linked to a user")

    # 5. Create mapping
    link = UserEmployeeMap(
        user_id=payload.user_id,
        emp_id=payload.emp_id
    )

    db.add(link)
    db.commit()

    return {"message": "User successfully linked to employee"}