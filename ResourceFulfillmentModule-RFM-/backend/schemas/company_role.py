from typing import Optional
from datetime import datetime

from pydantic import BaseModel, Field


class CompanyRoleCreate(BaseModel):
    role_name: str = Field(..., min_length=1)
    role_description: Optional[str] = None


class CompanyRoleUpdate(BaseModel):
    role_name: Optional[str] = Field(None, min_length=1)
    role_description: Optional[str] = None
    is_active: Optional[bool] = None


class CompanyRoleResponse(BaseModel):
    role_id: int
    role_name: str
    role_description: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
