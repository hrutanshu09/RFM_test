"""
RBAC Dependencies for FastAPI routes.
Use these dependencies to protect endpoints based on user roles.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from typing import List, Optional

from db.session import get_db
from db.models.auth import User, Role, UserRole
from db.models.candidate import Candidate
from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem
from utils.jwt import verify_token

# Message returned when TA is not the owner of the requisition/item
TA_OWNERSHIP_DENIED_MESSAGE = (
    "Access Denied: You are not the assigned TA for this requisition."
)

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """
    Dependency to get the current authenticated user from JWT token.
    
    Usage:
        @router.get("/protected")
        def protected_route(current_user: User = Depends(get_current_user)):
            return {"user_id": current_user.user_id}
    """
    token = credentials.credentials
    payload = verify_token(token)
    
    user_id: Optional[int] = int(payload.get("sub"))
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    return user


def get_current_user_roles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> List[str]:
    """
    Dependency to get the current user's roles.
    
    Usage:
        @router.get("/admin-only")
        def admin_route(roles: List[str] = Depends(get_current_user_roles)):
            if "Admin" not in roles:
                raise HTTPException(403, "Admin access required")
    """
    roles_result = (
        db.query(Role.role_name)
        .join(UserRole, Role.role_id == UserRole.role_id)
        .filter(UserRole.user_id == current_user.user_id)
        .all()
    )
    return [role[0] for role in roles_result]


def require_role(required_role: str):
    """
    Dependency factory to require a specific role.
    
    Usage:
        @router.get("/hr-only")
        def hr_route(user: User = Depends(require_role("HR"))):
            return {"message": "HR access granted"}
    """
    def role_checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> User:
        roles_result = (
            db.query(Role.role_name)
            .join(UserRole, Role.role_id == UserRole.role_id)
            .filter(UserRole.user_id == current_user.user_id)
            .all()
        )
        user_roles = [role[0] for role in roles_result]
        
        if required_role not in user_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: {required_role}"
            )
        
        return current_user
    
    return role_checker


def require_any_role(*required_roles: str):
    """
    Dependency factory to require any one of the specified roles.
    
    Usage:
        @router.get("/hr-or-admin")
        def hr_or_admin_route(user: User = Depends(require_any_role("HR", "Admin"))):
            return {"message": "Access granted"}
    """
    def role_checker(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db)
    ) -> User:
        roles_result = (
            db.query(Role.role_name)
            .join(UserRole, Role.role_id == UserRole.role_id)
            .filter(UserRole.user_id == current_user.user_id)
            .all()
        )
        user_roles = [role[0] for role in roles_result]
        
        if not any(role in user_roles for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required one of: {', '.join(required_roles)}"
            )
        
        return current_user
    
    return role_checker


def _is_hr_or_admin(roles: List[str]) -> bool:
    return "HR" in roles or "Admin" in roles


def _resolve_assigned_ta_id(item: RequisitionItem, requisition: Optional[Requisition]) -> Optional[int]:
    """Item-level is source of truth; fall back to header-level for backward compatibility."""
    if item.assigned_ta is not None:
        return item.assigned_ta
    if requisition is not None and requisition.assigned_ta is not None:
        return requisition.assigned_ta
    return None


def _check_ta_ownership_for_candidate_impl(
    db: Session,
    candidate_id: int,
    current_user: User,
    roles: List[str],
) -> None:
    candidate = (
        db.query(Candidate)
        .filter(Candidate.candidate_id == candidate_id)
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    item = (
        db.query(RequisitionItem)
        .filter(RequisitionItem.item_id == candidate.requisition_item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requisition item not found")
    requisition = (
        db.query(Requisition)
        .filter(Requisition.req_id == item.req_id)
        .first()
    )
    assigned_ta_id = _resolve_assigned_ta_id(item, requisition)
    if _is_hr_or_admin(roles):
        return
    if assigned_ta_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=TA_OWNERSHIP_DENIED_MESSAGE,
        )
    if assigned_ta_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=TA_OWNERSHIP_DENIED_MESSAGE,
        )


def require_ta_ownership_for_candidate(
    candidate_id: int,
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
    db: Session = Depends(get_db),
) -> User:
    """
    Dependency: ensure current user is the assigned TA for the candidate's requisition (or item).
    HR/Admin bypass. Use on PATCH/DELETE /candidates/{candidate_id} and any route that has candidate_id in path.
    """
    _check_ta_ownership_for_candidate_impl(
        db=db,
        candidate_id=candidate_id,
        current_user=current_user,
        roles=roles,
    )
    return current_user


def check_ta_ownership_for_candidate(
    db: Session,
    candidate_id: int,
    current_user: User,
    roles: List[str],
) -> None:
    """
    Callable helper: raise 403 if current user is not the assigned TA for the candidate.
    Use in routes where candidate_id comes from body (e.g. POST /interviews/).
    """
    _check_ta_ownership_for_candidate_impl(
        db=db,
        candidate_id=candidate_id,
        current_user=current_user,
        roles=roles,
    )


def require_ta_ownership_for_requisition_item(
    requisition_item_id: int,
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
    db: Session = Depends(get_db),
) -> User:
    """
    Dependency: ensure current user is the assigned TA for the given requisition item.
    HR/Admin bypass. Use when path has requisition_item_id.
    """
    _check_ta_ownership_for_requisition_item_impl(
        db=db,
        requisition_item_id=requisition_item_id,
        current_user=current_user,
        roles=roles,
    )
    return current_user


def check_ta_ownership_for_requisition_item(
    db: Session,
    requisition_item_id: int,
    current_user: User,
    roles: List[str],
) -> None:
    """
    Callable helper: raise 403 if current user is not the assigned TA for the item.
    Use in routes where item_id comes from body (e.g. POST /candidates/).
    """
    _check_ta_ownership_for_requisition_item_impl(
        db=db,
        requisition_item_id=requisition_item_id,
        current_user=current_user,
        roles=roles,
    )


def _check_ta_ownership_for_requisition_item_impl(
    db: Session,
    requisition_item_id: int,
    current_user: User,
    roles: List[str],
) -> None:
    item = (
        db.query(RequisitionItem)
        .filter(RequisitionItem.item_id == requisition_item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requisition item not found")
    requisition = (
        db.query(Requisition)
        .filter(Requisition.req_id == item.req_id)
        .first()
    )
    assigned_ta_id = _resolve_assigned_ta_id(item, requisition)
    if _is_hr_or_admin(roles):
        return
    if assigned_ta_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=TA_OWNERSHIP_DENIED_MESSAGE,
        )
    if assigned_ta_id != current_user.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=TA_OWNERSHIP_DENIED_MESSAGE,
        )


def validate_status_transition(current_status: str, new_status: str) -> None:
    """
    Validate requisition status transitions.

    Allowed transitions:
    Pending Budget Approval -> Pending HR Approval or Rejected
    Pending HR Approval -> Approved & Unassigned or Rejected
    Approved & Unassigned -> Active
    Active -> Closed
    """
    allowed_transitions = {
        "Pending Budget Approval": {"Pending HR Approval", "Rejected"},
        "Pending HR Approval": {"Approved & Unassigned", "Rejected"},
        "Approved & Unassigned": {"Active"},
        "Active": {"Closed", "Fulfilled"},
    }

    if current_status == new_status:
        return

    if new_status not in allowed_transitions.get(current_status, set()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid status transition: {current_status} -> {new_status}"
            ),
        )
