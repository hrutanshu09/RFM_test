"""
Candidates API Router
CRUD + stage transitions for candidates linked to requisition items.
TA ownership enforced for create/update/delete/stage; Hired triggers auto-fulfill and onboarding.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from db.session import get_db
from db.models.auth import User
from db.models.candidate import Candidate
from db.models.interview import Interview
from db.models.requisition_item import RequisitionItem
from db.models.audit_log import AuditLog

from schemas.candidate import (
    CandidateCreate,
    CandidateUpdate,
    CandidateStageUpdate,
    CandidateResponse,
)
from utils.dependencies import (
    require_any_role,
    get_current_user_roles,
    require_ta_ownership_for_candidate,
    check_ta_ownership_for_requisition_item,
)
from services.requisition.workflow_engine_v2 import RequisitionItemWorkflowEngine
from services.requisition.workflow_exceptions import WorkflowException
from services.onboarding import create_employee_from_candidate

router = APIRouter(prefix="/candidates", tags=["Candidates"])


# --------------------------------------------------------------------------
# LIST candidates (filterable by requisition or item)
# --------------------------------------------------------------------------
@router.get("/", response_model=List[CandidateResponse])
def list_candidates(
    requisition_id: Optional[int] = Query(None),
    requisition_item_id: Optional[int] = Query(None),
    current_stage: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin", "Manager")),
):
    q = db.query(Candidate).options(joinedload(Candidate.interviews))

    if requisition_id is not None:
        q = q.filter(Candidate.requisition_id == requisition_id)
    if requisition_item_id is not None:
        q = q.filter(Candidate.requisition_item_id == requisition_item_id)
    if current_stage is not None:
        q = q.filter(Candidate.current_stage == current_stage)

    return q.order_by(Candidate.created_at.desc()).all()


# --------------------------------------------------------------------------
# GET single candidate
# --------------------------------------------------------------------------
@router.get("/{candidate_id}", response_model=CandidateResponse)
def get_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin", "Manager")),
):
    candidate = (
        db.query(Candidate)
        .options(joinedload(Candidate.interviews))
        .filter(Candidate.candidate_id == candidate_id)
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


# --------------------------------------------------------------------------
# CREATE candidate
# --------------------------------------------------------------------------
@router.post("/", response_model=CandidateResponse, status_code=status.HTTP_201_CREATED)
def create_candidate(
    payload: CandidateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin")),
    roles: List[str] = Depends(get_current_user_roles),
):
    # Validate requisition item exists
    item = db.query(RequisitionItem).filter(
        RequisitionItem.item_id == payload.requisition_item_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Requisition item not found")
    if item.req_id != payload.requisition_id:
        raise HTTPException(
            status_code=400,
            detail="Requisition item does not belong to the given requisition",
        )
    check_ta_ownership_for_requisition_item(
        db, payload.requisition_item_id, current_user, roles
    )

    candidate = Candidate(
        requisition_item_id=payload.requisition_item_id,
        requisition_id=payload.requisition_id,
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        resume_path=payload.resume_path,
        current_stage="Sourced",
        added_by=current_user.user_id,
    )
    db.add(candidate)

    # Audit log
    audit = AuditLog(
        entity_name="candidate",
        entity_id=None,  # will be set after flush
        action="CREATE",
        performed_by=current_user.user_id,
        new_value=f"Candidate {payload.full_name} added for item {payload.requisition_item_id}",
    )
    db.add(audit)
    db.flush()
    audit.entity_id = str(candidate.candidate_id)
    db.commit()
    db.refresh(candidate)
    return candidate


# --------------------------------------------------------------------------
# UPDATE candidate profile
# --------------------------------------------------------------------------
@router.patch("/{candidate_id}", response_model=CandidateResponse)
def update_candidate(
    candidate_id: int,
    payload: CandidateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin")),
    _ownership: User = Depends(require_ta_ownership_for_candidate),
):
    candidate = db.query(Candidate).filter(
        Candidate.candidate_id == candidate_id
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(candidate, field, value)

    db.commit()
    db.refresh(candidate)
    return candidate


# --------------------------------------------------------------------------
# UPDATE candidate stage (atomic transition)
# --------------------------------------------------------------------------
VALID_STAGE_TRANSITIONS = {
    "Sourced": ["Shortlisted", "Rejected"],
    "Shortlisted": ["Interviewing", "Sourced", "Rejected"],
    "Interviewing": ["Offered", "Shortlisted", "Rejected"],
    "Offered": ["Hired", "Interviewing", "Rejected"],
    "Rejected": ["Sourced"],  # allow re-sourcing a rejected candidate
}


@router.patch("/{candidate_id}/stage", response_model=CandidateResponse)
def update_candidate_stage(
    candidate_id: int,
    payload: CandidateStageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin")),
    roles: List[str] = Depends(get_current_user_roles),
    _ownership: User = Depends(require_ta_ownership_for_candidate),
):
    candidate = (
        db.query(Candidate)
        .options(joinedload(Candidate.interviews))
        .filter(Candidate.candidate_id == candidate_id)
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    old_stage = candidate.current_stage
    new_stage = payload.new_stage

    # Validate transition
    allowed = VALID_STAGE_TRANSITIONS.get(old_stage, [])
    if new_stage not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot move from '{old_stage}' to '{new_stage}'. Allowed: {allowed}",
        )

    # Business rules
    if new_stage == "Interviewing":
        scheduled = [
            i for i in candidate.interviews
            if i.status == "Scheduled"
        ]
        if not scheduled:
            raise HTTPException(
                status_code=400,
                detail="At least one interview must be scheduled before moving to Interviewing",
            )

    # Keep requisition item workflow in sync with candidate stage
    if new_stage in {"Offered", "Hired"}:
        item = (
            db.query(RequisitionItem)
            .filter(RequisitionItem.item_id == candidate.requisition_item_id)
            .first()
        )
        if not item:
            raise HTTPException(status_code=404, detail="Requisition item not found")

        if item.item_status in {"Fulfilled", "Cancelled"}:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Cannot update candidate stage; requisition item is in terminal "
                    f"status '{item.item_status}'."
                ),
            )

        def sync_item_to_offered() -> None:
            nonlocal item

            # If item is still pending and TA not assigned, TA can self-assign first.
            if item.item_status == "Pending" and item.assigned_ta is None:
                role_set = {r.lower() for r in roles}
                if "ta" in role_set:
                    RequisitionItemWorkflowEngine.assign_ta(
                        db=db,
                        item_id=item.item_id,
                        ta_user_id=current_user.user_id,
                        performed_by=current_user.user_id,
                        user_roles=roles,
                    )
                    db.flush()
                    db.refresh(item)
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Cannot auto-progress item from Pending because no TA is assigned. "
                            "Assign TA first, then continue stage transition."
                        ),
                    )

            # Progressively sync item workflow to Offered.
            if item.item_status == "Sourcing":
                RequisitionItemWorkflowEngine.shortlist(
                    db=db,
                    item_id=item.item_id,
                    user_id=current_user.user_id,
                    user_roles=roles,
                    candidate_count=1,
                )
                db.flush()
                db.refresh(item)

            if item.item_status == "Shortlisted":
                RequisitionItemWorkflowEngine.start_interview(
                    db=db,
                    item_id=item.item_id,
                    user_id=current_user.user_id,
                    user_roles=roles,
                )
                db.flush()
                db.refresh(item)

            if item.item_status == "Interviewing":
                RequisitionItemWorkflowEngine.make_offer(
                    db=db,
                    item_id=item.item_id,
                    user_id=current_user.user_id,
                    user_roles=roles,
                    candidate_id=str(candidate.candidate_id),
                )
                db.flush()
                db.refresh(item)

        if item.item_status != "Offered":
            try:
                sync_item_to_offered()
            except WorkflowException as e:
                raise HTTPException(status_code=e.http_status, detail=e.message)

    # Hired: auto-fulfill item, create employee, reject other candidates
    if new_stage == "Hired":
        item = (
            db.query(RequisitionItem)
            .filter(RequisitionItem.item_id == candidate.requisition_item_id)
            .first()
        )
        if not item:
            raise HTTPException(status_code=404, detail="Requisition item not found")
        if item.item_status == "Fulfilled":
            raise HTTPException(
                status_code=400,
                detail="Cannot hire; Requisition already fulfilled.",
            )

        if item.item_status != "Offered":
            raise HTTPException(
                status_code=400,
                detail=(
                    "Cannot hire; Requisition item must be in Offered status before "
                    f"marking candidate as Hired. Current item status: {item.item_status}."
                ),
            )
        employee = create_employee_from_candidate(db, candidate)
        try:
            RequisitionItemWorkflowEngine.fulfill(
                db=db,
                item_id=item.item_id,
                user_id=current_user.user_id,
                user_roles=roles,
                employee_id=employee.emp_id,
            )
        except WorkflowException as e:
            raise HTTPException(status_code=e.http_status, detail=e.message)
        # Reject other candidates for this item (Position Filled)
        others = (
            db.query(Candidate)
            .filter(
                Candidate.requisition_item_id == candidate.requisition_item_id,
                Candidate.candidate_id != candidate.candidate_id,
                Candidate.current_stage.notin_(["Hired", "Rejected"]),
            )
            .all()
        )
        for other in others:
            prev_stage = other.current_stage
            other.current_stage = "Rejected"
            db.add(
                AuditLog(
                    entity_name="candidate",
                    entity_id=str(other.candidate_id),
                    action="STAGE_CHANGE",
                    performed_by=current_user.user_id,
                    old_value=prev_stage,
                    new_value="Rejected (Position Filled)",
                )
            )
        # Audit for the hired candidate is added below with STAGE_CHANGE

    # Atomic: update stage + audit in one transaction
    candidate.current_stage = new_stage

    audit = AuditLog(
        entity_name="candidate",
        entity_id=str(candidate.candidate_id),
        action="STAGE_CHANGE",
        performed_by=current_user.user_id,
        old_value=old_stage,
        new_value=new_stage,
    )
    db.add(audit)
    db.commit()
    db.refresh(candidate)
    return candidate


# --------------------------------------------------------------------------
# DELETE candidate
# --------------------------------------------------------------------------
@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("TA", "HR", "Admin")),
    _ownership: User = Depends(require_ta_ownership_for_candidate),
):
    candidate = db.query(Candidate).filter(
        Candidate.candidate_id == candidate_id
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    audit = AuditLog(
        entity_name="candidate",
        entity_id=str(candidate.candidate_id),
        action="DELETE",
        performed_by=current_user.user_id,
        old_value=f"Deleted candidate {candidate.full_name}",
    )
    db.add(audit)
    db.delete(candidate)
    db.commit()
    return None
