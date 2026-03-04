from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
import sqlalchemy as sa
from typing import List
import os
import json
from datetime import datetime, timezone

from db.session import get_db
from db.models.projects import Project, ProjectManager, ProjectTimeline, EmployeeProjectAssignment
from db.models.employee import Employee
from db.models.employee_skill import EmployeeSkill
from db.models.skill import Skill
from db.models.audit_log import AuditLog
from schemas.projects import (
    ProjectCreate, ProjectUpdate, ProjectResponse,
    ProjectApprovalRequest,
    ProjectManagerCreate, ProjectManagerUpdate, ProjectManagerResponse,
    ProjectTimelineCreate, ProjectTimelineUpdate, ProjectTimelineResponse,
    EmployeeProjectAssignmentCreate, EmployeeProjectAssignmentUpdate, EmployeeProjectAssignmentResponse,
    AssignmentApprovalRequest,
    SkillSearchResponse,
    SkillSearchEmployeeResult,
    SkillRecommendationRequest,
    SkillRecommendationResponse,
    SkillRecommendationEmployeeResult,
)
from utils.dependencies import get_current_user, get_current_user_roles
from services.skill_ai_reranker import ai_rerank_skill_candidates
from db.models.auth import User
from db.models.auth import User as AuthUser # Required for join
router = APIRouter(prefix="/projects", tags=["projects"])

FULL_ACCESS_ROLES = {"admin", "owner"}
ASSIGNMENT_WRITE_ROLES = {"admin", "owner", "hr", "ta", "manager", "pm"}
BILLING_ACCESS_ROLES = {"admin", "owner", "manager", "pm"}
AI_RECOMMENDER_ENABLED = os.getenv("ENABLE_SKILL_RECOMMENDATION_AI", "false").lower() == "true"


def _normalized_roles(roles: List[str]) -> set[str]:
    return {r.lower() for r in roles}


def _has_full_access(roles: List[str]) -> bool:
    return bool(_normalized_roles(roles) & FULL_ACCESS_ROLES)


def _can_write_assignments(roles: List[str]) -> bool:
    normalized = _normalized_roles(roles)
    return bool(normalized & ASSIGNMENT_WRITE_ROLES)


def _can_access_billing(roles: List[str]) -> bool:
    normalized = _normalized_roles(roles)
    return bool(normalized & BILLING_ACCESS_ROLES)


def _assert_full_access(roles: List[str]) -> None:
    if not _has_full_access(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Admin or Owner role required.",
        )


def _is_manager_role(roles: List[str]) -> bool:
    return "manager" in _normalized_roles(roles)


def _is_manager_assigned_to_project(db: Session, project_id: int, user_id: int) -> bool:
    return (
        db.query(ProjectManager.id)
        .filter(
            ProjectManager.project_id == project_id,
            ProjectManager.manager_user_id == user_id,
            ProjectManager.is_active == True,
        )
        .first()
        is not None
    )


def _build_project_response_dict(
    project: Project,
    manager_name: str | None,
    manager_user_id: int | None,
    planned_start_date,
    planned_end_date,
    actual_start_date,
    actual_end_date,
    can_current_user_approve: bool = False,
) -> dict:
    project_dict = {c.name: getattr(project, c.name) for c in project.__table__.columns}
    project_dict["manager_name"] = manager_name
    project_dict["manager_user_id"] = manager_user_id
    project_dict["planned_start_date"] = planned_start_date
    project_dict["planned_end_date"] = planned_end_date
    project_dict["actual_start_date"] = actual_start_date
    project_dict["actual_end_date"] = actual_end_date
    project_dict["can_current_user_approve"] = can_current_user_approve
    return project_dict


def _build_assignment_response_dict(
    assignment: EmployeeProjectAssignment,
    can_current_user_approve: bool = False,
) -> dict:
    assignment_dict = {c.name: getattr(assignment, c.name) for c in assignment.__table__.columns}
    assignment_dict["can_current_user_approve"] = can_current_user_approve
    return assignment_dict


def log_audit(db: Session, user_id: int, action: str, entity_name: str, entity_id: int, old_val=None, new_val=None):
    """Helper to record actions in the AuditLog table."""
    audit = AuditLog(
        action=action,
        entity_name=entity_name,
        entity_id=str(entity_id),
        performed_by=user_id,
        old_value=json.dumps(old_val, default=str) if old_val else None,
        new_value=json.dumps(new_val, default=str) if new_val else None
    )
    db.add(audit)


def _assert_assignment_write_access(roles: List[str]) -> None:
    if not _can_write_assignments(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Insufficient role for resource assignment updates.",
        )


def _assert_project_assignment_scope(
    db: Session,
    roles: List[str],
    current_user: User,
    project_id: int,
) -> None:
    _assert_assignment_write_access(roles)
    normalized = _normalized_roles(roles)
    has_non_manager_writer_role = bool((normalized & ASSIGNMENT_WRITE_ROLES) - {"manager"})
    is_manager_only_writer = "manager" in normalized and not has_non_manager_writer_role
    if is_manager_only_writer and not _is_manager_assigned_to_project(db, project_id, current_user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not the assigned manager for this project.",
        )


def _normalize_skill_tokens(values: list[str]) -> list[str]:
    cleaned: list[str] = []
    for value in values:
        token = value.strip().lower()
        if token and token not in cleaned:
            cleaned.append(token)
    return cleaned


def _active_assignment_filter() -> sa.sql.elements.BinaryExpression:
    return EmployeeProjectAssignment.status.in_(["Planned", "Active"])


