import json
import os
import re
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from db.models.candidate_intake_submission import CandidateIntakeSubmission
from db.models.candidate_profile import CandidateProfile
from db.models.candidate_resume import CandidateResume
from db.session import get_db
from services.resume_parser import parse_resume_bytes
from utils.storage import StorageService, get_resume_storage_service

router = APIRouter(prefix="/candidate-intake", tags=["Candidate Intake"])

RESUME_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_FILE_SIZE = 10 * 1024 * 1024


def _ext_from_content_type(content_type: str) -> str:
    mapping = {
        "application/pdf": ".pdf",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    }
    return mapping.get(content_type, ".pdf")


def _parse_payload_json(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}




def _is_nonempty(value: object) -> bool:
    return bool(str(value or "").strip())


def _parse_project_text_line(text: str) -> dict:
    raw = str(text or "").strip().strip("|").strip()
    if not raw:
        return {"project_name": None, "brief_summary": None, "tech_stack": None}

    # Remove optional "(Tech Stack: ...)" suffix first.
    tech_stack = None
    stack_match = re.search(r"\(\s*tech\s*stack\s*:\s*(.*?)\)\s*$", raw, flags=re.IGNORECASE)
    if stack_match:
        tech_stack = stack_match.group(1).strip() or None
        raw = raw[: stack_match.start()].strip()

    # Handle explicit pipe form if present.
    if "|" in raw:
        parts = [p.strip() for p in raw.split("|")]
        non_empty = [p for p in parts if p]
        if len(non_empty) >= 3:
            return {
                "project_name": non_empty[0] or None,
                "brief_summary": non_empty[1] or None,
                "tech_stack": (non_empty[2] or tech_stack) or None,
            }
        if len(non_empty) == 2:
            return {
                "project_name": non_empty[0] or None,
                "brief_summary": non_empty[1] or None,
                "tech_stack": tech_stack,
            }
        if len(non_empty) == 1:
            raw = non_empty[0]

    name = None
    summary = raw
    if ":" in raw:
        left, right = raw.split(":", 1)
        if left.strip() and right.strip():
            name = left.strip()
            summary = right.strip()

    return {"project_name": name, "brief_summary": summary or None, "tech_stack": tech_stack}


def _parse_work_text_line(text: str) -> dict:
    raw = str(text or "").strip().strip("|").strip()
    if not raw:
        return {"company": None, "role": None, "dates": None}

    # Handle explicit pipe form if present.
    if "|" in raw:
        parts = [p.strip() for p in raw.split("|")]
        non_empty = [p for p in parts if p]
        if len(non_empty) >= 3:
            return {"company": non_empty[0] or None, "role": non_empty[1] or None, "dates": non_empty[2] or None}
        if len(non_empty) == 2:
            return {"company": non_empty[0] or None, "role": non_empty[1] or None, "dates": None}
        if len(non_empty) == 1:
            raw = non_empty[0]

    dates = None
    # Prefer parenthesized dates: "(Jan 2025 - May 2025)"
    paren = re.search(r"\(([^)]*(?:19|20)\d{2}[^)]*)\)\s*$", raw)
    if paren:
        dates = paren.group(1).strip() or None
        raw = (raw[: paren.start()] + raw[paren.end() :]).strip(" -")
    else:
        # Fallback: any year range text in-line
        if re.search(r"\b(19|20)\d{2}\b", raw):
            dates = raw

    company = None
    role = None
    if re.search(r"\s+at\s+", raw, flags=re.IGNORECASE):
        left, right = re.split(r"\s+at\s+", raw, maxsplit=1, flags=re.IGNORECASE)
        role = left.strip() or None
        company = right.strip(" ,-") or None
    elif " - " in raw:
        left, right = raw.split(" - ", 1)
        company = left.strip() or None
        role = right.strip() or None
    else:
        role = raw or None

    return {"company": company, "role": role, "dates": dates}


