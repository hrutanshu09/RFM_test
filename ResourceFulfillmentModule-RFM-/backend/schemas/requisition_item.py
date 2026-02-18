from pydantic import BaseModel, Field, condecimal, validator
from typing import Optional, Annotated
from decimal import Decimal
import re


class RequisitionItemCreate(BaseModel):
    role_position: Annotated[str, Field(min_length=2, max_length=50)]
    job_description: Annotated[str, Field(min_length=5)]
    skill_level: Optional[Annotated[str, Field(max_length=30)]] = None
    experience_years: Optional[Annotated[int, Field(ge=0)]] = None
    education_requirement: Optional[Annotated[str, Field(max_length=100)]] = None
    requirements: Optional[str] = None
    replacement_hire: bool = False
    replaced_emp_id: Optional[str] = None
    # Budget fields (item-level)
    estimated_budget: Optional[condecimal(max_digits=12, decimal_places=2, ge=Decimal('0'))] = Decimal('0')
    currency: Optional[Annotated[str, Field(max_length=10, pattern=r'^[A-Z]{2,10}$')]] = 'INR'
    
    @validator('currency', pre=True, always=True)
    def validate_currency(cls, v):
        if v is None:
            return 'INR'
        if not re.match(r'^[A-Z]{2,10}$', v):
            raise ValueError('Currency must be 2-10 uppercase letters (ISO 4217)')
        return v


class RequisitionItemResponse(BaseModel):
    item_id: int
    req_id: int
    role_position: str
    skill_level: Optional[str] = None
    experience_years: Optional[int] = None
    education_requirement: Optional[str] = None
    job_description: str
    jd_file_key: Optional[str] = None
    requirements: Optional[str] = None
    item_status: str
    replacement_hire: bool = False
    replaced_emp_id: Optional[str] = None
    # Budget fields (item-level)
    estimated_budget: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    approved_budget: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    currency: Optional[str] = 'INR'
    # Assigned TA
    assigned_ta: Optional[int] = None
    assigned_emp_id: Optional[str] = None

    class Config:
        from_attributes = True


class AssignEmployeeRequest(BaseModel):
    emp_id: str


class UpdateItemStatusRequest(BaseModel):
    status: str


# ============================================================================
# BUDGET WORKFLOW SCHEMAS
# ============================================================================

class ItemBudgetEditRequest(BaseModel):
    """Request for editing item budget."""
    estimated_budget: condecimal(max_digits=12, decimal_places=2, gt=Decimal('0'))
    currency: Annotated[str, Field(max_length=10, pattern=r'^[A-Z]{2,10}$')] = 'INR'
    
    @validator('currency', pre=True, always=True)
    def validate_currency(cls, v):
        if v is None:
            return 'INR'
        if not re.match(r'^[A-Z]{2,10}$', v):
            raise ValueError('Currency must be 2-10 uppercase letters (ISO 4217)')
        return v


class ItemBudgetApproveRequest(BaseModel):
    """Request for approving item budget."""
    # If provided, approved_budget is set to this value (approver can approve at a different amount).
    # If omitted, approved_budget = estimated_budget (backward compatible).
    approved_budget: Optional[condecimal(max_digits=12, decimal_places=2, ge=Decimal('0'))] = None


class ItemBudgetRejectRequest(BaseModel):
    """Request for rejecting item budget."""
    reason: Annotated[str, Field(min_length=10, max_length=2000)]


class ItemBudgetResponse(BaseModel):
    """Response for budget operations."""
    success: bool = True
    item_id: int
    estimated_budget: condecimal(max_digits=12, decimal_places=2)
    approved_budget: Optional[condecimal(max_digits=12, decimal_places=2)] = None
    currency: str
    budget_status: str  # 'pending', 'approved', 'rejected'
    
    class Config:
        from_attributes = True
