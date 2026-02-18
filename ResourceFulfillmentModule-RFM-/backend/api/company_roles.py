from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_any_role
from db.models.company_role import CompanyRole
from schemas.company_role import (
    CompanyRoleCreate,
    CompanyRoleUpdate,
    CompanyRoleResponse,
)

router = APIRouter(prefix="/company-roles", tags=["Company Roles"])


@router.post("/", response_model=CompanyRoleResponse)
def create_company_role(
    payload: CompanyRoleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR"))
):
    role_name = payload.role_name.strip()
    if not role_name:
        raise HTTPException(status_code=400, detail="Role name cannot be empty")

    existing = db.query(CompanyRole).filter(CompanyRole.role_name == role_name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Role name already exists")

    role = CompanyRole(
        role_name=role_name,
        role_description=payload.role_description,
        is_active=True,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


@router.get("/", response_model=list[CompanyRoleResponse])
def list_company_roles(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR"))
):
    query = db.query(CompanyRole)
    if not include_inactive:
        query = query.filter(CompanyRole.is_active.is_(True))
    return query.order_by(CompanyRole.role_name).all()


@router.get("/{role_id}", response_model=CompanyRoleResponse)
def get_company_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR"))
):
    role = db.query(CompanyRole).filter(CompanyRole.role_id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    return role


@router.put("/{role_id}", response_model=CompanyRoleResponse)
def update_company_role(
    role_id: int,
    payload: CompanyRoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR"))
):
    role = db.query(CompanyRole).filter(CompanyRole.role_id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    if payload.role_name is not None:
        role_name = payload.role_name.strip()
        if not role_name:
            raise HTTPException(status_code=400, detail="Role name cannot be empty")
        existing = (
            db.query(CompanyRole)
            .filter(
                CompanyRole.role_name == role_name,
                CompanyRole.role_id != role_id,
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Role name already exists")
        role.role_name = role_name

    if payload.role_description is not None:
        role.role_description = payload.role_description

    if payload.is_active is not None:
        role.is_active = payload.is_active

    db.commit()
    db.refresh(role)
    return role


@router.delete("/{role_id}", response_model=CompanyRoleResponse)
def delete_company_role(
    role_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR"))
):
    role = db.query(CompanyRole).filter(CompanyRole.role_id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    role.is_active = False
    db.commit()
    db.refresh(role)
    return role
