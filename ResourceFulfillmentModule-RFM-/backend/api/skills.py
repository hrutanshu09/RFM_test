from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db.session import get_db
from db.models.auth import User
from utils.dependencies import require_any_role
from db.models.skill import Skill
from db.models.audit_log import AuditLog
from schemas.skill import SkillCreate, SkillInstantCreate, SkillResponse, SkillUpdate

router = APIRouter(prefix="/skills", tags=["Skills"])

@router.post("/", response_model=SkillResponse)
def create_skill(
    payload: SkillCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    existing = db.query(Skill).filter(Skill.skill_name == payload.skill_name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Skill already exists")

    skill = Skill(skill_name=payload.skill_name)
    db.add(skill)
    db.commit()
    db.refresh(skill)

    audit = AuditLog(
        entity_name="skill",
        entity_id=str(skill.skill_id),
        action="CREATE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()

    return skill


@router.post("/instant-add", response_model=SkillResponse)
def instant_add_skill(
    payload: SkillInstantCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee"))
):
    name = (payload.name or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Skill name must be at least 2 characters")

    normalized_name = name.lower()

    existing = db.query(Skill).filter(Skill.normalized_name == normalized_name).first()
    if existing:
        created_by_name = None
        if existing.created_by:
            user = db.query(User).filter(User.user_id == existing.created_by).first()
            created_by_name = user.username if user else None

        return SkillResponse(
            skill_id=existing.skill_id,
            skill_name=existing.skill_name,
            created_by=created_by_name,
            created_at=None,
        )

    skill = Skill(
        skill_name=name,
        normalized_name=normalized_name,
        is_verified=False,
        created_by=current_user.user_id,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)

    return SkillResponse(
        skill_id=skill.skill_id,
        skill_name=skill.skill_name,
        created_by=current_user.username,
        created_at=None,
    )
@router.get("/", response_model=list[SkillResponse])
def list_skills(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin", "Manager", "Employee", "TA"))
):
    skills = db.query(Skill).order_by(Skill.skill_name).all()

    audit_logs = (
        db.query(AuditLog)
        .filter(AuditLog.entity_name == "skill", AuditLog.action == "CREATE")
        .all()
    )
    audit_by_entity = {log.entity_id: log for log in audit_logs}
    user_ids = {log.performed_by for log in audit_logs if log.performed_by}
    users_by_id = {
        user.user_id: user.username
        for user in db.query(User).filter(User.user_id.in_(user_ids)).all()
    } if user_ids else {}

    response: list[SkillResponse] = []
    for skill in skills:
        audit = audit_by_entity.get(str(skill.skill_id))
        response.append(
            SkillResponse(
                skill_id=skill.skill_id,
                skill_name=skill.skill_name,
                created_by=users_by_id.get(audit.performed_by) if audit else None,
                created_at=audit.performed_at if audit else None,
            )
        )

    return response


@router.patch("/{skill_id}", response_model=SkillResponse)
def update_skill(
    skill_id: int,
    payload: SkillUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    skill = db.query(Skill).filter(Skill.skill_id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    skill.skill_name = payload.skill_name
    db.commit()
    db.refresh(skill)

    audit = AuditLog(
        entity_name="skill",
        entity_id=str(skill.skill_id),
        action="UPDATE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()

    return SkillResponse(
        skill_id=skill.skill_id,
        skill_name=skill.skill_name,
    )


@router.delete("/{skill_id}")
def delete_skill(
    skill_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_role("HR", "Admin"))
):
    skill = db.query(Skill).filter(Skill.skill_id == skill_id).first()
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")

    db.delete(skill)
    db.commit()

    audit = AuditLog(
        entity_name="skill",
        entity_id=str(skill_id),
        action="DELETE",
        performed_by=current_user.user_id,
    )
    db.add(audit)
    db.commit()

    return {"message": "Skill deleted"}
