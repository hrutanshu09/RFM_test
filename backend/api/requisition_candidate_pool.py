import hashlib
import json
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import text

from db.engine import engine
from db.models.candidate_profile import CandidateProfile
from db.models.candidate_resume import CandidateResume
from db.models.requisition import Requisition
from db.models.requisition_candidate_pool import RequisitionCandidatePool
from db.session import get_db
from db.models.requisition_candidate_ranking_snapshot import RequisitionCandidateRankingSnapshot
from services.ta_jd_screening import (
    parse_jd_validated,
    _build_work_experience_entries,
    _experience_score,
    _extract_candidate_years,
    _keyword_overlap_percent,
    _resume_text_blob,
    _skill_component,
)

router = APIRouter(prefix="/requisitions", tags=["Requisition Candidate Pool"])


class AttachCandidatesPayload(BaseModel):
    profile_ids: list[int] = Field(default_factory=list)


class RankCandidatesPayload(BaseModel):
    job_description: str = ""
    strict_upper_bound: bool = False
    force_refresh: bool = False
    debug: bool = False


class PromoteCandidatePayload(BaseModel):
    requisition_item_id: int | None = None
    selected_by: int | None = None


class CandidateStagePayload(BaseModel):
    new_stage: str = Field(..., min_length=3, max_length=32)
    updated_by: int | None = None


def _ensure_table_exists() -> None:
    RequisitionCandidatePool.__table__.create(bind=engine, checkfirst=True)
    # Additive, backward-compatible columns for pool-as-pipeline model.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE requisition_candidate_pool ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR(32)"))
        conn.execute(text("ALTER TABLE requisition_candidate_pool ADD COLUMN IF NOT EXISTS requisition_item_id INTEGER"))
        conn.execute(text("ALTER TABLE requisition_candidate_pool ADD COLUMN IF NOT EXISTS selected_by INTEGER"))
        conn.execute(text("ALTER TABLE requisition_candidate_pool ADD COLUMN IF NOT EXISTS selected_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE requisition_candidate_pool ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMP"))
        conn.execute(text("ALTER TABLE requisition_candidate_pool ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now()"))


def _ensure_ranking_table_exists() -> None:
    RequisitionCandidateRankingSnapshot.__table__.create(bind=engine, checkfirst=True)


def _loads(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _loads_any(value: str | None):
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None


def _as_non_empty_list(value):
    return value if isinstance(value, list) and len(value) > 0 else None


def _as_non_empty_str(value):
    if isinstance(value, str) and value.strip():
        return value
    return None


def _merge_resume_payload(parsed: dict, confirmed: dict) -> dict:
    # Keep parsed as base (it usually contains raw text + broader sections),
    # then override with confirmed values only when confirmed has real content.
    merged = dict(parsed or {})
    for key, value in (confirmed or {}).items():
        if _as_non_empty_list(value) is not None:
            merged[key] = value
            continue
        if _as_non_empty_str(value) is not None:
            merged[key] = value
            continue
        if isinstance(value, (int, float, bool)):
            merged[key] = value
            continue
        if isinstance(value, dict) and value:
            merged[key] = value
    return merged


def _get_latest_resume(db: Session, profile_id: int) -> CandidateResume | None:
    return (
        db.query(CandidateResume)
        .filter(CandidateResume.profile_id == profile_id)
        .order_by(CandidateResume.created_at.desc(), CandidateResume.resume_id.desc())
        .first()
    )


def _stable_candidate_id(req_id: int, profile_id: int, resume_id: int | None) -> str:
    base = f"{req_id}|{profile_id}|{resume_id or 0}"
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:10]
    return f"cand_req_{digest}"


