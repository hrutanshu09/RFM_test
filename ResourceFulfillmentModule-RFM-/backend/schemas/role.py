from pydantic import BaseModel


class AssignRoleRequest(BaseModel):
    role_name: str