def _normalize_projects(projects_raw: object) -> list[dict]:
    out: list[dict] = []
    if not isinstance(projects_raw, list):
        return out
    for item in projects_raw:
        if isinstance(item, dict):
            name = str(item.get("project_name") or item.get("name") or item.get("title") or "").strip()
            summary = str(item.get("brief_summary") or item.get("summary") or item.get("description") or "").strip()
            raw_stack = item.get("tech_stack") or item.get("stack") or item.get("technologies")
            if isinstance(raw_stack, list):
                tech_stack = ", ".join([str(x).strip() for x in raw_stack if str(x).strip()])
            else:
                tech_stack = str(raw_stack or "").strip()
            if not (name or summary or tech_stack):
                parsed = _parse_project_text_line(
                    str(item.get("text") or item.get("value") or item.get("project") or "")
                )
                name = str(parsed.get("project_name") or "").strip()
                summary = str(parsed.get("brief_summary") or "").strip()
                tech_stack = str(parsed.get("tech_stack") or "").strip()
        else:
            parsed = _parse_project_text_line(str(item or ""))
            name = str(parsed.get("project_name") or "").strip()
            summary = str(parsed.get("brief_summary") or "").strip()
            tech_stack = str(parsed.get("tech_stack") or "").strip()

        if name or summary or tech_stack:
            out.append(
                {
                    "project_name": name or None,
                    "brief_summary": summary or None,
                    "tech_stack": tech_stack or None,
                }
            )
    return out


def _normalize_work_experience(work_raw: object) -> list[dict]:
    out: list[dict] = []
    if not isinstance(work_raw, list):
        return out
    for item in work_raw:
        if isinstance(item, dict):
            company = str(item.get("company") or item.get("organization") or item.get("employer") or "").strip()
            role = str(item.get("role") or item.get("title") or item.get("position") or "").strip()
            dates = str(item.get("dates") or item.get("duration") or item.get("period") or "").strip()
            if not (company or role or dates):
                parsed = _parse_work_text_line(
                    str(item.get("text") or item.get("value") or item.get("experience") or "")
                )
                company = str(parsed.get("company") or "").strip()
                role = str(parsed.get("role") or "").strip()
                dates = str(parsed.get("dates") or "").strip()
        else:
            parsed = _parse_work_text_line(str(item or ""))
            company = str(parsed.get("company") or "").strip()
            role = str(parsed.get("role") or "").strip()
            dates = str(parsed.get("dates") or "").strip()

        if company or role or dates:
            out.append({"company": company or None, "role": role or None, "dates": dates or None})
    return out


def _extract_section_block(raw_text: str, start_patterns: list[str], stop_patterns: list[str]) -> list[str]:
    lines = [ln.strip() for ln in (raw_text or "").splitlines()]
    start_idx = -1
    for i, ln in enumerate(lines):
        low = ln.lower()
        if any(re.search(p, low) for p in start_patterns):
            start_idx = i + 1
            break
    if start_idx < 0:
        return []

    block: list[str] = []
    for ln in lines[start_idx:]:
        low = ln.lower()
        if any(re.search(p, low) for p in stop_patterns):
            break
        if ln:
            block.append(ln)
    return block


def _fallback_projects_from_raw_text(raw_text: str) -> list[dict]:
    block = _extract_section_block(
        raw_text,
        start_patterns=[r"^projects?$", r"^project\s+experience$", r"^academic\s+projects?$"],
        stop_patterns=[r"^experience$", r"^work\s+experience$", r"^education$", r"^skills?$", r"^certifications?$"],
    )
    out: list[dict] = []
    for ln in block:
        text = ln.lstrip("-?* ").strip()
        if len(text) < 8:
            continue
        if text.lower() in {"projects", "project"}:
            continue
        out.append({"project_name": None, "brief_summary": text, "tech_stack": None})
        if len(out) >= 8:
            break
    return out


def _fallback_work_from_raw_text(raw_text: str) -> list[dict]:
    block = _extract_section_block(
        raw_text,
        start_patterns=[r"^experience$", r"^work\s+experience$", r"^professional\s+experience$", r"^employment$"],
        stop_patterns=[r"^projects?$", r"^education$", r"^skills?$", r"^certifications?$"],
    )
    out: list[dict] = []
    for ln in block:
        text = ln.lstrip("-?* ").strip()
        if len(text) < 6:
            continue
        if text.lower() in {"experience", "work experience", "professional experience"}:
            continue
        # Lightweight split: company | role | dates if patterns appear
        company = None
        role = None
        dates = None
        if " - " in text or " ? " in text:
            parts = re.split(r"\s[-?]\s", text, maxsplit=1)
            left = parts[0].strip()
            right = parts[1].strip() if len(parts) > 1 else ""
            company = left or None
            role = right or None
        else:
            role = text

        if re.search(r"(19|20)\d{2}", text):
            dates = text

        out.append({"company": company, "role": role, "dates": dates})
        if len(out) >= 8:
            break
    return out


