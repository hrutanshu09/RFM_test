from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_any_role
from db.models.requisition_status_history import RequisitionStatusHistory
from db.models.requisition import Requisition
from schemas.requisition_status_history import (
    RequisitionStatusHistoryCreate
)

router = APIRouter(
    prefix="/requisitions",
    tags=["Requisition Status History"]
)


@router.post("/{req_id}/status-history")
def create_requisition_status_history(
    req_id: int,
    payload: RequisitionStatusHistoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Manager", "Admin", "HR"))
):
    # PHASE 1 SAFETY: Manual status history creation is disabled
    # Status history is recorded internally by workflow operations
    raise HTTPException(
        status_code=403,
        detail="Manual status history creation is disabled. History is recorded automatically by workflow operations."
    )

    # --- DISABLED CODE BELOW (kept for reference) ---
    requisition = db.query(Requisition).filter(
        Requisition.req_id == req_id
    ).first()

    if not requisition:
        raise HTTPException(status_code=404, detail="Requisition not found")

    history = RequisitionStatusHistory(
        req_id=req_id,
        old_status=payload.old_status,
        new_status=payload.new_status,
        changed_by=payload.changed_by,
        justification=payload.justification,
    )

    db.add(history)
    db.commit()
    db.refresh(history)

    return {
        "message": "Requisition status history recorded",
        "history_id": history.history_id,
    }


@router.get("/{req_id}/status-history")
def list_requisition_status_history(
    req_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Manager", "Admin", "HR", "Employee", "TA"))
):
    return (
        db.query(RequisitionStatusHistory)
        .filter(RequisitionStatusHistory.req_id == req_id)
        .order_by(RequisitionStatusHistory.changed_at.desc())
        .all()
    )
