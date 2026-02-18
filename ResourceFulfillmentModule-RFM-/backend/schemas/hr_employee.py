from pydantic import BaseModel
from typing import List, Optional

from schemas.employee import EmployeeResponse
from schemas.employee_contact import EmployeeContactResponse
from schemas.employee_skill import EmployeeSkillResponse
from schemas.employee_education import EmployeeEducationResponse
from schemas.employee_finance import EmployeeFinanceResponse


class HREmployeeProfile(BaseModel):
    employee: EmployeeResponse
    contacts: List[EmployeeContactResponse] = []
    skills: List[EmployeeSkillResponse] = []
    education: List[EmployeeEducationResponse] = []
    finance: Optional[EmployeeFinanceResponse] = None

