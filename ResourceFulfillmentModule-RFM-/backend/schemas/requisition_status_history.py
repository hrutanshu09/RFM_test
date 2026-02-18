from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class RequisitionStatusHistoryCreate(BaseModel):
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    changed_by: Optional[int] = None
    justification: Optional[str] = None


class RequisitionStatusHistoryResponse(BaseModel):
    history_id: int
    req_id: int
    old_status: Optional[str]
    new_status: Optional[str]
    changed_by: Optional[int]
    justification: Optional[str]
    changed_at: datetime

    class Config:
        from_attributes = True