def _get_project_allocation_flags(
    db: Session,
    project_id: int,
    emp_ids: list[str],
) -> dict[str, dict[str, bool]]:
    if not emp_ids:
        return {}

    rows = (
        db.query(
            EmployeeProjectAssignment.emp_id,
            EmployeeProjectAssignment.project_id,
        )
        .filter(
            EmployeeProjectAssignment.emp_id.in_(emp_ids),
            _active_assignment_filter(),
        )
        .all()
    )
    flags: dict[str, dict[str, bool]] = {
        emp_id: {
            "already_allocated_to_project": False,
            "allocated_elsewhere": False,
        }
        for emp_id in emp_ids
    }
    for emp_id, assigned_project_id in rows:
        if assigned_project_id == project_id:
            flags[emp_id]["already_allocated_to_project"] = True
        else:
            flags[emp_id]["allocated_elsewhere"] = True
    return flags


def _allocation_status_from_flags(
    already_allocated_to_project: bool,
    allocated_elsewhere: bool,
) -> str:
    if already_allocated_to_project:
        return "Already allocated to this project"
    if allocated_elsewhere:
        return "Allocated elsewhere"
    return "Available"


def _determine_match_type(query: str, matched_skills: list[str]) -> str:
    q = query.strip().lower()
    if any(skill.lower() == q for skill in matched_skills):
        return "exact"
    if any(q in skill.lower() or skill.lower() in q for skill in matched_skills):
        return "partial"
    return "related"


def _collect_employee_skill_relevance(
    requested_skills: list[str],
    expanded_skills: list[str],
    employee_skills: list[str],
) -> tuple[list[str], list[str], str]:
    if not requested_skills or not employee_skills:
        return [], [], "No meaningful skill overlap found."

    normalized_employee_skills = [s.lower() for s in employee_skills]
    matched_skills: list[str] = []
    related_skills: list[str] = []

    for requested in requested_skills:
        if requested in normalized_employee_skills:
            matched_skills.append(requested)
            continue

        partial_hits = [
            skill for skill in normalized_employee_skills
            if requested in skill or skill in requested
        ]
        if partial_hits:
            related_skills.extend(partial_hits)
            continue

        requested_tokens = set(requested.split())
        related_hits = []
        for skill in normalized_employee_skills:
            tokens = set(skill.split())
            if requested_tokens and tokens and requested_tokens.intersection(tokens):
                related_hits.append(skill)
        if related_hits:
            related_skills.extend(related_hits)

    related_targets = [skill for skill in expanded_skills if skill not in requested_skills]
    for related in related_targets:
        if related in normalized_employee_skills:
            related_skills.append(related)
            continue

        partial_related_hits = [
            skill for skill in normalized_employee_skills
            if related in skill or skill in related
        ]
        if partial_related_hits:
            related_skills.extend(partial_related_hits)

    dedup_matched = sorted(set(matched_skills))
    dedup_related = sorted(set(related_skills) - set(dedup_matched))
    rationale_parts = []
    if dedup_matched:
        rationale_parts.append(f"exact matches: {', '.join(dedup_matched)}")
    if dedup_related:
        rationale_parts.append(f"similar skills: {', '.join(dedup_related)}")
    if not rationale_parts:
        rationale_parts.append("limited relevance based on partial overlap")

    return dedup_matched, dedup_related, "; ".join(rationale_parts)


def _expand_requested_skills(
    requested_skills: list[str],
    available_skills: set[str],
) -> list[str]:
    relation_map: dict[str, list[str]] = {
        "react": ["javascript", "typescript", "html", "css", "redux", "next.js", "node.js"],
        "angular": ["typescript", "javascript", "html", "css", "rxjs"],
        "vue": ["javascript", "typescript", "html", "css", "nuxt.js"],
        "javascript": ["typescript", "html", "css", "react", "node.js", "express"],
        "typescript": ["javascript", "react", "angular", "node.js"],
        "node.js": ["javascript", "typescript", "express", "mongodb", "rest api"],
        "express": ["node.js", "javascript", "rest api"],
        "python": ["django", "flask", "fastapi", "postgresql", "sql"],
        "django": ["python", "postgresql", "rest api"],
        "flask": ["python", "sqlalchemy", "rest api"],
        "fastapi": ["python", "pydantic", "sqlalchemy", "rest api"],
        "java": ["spring", "spring boot", "hibernate", "sql"],
        "spring": ["java", "spring boot", "hibernate"],
        "spring boot": ["java", "spring", "rest api", "microservices"],
        "c#": [".net", "asp.net", "sql server"],
        ".net": ["c#", "asp.net", "sql server"],
        "go": ["golang", "microservices", "rest api"],
        "golang": ["go", "microservices", "rest api"],
        "postgresql": ["sql", "database", "python", "java"],
        "mysql": ["sql", "database"],
        "mongodb": ["nosql", "node.js", "database"],
        "aws": ["cloud", "devops", "docker", "kubernetes"],
        "azure": ["cloud", "devops", "docker", "kubernetes"],
        "gcp": ["cloud", "devops", "docker", "kubernetes"],
        "docker": ["kubernetes", "devops", "cloud"],
        "kubernetes": ["docker", "devops", "cloud"],
    }

    expanded = list(requested_skills)
    available_lower = {skill.lower() for skill in available_skills}

    def _add_if_available(candidate: str) -> None:
        c = candidate.strip().lower()
        if c and c in available_lower and c not in expanded:
            expanded.append(c)

    for requested in requested_skills:
        for related in relation_map.get(requested, []):
            _add_if_available(related)

        requested_tokens = set(requested.split())
        for available in available_lower:
            available_tokens = set(available.split())
            if requested_tokens and available_tokens and requested_tokens.intersection(available_tokens):
                _add_if_available(available)

    return expanded


