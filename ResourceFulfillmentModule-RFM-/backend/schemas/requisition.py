from pydantic import BaseModel, Field, constr, condecimal
from typing import Optional, List
from datetime import date, datetime
from schemas.requisition_item import RequisitionItemCreate, RequisitionItemResponse


class RequisitionCreate(BaseModel):
    project_name: Optional[constr(max_length=100)] = None
    client_name: Optional[constr(max_length=100)] = None
    office_location: Optional[constr(max_length=100)] = None
    work_mode: Optional[constr(max_length=10)] = None
    required_by_date: Optional[date] = None
    priority: Optional[constr(max_length=10)] = None
    justification: Optional[str] = None
    budget_amount: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    duration: Optional[constr(max_length=50)] = None
    is_replacement: Optional[bool] = None
    manager_notes: Optional[str] = None
    items: List[RequisitionItemCreate] = Field(default_factory=list)


class RequisitionUpdate(BaseModel):
    project_name: Optional[constr(max_length=100)] = None
    client_name: Optional[constr(max_length=100)] = None
    justification: Optional[str] = None
    manager_notes: Optional[str] = None
    priority: Optional[constr(max_length=10)] = None
    is_replacement: Optional[bool] = None
    duration: Optional[constr(max_length=50)] = None
    work_mode: Optional[constr(max_length=10)] = None
    office_location: Optional[constr(max_length=100)] = None
    budget_amount: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    required_by_date: Optional[date] = None
    assigned_ta: Optional[int] = None
    budget_approved_by: Optional[int] = None
    approved_by: Optional[int] = None
    approval_history: Optional[datetime] = None
    assigned_at: Optional[datetime] = None
    overall_status: Optional[str] = None


class RequisitionManagerUpdate(BaseModel):
    project_name: Optional[constr(max_length=100)] = None
    client_name: Optional[constr(max_length=100)] = None
    office_location: Optional[constr(max_length=100)] = None
    work_mode: Optional[constr(max_length=10)] = None
    required_by_date: Optional[date] = None
    priority: Optional[constr(max_length=10)] = None
    justification: Optional[str] = None
    budget_amount: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    duration: Optional[constr(max_length=50)] = None
    is_replacement: Optional[bool] = None
    manager_notes: Optional[str] = None
    items: Optional[List[RequisitionItemCreate]] = None


class RequisitionReject(BaseModel):
    reason: constr(min_length=10)


class RequisitionStatusUpdate(BaseModel):
    overall_status: str


class RequisitionAssign(BaseModel):
    ta_user_id: int


class RequisitionResponse(BaseModel):
    req_id: int
    project_name: Optional[str] = None
    client_name: Optional[str] = None
    office_location: Optional[str] = None
    work_mode: Optional[str] = None
    required_by_date: Optional[date] = None
    priority: Optional[str] = None
    justification: Optional[str] = None
    # DEPRECATED: Header-level budget_amount - use computed totals instead
    budget_amount: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    duration: Optional[str] = None
    is_replacement: Optional[bool] = None
    manager_notes: Optional[str] = None
    rejection_reason: Optional[str] = None
    jd_file_key: Optional[str] = None
    overall_status: str
    raised_by: int
    assigned_ta: Optional[int] = None
    budget_approved_by: Optional[int] = None
    approved_by: Optional[int] = None
    approval_history: Optional[datetime] = None
    assigned_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    items: List[RequisitionItemResponse] = Field(default_factory=list)
    total_items: Optional[int] = None
    fulfilled_items: Optional[int] = None
    cancelled_items: Optional[int] = None
    active_items: Optional[int] = None
    progress_ratio: Optional[float] = None
    progress_text: Optional[str] = None
    # Computed budget totals (from items)
    total_estimated_budget: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    total_approved_budget: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    budget_approval_status: Optional[str] = None  # 'pending', 'partial', 'approved', 'none'

    class Config:
        from_attributes = True
