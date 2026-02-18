from pydantic import BaseModel
from typing import Optional

class EmployeeFinanceCreate(BaseModel):
    bank_details: Optional[str] = None
    tax_id: Optional[str] = None

class EmployeeFinanceResponse(BaseModel):
    emp_id: str
    bank_details: Optional[str]
    tax_id: Optional[str]

    class Config:
        from_attributes = True