def _categorize_skills(skills: list[str]) -> dict[str, list[str]]:
    category_keywords: dict[str, set[str]] = {
        "Frontend": {
            "react", "javascript", "typescript", "html", "css", "angular", "vue",
            "next.js", "nuxt.js", "redux",
        },
        "Backend": {
            "node.js", "express", "python", "java", "spring", "spring boot", "springboot",
            "django", "flask", "fastapi", ".net", "asp.net", "c#", "go", "golang", "php",
        },
        "Database": {
            "sql", "mysql", "postgresql", "mongodb", "redis", "oracle", "nosql", "database",
        },
        "DevOps/Cloud": {
            "aws", "azure", "gcp", "docker", "kubernetes", "jenkins", "terraform", "ci/cd",
            "devops",
        },
        "Testing/Quality": {
            "selenium", "cypress", "jest", "pytest", "junit", "testing", "qa",
        },
        "Data/AI": {
            "machine learning", "deep learning", "nlp", "tensorflow", "pytorch", "data science",
        },
    }

    grouped: dict[str, list[str]] = {}
    for skill in sorted({s.strip() for s in skills if s and s.strip()}):
        normalized = skill.lower()
        matched_category = None
        for category, keywords in category_keywords.items():
            if normalized in keywords or any(keyword in normalized for keyword in keywords):
                matched_category = category
                break
        if matched_category is None:
            matched_category = "Other"
        grouped.setdefault(matched_category, []).append(skill)
    return grouped


def _build_relevance_note(
    requested_skills: list[str],
    skill_groups: dict[str, list[str]],
    rationale: str,
) -> str:
    req = ", ".join(requested_skills[:3])
    top_groups = [group for group in skill_groups.keys() if group != "Other"][:2]
    if top_groups:
        group_text = " and ".join(top_groups)
        return (
            f"Relevant for {req} because this profile shows adjacent {group_text} skills."
        )
    if rationale:
        return f"Relevant for {req} based on overlapping technical patterns."
    return f"Relevant for {req} as a nearby skill profile."


def _maybe_ai_rerank(
    requested_skills: list[str],
    candidates: list[SkillRecommendationEmployeeResult],
    use_ai: bool,
) -> tuple[list[SkillRecommendationEmployeeResult], bool]:
    # Deterministic scoring remains the default output on any AI failure.
    if not use_ai or not AI_RECOMMENDER_ENABLED:
        return candidates, False

    candidate_dicts = [
        {
            "emp_id": row.emp_id,
            "full_name": row.full_name,
            "matched_skills": row.matched_skills,
            "related_skills": row.related_skills,
            "status": row.status,
        }
        for row in candidates
    ]
    ranked_emp_ids, rationales, used_ai = ai_rerank_skill_candidates(
        requested_skills=requested_skills,
        candidates=candidate_dicts,
        required_count=len(candidates),
    )
    if not used_ai or not ranked_emp_ids:
        return candidates, False

    by_emp_id = {candidate.emp_id: candidate for candidate in candidates}
    reranked: list[SkillRecommendationEmployeeResult] = []
    seen: set[str] = set()
    for emp_id in ranked_emp_ids:
        candidate = by_emp_id.get(emp_id)
        if candidate and emp_id not in seen:
            if emp_id in rationales and rationales[emp_id]:
                candidate.rationale = rationales[emp_id]
            reranked.append(candidate)
            seen.add(emp_id)

    for candidate in candidates:
        if candidate.emp_id not in seen:
            reranked.append(candidate)
            seen.add(candidate.emp_id)

    return reranked, True

# --- 1. Project CRUD ---

