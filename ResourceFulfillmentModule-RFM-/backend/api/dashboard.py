"""
Dashboard API Endpoints
Provides aggregated metrics for different dashboard views (HR, Admin, etc.)
"""

from datetime import datetime, timedelta
import os
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from pydantic import BaseModel
from typing import Optional

from db.session import get_db
from db.models.auth import User
from db.models.employee import Employee
from db.models.employee_availability import EmployeeAvailability
from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem
from db.models.requisition_status_history import RequisitionStatusHistory
from db.models.audit_log import AuditLog
from utils.dependencies import require_any_role

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


# ============================================
# Response Schemas
# ============================================

class HRMetricsResponse(BaseModel):
    """Aggregated HR metrics for dashboard"""
    total_employees: int
    active_employees: int
    onboarding_employees: int
    on_leave_employees: int
    exited_employees: int
    bench_employees: int
    pending_hr_approvals: int
    upcoming_probation_count: int


class PendingApprovalItem(BaseModel):
    """Requisition pending HR approval"""
    req_id: int
    project_name: Optional[str]
    client_name: Optional[str]
    requester_name: str
    priority: Optional[str]
    overall_status: str
    budget_amount: Optional[float]
    required_by_date: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


class RecentActivityItem(BaseModel):
    """Recent HR activity from audit log"""
    audit_id: int
    action: str
    entity_name: str
    entity_id: Optional[str]
    performed_at: str
    performed_by_name: Optional[str]

    class Config:
        from_attributes = True


class HRDashboardDataResponse(BaseModel):
    """Complete HR dashboard data"""
    metrics: HRMetricsResponse
    pending_approvals: list[PendingApprovalItem]
    recent_activity: list[RecentActivityItem]


class HRPendingApprovalItem(BaseModel):
    requisition_id: str
    project_name: Optional[str]
    manager_name: Optional[str]
    requested_date: Optional[str]
    budget_amount: Optional[float]
    status: str


class ManagerSlaRiskItem(BaseModel):
    requisition_id: str
    days_open: int


class ManagerPendingPositionsAlert(BaseModel):
    requisition_id: str
    pending_count: int


class ManagerMetricsResponse(BaseModel):
    total_requisitions: int
    open: int
    in_progress: int
    closed: int
    pending_positions: int
    avg_fulfillment_days: float
    sla_risks: list[ManagerSlaRiskItem]
    pending_positions_alerts: list[ManagerPendingPositionsAlert]


# ============================================
# Helper Functions
# ============================================

def get_employee_counts_by_status(db: Session) -> dict[str, int]:
    """Get count of employees grouped by status"""
    counts = (
        db.query(Employee.emp_status, func.count(Employee.emp_id))
        .group_by(Employee.emp_status)
        .all()
    )
    return {status: count for status, count in counts}


def get_bench_employee_count(db: Session) -> int:
    """
    Get count of employees on bench (Active but 100% available).
    Uses the latest availability record per employee.
    """
    # Subquery to get latest availability date per employee
    latest_avail = (
        db.query(
            EmployeeAvailability.emp_id,
            func.max(EmployeeAvailability.effective_from).label("max_date")
        )
        .filter(EmployeeAvailability.effective_from <= datetime.today().date())
        .group_by(EmployeeAvailability.emp_id)
        .subquery()
    )

    # Join to get current availability and filter for bench (100% available)
    bench_count = (
        db.query(func.count(EmployeeAvailability.emp_id.distinct()))
        .join(
            latest_avail,
            and_(
                EmployeeAvailability.emp_id == latest_avail.c.emp_id,
                EmployeeAvailability.effective_from == latest_avail.c.max_date
            )
        )
        .join(Employee, Employee.emp_id == EmployeeAvailability.emp_id)
        .filter(
            Employee.emp_status == "Active",
            EmployeeAvailability.availability_pct == 100
        )
        .scalar()
    ) or 0

    return bench_count


def get_pending_hr_approval_count(db: Session) -> int:
    """Get count of requisitions pending HR approval (status Pending_HR)."""
    return (
        db.query(func.count(Requisition.req_id))
        .filter(Requisition.overall_status == "Pending_HR")
        .scalar()
    ) or 0


def get_upcoming_probation_count(db: Session, days: int = 30) -> int:
    """
    Get count of employees approaching probation confirmation.
    Assumes 90-day probation from DOJ.
    """
    today = datetime.today().date()
    cutoff_start = today - timedelta(days=90)
    cutoff_end = cutoff_start + timedelta(days=days)

    count = (
        db.query(func.count(Employee.emp_id))
        .filter(
            Employee.emp_status == "Active",
            Employee.doj.isnot(None),
            Employee.doj >= cutoff_start,
            Employee.doj <= cutoff_end
        )
        .scalar()
    ) or 0

    return count


