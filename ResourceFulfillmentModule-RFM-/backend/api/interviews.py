"""
Interviews API Router
Schedule, update, and track interview rounds for candidates.
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from db.models.candidate import Candidate
from db.models.interview import Interview
from db.models.audit_log import AuditLog

from schemas.candidate import InterviewCreate, InterviewUpdate, InterviewResponse
from utils.dependencies import require_any_role, get_current_user_roles, check_ta_ownership_for_candidate

router = APIRouter(prefix="/interviews", tags=["Interviews"])


# --------------------------------------------------------------------------
# LIST interviews for a candidate
# --------------------------------------------------------------------------
@router.get("/", response_model=List[InterviewResponse])
def list_interviews(
    candidate_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin", "Manager")),
):
    q = db.query(Interview)
    if candidate_id is not None:
        q = q.filter(Interview.candidate_id == candidate_id)
    return q.order_by(Interview.round_number).all()


# --------------------------------------------------------------------------
# GET single interview
# --------------------------------------------------------------------------
@router.get("/{interview_id}", response_model=InterviewResponse)
def get_interview(
    interview_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin", "Manager")),
):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    return interview


# --------------------------------------------------------------------------
# CREATE (schedule) an interview
# --------------------------------------------------------------------------
@router.post("/", response_model=InterviewResponse, status_code=status.HTTP_201_CREATED)
def create_interview(
    payload: InterviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin")),
    roles: List[str] = Depends(get_current_user_roles),
):
    # Validate candidate
    candidate = db.query(Candidate).filter(
        Candidate.candidate_id == payload.candidate_id
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    check_ta_ownership_for_candidate(
        db, payload.candidate_id, current_user, roles
    )

    # Pydantic validation: no past dates
    if payload.scheduled_at.replace(tzinfo=None) < datetime.now():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="You cannot select a past date for the interview schedule",
        )

    # Auto-determine round number if not provided or already taken
    existing_rounds = (
        db.query(Interview)
        .filter(Interview.candidate_id == payload.candidate_id)
        .count()
    )
    round_num = max(payload.round_number, existing_rounds + 1)

    interview = Interview(
        candidate_id=payload.candidate_id,
        round_number=round_num,
        interviewer_name=payload.interviewer_name,
        scheduled_at=payload.scheduled_at,
        status="Scheduled",
        conducted_by=current_user.user_id,
    )
    db.add(interview)

    # Audit
    audit = AuditLog(
        entity_name="interview",
        entity_id=None,
        action="CREATE",
        performed_by=current_user.user_id,
        new_value=f"Round {round_num} scheduled for candidate {candidate.full_name} with {payload.interviewer_name}",
    )
    db.add(audit)
    db.flush()
    audit.entity_id = str(interview.id)
    db.commit()
    db.refresh(interview)
    return interview


# --------------------------------------------------------------------------
# UPDATE an interview (result / feedback / reschedule)
# --------------------------------------------------------------------------
@router.patch("/{interview_id}", response_model=InterviewResponse)
def update_interview(
    interview_id: int,
    payload: InterviewUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin")),
    roles: List[str] = Depends(get_current_user_roles),
):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    check_ta_ownership_for_candidate(
        db, interview.candidate_id, current_user, roles
    )

    update_data = payload.model_dump(exclude_unset=True)

    # Validate scheduled_at if being updated
    if "scheduled_at" in update_data and update_data["scheduled_at"]:
        dt = update_data["scheduled_at"]
        if dt.replace(tzinfo=None) < datetime.now():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="You cannot select a past date for the interview schedule",
            )

    old_status = interview.status
    old_result = interview.result

    for field, value in update_data.items():
        setattr(interview, field, value)

    # Audit
    changes = []
    if "status" in update_data and update_data["status"] != old_status:
        changes.append(f"status: {old_status} → {update_data['status']}")
    if "result" in update_data and update_data["result"] != old_result:
        changes.append(f"result: {old_result} → {update_data['result']}")
    if "feedback" in update_data:
        changes.append("feedback updated")

    if changes:
        audit = AuditLog(
            entity_name="interview",
            entity_id=str(interview_id),
            action="UPDATE",
            performed_by=current_user.user_id,
            old_value=f"status={old_status}, result={old_result}",
            new_value="; ".join(changes),
        )
        db.add(audit)

    db.commit()
    db.refresh(interview)
    return interview


# --------------------------------------------------------------------------
# DELETE (cancel) an interview
# --------------------------------------------------------------------------
@router.delete("/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview(
    interview_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin")),
    roles: List[str] = Depends(get_current_user_roles),
):
    interview = db.query(Interview).filter(Interview.id == interview_id).first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")
    check_ta_ownership_for_candidate(
        db, interview.candidate_id, current_user, roles
    )

    audit = AuditLog(
        entity_name="interview",
        entity_id=str(interview_id),
        action="DELETE",
        performed_by=current_user.user_id,
        old_value=f"Deleted round {interview.round_number} for candidate {interview.candidate_id}",
    )
    db.add(audit)
    db.delete(interview)
    db.commit()
    return None
