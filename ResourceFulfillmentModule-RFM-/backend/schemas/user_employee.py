from pydantic import BaseModel


class LinkUserEmployeeRequest(BaseModel):
    user_id: int
    emp_id: str
