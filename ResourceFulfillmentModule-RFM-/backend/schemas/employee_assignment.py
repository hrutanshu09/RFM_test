from pydantic import BaseModel
from datetime import date

class AssignmentEnd(BaseModel):
    end_date: date