def _require_requisition(db: Session, req_id: int) -> Requisition:
    req = db.query(Requisition).filter(Requisition.req_id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Requisition not found")
    return req


def _sync_legacy_candidate_row(
    db: Session,
    *,
    req_id: int,
    profile_id: int,
    requisition_item_id: int | None,
    stage: str,
    resume_id: int | None = None,
    added_by: int | None = None,
) -> None:
    """
    Backward-compatible sync to legacy `candidates` table.
    Keeps old pipeline screens functional while pool becomes the source layer.
    """
    if requisition_item_id is None:
        return

    try:
        profile = (
            db.query(CandidateProfile)
            .filter(CandidateProfile.profile_id == profile_id)
            .first()
        )
        if not profile or not profile.email:
            return

        effective_resume_id = resume_id
        if effective_resume_id is None:
            latest_resume = _get_latest_resume(db, profile_id)
            effective_resume_id = latest_resume.resume_id if latest_resume else None
        resume_path = (
            f"/api/candidate-intake/resumes/{effective_resume_id}/file"
            if effective_resume_id
            else None
        )

        existing = db.execute(
            text(
                """
                SELECT candidate_id
                FROM candidates
                WHERE requisition_id = :req_id
                  AND requisition_item_id = :item_id
                  AND lower(email) = lower(:email)
                ORDER BY created_at DESC, candidate_id DESC
                LIMIT 1
                """
            ),
            {"req_id": req_id, "item_id": requisition_item_id, "email": profile.email},
        ).fetchone()

        if existing:
            db.execute(
                text(
                    """
                    UPDATE candidates
                    SET full_name = :full_name,
                        phone = :phone,
                        resume_path = :resume_path,
                        current_stage = :stage,
                        updated_at = now()
                    WHERE candidate_id = :candidate_id
                    """
                ),
                {
                    "candidate_id": existing[0],
                    "full_name": profile.full_name,
                    "phone": profile.phone,
                    "resume_path": resume_path,
                    "stage": stage,
                },
            )
            return

        db.execute(
            text(
                """
                INSERT INTO candidates (
                    requisition_item_id,
                    requisition_id,
                    full_name,
                    email,
                    phone,
                    resume_path,
                    current_stage,
                    added_by,
                    created_at,
                    updated_at
                )
                VALUES (
                    :item_id,
                    :req_id,
                    :full_name,
                    :email,
                    :phone,
                    :resume_path,
                    :stage,
                    :added_by,
                    now(),
                    now()
                )
                """
            ),
            {
                "item_id": requisition_item_id,
                "req_id": req_id,
                "full_name": profile.full_name,
                "email": profile.email,
                "phone": profile.phone,
                "resume_path": resume_path,
                "stage": stage,
                "added_by": added_by,
            },
        )
    except Exception:
        # Non-blocking compatibility sync.
        return


@router.get("/{req_id}/candidate-pool/available")
def list_available_candidates(req_id: int, db: Session = Depends(get_db)):
    _ensure_table_exists()
    _require_requisition(db, req_id)

    selected_profile_ids = {
        row.profile_id
        for row in db.query(RequisitionCandidatePool.profile_id)
        .filter(RequisitionCandidatePool.req_id == req_id)
        .all()
    }

    profiles = db.query(CandidateProfile).order_by(CandidateProfile.updated_at.desc()).all()
    out = []
    for profile in profiles:
        latest_resume = _get_latest_resume(db, profile.profile_id)
        parsed = _loads(latest_resume.parsed_payload) if latest_resume else {}
        confirmed = _loads(latest_resume.confirmed_payload) if latest_resume else {}

        out.append(
            {
                "profile_id": profile.profile_id,
                "full_name": profile.full_name,
                "email": profile.email,
                "phone": profile.phone,
                "latest_resume_id": latest_resume.resume_id if latest_resume else None,
                "latest_parser_status": latest_resume.parser_status if latest_resume else None,
                "skills_count": len((confirmed.get("skills") or parsed.get("skills") or [])),
                "is_selected": profile.profile_id in selected_profile_ids,
                "updated_at": profile.updated_at,
            }
        )

    return {"req_id": req_id, "candidates": out}


@router.get("/{req_id}/candidate-pool/selected")
def list_selected_candidates(req_id: int, db: Session = Depends(get_db)):
    _ensure_table_exists()
    _require_requisition(db, req_id)

    rows = (
        db.query(RequisitionCandidatePool)
        .filter(RequisitionCandidatePool.req_id == req_id)
        .order_by(RequisitionCandidatePool.created_at.desc(), RequisitionCandidatePool.id.desc())
        .all()
    )

    out = []
    for row in rows:
        profile = db.query(CandidateProfile).filter(CandidateProfile.profile_id == row.profile_id).first()
        resume = db.query(CandidateResume).filter(CandidateResume.resume_id == row.resume_id).first() if row.resume_id else _get_latest_resume(db, row.profile_id)
        parsed = _loads(resume.parsed_payload) if resume else {}
        confirmed = _loads(resume.confirmed_payload) if resume else {}

        out.append(
            {
                "id": row.id,
                "profile_id": row.profile_id,
                "resume_id": row.resume_id,
                "status": row.status,
                "pipeline_stage": row.pipeline_stage,
                "requisition_item_id": row.requisition_item_id,
                "created_at": row.created_at,
                "candidate": {
                    "full_name": profile.full_name if profile else None,
                    "email": profile.email if profile else None,
                    "phone": profile.phone if profile else None,
                },
                "parsed_summary": {
                    "skills": confirmed.get("skills") or parsed.get("skills") or [],
                    "education": confirmed.get("education") or parsed.get("education") or [],
                    "projects": confirmed.get("projects") or parsed.get("projects") or [],
                    "work_experience": confirmed.get("work_experience") or parsed.get("work_experience") or [],
                },
            }
        )

    return {"req_id": req_id, "selected": out, "count": len(out)}


@router.post("/{req_id}/candidate-pool/attach")
def attach_candidates(req_id: int, payload: AttachCandidatesPayload, db: Session = Depends(get_db)):
    _ensure_table_exists()
    _require_requisition(db, req_id)

    profile_ids = sorted({pid for pid in payload.profile_ids if isinstance(pid, int) and pid > 0})
    if not profile_ids:
        return {"req_id": req_id, "attached": 0, "skipped": 0}

    attached = 0
    skipped = 0
    errors: list[dict] = []

    for profile_id in profile_ids:
        profile = db.query(CandidateProfile).filter(CandidateProfile.profile_id == profile_id).first()
        if not profile:
            skipped += 1
            errors.append({"profile_id": profile_id, "error": "Profile not found"})
            continue

        latest_resume = _get_latest_resume(db, profile_id)
        existing = (
            db.query(RequisitionCandidatePool)
            .filter(
                RequisitionCandidatePool.req_id == req_id,
                RequisitionCandidatePool.profile_id == profile_id,
            )
            .first()
        )
        if existing:
            skipped += 1
            continue

        row = RequisitionCandidatePool(
            req_id=req_id,
            profile_id=profile_id,
            resume_id=latest_resume.resume_id if latest_resume else None,
            status="added",
        )
        db.add(row)
        try:
            db.flush()
            attached += 1
        except IntegrityError:
            db.rollback()
            skipped += 1

    db.commit()
    return {"req_id": req_id, "attached": attached, "skipped": skipped, "errors": errors}


@router.delete("/{req_id}/candidate-pool/{profile_id}")
def remove_candidate(req_id: int, profile_id: int, db: Session = Depends(get_db)):
    _ensure_table_exists()
    _require_requisition(db, req_id)

    row = (
        db.query(RequisitionCandidatePool)
        .filter(
            RequisitionCandidatePool.req_id == req_id,
            RequisitionCandidatePool.profile_id == profile_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not attached to requisition")

    db.delete(row)
    db.commit()
    return {"req_id": req_id, "profile_id": profile_id, "status": "removed"}


VALID_POOL_STAGES = {"Sourced", "Shortlisted", "Interviewing", "Offered", "Hired", "Rejected"}


@router.post("/{req_id}/candidate-pool/{profile_id}/promote")
def promote_candidate_to_pipeline(
    req_id: int,
    profile_id: int,
    payload: PromoteCandidatePayload,
    db: Session = Depends(get_db),
):
    _ensure_table_exists()
    _require_requisition(db, req_id)

    row = (
        db.query(RequisitionCandidatePool)
        .filter(
            RequisitionCandidatePool.req_id == req_id,
            RequisitionCandidatePool.profile_id == profile_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not attached to requisition")

    row.status = "promoted"
    row.pipeline_stage = "Sourced"
    if payload.requisition_item_id:
        row.requisition_item_id = payload.requisition_item_id
    row.selected_by = payload.selected_by
    row.selected_at = datetime.utcnow()
    row.stage_updated_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    _sync_legacy_candidate_row(
        db,
        req_id=req_id,
        profile_id=profile_id,
        requisition_item_id=row.requisition_item_id,
        stage="Sourced",
        resume_id=row.resume_id,
        added_by=payload.selected_by,
    )
    db.commit()
    db.refresh(row)
    return {
        "req_id": req_id,
        "profile_id": profile_id,
        "status": row.status,
        "pipeline_stage": row.pipeline_stage,
        "requisition_item_id": row.requisition_item_id,
    }


@router.patch("/{req_id}/candidate-pool/{profile_id}/stage")
def update_pool_candidate_stage(
    req_id: int,
    profile_id: int,
    payload: CandidateStagePayload,
    db: Session = Depends(get_db),
):
    _ensure_table_exists()
    _require_requisition(db, req_id)
    new_stage = payload.new_stage.strip()
    if new_stage not in VALID_POOL_STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Allowed: {sorted(VALID_POOL_STAGES)}")

    row = (
        db.query(RequisitionCandidatePool)
        .filter(
            RequisitionCandidatePool.req_id == req_id,
            RequisitionCandidatePool.profile_id == profile_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not attached to requisition")

    row.pipeline_stage = new_stage
    row.status = "promoted" if new_stage != "Rejected" else "not_selected"
    row.stage_updated_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    if payload.updated_by:
        row.selected_by = payload.updated_by
    _sync_legacy_candidate_row(
        db,
        req_id=req_id,
        profile_id=profile_id,
        requisition_item_id=row.requisition_item_id,
        stage=new_stage,
        resume_id=row.resume_id,
        added_by=row.selected_by,
    )
    db.commit()
    db.refresh(row)
    return {
        "req_id": req_id,
        "profile_id": profile_id,
        "status": row.status,
        "pipeline_stage": row.pipeline_stage,
    }


@router.get("/{req_id}/candidate-pool/pipeline")
def get_pool_pipeline(req_id: int, db: Session = Depends(get_db)):
    _ensure_table_exists()
    _require_requisition(db, req_id)

    rows = (
        db.query(RequisitionCandidatePool)
        .filter(
            RequisitionCandidatePool.req_id == req_id,
            RequisitionCandidatePool.pipeline_stage.isnot(None),
        )
        .order_by(RequisitionCandidatePool.stage_updated_at.desc(), RequisitionCandidatePool.id.desc())
        .all()
    )

    out = []
    for row in rows:
        profile = db.query(CandidateProfile).filter(CandidateProfile.profile_id == row.profile_id).first()
        resume = (
            db.query(CandidateResume).filter(CandidateResume.resume_id == row.resume_id).first()
            if row.resume_id
            else _get_latest_resume(db, row.profile_id)
        )
        legacy_candidate_id = None
        if profile and profile.email and row.requisition_item_id:
            legacy_row = db.execute(
                text(
                    """
                    SELECT candidate_id
                    FROM candidates
                    WHERE requisition_id = :req_id
                      AND requisition_item_id = :item_id
                      AND lower(email) = lower(:email)
                    ORDER BY updated_at DESC, candidate_id DESC
                    LIMIT 1
                    """
                ),
                {
                    "req_id": req_id,
                    "item_id": row.requisition_item_id,
                    "email": profile.email,
                },
            ).fetchone()
            legacy_candidate_id = legacy_row[0] if legacy_row else None
        out.append(
            {
                "id": row.id,
                "req_id": row.req_id,
                "profile_id": row.profile_id,
                "legacy_candidate_id": legacy_candidate_id,
                "resume_id": row.resume_id if row.resume_id else (resume.resume_id if resume else None),
                "status": row.status,
                "pipeline_stage": row.pipeline_stage,
                "requisition_item_id": row.requisition_item_id,
                "selected_by": row.selected_by,
                "selected_at": row.selected_at,
                "stage_updated_at": row.stage_updated_at,
                "candidate": {
                    "full_name": profile.full_name if profile else None,
                    "email": profile.email if profile else None,
                    "phone": profile.phone if profile else None,
                },
            }
        )

    return {"req_id": req_id, "count": len(out), "pipeline": out}


@router.patch("/{req_id}/candidate-pool/{profile_id}/not-selected")
def mark_pool_candidate_not_selected(req_id: int, profile_id: int, db: Session = Depends(get_db)):
    _ensure_table_exists()
    _require_requisition(db, req_id)
    row = (
        db.query(RequisitionCandidatePool)
        .filter(
            RequisitionCandidatePool.req_id == req_id,
            RequisitionCandidatePool.profile_id == profile_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not attached to requisition")
    row.status = "not_selected"
    row.pipeline_stage = None
    row.stage_updated_at = datetime.utcnow()
    row.updated_at = datetime.utcnow()
    _sync_legacy_candidate_row(
        db,
        req_id=req_id,
        profile_id=profile_id,
        requisition_item_id=row.requisition_item_id,
        stage="Rejected",
        resume_id=row.resume_id,
        added_by=row.selected_by,
    )
    db.commit()
    return {"req_id": req_id, "profile_id": profile_id, "status": "not_selected"}


@router.post("/{req_id}/candidate-pool/rank")
def rank_selected_candidates(req_id: int, payload: RankCandidatesPayload, db: Session = Depends(get_db)):
    _ensure_table_exists()
    _ensure_ranking_table_exists()
    req = _require_requisition(db, req_id)

    jd_text = (payload.job_description or "").strip()
    if not jd_text:
        raise HTTPException(status_code=400, detail="job_description is required")

    cleared_previous_runs = 0

    jd_parsed, _, jd_error, parse_meta = parse_jd_validated(
        jd_text,
        strict_upper_bound=payload.strict_upper_bound,
        force_refresh=payload.force_refresh,
    )
    if jd_error or not jd_parsed:
        return {
            "req_id": req_id,
            "status": "failed",
            "detail": jd_error or "JD parse failed",
            "validation_errors": parse_meta.get("validation_errors", []),
        }

    if payload.force_refresh:
        cleared_previous_runs = (
            db.query(RequisitionCandidateRankingSnapshot)
            .filter(RequisitionCandidateRankingSnapshot.req_id == req_id)
            .delete(synchronize_session=False)
        )
        db.flush()

    rows = (
        db.query(RequisitionCandidatePool)
        .filter(RequisitionCandidatePool.req_id == req_id)
        .order_by(RequisitionCandidatePool.created_at.asc(), RequisitionCandidatePool.id.asc())
        .all()
    )
    if not rows:
        raise HTTPException(status_code=400, detail="No candidates attached to this requisition")

    min_years = jd_parsed.get("min_experience_years")
    max_years = jd_parsed.get("max_experience_years")
    strict = bool(jd_parsed.get("strict_upper_bound"))
    primary = list(jd_parsed.get("primary_skills") or [])
    secondary = list(jd_parsed.get("secondary_skills") or [])

    jd_tokens = {
        token
        for token in __import__("re").findall(r"[A-Za-z0-9+#.]{3,}", jd_text.lower())
        if token not in {"with", "from", "that", "this", "have", "will", "and", "for", "the"}
    }

    ranked = []
    errors = []

    for row in rows:
        profile = db.query(CandidateProfile).filter(CandidateProfile.profile_id == row.profile_id).first()
        resume = db.query(CandidateResume).filter(CandidateResume.resume_id == row.resume_id).first() if row.resume_id else _get_latest_resume(db, row.profile_id)
        if not profile or not resume:
            errors.append({"profile_id": row.profile_id, "error": "Missing profile/resume"})
            continue

        confirmed = _loads(resume.confirmed_payload)
        parsed = _loads(resume.parsed_payload)
        parsed_resume = _merge_resume_payload(parsed, confirmed)
        if not parsed_resume:
            errors.append({"profile_id": row.profile_id, "error": "No parsed payload available"})
            continue

        raw_text = str(parsed_resume.get("raw_text_preview") or "")
        skill_score, skill_details = _skill_component(parsed_resume, raw_text, primary, secondary)
        work_entries = _build_work_experience_entries(parsed_resume, raw_text)
        candidate_years, experience_debug = _extract_candidate_years(work_entries)
        experience_score, experience_fit = _experience_score(candidate_years, min_years, max_years, strict)
        jd_context_score = _keyword_overlap_percent(jd_tokens, _resume_text_blob(parsed_resume))
        final_score = int(round((skill_score * 0.6) + (experience_score * 0.3) + (jd_context_score * 0.1)))

        skills = []
        for detail in skill_details:
            evidence_lines = [str(ev.get("text", "")) for ev in (detail.get("evidence") or []) if isinstance(ev, dict) and str(ev.get("text", "")).strip()]
            skills.append(
                {
                    "skill": detail.get("skill"),
                    "percent": int(detail.get("score", 0) or 0),
                    "evidence": evidence_lines,
                    "is_primary": bool(detail.get("is_primary")),
                    "debug": {
                        "base": detail.get("base"),
                        "occurrence_bonus": detail.get("bonus"),
                        "mentions_in_sections": detail.get("mentions_in_sections", 0),
                        "mentions_in_raw_fallback": detail.get("mentions_in_raw_fallback", 0),
                        "mention_source": detail.get("mention_source", "sections"),
                        "matched_in_sections": detail.get("mentioned_in_sections") or [],
                        "alias_used": bool(detail.get("matched_aliases")),
                        "evidence_count": len(evidence_lines),
                        "matched_tokens": detail.get("matched_aliases") or [],
                    },
                }
            )

        ranked.append(
            {
                "candidate_id": _stable_candidate_id(req_id, row.profile_id, resume.resume_id),
                "profile_id": row.profile_id,
                "resume_id": resume.resume_id,
                "name": profile.full_name,
                "overall_match_percent": final_score,
                "skills": skills,
                "jd_breakdown": {
                    "skill_score": skill_score,
                    "experience_score": experience_score,
                    "jd_context_score": jd_context_score,
                    "experience_years_detected": candidate_years,
                    "experience_fit": experience_fit,
                    "experience_debug": experience_debug,
                },
            }
        )

    ranked.sort(key=lambda x: x.get("overall_match_percent", 0), reverse=True)

    run_id = f"run_req_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"
    for i, item in enumerate(ranked, start=1):
        breakdown = item.get("jd_breakdown") or {}
        snap = RequisitionCandidateRankingSnapshot(
            req_id=req_id,
            run_id=run_id,
            rank_position=i,
            profile_id=item.get("profile_id"),
            resume_id=item.get("resume_id"),
            candidate_name=item.get("name") or "candidate",
            overall_score=int(item.get("overall_match_percent") or 0),
            skill_score=int(breakdown.get("skill_score") or 0),
            experience_score=int(breakdown.get("experience_score") or 0),
            jd_context_score=int(breakdown.get("jd_context_score") or 0),
            experience_years_detected=breakdown.get("experience_years_detected"),
            experience_fit=breakdown.get("experience_fit"),
            skills_json=json.dumps(item.get("skills") or [], ensure_ascii=False),
            jd_breakdown_json=json.dumps(breakdown, ensure_ascii=False),
            jd_parsed_json=json.dumps(jd_parsed, ensure_ascii=False),
        )
        db.add(snap)

    db.commit()

    return {
        "req_id": req_id,
        "status": "completed",
        "run_id": run_id,
        "ranked": len(ranked),
        "cleared_previous_runs": cleared_previous_runs,
        "errors": errors,
        "jd_parsed": jd_parsed,
    }


@router.get("/{req_id}/candidate-pool/rankings")
def get_latest_rankings(req_id: int, db: Session = Depends(get_db)):
    _ensure_ranking_table_exists()
    _require_requisition(db, req_id)

    latest = (
        db.query(RequisitionCandidateRankingSnapshot)
        .filter(RequisitionCandidateRankingSnapshot.req_id == req_id)
        .order_by(RequisitionCandidateRankingSnapshot.created_at.desc(), RequisitionCandidateRankingSnapshot.id.desc())
        .first()
    )
    if not latest:
        return {"req_id": req_id, "ranked_candidates": [], "count": 0}

    rows = (
        db.query(RequisitionCandidateRankingSnapshot)
        .filter(
            RequisitionCandidateRankingSnapshot.req_id == req_id,
            RequisitionCandidateRankingSnapshot.run_id == latest.run_id,
        )
        .order_by(RequisitionCandidateRankingSnapshot.rank_position.asc(), RequisitionCandidateRankingSnapshot.id.asc())
        .all()
    )

    ranked_candidates = []
    jd_parsed = {}
    for row in rows:
        breakdown_raw = _loads_any(row.jd_breakdown_json)
        breakdown = breakdown_raw if isinstance(breakdown_raw, dict) else {}
        skills_raw = _loads_any(row.skills_json)
        skills = skills_raw if isinstance(skills_raw, list) else []
        jd_parsed_raw = _loads_any(row.jd_parsed_json)
        jd_parsed = jd_parsed_raw if isinstance(jd_parsed_raw, dict) else jd_parsed
        ranked_candidates.append(
            {
                "candidate_id": _stable_candidate_id(req_id, row.profile_id or 0, row.resume_id),
                "profile_id": row.profile_id,
                "resume_id": row.resume_id,
                "name": row.candidate_name,
                "overall_match_percent": row.overall_score,
                "skills": skills,
                "jd_breakdown": {
                    "skill_score": breakdown.get("skill_score", row.skill_score),
                    "experience_score": breakdown.get("experience_score", row.experience_score),
                    "jd_context_score": breakdown.get("jd_context_score", row.jd_context_score),
                    "experience_years_detected": breakdown.get("experience_years_detected", row.experience_years_detected),
                    "experience_fit": breakdown.get("experience_fit", row.experience_fit),
                    "experience_debug": breakdown.get("experience_debug", {}),
                },
            }
        )

    return {
        "req_id": req_id,
        "run_id": latest.run_id,
        "jd_parsed": jd_parsed,
        "ranked_candidates": ranked_candidates,
        "count": len(ranked_candidates),
    }




@router.get("/candidate-pool/test-ui", response_class=HTMLResponse)
def candidate_pool_test_ui():
    return HTMLResponse(
        """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Requisition Candidate Pool Test</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; max-width: 980px; }
      .card { border: 1px solid #dde3ec; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
      label { display:block; margin: 8px 0 4px; }
      input, textarea, button { width: 100%; padding: 8px; box-sizing: border-box; }
      button { margin-top: 8px; }
      pre { background: #f5f7fb; border-radius: 8px; padding: 10px; max-height: 380px; overflow:auto; }
      .status { margin: 0 0 12px; display:inline-block; padding:6px 10px; border-radius:999px; font-size:12px; font-weight:600; }
      .status.idle { background:#eef2ff; color:#3730a3; }
      .status.processing { background:#fff7ed; color:#9a3412; }
      .status.success { background:#ecfdf5; color:#065f46; }
      .status.error { background:#fef2f2; color:#991b1b; }
    </style>
  </head>
  <body>
    <h2>Requisition Candidate Pool Test UI</h2>
    <div id="status" class="status idle">Idle</div>

    <div class="card">
      <label>Requisition ID</label>
      <input id="reqId" type="number" min="1" placeholder="e.g. 1" />
      <button id="availableBtn" type="button">Load Available Candidates</button>
      <button id="selectedBtn" type="button">Load Selected Candidates</button>
    </div>

    <div class="card">
      <label>Attach Profile IDs (comma separated)</label>
      <input id="profileIds" placeholder="1,2,3" />
      <button id="attachBtn" type="button">Attach to Requisition</button>
    </div>

    <div class="card">
      <label>Remove Profile ID</label>
      <input id="removeProfileId" type="number" min="1" />
      <button id="removeBtn" type="button">Remove from Requisition</button>
    </div>

    <div class="card">
      <label>JD Text for Ranking</label>
      <textarea id="jdText" rows="6" placeholder="Paste requisition JD text here"></textarea>
      <button id="rankBtn" type="button">Rank Selected Candidates</button>
      <button id="rankingsBtn" type="button">Load Latest Rankings</button>
    </div>

    <div class="card">
      <h3>Response</h3>
      <pre id="out">-</pre>
    </div>

    <script>
      const out = document.getElementById('out');
      const reqIdEl = document.getElementById('reqId');
      const profileIdsEl = document.getElementById('profileIds');
      const removeProfileIdEl = document.getElementById('removeProfileId');
      const statusEl = document.getElementById('status');
      const jdTextEl = document.getElementById('jdText');

      const print = (d) => out.textContent = typeof d === 'string' ? d : JSON.stringify(d, null, 2);
      const reqId = () => (reqIdEl.value || '').trim();
      const setStatus = (state, msg) => { statusEl.className = `status ${state}`; statusEl.textContent = msg; };

      const runRequest = async (msg, fn) => {
        setStatus('processing', msg);
        try {
          const data = await fn();
          print(data);
          setStatus('success', 'Completed');
        } catch (e) {
          print(String(e));
          setStatus('error', 'Request failed');
        }
      };

      document.getElementById('availableBtn').addEventListener('click', async () => {
        const r = reqId();
        if (!r) return print('Enter requisition ID first.');
        await runRequest('Loading available candidates...', async () => {
          const res = await fetch(`/api/requisitions/${r}/candidate-pool/available`);
          return await res.json();
        });
      });

      document.getElementById('selectedBtn').addEventListener('click', async () => {
        const r = reqId();
        if (!r) return print('Enter requisition ID first.');
        await runRequest('Loading selected candidates...', async () => {
          const res = await fetch(`/api/requisitions/${r}/candidate-pool/selected`);
          return await res.json();
        });
      });

      document.getElementById('attachBtn').addEventListener('click', async () => {
        const r = reqId();
        if (!r) return print('Enter requisition ID first.');
        const ids = (profileIdsEl.value || '').split(',').map(v => parseInt(v.trim(), 10)).filter(v => Number.isInteger(v) && v > 0);
        await runRequest('Attaching candidates...', async () => {
          const res = await fetch(`/api/requisitions/${r}/candidate-pool/attach`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile_ids: ids })
          });
          return await res.json();
        });
      });

      document.getElementById('removeBtn').addEventListener('click', async () => {
        const r = reqId();
        const pid = (removeProfileIdEl.value || '').trim();
        if (!r) return print('Enter requisition ID first.');
        if (!pid) return print('Enter profile ID to remove.');
        await runRequest('Removing candidate...', async () => {
          const res = await fetch(`/api/requisitions/${r}/candidate-pool/${pid}`, { method: 'DELETE' });
          return await res.json();
        });
      });

      document.getElementById('rankBtn').addEventListener('click', async () => {
        const r = reqId();
        const jd = (jdTextEl.value || '').trim();
        if (!r) return print('Enter requisition ID first.');
        if (!jd) return print('Paste JD text first.');
        await runRequest('Ranking selected candidates...', async () => {
          const res = await fetch(`/api/requisitions/${r}/candidate-pool/rank`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_description: jd, strict_upper_bound: false, force_refresh: false })
          });
          return await res.json();
        });
      });

      document.getElementById('rankingsBtn').addEventListener('click', async () => {
        const r = reqId();
        if (!r) return print('Enter requisition ID first.');
        await runRequest('Loading latest rankings...', async () => {
          const res = await fetch(`/api/requisitions/${r}/candidate-pool/rankings`);
          return await res.json();
        });
      });
    </script>
  </body>
</html>
        """
    )