def get_pending_approvals(db: Session, limit: int = 10) -> list[dict]:
    """Get requisitions pending HR approval with requester info (status Pending_HR), ordered by req_id descending (newest first)."""
    requisitions = (
        db.query(Requisition, User.username)
        .outerjoin(User, User.user_id == Requisition.raised_by)
        .filter(Requisition.overall_status == "Pending_HR")
        .order_by(Requisition.req_id.desc())
        .limit(limit)
        .all()
    )

    result = []
    for req, username in requisitions:
        result.append({
            "req_id": req.req_id,
            "project_name": req.project_name,
            "client_name": req.client_name,
            "requester_name": username or "Unknown",
            "priority": req.priority,
            "overall_status": req.overall_status,
            "budget_amount": float(req.budget_amount) if req.budget_amount else None,
            "required_by_date": req.required_by_date.isoformat() if req.required_by_date else None,
            "created_at": req.created_at.isoformat() if req.created_at else "",
        })

    return result


def get_hr_pending_approvals(db: Session, limit: Optional[int] = None) -> list[dict]:
    """Get requisitions pending HR approval (status Pending_HR) ordered by req_id descending (newest first)."""
    query = (
        db.query(Requisition, User.username)
        .outerjoin(User, User.user_id == Requisition.raised_by)
        .filter(Requisition.overall_status == "Pending_HR")
        .order_by(Requisition.req_id.desc())
    )

    if limit:
        query = query.limit(limit)

    rows = query.all()

    result = []
    for req, username in rows:
        result.append({
            "requisition_id": str(req.req_id),
            "project_name": req.project_name,
            "manager_name": username,
            "requested_date": req.created_at.isoformat() if req.created_at else None,
            "budget_amount": float(req.budget_amount) if req.budget_amount else None,
            "status": req.overall_status,
        })

    return result


def get_recent_hr_activity(db: Session, limit: int = 5) -> list[dict]:
    """Get recent HR-related audit log entries"""
    # HR-related entities and actions
    hr_entities = ["employee", "employees", "requisition", "requisitions", "onboarding"]
    hr_actions = [
        "CREATE", "UPDATE", "DELETE", "APPROVE", "REJECT",
        "HR_APPROVE", "HR_REJECT", "ASSIGN", "ONBOARD", "STATUS_CHANGE"
    ]

    activities = (
        db.query(AuditLog, User.username)
        .outerjoin(User, User.user_id == AuditLog.performed_by)
        .filter(
            or_(
                func.lower(AuditLog.entity_name).in_([e.lower() for e in hr_entities]),
                AuditLog.action.in_(hr_actions)
            )
        )
        .order_by(AuditLog.performed_at.desc())
        .limit(limit)
        .all()
    )

    result = []
    for log, username in activities:
        result.append({
            "audit_id": log.audit_id,
            "action": log.action,
            "entity_name": log.entity_name,
            "entity_id": log.entity_id,
            "performed_at": log.performed_at.isoformat() if log.performed_at else "",
            "performed_by_name": username,
        })

    return result


# ============================================
# Manager Dashboard Helper Functions
# ============================================

MANAGER_SLA_DAYS = int(os.getenv("MANAGER_SLA_DAYS", "30"))

OPEN_STATUSES = {
    "Pending Budget Approval",
    "Pending HR Approval",
}

IN_PROGRESS_STATUSES = {
    "Approved & Unassigned",
    "Active",
}

CLOSED_STATUSES = {"Closed"}


def get_manager_status_counts(db: Session, manager_id: int) -> dict[str, int]:
    """Get requisition counts by status for a specific manager."""
    rows = (
        db.query(Requisition.overall_status, func.count(Requisition.req_id))
        .filter(Requisition.raised_by == manager_id)
        .group_by(Requisition.overall_status)
        .all()
    )
    return {status: count for status, count in rows}


def get_manager_pending_positions_count(db: Session, manager_id: int) -> int:
    """Total unfulfilled positions for a manager's requisitions."""
    return (
        db.query(func.count(RequisitionItem.item_id))
        .join(Requisition, Requisition.req_id == RequisitionItem.req_id)
        .filter(
            Requisition.raised_by == manager_id,
            RequisitionItem.item_status.notin_(["Fulfilled", "Cancelled"]),
        )
        .scalar()
    ) or 0


def get_manager_pending_positions_alerts(
    db: Session,
    manager_id: int,
    limit: int = 10,
) -> list[dict]:
    """Pending positions grouped by requisition for alerting."""
    rows = (
        db.query(
            Requisition.req_id,
            func.count(RequisitionItem.item_id).label("pending_count"),
        )
        .join(RequisitionItem, RequisitionItem.req_id == Requisition.req_id)
        .filter(
            Requisition.raised_by == manager_id,
            RequisitionItem.item_status.notin_(["Fulfilled", "Cancelled"]),
        )
        .group_by(Requisition.req_id)
        .order_by(func.count(RequisitionItem.item_id).desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "requisition_id": str(req_id),
            "pending_count": int(pending_count),
        }
        for req_id, pending_count in rows
    ]