def _normalize_parsed_payload(payload: dict) -> tuple[dict, dict]:
    data = dict(payload or {})
    raw_text = str(data.get("raw_text_preview") or "")

    projects = _normalize_projects(data.get("projects"))
    work = _normalize_work_experience(data.get("work_experience"))

    debug = {
        "projects_source": "model",
        "work_source": "model",
    }

    if not projects and raw_text:
        projects = _fallback_projects_from_raw_text(raw_text)
        debug["projects_source"] = "fallback" if projects else "none"

    if not work and raw_text:
        work = _fallback_work_from_raw_text(raw_text)
        debug["work_source"] = "fallback" if work else "none"

    data["projects"] = projects
    data["work_experience"] = work
    return data, debug


def _validate_upload(resume: UploadFile) -> tuple[str, bytes]:
    content_type = (resume.content_type or "").lower()
    if content_type not in RESUME_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: PDF, DOC, DOCX")

    resume.file.seek(0, 2)
    size = resume.file.tell()
    resume.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 10MB")

    file_bytes = resume.file.read()
    resume.file.seek(0)
    return content_type, file_bytes


@router.post("/parse-preview")
def parse_preview_resume(resume: UploadFile = File(...)):
    content_type, file_bytes = _validate_upload(resume)
    parsed_payload, parse_error, _ = parse_resume_bytes(file_bytes, content_type)

    if parse_error:
        return {"status": "parse_failed", "detail": parse_error, "parsed_profile": {}}

    normalized, debug = _normalize_parsed_payload(parsed_payload or {})
    missing = []
    if not normalized.get("projects"):
        missing.append("projects")
    if not normalized.get("work_experience"):
        missing.append("work_experience")

    return {"status": "parsed", "parsed_profile": normalized, "parse_debug": {**debug, "missing_fields": missing}}


