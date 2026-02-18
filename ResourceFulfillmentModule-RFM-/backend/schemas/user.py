from pydantic import BaseModel
from typing import Optional, List


class UserCreate(BaseModel):
    username: str
    password: str


class UserAdminUpdate(BaseModel):
    roles: Optional[List[str]] = None
    is_active: Optional[bool] = None
    employee_id: Optional[str] = None
