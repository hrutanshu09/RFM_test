from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services.ta_resume_screening import (
    create_job,
    get_job,
    load_taxonomy,
    process_job,
    queue_files,
    set_job_skills,
)

router = APIRouter(prefix="/ta", tags=["TA Resume Screening"])


class JobCreateRequest(BaseModel):
    title: Optional[str] = ""
    primary_skills: list[str] = Field(default_factory=list)
    secondary_skills: list[str] = Field(default_factory=list)
    min_match_percent: int = 0


class JobSkillsRequest(BaseModel):
    title: Optional[str] = ""
    primary_skills: list[str] = Field(default_factory=list)
    secondary_skills: list[str] = Field(default_factory=list)
    min_match_percent: int = 0


@router.get("/skills")
def get_skills_taxonomy():
    return {"skills": load_taxonomy()}


def _validate_skills(primary: list[str], secondary: list[str]) -> Optional[JSONResponse]:
    taxonomy = {skill.lower() for skill in load_taxonomy()}
    invalid = [
        skill
        for skill in primary + secondary
        if skill.lower() not in taxonomy
    ]
    if invalid:
        return JSONResponse(
            status_code=400,
            content={"detail": "Unknown skills in request.", "invalid": invalid},
        )
    return None


@router.post("/jobs")
def create_screening_job(payload: JobCreateRequest):
    primary = [skill.strip() for skill in payload.primary_skills if skill.strip()]
    secondary = [skill.strip() for skill in payload.secondary_skills if skill.strip()]

    invalid = _validate_skills(primary, secondary)
    if invalid:
        return invalid

    job = create_job(
        title=payload.title,
        primary_skills=primary,
        secondary_skills=secondary,
        min_match_percent=max(0, min(100, payload.min_match_percent)),
    )
    return {"job_id": job["job_id"], "status": job["status"]}


@router.post("/jobs/upload")
async def upload_first(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
):
    if not files:
        return JSONResponse(status_code=400, content={"detail": "No files uploaded."})

    job = create_job(title="", primary_skills=[], secondary_skills=[], min_match_percent=0)
    file_items = []
    for upload in files:
        file_items.append(
            {
                "filename": upload.filename,
                "content_type": upload.content_type,
                "file_bytes": await upload.read(),
            }
        )

    queue_files(job["job_id"], file_items)

    return {
        "job_id": job["job_id"],
        "uploaded": len(file_items),
        "accepted": len(file_items),
        "rejected": 0,
        "status": "uploaded",
    }


@router.post("/jobs/{job_id}/skills")
def set_skills_and_process(
    job_id: str,
    payload: JobSkillsRequest,
    background_tasks: BackgroundTasks,
):
    job = get_job(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"detail": "Job not found."})

    primary = [skill.strip() for skill in payload.primary_skills if skill.strip()]
    secondary = [skill.strip() for skill in payload.secondary_skills if skill.strip()]

    invalid = _validate_skills(primary, secondary)
    if invalid:
        return invalid

    set_job_skills(
        job_id,
        title=payload.title,
        primary_skills=primary,
        secondary_skills=secondary,
        min_match_percent=max(0, min(100, payload.min_match_percent)),
    )

    background_tasks.add_task(process_job, job_id)

    return {
        "job_id": job_id,
        "status": "processing",
    }


@router.post("/jobs/{job_id}/resumes")
async def upload_resumes(
    job_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
):
    job = get_job(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"detail": "Job not found."})

    if not files:
        return JSONResponse(status_code=400, content={"detail": "No files uploaded."})

    file_items = []
    for upload in files:
        file_items.append(
            {
                "filename": upload.filename,
                "content_type": upload.content_type,
                "file_bytes": await upload.read(),
            }
        )

    job = queue_files(job_id, file_items)

    if job.get("primary_skills"):
        background_tasks.add_task(process_job, job_id)

    return {
        "job_id": job_id,
        "uploaded": job.get("uploaded", 0),
        "accepted": len(file_items),
        "rejected": 0,
        "status": job.get("status", "uploaded"),
    }


@router.get("/jobs/{job_id}/results")
def get_job_results(job_id: str):
    job = get_job(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"detail": "Job not found."})

    return {
        "job_id": job_id,
        "status": job.get("status"),
        "created_at": job.get("created_at"),
        "title": job.get("title"),
        "primary_skills": job.get("primary_skills"),
        "secondary_skills": job.get("secondary_skills"),
        "min_match_percent": job.get("min_match_percent"),
        "uploaded": job.get("uploaded", 0),
        "processed": job.get("processed", 0),
        "total": job.get("total", 0),
        "errors": job.get("errors", []),
        "ranked_candidates": job.get("results", []),
    }