@router.post("/apply")
def apply_candidate(
    full_name: str = Form(...),
    email: str = Form(...),
    phone: str | None = Form(None),
    confirmed_profile_json: str | None = Form(None),
    resume: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_resume_storage_service),
):
    content_type, file_bytes = _validate_upload(resume)

    parsed_payload, parse_error, _ = parse_resume_bytes(file_bytes, content_type)
    parsed_payload, _ = _normalize_parsed_payload(parsed_payload or {})
    confirmed_payload = _parse_payload_json(confirmed_profile_json)

    stored_name = f"{uuid4().hex}{_ext_from_content_type(content_type)}"
    resume_key = storage.save(resume, stored_name)

    normalized_name = full_name.strip()
    normalized_email = email.strip().lower()
    normalized_phone = (phone or "").strip() or None

    profile = db.query(CandidateProfile).filter(CandidateProfile.email == normalized_email).first()
    if profile:
        profile.full_name = normalized_name or profile.full_name
        profile.phone = normalized_phone
    else:
        profile = CandidateProfile(full_name=normalized_name, email=normalized_email, phone=normalized_phone)
        db.add(profile)
        db.flush()

    parsed_payload_json = json.dumps(parsed_payload or {}, ensure_ascii=False)
    confirmed_payload_json = json.dumps(confirmed_payload or {}, ensure_ascii=False) if confirmed_payload else None

    resume_record = CandidateResume(
        profile_id=profile.profile_id,
        resume_file_key=resume_key,
        resume_original_filename=resume.filename or stored_name,
        resume_content_type=content_type,
        parser_status="parsed" if not parse_error else "failed",
        parsed_payload=parsed_payload_json,
        confirmed_payload=confirmed_payload_json,
        parser_error=parse_error,
    )
    db.add(resume_record)
    db.flush()

    record = CandidateIntakeSubmission(
        full_name=normalized_name,
        email=normalized_email,
        phone=normalized_phone,
        profile_id=profile.profile_id,
        resume_id=resume_record.resume_id,
        resume_file_key=resume_key,
        resume_original_filename=resume.filename or stored_name,
        resume_content_type=content_type,
        parser_status=resume_record.parser_status,
        submission_status="submitted",
        parsed_payload=resume_record.parsed_payload,
        confirmed_payload=resume_record.confirmed_payload,
        parser_error=parse_error,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    base_response = {
        "submission_id": record.submission_id,
        "profile_id": profile.profile_id,
        "resume_id": resume_record.resume_id,
        "candidate": {
            "full_name": record.full_name,
            "email": record.email,
            "phone": record.phone,
        },
        "resume": {
            "file_key": record.resume_file_key,
            "original_filename": record.resume_original_filename,
        },
    }

    if parse_error:
        return {
            **base_response,
            "status": "stored_parse_failed",
            "message": "Resume uploaded but parsing failed.",
            "detail": parse_error,
            "confirmed_profile": confirmed_payload or {},
        }

    return {
        **base_response,
        "status": "stored_parsed",
        "parsed_profile": parsed_payload or {},
        "confirmed_profile": confirmed_payload or {},
    }


@router.get("/profiles")
def list_profiles(db: Session = Depends(get_db)):
    profiles = db.query(CandidateProfile).order_by(CandidateProfile.updated_at.desc()).all()
    out = []
    for profile in profiles:
        latest_resume = (
            db.query(CandidateResume)
            .filter(CandidateResume.profile_id == profile.profile_id)
            .order_by(CandidateResume.created_at.desc(), CandidateResume.resume_id.desc())
            .first()
        )
        out.append(
            {
                "profile_id": profile.profile_id,
                "full_name": profile.full_name,
                "email": profile.email,
                "phone": profile.phone,
                "latest_resume_id": latest_resume.resume_id if latest_resume else None,
                "latest_parser_status": latest_resume.parser_status if latest_resume else None,
                "updated_at": profile.updated_at,
            }
        )
    return {"profiles": out}


@router.get("/profiles/{profile_id}")
def get_profile(profile_id: int, db: Session = Depends(get_db)):
    profile = db.query(CandidateProfile).filter(CandidateProfile.profile_id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    resume_rows = (
        db.query(CandidateResume)
        .filter(CandidateResume.profile_id == profile_id)
        .order_by(CandidateResume.created_at.desc(), CandidateResume.resume_id.desc())
        .all()
    )

    resumes = []
    for row in resume_rows:
        resumes.append(
            {
                "resume_id": row.resume_id,
                "file_key": row.resume_file_key,
                "original_filename": row.resume_original_filename,
                "content_type": row.resume_content_type,
                "parser_status": row.parser_status,
                "parser_error": row.parser_error,
                "parsed_profile": _parse_payload_json(row.parsed_payload),
                "confirmed_profile": _parse_payload_json(row.confirmed_payload),
                "created_at": row.created_at,
            }
        )

    return {
        "profile": {
            "profile_id": profile.profile_id,
            "full_name": profile.full_name,
            "email": profile.email,
            "phone": profile.phone,
            "created_at": profile.created_at,
            "updated_at": profile.updated_at,
        },
        "resumes": resumes,
    }


@router.get("/resumes/{resume_id}/file")
def get_resume_file(
    resume_id: int,
    db: Session = Depends(get_db),
    storage: StorageService = Depends(get_resume_storage_service),
):
    row = db.query(CandidateResume).filter(CandidateResume.resume_id == resume_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Resume not found")

    key = str(row.resume_file_key or "").strip()
    if not key:
        raise HTTPException(status_code=404, detail="Resume file key missing")

    file_url = storage.get_url(key)
    content_type = row.resume_content_type or "application/octet-stream"
    filename = row.resume_original_filename or f"resume_{resume_id}"

    if file_url.startswith("http://") or file_url.startswith("https://"):
        return RedirectResponse(url=file_url, status_code=307)

    if not os.path.exists(file_url):
        raise HTTPException(status_code=404, detail="Stored resume file not found")

    return FileResponse(
        path=file_url,
        media_type=content_type,
        filename=filename,
    )


@router.get("/test-ui-v2", response_class=HTMLResponse)
def candidate_intake_test_ui_v2():
    return HTMLResponse(
        """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Candidate Intake Test UI V2</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; max-width: 1100px; background: #f6f8fc; }
      .card { border: 1px solid #dbe2ee; border-radius: 12px; padding: 14px; background: #fff; margin-bottom: 14px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      label { display:block; margin: 8px 0 4px; font-size: 13px; color:#425466; }
      input, textarea, button { width: 100%; padding: 8px; box-sizing: border-box; }
      textarea { min-height: 110px; }
      button { cursor: pointer; margin-top: 10px; }
      pre { background: #f5f7fb; border-radius: 8px; padding: 10px; max-height: 360px; overflow:auto; }
      .hint { font-size: 12px; color: #66788a; }
      .status { margin-top: 10px; display: inline-block; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
      .status.idle { background: #eef2ff; color: #3730a3; }
      .status.processing { background: #fff7ed; color: #9a3412; }
      .status.success { background: #ecfdf5; color: #065f46; }
      .status.error { background: #fef2f2; color: #991b1b; }
    </style>
  </head>
  <body>
    <h2>Candidate Intake Test UI (Editable Auto-Fill)</h2>
    <div id="status" class="status idle">Idle</div>

    <div class="card">
      <h3>1) Upload + Parse Resume</h3>
      <form id="parseForm">
        <label>Resume (PDF/DOC/DOCX)</label>
        <input id="resumeFile" name="resume" type="file" accept=".pdf,.doc,.docx" required />
        <button type="submit">Parse Resume (Preview)</button>
      </form>
      <div class="hint">This only parses and auto-fills fields. It does not store to DB yet.</div>
    </div>

    <div class="card">
      <h3>2) Review / Edit Candidate Form</h3>
      <div class="grid">
        <div><label>Full Name</label><input id="fullName" /></div>
        <div><label>Email</label><input id="email" type="email" /></div>
      </div>
      <div class="grid">
        <div><label>Phone</label><input id="phone" /></div>
        <div><label>LinkedIn</label><input id="linkedin" /></div>
      </div>
      <label>Skills (comma separated)</label>
      <textarea id="skills"></textarea>
      <label>Education (one item per line)</label>
      <textarea id="education"></textarea>
      <label>Projects (one per line: Name | Summary | Tech Stack)</label>
      <textarea id="projects"></textarea>
      <label>Work Experience (one per line: Company | Role | Dates)</label>
      <textarea id="workExp"></textarea>
      <button id="submitBtn" type="button">Submit Application (Store to DB)</button>
    </div>

    <div class="card">
      <h3>3) Get Profile By ID</h3>
      <label>Profile ID</label>
      <input id="profileId" type="number" min="1" />
      <button id="fetchProfileBtn" type="button">Fetch Profile</button>
      <button id="listProfilesBtn" type="button">List Profiles</button>
    </div>

    <div class="card"><h3>Response</h3><pre id="out">-</pre></div>

    <script>
      var out = document.getElementById('out');
      var statusEl = document.getElementById('status');
      var parseForm = document.getElementById('parseForm');
      var resumeFile = document.getElementById('resumeFile');
      var fullName = document.getElementById('fullName');
      var email = document.getElementById('email');
      var phone = document.getElementById('phone');
      var linkedin = document.getElementById('linkedin');
      var skills = document.getElementById('skills');
      var education = document.getElementById('education');
      var projects = document.getElementById('projects');
      var workExp = document.getElementById('workExp');
      var submitBtn = document.getElementById('submitBtn');
      var profileId = document.getElementById('profileId');
      var fetchProfileBtn = document.getElementById('fetchProfileBtn');
      var listProfilesBtn = document.getElementById('listProfilesBtn');
      var parseBtn = parseForm.querySelector('button[type="submit"]');

      function print(data) {
        out.textContent = (typeof data === 'string') ? data : JSON.stringify(data, null, 2);
      }
      function setStatus(state, message) {
        statusEl.className = 'status ' + state;
        statusEl.textContent = message;
      }
      function setBusy(busy) {
        parseBtn.disabled = busy;
        submitBtn.disabled = busy;
        fetchProfileBtn.disabled = busy;
        listProfilesBtn.disabled = busy;
      }
      function toProjectLine(p) {
        var name = (p.project_name || p.name || p.title || '').trim();
        var summary = (p.brief_summary || p.summary || p.description || '').trim();
        var rawStack = p.tech_stack || p.stack || p.technologies || '';
        var stack = Array.isArray(rawStack) ? rawStack.join(', ') : String(rawStack || '').trim();
        if (!name && !summary && !stack) return '';
        return [name, summary, stack].filter(function(v){ return !!v; }).join(' | ');
      }
      function toWorkLine(w) {
        var company = (w.company || w.organization || w.employer || '').trim();
        var role = (w.role || w.title || w.position || '').trim();
        var dates = (w.dates || w.duration || w.period || '').trim();
        if (!company && !role && !dates) return '';
        return [company, role, dates].filter(function(v){ return !!v; }).join(' | ');
      }
      function parseProjectLine(line) {
        var parts = line.split('|').map(function(v){ return (v || '').trim(); });
        var item = { project_name: parts[0] || null, brief_summary: parts[1] || null, tech_stack: parts[2] || null };
        if (!item.project_name && !item.brief_summary && !item.tech_stack) return null;
        return item;
      }
      function parseWorkLine(line) {
        var parts = line.split('|').map(function(v){ return (v || '').trim(); });
        var item = { company: parts[0] || null, role: parts[1] || null, dates: parts[2] || null };
        if (!item.company && !item.role && !item.dates) return null;
        return item;
      }

      parseForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!resumeFile.files || !resumeFile.files[0]) { print('Please choose a resume file first.'); return; }

        var fd = new FormData();
        fd.append('resume', resumeFile.files[0]);
        setBusy(true);
        setStatus('processing', 'Parsing resume...');
        print('Parsing resume...');
        try {
          var res = await fetch('/api/candidate-intake/parse-preview', { method: 'POST', body: fd });
          var data = await res.json();
          print(data);
          var p = data.parsed_profile || {};
          fullName.value = p.name || '';
          email.value = p.email || '';
          phone.value = p.phone || '';
          linkedin.value = p.linkedin || '';
          skills.value = Array.isArray(p.skills) ? p.skills.join(', ') : '';
          education.value = Array.isArray(p.education) ? p.education.join(String.fromCharCode(10)) : '';
          projects.value = Array.isArray(p.projects) ? p.projects.map(toProjectLine).filter(Boolean).join(String.fromCharCode(10)) : '';
          workExp.value = Array.isArray(p.work_experience) ? p.work_experience.map(toWorkLine).filter(Boolean).join(String.fromCharCode(10)) : '';
          setStatus('success', (data.status === 'parsed') ? 'Resume parsed successfully. You can edit and submit.' : 'Parsed with warnings.');
        } catch (err) {
          print(String(err));
          setStatus('error', 'Parsing failed.');
        } finally {
          setBusy(false);
        }
      });

      submitBtn.addEventListener('click', async function() {
        if (!resumeFile.files || !resumeFile.files[0]) { print('Please choose a resume file first.'); return; }

        var confirmedProfile = {
          name: (fullName.value || '').trim(),
          email: (email.value || '').trim(),
          phone: (phone.value || '').trim(),
          linkedin: (linkedin.value || '').trim(),
          skills: (skills.value || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean),
          education: (education.value || '').split(String.fromCharCode(10)).map(function(s){ return s.trim(); }).filter(Boolean),
          projects: (projects.value || '').split(String.fromCharCode(10)).map(function(s){ return s.trim(); }).filter(Boolean).map(parseProjectLine).filter(Boolean),
          work_experience: (workExp.value || '').split(String.fromCharCode(10)).map(function(s){ return s.trim(); }).filter(Boolean).map(parseWorkLine).filter(Boolean)
        };

        var fd = new FormData();
        fd.append('full_name', confirmedProfile.name || 'Candidate');
        fd.append('email', confirmedProfile.email || 'candidate@example.com');
        fd.append('phone', confirmedProfile.phone || '');
        fd.append('confirmed_profile_json', JSON.stringify(confirmedProfile));
        fd.append('resume', resumeFile.files[0]);

        setBusy(true);
        setStatus('processing', 'Submitting application...');
        print('Submitting application to DB...');
        try {
          var res = await fetch('/api/candidate-intake/apply', { method: 'POST', body: fd });
          var data = await res.json();
          print(data);
          if (data && data.profile_id) profileId.value = data.profile_id;
          setStatus('success', 'Application submitted and stored in DB.');
        } catch (err) {
          print(String(err));
          setStatus('error', 'Submit failed.');
        } finally {
          setBusy(false);
        }
      });

      fetchProfileBtn.addEventListener('click', async function() {
        var id = (profileId.value || '').trim();
        if (!id) { print('Enter profile ID first.'); return; }
        setBusy(true);
        setStatus('processing', 'Loading profile...');
        print('Loading profile...');
        try {
          var res = await fetch('/api/candidate-intake/profiles/' + id);
          var data = await res.json();
          print(data);
          setStatus('success', 'Profile loaded.');
        } catch (err) {
          print(String(err));
          setStatus('error', 'Profile fetch failed.');
        } finally {
          setBusy(false);
        }
      });

      listProfilesBtn.addEventListener('click', async function() {
        setBusy(true);
        setStatus('processing', 'Loading profiles...');
        print('Loading profiles...');
        try {
          var res = await fetch('/api/candidate-intake/profiles');
          var data = await res.json();
          print(data);
          setStatus('success', 'Profiles loaded.');
        } catch (err) {
          print(String(err));
          setStatus('error', 'List profiles failed.');
        } finally {
          setBusy(false);
        }
      });
    </script>
  </body>
</html>
        """
    )
