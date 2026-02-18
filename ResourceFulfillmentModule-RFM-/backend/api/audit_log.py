from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func, or_
from datetime import datetime, time
import io
import json

from db.session import get_db
from db.models.auth import User, Role, UserRole
from db.models.employee import Employee
from db.models.user_employee_map import UserEmployeeMap
from utils.dependencies import require_any_role
from db.models.audit_log import AuditLog
from schemas.audit_log import AuditLogCreate
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet

router = APIRouter(
    prefix="/audit-logs",
    tags=["Audit Logs"]
)


@router.post("/")
def create_audit_log(
    payload: AuditLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR"))
):
    audit = AuditLog(
        entity_name=payload.entity_name,
        entity_id=payload.entity_id,
        action=payload.action,
        performed_by=payload.performed_by,
        target_user_id=payload.target_user_id,
        old_value=payload.old_value,
        new_value=payload.new_value,
    )

    db.add(audit)
    db.commit()
    db.refresh(audit)

    return {
        "message": "Audit log created",
        "audit_id": audit.audit_id,
    }


def _build_audit_query(
    db: Session,
    entity_name: str | None = None,
    entity_id: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user_id: str | None = None,
    action: str | None = None,
):
    actor_user = aliased(User)
    target_user = aliased(User)
    actor_map = aliased(UserEmployeeMap)
    target_map = aliased(UserEmployeeMap)
    actor_employee = aliased(Employee)
    target_employee = aliased(Employee)

    query = (
        db.query(AuditLog)
        .outerjoin(actor_user, actor_user.user_id == AuditLog.performed_by)
        .outerjoin(target_user, target_user.user_id == AuditLog.target_user_id)
        .outerjoin(actor_map, actor_map.user_id == actor_user.user_id)
        .outerjoin(target_map, target_map.user_id == target_user.user_id)
        .outerjoin(
            actor_employee,
            or_(
                actor_employee.emp_id == actor_user.employee_id,
                actor_employee.emp_id == actor_map.emp_id,
            ),
        )
        .outerjoin(
            target_employee,
            or_(
                target_employee.emp_id == target_user.employee_id,
                target_employee.emp_id == target_map.emp_id,
            ),
        )
    )

    if entity_name:
        query = query.filter(AuditLog.entity_name == entity_name)

    if entity_id:
        query = query.filter(AuditLog.entity_id == entity_id)

    if date_from:
        start = datetime.fromisoformat(date_from)
        query = query.filter(AuditLog.performed_at >= start)

    if date_to:
        end = datetime.combine(datetime.fromisoformat(date_to).date(), time(23, 59, 59))
        query = query.filter(AuditLog.performed_at <= end)

    if action:
        query = query.filter(AuditLog.action == action)

    if user_id:
        if user_id.lower() == "system":
            query = query.filter(AuditLog.performed_by.is_(None))
        else:
            query = query.filter(AuditLog.performed_by == int(user_id))

    if search:
        like = f"%{search}%"
        query = query.filter(
            or_(
                actor_user.username.ilike(like),
                target_user.username.ilike(like),
                actor_employee.full_name.ilike(like),
                target_employee.full_name.ilike(like),
                AuditLog.action.ilike(like),
            )
        )

    return query


@router.get("/")
def list_audit_logs(
    entity_name: str | None = None,
    entity_id: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user_id: str | None = None,
    action: str | None = None,
    db: Session = Depends(get_db),
):
    query = _build_audit_query(
        db=db,
        entity_name=entity_name,
        entity_id=entity_id,
        search=search,
        date_from=date_from,
        date_to=date_to,
        user_id=user_id,
        action=action,
    )

    logs = query.order_by(AuditLog.performed_at.desc()).all()

    user_ids = {
        user_id
        for log in logs
        for user_id in (log.performed_by, log.target_user_id)
        if user_id
    }

    users = (
        db.query(User)
        .filter(User.user_id.in_(user_ids))
        .all()
        if user_ids
        else []
    )
    users_by_id = {user.user_id: user for user in users}

    role_rows = (
        db.query(UserRole.user_id, Role.role_name)
        .join(Role, Role.role_id == UserRole.role_id)
        .filter(UserRole.user_id.in_(user_ids))
        .all()
        if user_ids
        else []
    )
    roles_by_user: dict[int, list[str]] = {}
    for user_id_value, role_name in role_rows:
        roles_by_user.setdefault(user_id_value, []).append(role_name)

    user_employee_rows = (
        db.query(UserEmployeeMap.user_id, UserEmployeeMap.emp_id)
        .filter(UserEmployeeMap.user_id.in_(user_ids))
        .all()
        if user_ids
        else []
    )
    map_emp_by_user = {user_id: emp_id for user_id, emp_id in user_employee_rows}

    employee_ids = {
        emp_id
        for user in users
        for emp_id in (user.employee_id, map_emp_by_user.get(user.user_id))
        if emp_id
    }
    employees = (
        db.query(Employee)
        .filter(Employee.emp_id.in_(employee_ids))
        .all()
        if employee_ids
        else []
    )
    employee_by_id = {employee.emp_id: employee.full_name for employee in employees}

    def resolve_full_name(user_id: int | None) -> str | None:
        if not user_id:
            return None
        user = users_by_id.get(user_id)
        if not user:
            return None
        emp_id = user.employee_id or map_emp_by_user.get(user_id)
        return employee_by_id.get(emp_id) if emp_id else None

    response = []
    for log in logs:
        performed_user = users_by_id.get(log.performed_by) if log.performed_by else None
        target_user = users_by_id.get(log.target_user_id) if log.target_user_id else None

        response.append({
            "audit_id": log.audit_id,
            "entity_name": log.entity_name,
            "entity_id": log.entity_id,
            "action": log.action,
            "performed_by": log.performed_by,
            "performed_by_username": performed_user.username if performed_user else None,
            "performed_by_full_name": resolve_full_name(log.performed_by),
            "performed_by_roles": roles_by_user.get(log.performed_by, []),
            "target_user_id": log.target_user_id,
            "target_user_username": target_user.username if target_user else None,
            "target_user_full_name": resolve_full_name(log.target_user_id),
            "old_value": log.old_value,
            "new_value": log.new_value,
            "performed_at": log.performed_at,
        })

    return response


