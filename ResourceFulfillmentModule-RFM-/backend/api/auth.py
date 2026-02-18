from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from db.session import get_db
from db.models.auth import User, Role, UserRole
from schemas.auth import LoginRequest, TokenResponse
from utils.security import verify_password
from utils.jwt import create_access_token

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Authenticate user and return JWT token with user info and roles.
    """
    # 1. Find user by username
    user = db.query(User).filter(User.username == payload.username).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    # 2. Check if user is active
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    # 3. Verify password
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    # 4. Get user roles
    roles_result = (
        db.query(Role.role_name)
        .join(UserRole, Role.role_id == UserRole.role_id)
        .filter(UserRole.user_id == user.user_id)
        .all()
    )
    roles = [role[0] for role in roles_result]  # Extract role names from tuples
    
    # 5. Create JWT token
    token_data = {
        "sub": str(user.user_id),  # Subject (user_id as string for JWT standard)
        "username": user.username,
        "roles": roles
    }
    access_token = create_access_token(data=token_data)
    
    # 6. Update last_login (optional)
    from datetime import datetime
    user.last_login = datetime.utcnow()
    db.commit()
    
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user_id=user.user_id,
        username=user.username,
        roles=roles
    )
