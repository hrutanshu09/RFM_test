from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AuditLogCreate(BaseModel):
    entity_name: str
    entity_id: Optional[str] = None
    action: str
    performed_by: Optional[int] = None
    target_user_id: Optional[int] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None


class AuditLogResponse(BaseModel):
    audit_id: int
    entity_name: str
    entity_id: Optional[str]
    action: str
    performed_by: Optional[int]
    target_user_id: Optional[int] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    performed_at: datetime

    class Config:
        from_attributes = True
