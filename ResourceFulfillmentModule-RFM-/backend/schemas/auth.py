from pydantic import BaseModel
from typing import List, Optional


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    roles: List[str]


class TokenData(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None
