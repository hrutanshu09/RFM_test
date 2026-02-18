"""
============================================================================
Workflow Audit & Observability API
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module provides API endpoints for:
1. Querying workflow audit logs
2. Retrieving transition metrics
3. Health check data
4. Prometheus-compatible metrics export
"""

from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, and_, func
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from db.models.workflow_audit import WorkflowTransitionAudit
from db.models.requisition import Requisition
from db.models.requisition_item import RequisitionItem
from utils.dependencies import require_any_role

from services.requisition.workflow_metrics import (
    get_workflow_metrics,
    get_prometheus_metrics,
)


router = APIRouter(
    prefix="/workflow",
    tags=["Workflow Audit"]
)


# =============================================================================
# SCHEMAS
# =============================================================================

class AuditLogEntry(BaseModel):
    """Single audit log entry."""
    audit_id: int
    entity_type: str
    entity_id: int
    action: str
    from_status: str
    to_status: str
    version_before: int
    version_after: int
    performed_by: Optional[int] = None
    performed_by_username: Optional[str] = None
    performed_by_full_name: Optional[str] = None
    user_roles: Optional[str] = None
    reason: Optional[str] = None
    transition_metadata: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True


class AuditLogResponse(BaseModel):
    """Paginated audit log response."""
    total: int
    page: int
    page_size: int
    entries: List[AuditLogEntry]


class TransitionMetricResponse(BaseModel):
    """Single transition metric."""
    entity_type: str
    from_status: str
    to_status: str
    action: str
    success_count: int
    failure_count: int
    avg_duration_ms: float
    last_success: Optional[str] = None
    last_failure: Optional[str] = None
    last_error: Optional[str] = None


class MetricsResponse(BaseModel):
    """Overall metrics response."""
    total_transitions: int
    total_successes: int
    total_failures: int
    total_conflicts: int
    success_rate: float
    avg_duration_ms: float
    uptime_seconds: float
    start_time: str
    transitions: List[TransitionMetricResponse]


class WorkflowHealthResponse(BaseModel):
    """Workflow health check response."""
    status: str  # "healthy", "degraded", "unhealthy"
    total_transitions: int
    recent_success_rate: float
    recent_conflicts: int
    last_transition: Optional[str] = None
    issues: List[str] = []


# =============================================================================
# AUDIT LOG ENDPOINTS
# =============================================================================

