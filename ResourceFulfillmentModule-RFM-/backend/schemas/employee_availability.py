
from pydantic import BaseModel, Field
from datetime import date


class AvailabilityCreate(BaseModel):
    availability_pct: int = Field(ge=0, le=100)
    effective_from: date


class AvailabilityResponse(BaseModel):
    emp_id: str
    availability_pct: int
    effective_from: date
