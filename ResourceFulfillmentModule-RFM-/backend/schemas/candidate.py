from datetime import datetime
from typing import Annotated, List, Optional
from pydantic import BaseModel, EmailStr, Field, StringConstraints


# --------------------------------------------------------------------------
# Interview schemas (nested in candidate responses)
# --------------------------------------------------------------------------

class InterviewBase(BaseModel):
    round_number: int = Field(..., ge=1, description="Interview round number (1-based)")
    interviewer_name: str = Field(..., min_length=1, max_length=150)
    scheduled_at: datetime


class InterviewCreate(InterviewBase):
    candidate_id: int


class InterviewUpdate(BaseModel):
    interviewer_name: Optional[str] = Field(None, min_length=1, max_length=150)
    scheduled_at: Optional[datetime] = None
    status: Optional[str] = Field(None, pattern=r"^(Scheduled|Completed|Cancelled)$")
    result: Optional[str] = Field(None, pattern=r"^(Pass|Fail|Hold)$")
    feedback: Optional[str] = None


class InterviewResponse(InterviewBase):
    id: int
    candidate_id: int
    status: str
    result: Optional[str] = None
    feedback: Optional[str] = None
    conducted_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --------------------------------------------------------------------------
# Candidate schemas
# --------------------------------------------------------------------------

class CandidateCreate(BaseModel):
    requisition_item_id: int
    requisition_id: int
    full_name: str = Field(..., min_length=1, max_length=150)
    email: EmailStr
    phone: Optional[Annotated[str, StringConstraints(max_length=30)]] = None
    resume_path: Optional[str] = None


class CandidateUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=150)
    email: Optional[EmailStr] = None
    phone: Optional[Annotated[str, StringConstraints(max_length=30)]] = None
    resume_path: Optional[str] = None


class CandidateStageUpdate(BaseModel):
    new_stage: str = Field(
        ...,
        pattern=r"^(Sourced|Shortlisted|Interviewing|Offered|Hired|Rejected)$",
        description="Target pipeline stage",
    )
    reason: Optional[str] = Field(None, max_length=500)


class CandidateResponse(BaseModel):
    candidate_id: int
    requisition_item_id: int
    requisition_id: int
    full_name: str
    email: str
    phone: Optional[str] = None
    resume_path: Optional[str] = None
    current_stage: str
    added_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    interviews: List[InterviewResponse] = Field(default_factory=list)

    class Config:
        from_attributes = True