@router.post("/", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    project: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    """
    Create a project header.  If the caller supplied a manager_user_id
    we also insert the corresponding project_managers row in the same
    transaction.
    """
    _assert_full_access(roles)

    has_start = project.planned_start_date is not None
    has_end = project.planned_end_date is not None
    has_actual_start = project.actual_start_date is not None
    has_actual_end = project.actual_end_date is not None
    if has_start != has_end:
        raise HTTPException(
            status_code=400,
            detail="Provide both planned_start_date and planned_end_date together",
        )
    if has_start and project.planned_end_date < project.planned_start_date:
        raise HTTPException(
            status_code=400,
            detail="planned_end_date cannot be before planned_start_date",
        )
    if has_actual_start and has_actual_end and project.actual_end_date < project.actual_start_date:
        raise HTTPException(
            status_code=400,
            detail="actual_end_date cannot be before actual_start_date",
        )

    # build project model without manager/timeline helper fields
    proj_data = project.model_dump(
        exclude={
            "manager_user_id",
            "planned_start_date",
            "planned_end_date",
            "actual_start_date",
            "actual_end_date",
        }
    )
    proj_data["approval_status"] = "Pending"
    proj_data["approved_by_manager_id"] = None
    proj_data["approved_at"] = None
    proj_data["approval_note"] = None
    db_project = Project(**proj_data)
    db.add(db_project)
    db.flush()                         # get project_id now

    # create assignment row if manager chosen
    if project.manager_user_id:
        db.add(
            ProjectManager(
                project_id=db_project.project_id,
                manager_user_id=project.manager_user_id,
                role="Primary PM",                   # default role
                assigned_from=sa.func.current_date(),
                is_active=True,
            )
        )

    if has_start and has_end:
        db.add(
            ProjectTimeline(
                project_id=db_project.project_id,
                start_date=project.planned_start_date,
                planned_start_date=project.planned_start_date,
                planned_end_date=project.planned_end_date,
                actual_start_date=project.actual_start_date,
                actual_end_date=project.actual_end_date,
                version_number=1,
                is_current=True,
            )
        )

    db.commit()
    db.refresh(db_project)
    return db_project

@router.get("/", response_model=List[ProjectResponse])
def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    # Join with active manager, and current timeline metadata
    results = db.query(
        Project,
        AuthUser.username.label("manager_name"),
        ProjectManager.manager_user_id.label("manager_user_id"),
        ProjectTimeline.planned_start_date.label("planned_start_date"),
        ProjectTimeline.planned_end_date.label("planned_end_date"),
        ProjectTimeline.actual_start_date.label("actual_start_date"),
        ProjectTimeline.actual_end_date.label("actual_end_date"),
    ).outerjoin(
        ProjectManager, 
        (Project.project_id == ProjectManager.project_id) & (ProjectManager.is_active == True)
    ).outerjoin(
        ProjectTimeline,
        (Project.project_id == ProjectTimeline.project_id) & (ProjectTimeline.is_current == True)
    ).outerjoin(
        AuthUser, ProjectManager.manager_user_id == AuthUser.user_id
    ).all()
    
    projects_list = []
    manager_role = _is_manager_role(roles)
    for p, manager_name, manager_user_id, planned_start_date, planned_end_date, actual_start_date, actual_end_date in results:
        can_current_user_approve = bool(
            manager_role and manager_user_id == current_user.user_id
        )
        projects_list.append(
            _build_project_response_dict(
                project=p,
                manager_name=manager_name,
                manager_user_id=manager_user_id,
                planned_start_date=planned_start_date,
                planned_end_date=planned_end_date,
                actual_start_date=actual_start_date,
                actual_end_date=actual_end_date,
                can_current_user_approve=can_current_user_approve,
            )
        )
        
    return projects_list

@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    result = db.query(
        Project,
        AuthUser.username.label("manager_name"),
        ProjectManager.manager_user_id.label("manager_user_id"),
        ProjectTimeline.planned_start_date.label("planned_start_date"),
        ProjectTimeline.planned_end_date.label("planned_end_date"),
        ProjectTimeline.actual_start_date.label("actual_start_date"),
        ProjectTimeline.actual_end_date.label("actual_end_date"),
    ).outerjoin(
        ProjectManager,
        (Project.project_id == ProjectManager.project_id) & (ProjectManager.is_active == True)
    ).outerjoin(
        ProjectTimeline,
        (Project.project_id == ProjectTimeline.project_id) & (ProjectTimeline.is_current == True)
    ).outerjoin(
        AuthUser, ProjectManager.manager_user_id == AuthUser.user_id
    ).filter(
        Project.project_id == project_id
    ).first()

    if not result:
        raise HTTPException(status_code=404, detail="Project not found")

    project, manager_name, manager_user_id, planned_start_date, planned_end_date, actual_start_date, actual_end_date = result
    can_current_user_approve = bool(
        _is_manager_role(roles)
        and _is_manager_assigned_to_project(db, project_id, current_user.user_id)
    )
    return _build_project_response_dict(
        project=project,
        manager_name=manager_name,
        manager_user_id=manager_user_id,
        planned_start_date=planned_start_date,
        planned_end_date=planned_end_date,
        actual_start_date=actual_start_date,
        actual_end_date=actual_end_date,
        can_current_user_approve=can_current_user_approve,
    )

@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: int,
    project_update: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    db_project = db.query(Project).filter(Project.project_id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    raw_update = project_update.model_dump(exclude_unset=True)
    full_access = _has_full_access(roles)

    if not full_access:
        timeline_fields = {
            "planned_start_date",
            "planned_end_date",
            "actual_start_date",
            "actual_end_date",
            "reason_for_change",
        }
        attempted_timeline_update = set(raw_update.keys()) & timeline_fields
        if attempted_timeline_update:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied. Only Admin or Owner can update timeline dates.",
            )

    update_data = dict(raw_update)

    has_manager_update = "manager_user_id" in raw_update
    manager_user_id = update_data.pop("manager_user_id", None)
    has_planned_start = "planned_start_date" in raw_update
    has_planned_end = "planned_end_date" in raw_update
    has_actual_start = "actual_start_date" in raw_update
    has_actual_end = "actual_end_date" in raw_update
    reason_for_change = update_data.pop("reason_for_change", None)
    planned_start_date = update_data.pop("planned_start_date", None)
    planned_end_date = update_data.pop("planned_end_date", None)
    actual_start_date = update_data.pop("actual_start_date", None)
    actual_end_date = update_data.pop("actual_end_date", None)

    if has_planned_start != has_planned_end:
        raise HTTPException(
            status_code=400,
            detail="Provide both planned_start_date and planned_end_date together",
        )
    if has_planned_start and ((planned_start_date is None) or (planned_end_date is None)):
        raise HTTPException(
            status_code=400,
            detail="planned_start_date and planned_end_date cannot be null",
        )
    if has_planned_start and planned_end_date < planned_start_date:
        raise HTTPException(
            status_code=400,
            detail="planned_end_date cannot be before planned_start_date",
        )
    if has_actual_start and has_actual_end and actual_start_date and actual_end_date and actual_end_date < actual_start_date:
        raise HTTPException(
            status_code=400,
            detail="actual_end_date cannot be before actual_start_date",
        )

    old_data = {c.name: getattr(db_project, c.name) for c in db_project.__table__.columns}
    for key, value in update_data.items():
        setattr(db_project, key, value)

    if has_manager_update:
        db.query(ProjectManager).filter(
            ProjectManager.project_id == project_id,
            ProjectManager.is_active == True,
        ).update({"is_active": False})
        if manager_user_id:
            db.add(
                ProjectManager(
                    project_id=project_id,
                    manager_user_id=manager_user_id,
                    role="Primary PM",
                    assigned_from=sa.func.current_date(),
                    is_active=True,
                )
            )

    has_timeline_update = has_planned_start or has_planned_end or has_actual_start or has_actual_end
    if has_timeline_update:
        current_timeline = db.query(ProjectTimeline).filter(
            ProjectTimeline.project_id == project_id,
            ProjectTimeline.is_current == True,
        ).first()

        current_planned_start = current_timeline.planned_start_date if current_timeline else None
        current_planned_end = current_timeline.planned_end_date if current_timeline else None
        current_actual_start = current_timeline.actual_start_date if current_timeline else None
        current_actual_end = current_timeline.actual_end_date if current_timeline else None

        next_planned_start = planned_start_date if has_planned_start else current_planned_start
        next_planned_end = planned_end_date if has_planned_end else current_planned_end
        next_actual_start = actual_start_date if has_actual_start else current_actual_start
        next_actual_end = actual_end_date if has_actual_end else current_actual_end

        if next_planned_start is None or next_planned_end is None:
            raise HTTPException(
                status_code=400,
                detail="Project timeline requires planned_start_date and planned_end_date",
            )

        if next_actual_start and next_actual_end and next_actual_end < next_actual_start:
            raise HTTPException(
                status_code=400,
                detail="actual_end_date cannot be before actual_start_date",
            )

        dates_changed = any([
            next_planned_start != current_planned_start,
            next_planned_end != current_planned_end,
            next_actual_start != current_actual_start,
            next_actual_end != current_actual_end,
        ])
        planned_dates_changed = any([
            next_planned_start != current_planned_start,
            next_planned_end != current_planned_end,
        ])

        if (
            planned_dates_changed
            and current_timeline
            and not (reason_for_change and reason_for_change.strip())
        ):
            raise HTTPException(
                status_code=400,
                detail="reason_for_change is required when updating planned timeline dates",
            )

        if dates_changed:
            if current_timeline:
                current_timeline.is_current = False

            next_version = db.query(sa.func.coalesce(sa.func.max(ProjectTimeline.version_number), 0)).filter(
                ProjectTimeline.project_id == project_id
            ).scalar() + 1

            db.add(
                ProjectTimeline(
                    project_id=project_id,
                    start_date=next_planned_start,
                    planned_start_date=next_planned_start,
                    planned_end_date=next_planned_end,
                    actual_start_date=next_actual_start,
                    actual_end_date=next_actual_end,
                    version_number=next_version,
                    reason_for_change=reason_for_change.strip() if reason_for_change else None,
                    is_current=True,
                )
            )

    log_audit(db, current_user.user_id, "UPDATE", "Project", project_id, old_val=old_data, new_val=update_data)
    db.commit()
    return get_project(project_id, db, current_user, roles)


@router.patch("/{project_id}/approval", response_model=ProjectResponse)
def update_project_approval(
    project_id: int,
    payload: ProjectApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    if not _is_manager_role(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Manager role required.",
        )

    db_project = db.query(Project).filter(Project.project_id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not _is_manager_assigned_to_project(db, project_id, current_user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not the assigned manager for this project.",
        )

    old_data = {
        "approval_status": db_project.approval_status,
        "approved_by_manager_id": db_project.approved_by_manager_id,
        "approved_at": db_project.approved_at,
        "approval_note": db_project.approval_note,
    }

    db_project.approval_status = payload.approval_status
    db_project.approved_by_manager_id = current_user.user_id
    db_project.approved_at = datetime.now(timezone.utc)
    db_project.approval_note = payload.approval_note

    new_data = {
        "approval_status": db_project.approval_status,
        "approved_by_manager_id": db_project.approved_by_manager_id,
        "approved_at": db_project.approved_at,
        "approval_note": db_project.approval_note,
    }
    log_audit(
        db=db,
        user_id=current_user.user_id,
        action="APPROVAL_UPDATE",
        entity_name="Project",
        entity_id=project_id,
        old_val=old_data,
        new_val=new_data,
    )
    db.commit()
    return get_project(project_id, db, current_user, roles)

# --- 2. Project Manager Assignments (REINSTATED) ---

@router.post("/managers", response_model=ProjectManagerResponse)
def add_project_manager(
    manager: ProjectManagerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    """Assigns an internal manager to a project."""
    _assert_full_access(roles)

    db_mgr = ProjectManager(**manager.model_dump())
    db.add(db_mgr)
    db.commit()
    db.refresh(db_mgr)
    
    log_audit(db, current_user.user_id, "CREATE", "ProjectManager", db_mgr.id, new_val=manager.model_dump())
    db.commit()
    return db_mgr

@router.get("/{project_id}/managers", response_model=List[ProjectManagerResponse])
def list_project_managers(project_id: int, db: Session = Depends(get_db)):
    """Retrieves all managers assigned to a specific project."""
    return db.query(ProjectManager).filter(ProjectManager.project_id == project_id).all()

# --- 3. Project Timelines ---

@router.post("/timelines", response_model=ProjectTimelineResponse)
def create_project_timeline(
    timeline: ProjectTimelineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    _assert_full_access(roles)

    if timeline.planned_start_date is None:
        raise HTTPException(
            status_code=400,
            detail="planned_start_date is required for timeline",
        )
    if timeline.planned_end_date < timeline.planned_start_date:
        raise HTTPException(
            status_code=400,
            detail="planned_end_date cannot be before planned_start_date",
        )

    if timeline.is_current:
        db.query(ProjectTimeline).filter(
            ProjectTimeline.project_id == timeline.project_id,
            ProjectTimeline.is_current == True
        ).update({"is_current": False})
    
    version = db.query(ProjectTimeline).filter(ProjectTimeline.project_id == timeline.project_id).count() + 1
    timeline_data = timeline.model_dump()
    timeline_data["start_date"] = timeline.planned_start_date
    db_timeline = ProjectTimeline(**timeline_data, version_number=version)
    
    db.add(db_timeline)
    db.commit()
    log_audit(db, current_user.user_id, "CREATE", "ProjectTimeline", db_timeline.timeline_id, new_val=timeline.model_dump())
    db.commit()
    db.refresh(db_timeline)
    return db_timeline


@router.get("/{project_id}/timelines", response_model=List[ProjectTimelineResponse])
def list_project_timelines(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_exists = db.query(Project.project_id).filter(Project.project_id == project_id).first()
    if not project_exists:
        raise HTTPException(status_code=404, detail="Project not found")

    return (
        db.query(ProjectTimeline)
        .filter(ProjectTimeline.project_id == project_id)
        .order_by(ProjectTimeline.version_number.desc(), ProjectTimeline.timeline_id.desc())
        .all()
    )

# --- 4. Employee Project Assignments (With Billing & Masking) ---

@router.post("/assignments", response_model=EmployeeProjectAssignmentResponse)
def assign_employee_to_project(
    assignment: EmployeeProjectAssignmentCreate, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles)
):
    _assert_project_assignment_scope(
        db=db,
        roles=roles,
        current_user=current_user,
        project_id=assignment.project_id,
    )

    duplicate_assignment = (
        db.query(EmployeeProjectAssignment.assignment_id)
        .filter(
            EmployeeProjectAssignment.project_id == assignment.project_id,
            EmployeeProjectAssignment.emp_id == assignment.emp_id,
            _active_assignment_filter(),
        )
        .first()
    )
    if duplicate_assignment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Employee is already actively assigned to this project.",
        )

    assign_data = assignment.model_dump()
    send_for_approval = bool(assign_data.pop("send_for_approval", True))
    full_access = _has_full_access(roles)
    billing_access = _can_access_billing(roles)
    billing_access = _can_access_billing(roles)
    
    if not billing_access:
        assign_data['billing_rate'] = None
        assign_data['billing_start_date'] = None
        assign_data['billing_end_date'] = None
        assign_data['billing_project_id'] = None
        assign_data['is_billable'] = False

    if full_access and send_for_approval:
        assign_data["approval_status"] = "Pending"
        assign_data["approved_by_manager_id"] = None
        assign_data["approved_at"] = None
        assign_data["approval_note"] = None
        assign_data["approval_requested_by_user_id"] = current_user.user_id
        assign_data["approval_requested_at"] = datetime.now(timezone.utc)
    else:
        assign_data["approval_status"] = "Approved"
        assign_data["approved_by_manager_id"] = current_user.user_id
        assign_data["approved_at"] = datetime.now(timezone.utc)
        assign_data["approval_note"] = "Auto-approved on assignment create"
        assign_data["approval_requested_by_user_id"] = current_user.user_id
        assign_data["approval_requested_at"] = datetime.now(timezone.utc)

    db_asgn = EmployeeProjectAssignment(**assign_data)
    db.add(db_asgn)
    db.commit()
    db.refresh(db_asgn)
    
    log_audit(db, current_user.user_id, "CREATE", "EmployeeProjectAssignment", db_asgn.assignment_id, new_val=assign_data)
    db.commit()
    return db_asgn

@router.get("/projects/{project_id}/assignments", response_model=List[EmployeeProjectAssignmentResponse])
def list_project_assignments(
    project_id: int, 
    db: Session = Depends(get_db), 
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles)
):
    assignments = db.query(EmployeeProjectAssignment).filter(
        EmployeeProjectAssignment.project_id == project_id
    ).order_by(EmployeeProjectAssignment.assignment_id.asc()).all()
    
    full_access = _has_full_access(roles)
    billing_access = _can_access_billing(roles)
    manager_can_approve_project = _is_manager_role(roles) and _is_manager_assigned_to_project(
        db,
        project_id,
        current_user.user_id,
    )

    response_rows: list[dict] = []
    for assignment in assignments:
        if not billing_access:
            assignment.billing_rate = None
            assignment.billing_start_date = None
            assignment.billing_end_date = None
            assignment.billing_project_id = None
            assignment.is_billable = False
        can_current_user_approve = bool(
            manager_can_approve_project and assignment.approval_status == "Pending"
        )
        response_rows.append(
            _build_assignment_response_dict(
                assignment=assignment,
                can_current_user_approve=can_current_user_approve,
            )
        )

    return response_rows

@router.patch("/assignments/{assignment_id}", response_model=EmployeeProjectAssignmentResponse)
def update_project_assignment(
    assignment_id: int,
    assignment_update: EmployeeProjectAssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    _assert_assignment_write_access(roles)

    db_assignment = db.query(EmployeeProjectAssignment).filter(
        EmployeeProjectAssignment.assignment_id == assignment_id
    ).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    update_data = assignment_update.model_dump(exclude_unset=True)
    full_access = _has_full_access(roles)
    billing_access = _can_access_billing(roles)
    if not full_access and "status" in update_data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only Admin or Owner can update assignment status.",
        )

    if not billing_access:
        blocked_financial_fields = {
            "billing_rate",
            "billing_start_date",
            "billing_end_date",
            "billing_project_id",
            "is_billable",
        }
        for key in blocked_financial_fields:
            if key in update_data:
                update_data.pop(key)

    old_data = {c.name: getattr(db_assignment, c.name) for c in db_assignment.__table__.columns}
    for key, value in update_data.items():
        setattr(db_assignment, key, value)

    log_audit(
        db,
        current_user.user_id,
        "UPDATE",
        "EmployeeProjectAssignment",
        assignment_id,
        old_val=old_data,
        new_val=update_data,
    )
    db.commit()
    db.refresh(db_assignment)

    if not billing_access:
        db_assignment.billing_rate = None
        db_assignment.billing_start_date = None
        db_assignment.billing_end_date = None
        db_assignment.billing_project_id = None
        db_assignment.is_billable = False
    return db_assignment


@router.patch("/assignments/{assignment_id}/approval", response_model=EmployeeProjectAssignmentResponse)
def update_assignment_approval(
    assignment_id: int,
    payload: AssignmentApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    if not _is_manager_role(roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Manager role required.",
        )

    db_assignment = db.query(EmployeeProjectAssignment).filter(
        EmployeeProjectAssignment.assignment_id == assignment_id
    ).first()
    if not db_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _assert_project_assignment_scope(
        db=db,
        roles=roles,
        current_user=current_user,
        project_id=db_assignment.project_id,
    )

    if not _is_manager_assigned_to_project(db, db_assignment.project_id, current_user.user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not the assigned manager for this project.",
        )

    old_data = {
        "approval_status": db_assignment.approval_status,
        "approved_by_manager_id": db_assignment.approved_by_manager_id,
        "approved_at": db_assignment.approved_at,
        "approval_note": db_assignment.approval_note,
        "status": db_assignment.status,
        "end_date": db_assignment.end_date,
    }

    db_assignment.approval_status = payload.approval_status
    db_assignment.approved_by_manager_id = current_user.user_id
    db_assignment.approved_at = datetime.now(timezone.utc)
    db_assignment.approval_note = payload.approval_note

    if payload.approval_status == "Rejected":
        db_assignment.status = "Ended"
        if db_assignment.end_date is None:
            db_assignment.end_date = sa.func.current_date()

    new_data = {
        "approval_status": db_assignment.approval_status,
        "approved_by_manager_id": db_assignment.approved_by_manager_id,
        "approved_at": db_assignment.approved_at,
        "approval_note": db_assignment.approval_note,
        "status": db_assignment.status,
        "end_date": db_assignment.end_date,
    }
    log_audit(
        db=db,
        user_id=current_user.user_id,
        action="ASGN_APPROVAL_UPD",
        entity_name="EmployeeProjectAssignment",
        entity_id=assignment_id,
        old_val=old_data,
        new_val=new_data,
    )
    db.commit()
    db.refresh(db_assignment)

    can_current_user_approve = db_assignment.approval_status == "Pending"
    return _build_assignment_response_dict(
        assignment=db_assignment,
        can_current_user_approve=can_current_user_approve,
    )


@router.get("/{project_id}/skill-search", response_model=SkillSearchResponse)
def search_employees_by_skill(
    project_id: int,
    query: str,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    _assert_project_assignment_scope(
        db=db,
        roles=roles,
        current_user=current_user,
        project_id=project_id,
    )

    project_exists = db.query(Project.project_id).filter(Project.project_id == project_id).first()
    if not project_exists:
        raise HTTPException(status_code=404, detail="Project not found")

    normalized_query = query.strip()
    if not normalized_query:
        return SkillSearchResponse(query=query, limit=limit, results=[])

    safe_limit = max(1, min(limit, 100))

    rows = (
        db.query(
            Employee.emp_id,
            Employee.full_name,
            Skill.skill_name,
        )
        .join(EmployeeSkill, EmployeeSkill.emp_id == Employee.emp_id)
        .join(Skill, Skill.skill_id == EmployeeSkill.skill_id)
        .filter(
            sa.or_(
                Skill.skill_name.ilike(f"%{normalized_query}%"),
                Skill.normalized_name.ilike(f"%{normalized_query.lower()}%"),
            )
        )
        .all()
    )

    by_employee: dict[str, dict] = {}
    for emp_id, full_name, skill_name in rows:
        if emp_id not in by_employee:
            by_employee[emp_id] = {
                "emp_id": emp_id,
                "full_name": full_name,
                "matched_skills": [],
            }
        if skill_name not in by_employee[emp_id]["matched_skills"]:
            by_employee[emp_id]["matched_skills"].append(skill_name)

    ordered_results = sorted(
        by_employee.values(),
        key=lambda item: (
            0 if any(s.lower() == normalized_query.lower() for s in item["matched_skills"]) else 1,
            0 if any(normalized_query.lower() in s.lower() for s in item["matched_skills"]) else 1,
            len(item["matched_skills"]) * -1,
            item["full_name"].lower(),
        ),
    )[:safe_limit]

    allocation_flags = _get_project_allocation_flags(
        db=db,
        project_id=project_id,
        emp_ids=[item["emp_id"] for item in ordered_results],
    )

    response_items: list[SkillSearchEmployeeResult] = []
    for item in ordered_results:
        flags = allocation_flags.get(
            item["emp_id"],
            {"already_allocated_to_project": False, "allocated_elsewhere": False},
        )
        status_text = _allocation_status_from_flags(
            already_allocated_to_project=flags["already_allocated_to_project"],
            allocated_elsewhere=flags["allocated_elsewhere"],
        )
        response_items.append(
            SkillSearchEmployeeResult(
                emp_id=item["emp_id"],
                full_name=item["full_name"],
                matched_skills=sorted(item["matched_skills"]),
                match_type=_determine_match_type(normalized_query, item["matched_skills"]),
                already_allocated_to_project=flags["already_allocated_to_project"],
                allocated_elsewhere=flags["allocated_elsewhere"],
                status=status_text,
            )
        )

    return SkillSearchResponse(
        query=query,
        limit=safe_limit,
        results=response_items,
    )


@router.post("/{project_id}/skill-recommendations", response_model=SkillRecommendationResponse)
def recommend_employees_by_skill(
    project_id: int,
    payload: SkillRecommendationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    roles: List[str] = Depends(get_current_user_roles),
):
    _assert_project_assignment_scope(
        db=db,
        roles=roles,
        current_user=current_user,
        project_id=project_id,
    )

    project_exists = db.query(Project.project_id).filter(Project.project_id == project_id).first()
    if not project_exists:
        raise HTTPException(status_code=404, detail="Project not found")

    requested_skills = _normalize_skill_tokens(payload.requested_skills)
    if not requested_skills:
        raise HTTPException(status_code=400, detail="requested_skills must not be empty")

    safe_required_count = max(1, min(payload.required_count or 5, 50))

    rows = (
        db.query(
            Employee.emp_id,
            Employee.full_name,
            Skill.skill_name,
        )
        .join(EmployeeSkill, EmployeeSkill.emp_id == Employee.emp_id)
        .join(Skill, Skill.skill_id == EmployeeSkill.skill_id)
        .all()
    )

    skills_by_employee: dict[str, dict] = {}
    available_skill_names: set[str] = set()
    for emp_id, full_name, skill_name in rows:
        if emp_id not in skills_by_employee:
            skills_by_employee[emp_id] = {
                "full_name": full_name,
                "skills": [],
            }
        skills_by_employee[emp_id]["skills"].append(skill_name)
        available_skill_names.add(skill_name)

    expanded_requested_skills = _expand_requested_skills(
        requested_skills=requested_skills,
        available_skills=available_skill_names,
    )

    all_emp_ids = list(skills_by_employee.keys())
    flags = _get_project_allocation_flags(db=db, project_id=project_id, emp_ids=all_emp_ids)

    candidates: list[SkillRecommendationEmployeeResult] = []
    fallback_pool: list[SkillRecommendationEmployeeResult] = []
    for emp_id, info in skills_by_employee.items():
        emp_flags = flags.get(
            emp_id,
            {"already_allocated_to_project": False, "allocated_elsewhere": False},
        )
        if (
            not payload.allow_existing_project_assignments
            and emp_flags["already_allocated_to_project"]
        ):
            continue

        fallback_pool.append(
            SkillRecommendationEmployeeResult(
                emp_id=emp_id,
                full_name=info["full_name"],
                matched_skills=[],
                related_skills=sorted({s.lower() for s in info["skills"]})[:6],
                skill_groups={},
                rationale="AI fallback candidate from overall nearby skill pool",
                relevance_note="",
                already_allocated_to_project=emp_flags["already_allocated_to_project"],
                allocated_elsewhere=emp_flags["allocated_elsewhere"],
                status=_allocation_status_from_flags(
                    already_allocated_to_project=emp_flags["already_allocated_to_project"],
                    allocated_elsewhere=emp_flags["allocated_elsewhere"],
                ),
            )
        )

        matched_skills, related_skills, rationale = _collect_employee_skill_relevance(
            requested_skills=requested_skills,
            expanded_skills=expanded_requested_skills,
            employee_skills=info["skills"],
        )
        if not matched_skills and not related_skills:
            continue

        candidates.append(
            SkillRecommendationEmployeeResult(
                emp_id=emp_id,
                full_name=info["full_name"],
                matched_skills=matched_skills,
                related_skills=related_skills,
                skill_groups={},
                rationale=rationale,
                relevance_note="",
                already_allocated_to_project=emp_flags["already_allocated_to_project"],
                allocated_elsewhere=emp_flags["allocated_elsewhere"],
                status=_allocation_status_from_flags(
                    already_allocated_to_project=emp_flags["already_allocated_to_project"],
                    allocated_elsewhere=emp_flags["allocated_elsewhere"],
                ),
            )
        )

    candidates.sort(
        key=lambda row: (
            len(row.matched_skills) * -1,
            len(row.related_skills) * -1,
            1 if row.allocated_elsewhere else 0,
            row.full_name.lower(),
        )
    )
    deterministic_top = candidates[:safe_required_count]
    candidate_pool_for_rerank = deterministic_top
    if (
        payload.ai_enabled
        and AI_RECOMMENDER_ENABLED
        and not deterministic_top
        and fallback_pool
    ):
        fallback_pool.sort(
            key=lambda row: (
                0 if row.status == "Available" else 1,
                row.full_name.lower(),
            )
        )
        ai_pool_size = min(max(safe_required_count * 8, 30), len(fallback_pool))
        candidate_pool_for_rerank = fallback_pool[:ai_pool_size]

    reranked, used_ai_rerank = _maybe_ai_rerank(
        requested_skills=requested_skills,
        candidates=candidate_pool_for_rerank,
        use_ai=payload.ai_enabled,
    )

    for row in reranked:
        grouped = _categorize_skills(row.matched_skills + row.related_skills)
        row.skill_groups = grouped
        row.relevance_note = _build_relevance_note(
            requested_skills=requested_skills,
            skill_groups=grouped,
            rationale=row.rationale,
        )

    return SkillRecommendationResponse(
        requested_skills=requested_skills,
        required_count=safe_required_count,
        used_ai_rerank=used_ai_rerank,
        results=reranked,
    )