def get_manager_sla_risks(
    db: Session,
    manager_id: int,
    sla_days: int,
    limit: int = 10,
) -> list[dict]:
    """Requisitions open beyond SLA threshold."""
    now = datetime.utcnow()

    requisitions = (
        db.query(Requisition.req_id, Requisition.created_at)
        .filter(
            Requisition.raised_by == manager_id,
            Requisition.overall_status.notin_(["Closed", "Rejected"]),
        )
        .all()
    )

    risks = []
    for req_id, created_at in requisitions:
        if not created_at:
            continue
        days_open = (now - created_at).days
        if days_open >= sla_days:
            risks.append({
                "requisition_id": str(req_id),
                "days_open": int(days_open),
            })

    risks.sort(key=lambda item: item["days_open"], reverse=True)
    return risks[:limit]


def get_manager_avg_fulfillment_days(db: Session, manager_id: int) -> float:
    """Average days to close requisitions for a manager."""
    closed_subquery = (
        db.query(
            RequisitionStatusHistory.req_id,
            func.min(RequisitionStatusHistory.changed_at).label("closed_at"),
        )
        .filter(RequisitionStatusHistory.new_status == "Closed")
        .group_by(RequisitionStatusHistory.req_id)
        .subquery()
    )

    rows = (
        db.query(Requisition.created_at, closed_subquery.c.closed_at)
        .join(closed_subquery, Requisition.req_id == closed_subquery.c.req_id)
        .filter(Requisition.raised_by == manager_id)
        .all()
    )

    durations = []
    for created_at, closed_at in rows:
        if created_at and closed_at:
            durations.append((closed_at - created_at).days)

    if not durations:
        return 0.0

    return round(sum(durations) / len(durations), 2)


# ============================================
# Endpoints
# ============================================

@router.get("/hr-metrics", response_model=HRDashboardDataResponse)
def get_hr_metrics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    """
    Get comprehensive HR dashboard metrics.
    Requires HR or Admin role.
    """
    # Get employee status counts
    status_counts = get_employee_counts_by_status(db)

    total = sum(status_counts.values())
    active = status_counts.get("Active", 0)
    onboarding = status_counts.get("Onboarding", 0)
    on_leave = status_counts.get("On Leave", 0)
    exited = status_counts.get("Exited", 0)

    # Get specialized counts
    bench = get_bench_employee_count(db)
    pending_approvals_count = get_pending_hr_approval_count(db)
    probation_count = get_upcoming_probation_count(db)

    # Build metrics response
    metrics = HRMetricsResponse(
        total_employees=total,
        active_employees=active,
        onboarding_employees=onboarding,
        on_leave_employees=on_leave,
        exited_employees=exited,
        bench_employees=bench,
        pending_hr_approvals=pending_approvals_count,
        upcoming_probation_count=probation_count,
    )

    # Get pending approvals list
    pending_list = get_pending_approvals(db, limit=10)

    # Get recent activity
    activity_list = get_recent_hr_activity(db, limit=5)

    return HRDashboardDataResponse(
        metrics=metrics,
        pending_approvals=pending_list,
        recent_activity=activity_list,
    )


@router.get("/hr/pending-approvals", response_model=list[HRPendingApprovalItem])
def get_hr_pending_approvals_endpoint(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    """
    Get HR pending approvals list ordered by oldest first.
    Requires HR role.
    """
    return get_hr_pending_approvals(db)


@router.get("/hr-metrics/summary", response_model=HRMetricsResponse)
def get_hr_metrics_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    """
    Get only HR metrics summary (lightweight version).
    """
    status_counts = get_employee_counts_by_status(db)

    return HRMetricsResponse(
        total_employees=sum(status_counts.values()),
        active_employees=status_counts.get("Active", 0),
        onboarding_employees=status_counts.get("Onboarding", 0),
        on_leave_employees=status_counts.get("On Leave", 0),
        exited_employees=status_counts.get("Exited", 0),
        bench_employees=get_bench_employee_count(db),
        pending_hr_approvals=get_pending_hr_approval_count(db),
        upcoming_probation_count=get_upcoming_probation_count(db),
    )


@router.get("/manager-metrics", response_model=ManagerMetricsResponse)
def get_manager_metrics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Manager"))
):
    """
    Get manager dashboard metrics scoped to the current manager.
    """
    status_counts = get_manager_status_counts(db, current_user.user_id)

    total_requisitions = sum(status_counts.values())
    open_count = sum(status_counts.get(status, 0) for status in OPEN_STATUSES)
    in_progress_count = sum(
        status_counts.get(status, 0) for status in IN_PROGRESS_STATUSES
    )
    closed_count = sum(status_counts.get(status, 0) for status in CLOSED_STATUSES)

    pending_positions = get_manager_pending_positions_count(
        db, current_user.user_id
    )
    avg_fulfillment_days = get_manager_avg_fulfillment_days(
        db, current_user.user_id
    )

    sla_risks = get_manager_sla_risks(
        db, current_user.user_id, MANAGER_SLA_DAYS
    )
    pending_positions_alerts = get_manager_pending_positions_alerts(
        db, current_user.user_id
    )

    return ManagerMetricsResponse(
        total_requisitions=total_requisitions,
        open=open_count,
        in_progress=in_progress_count,
        closed=closed_count,
        pending_positions=pending_positions,
        avg_fulfillment_days=avg_fulfillment_days,
        sla_risks=sla_risks,
        pending_positions_alerts=pending_positions_alerts,
    )