@router.get("/audit/{req_id}", response_model=AuditLogResponse)
def get_requisition_audit_log(
    req_id: int,
    include_items: bool = Query(True, description="Include item-level audit entries"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR", "Manager")),
):
    """
    Get audit log for a requisition.
    
    Returns all workflow transitions for the requisition header
    and optionally its items.
    """
    from sqlalchemy.orm import aliased
    
    # Verify requisition exists
    requisition = db.query(Requisition).filter(
        Requisition.req_id == req_id
    ).first()
    
    if not requisition:
        raise HTTPException(status_code=404, detail="Requisition not found")
    
    # Alias for User table join
    PerformerUser = aliased(User)
    
    # Build query with user join
    # Note: User model only has username, not full_name
    query = db.query(
        WorkflowTransitionAudit,
        PerformerUser.username.label("performer_username"),
    ).outerjoin(
        PerformerUser,
        WorkflowTransitionAudit.performed_by == PerformerUser.user_id
    )
    
    if include_items:
        # Get item IDs
        item_ids = db.query(RequisitionItem.item_id).filter(
            RequisitionItem.req_id == req_id
        ).all()
        item_ids = [i[0] for i in item_ids]
        
        # Include both header and items
        query = query.filter(
            ((WorkflowTransitionAudit.entity_type == 'requisition') & 
             (WorkflowTransitionAudit.entity_id == req_id)) |
            ((WorkflowTransitionAudit.entity_type == 'requisition_item') & 
             (WorkflowTransitionAudit.entity_id.in_(item_ids)))
        )
    else:
        # Header only
        query = query.filter(
            WorkflowTransitionAudit.entity_type == 'requisition',
            WorkflowTransitionAudit.entity_id == req_id,
        )
    
    # Count total (without join)
    count_query = db.query(WorkflowTransitionAudit)
    if include_items:
        item_ids_for_count = db.query(RequisitionItem.item_id).filter(
            RequisitionItem.req_id == req_id
        ).all()
        item_ids_for_count = [i[0] for i in item_ids_for_count]
        count_query = count_query.filter(
            ((WorkflowTransitionAudit.entity_type == 'requisition') & 
             (WorkflowTransitionAudit.entity_id == req_id)) |
            ((WorkflowTransitionAudit.entity_type == 'requisition_item') & 
             (WorkflowTransitionAudit.entity_id.in_(item_ids_for_count)))
        )
    else:
        count_query = count_query.filter(
            WorkflowTransitionAudit.entity_type == 'requisition',
            WorkflowTransitionAudit.entity_id == req_id,
        )
    total = count_query.count()
    
    # Apply ordering and pagination
    rows = (
        query
        .order_by(desc(WorkflowTransitionAudit.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    # Build entries with user info
    entries = []
    for row in rows:
        audit_record = row[0]
        performer_username = row[1] if len(row) > 1 else None
        
        entry = AuditLogEntry(
            audit_id=audit_record.audit_id,
            entity_type=audit_record.entity_type,
            entity_id=audit_record.entity_id,
            action=audit_record.action,
            from_status=audit_record.from_status or "",
            to_status=audit_record.to_status,
            version_before=audit_record.version_before or 0,
            version_after=audit_record.version_after or 0,
            performed_by=audit_record.performed_by,
            performed_by_username=performer_username,
            performed_by_full_name=performer_username,  # Use username as fallback
            user_roles=audit_record.user_roles,
            reason=audit_record.reason,
            transition_metadata=audit_record.transition_metadata,
            created_at=audit_record.created_at,
        )
        entries.append(entry)
    
    return AuditLogResponse(
        total=total,
        page=page,
        page_size=page_size,
        entries=entries,
    )


@router.get("/audit/item/{item_id}", response_model=AuditLogResponse)
def get_item_audit_log(
    item_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR", "Manager", "TA")),
):
    """Get audit log for a specific requisition item."""
    # Verify item exists
    item = db.query(RequisitionItem).filter(
        RequisitionItem.item_id == item_id
    ).first()
    
    if not item:
        raise HTTPException(status_code=404, detail="Requisition item not found")
    
    # Query audit log
    query = db.query(WorkflowTransitionAudit).filter(
        WorkflowTransitionAudit.entity_type == 'requisition_item',
        WorkflowTransitionAudit.entity_id == item_id,
    )
    
    total = query.count()
    
    entries = (
        query
        .order_by(desc(WorkflowTransitionAudit.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    return AuditLogResponse(
        total=total,
        page=page,
        page_size=page_size,
        entries=[AuditLogEntry.model_validate(e) for e in entries],
    )


@router.get("/audit/user/{user_id}", response_model=AuditLogResponse)
def get_user_audit_log(
    user_id: int,
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    since: Optional[datetime] = Query(None, description="Filter entries after this time"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR")),
):
    """Get all workflow transitions performed by a specific user."""
    query = db.query(WorkflowTransitionAudit).filter(
        WorkflowTransitionAudit.performed_by == user_id
    )
    
    if entity_type:
        query = query.filter(WorkflowTransitionAudit.entity_type == entity_type)
    
    if since:
        query = query.filter(WorkflowTransitionAudit.created_at >= since)
    
    total = query.count()
    
    entries = (
        query
        .order_by(desc(WorkflowTransitionAudit.created_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    return AuditLogResponse(
        total=total,
        page=page,
        page_size=page_size,
        entries=[AuditLogEntry.model_validate(e) for e in entries],
    )


# =============================================================================
# METRICS ENDPOINTS
# =============================================================================

@router.get("/metrics", response_model=MetricsResponse)
def get_metrics(
    current_user: User = Depends(require_any_role("Admin", "HR")),
):
    """
    Get workflow transition metrics.
    
    Returns counters, success rates, and timing data.
    """
    metrics = get_workflow_metrics()
    
    return MetricsResponse(
        total_transitions=metrics["overall"]["total_transitions"],
        total_successes=metrics["overall"]["total_successes"],
        total_failures=metrics["overall"]["total_failures"],
        total_conflicts=metrics["overall"]["total_conflicts"],
        success_rate=metrics["overall"]["success_rate"],
        avg_duration_ms=metrics["overall"]["avg_duration_ms"],
        uptime_seconds=metrics["overall"]["uptime_seconds"],
        start_time=metrics["overall"]["start_time"],
        transitions=[
            TransitionMetricResponse(**t) for t in metrics["transitions"]
        ],
    )


@router.get("/metrics/prometheus")
def get_prometheus_format():
    """
    Get metrics in Prometheus text format.
    
    For integration with Prometheus/Grafana monitoring.
    """
    from fastapi.responses import PlainTextResponse
    
    return PlainTextResponse(
        content=get_prometheus_metrics(),
        media_type="text/plain; charset=utf-8",
    )


# =============================================================================
# HEALTH CHECK
# =============================================================================

@router.get("/health", response_model=WorkflowHealthResponse)
def get_workflow_health(
    db: Session = Depends(get_db),
):
    """
    Get workflow subsystem health status.
    
    Checks:
    - Recent success rate
    - Conflict rate
    - Last activity
    """
    metrics = get_workflow_metrics()
    issues = []
    status = "healthy"
    
    # Check success rate
    success_rate = metrics["overall"]["success_rate"]
    if success_rate < 90:
        issues.append(f"Low success rate: {success_rate}%")
        status = "degraded"
    if success_rate < 50:
        status = "unhealthy"
    
    # Check conflict rate
    total = metrics["overall"]["total_transitions"]
    conflicts = metrics["overall"]["total_conflicts"]
    if total > 0:
        conflict_rate = (conflicts / total) * 100
        if conflict_rate > 10:
            issues.append(f"High conflict rate: {conflict_rate:.1f}%")
            status = "degraded" if status == "healthy" else status
    
    # Get last transition time from database
    last_transition = (
        db.query(WorkflowTransitionAudit.created_at)
        .order_by(desc(WorkflowTransitionAudit.created_at))
        .first()
    )
    
    return WorkflowHealthResponse(
        status=status,
        total_transitions=total,
        recent_success_rate=success_rate,
        recent_conflicts=conflicts,
        last_transition=last_transition[0].isoformat() if last_transition else None,
        issues=issues,
    )


# =============================================================================
# STATISTICS
# =============================================================================

@router.get("/stats/transitions")
def get_transition_stats(
    days: int = Query(7, ge=1, le=90, description="Number of days to analyze"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR")),
):
    """
    Get transition statistics from audit log.
    
    Returns counts grouped by action, entity type, and day.
    """
    since = datetime.utcnow() - timedelta(days=days)
    
    # Get action counts
    action_stats = (
        db.query(
            WorkflowTransitionAudit.action,
            WorkflowTransitionAudit.entity_type,
            func.count(WorkflowTransitionAudit.audit_id).label('count'),
        )
        .filter(WorkflowTransitionAudit.created_at >= since)
        .group_by(
            WorkflowTransitionAudit.action,
            WorkflowTransitionAudit.entity_type,
        )
        .order_by(desc('count'))
        .all()
    )
    
    # Get daily counts
    daily_stats = (
        db.query(
            func.date(WorkflowTransitionAudit.created_at).label('date'),
            func.count(WorkflowTransitionAudit.audit_id).label('count'),
        )
        .filter(WorkflowTransitionAudit.created_at >= since)
        .group_by('date')
        .order_by('date')
        .all()
    )
    
    # Get user activity
    user_stats = (
        db.query(
            WorkflowTransitionAudit.performed_by,
            func.count(WorkflowTransitionAudit.audit_id).label('count'),
        )
        .filter(
            WorkflowTransitionAudit.created_at >= since,
            WorkflowTransitionAudit.performed_by.isnot(None),
        )
        .group_by(WorkflowTransitionAudit.performed_by)
        .order_by(desc('count'))
        .limit(10)
        .all()
    )
    
    return {
        "period_days": days,
        "since": since.isoformat(),
        "by_action": [
            {
                "action": row.action,
                "entity_type": row.entity_type,
                "count": row.count,
            }
            for row in action_stats
        ],
        "by_day": [
            {
                "date": str(row.date),
                "count": row.count,
            }
            for row in daily_stats
        ],
        "top_users": [
            {
                "user_id": row.performed_by,
                "count": row.count,
            }
            for row in user_stats
        ],
    }