@router.get("/summary")
def audit_log_summary(
    entity_name: str | None = None,
    entity_id: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    user_id: str | None = None,
    action: str | None = None,
    db: Session = Depends(get_db),
):
    base_query = _build_audit_query(
        db=db,
        entity_name=entity_name,
        entity_id=entity_id,
        search=search,
        date_from=date_from,
        date_to=date_to,
        user_id=user_id,
        action=action,
    ).subquery()

    total_logs = db.query(func.count(base_query.c.audit_id)).scalar() or 0
    active_users = (
        db.query(func.count(func.distinct(base_query.c.performed_by)))
        .filter(base_query.c.performed_by.isnot(None))
        .scalar()
        or 0
    )
    warnings_errors = (
        db.query(func.count(base_query.c.audit_id))
        .filter(
            or_(
                base_query.c.action.ilike("%error%"),
                base_query.c.action.ilike("%warning%"),
                base_query.c.action.ilike("%failed%"),
            )
        )
        .scalar()
        or 0
    )
    failed_logins = (
        db.query(func.count(base_query.c.audit_id))
        .filter(base_query.c.action == "LOGIN_FAILED")
        .scalar()
        or 0
    )

    return {
        "total_logs": total_logs,
        "warnings_errors": warnings_errors,
        "active_users": active_users,
        "failed_logins": failed_logins,
    }


@router.get("/export")
def export_audit_logs(
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("Admin", "HR"))
):
    query = db.query(AuditLog)

    if date_from:
        start = datetime.fromisoformat(date_from)
        query = query.filter(AuditLog.performed_at >= start)

    if date_to:
        end = datetime.combine(datetime.fromisoformat(date_to).date(), time(23, 59, 59))
        query = query.filter(AuditLog.performed_at <= end)

    logs = query.order_by(AuditLog.performed_at.desc()).all()

    user_ids = {log.performed_by for log in logs if log.performed_by}
    users = (
        db.query(User)
        .filter(User.user_id.in_(user_ids))
        .all()
        if user_ids
        else []
    )
    users_by_id = {user.user_id: user for user in users}

    role_rows = (
        db.query(UserRole.user_id, Role.role_name)
        .join(Role, Role.role_id == UserRole.role_id)
        .filter(UserRole.user_id.in_(user_ids))
        .all()
        if user_ids
        else []
    )
    roles_by_user: dict[int, list[str]] = {}
    for user_id_value, role_name in role_rows:
        roles_by_user.setdefault(user_id_value, []).append(role_name)

    employee_rows = (
        db.query(UserEmployeeMap.user_id, Employee.full_name)
        .join(Employee, Employee.emp_id == UserEmployeeMap.emp_id)
        .filter(UserEmployeeMap.user_id.in_(user_ids))
        .all()
        if user_ids
        else []
    )
    employee_by_user = {user_id_value: full_name for user_id_value, full_name in employee_rows}

    def parse_value(raw_value: str | None):
        if not raw_value:
            return None
        try:
            return json.loads(raw_value)
        except json.JSONDecodeError:
            return raw_value

    def format_details(log: AuditLog) -> str:
        old_value = parse_value(log.old_value)
        new_value = parse_value(log.new_value)
        if old_value or new_value:
            return f"{old_value or ''} -> {new_value or ''}".strip()
        return log.action

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()

    elements = [
        Paragraph("Audit Log Report", styles["Title"]),
        Paragraph(
            f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
            styles["Normal"],
        ),
    ]

    if date_from or date_to:
        elements.append(
            Paragraph(
                f"Date range: {date_from or 'Any'} to {date_to or 'Any'}",
                styles["Normal"],
            )
        )

    elements.append(Spacer(1, 12))

    table_data = [["Timestamp", "User (Name + Role)", "Action", "Entity", "Details"]]
    for log in logs:
        user = users_by_id.get(log.performed_by) if log.performed_by else None
        user_name = employee_by_user.get(user.user_id) if user else None
        display_name = user_name or (user.username if user else "System")
        roles = ", ".join(roles_by_user.get(user.user_id, [])) if user else "-"
        table_data.append(
            [
                log.performed_at.strftime("%Y-%m-%d %H:%M"),
                f"{display_name} ({roles})",
                log.action,
                log.entity_name,
                format_details(log),
            ]
        )

    table = Table(table_data, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    elements.append(table)

    doc.build(elements)
    buffer.seek(0)

    filename = f"audit-log-{datetime.utcnow().strftime('%Y-%m-%d')}.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
