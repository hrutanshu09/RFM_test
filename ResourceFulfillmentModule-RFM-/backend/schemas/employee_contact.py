from pydantic import BaseModel, EmailStr
from typing import Optional, Literal


class EmployeeContactUpsert(BaseModel):
    contact_type: Literal["Work", "Personal", "Emergency"]
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None


class EmployeeContactResponse(BaseModel):
    emp_id: str
    contact_type: str
    email: Optional[str]
    phone: Optional[str]
    address: Optional[str]

    class Config:
        from_attributes = True
