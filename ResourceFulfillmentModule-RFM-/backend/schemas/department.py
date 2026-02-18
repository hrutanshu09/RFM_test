from pydantic import BaseModel
from typing import Optional

class DepartmentUpdate(BaseModel):
    department_name: Optional[str] = None
