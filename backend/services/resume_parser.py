from __future__ import annotations

from io import BytesIO
import json
import os
import re
from typing import Optional

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - optional dependency at runtime
    PdfReader = None

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - optional dependency at runtime
    genai = None

try:
    from docx import Document
except Exception:  # pragma: no cover - optional dependency at runtime
    Document = None


SUPPORTED_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

GEMINI_MODEL = os.getenv("SKILL_AI_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


def _extract_pdf_text(file_bytes: bytes) -> str:
    if PdfReader is None:
        return ""
    reader = PdfReader(BytesIO(file_bytes))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            pages.append("")
    return "\n".join(pages)


def _extract_docx_text(file_bytes: bytes) -> str:
    if Document is None:
        return ""
    doc = Document(BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text)


def _extract_json_from_text(text: str) -> Optional[dict]:
    try:
        return json.loads(text)
    except Exception:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except Exception:
        return None


def _parse_with_gemini(resume_text: str) -> tuple[Optional[dict], Optional[str]]:
    if genai is None:
        return None, "google-generativeai is not installed"
    if not GEMINI_API_KEY:
        return None, "GEMINI_API_KEY is not set"

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    trimmed = resume_text[:60000]

    prompt = (
        "You are a resume parser. Extract structured data from the resume text. "
        "Return JSON only with these keys: "
        "name (string or null), email (string or null), phone (string or null), "
        "linkedin (string or null), github (string or null), "
        "skills (array of strings), education (array of strings), projects (array of strings), "
        "work_experience (array of strings)(Only company name, role and dates of start and end).. "
        "For projects/work_experience, split into separate items (one per line or bullet). "
        "For projects return the project name its basic features and the tech stack(if mentioned) used in the project"
        "For education split the degree into 4 categories - Qualificaton, Specialization, Institution and Year Completed"
        "If a field is missing, use null for scalars and [] for arrays. "
        "Do not include any extra keys or commentary.\n\n"
        "Resume text:\n" + trimmed
    )

    try:
        response = model.generate_content(prompt)
        data = _extract_json_from_text(getattr(response, "text", ""))
        if not data:
            return None, "Model response was not valid JSON"
        return data, None
    except Exception as exc:
        return None, str(exc)


def parse_resume_bytes(
    file_bytes: bytes,
    content_type: str,
) -> tuple[Optional[dict], Optional[str], Optional[str]]:
    if content_type not in SUPPORTED_CONTENT_TYPES:
        return None, "Only PDF and DOCX are supported.", "unsupported"

    if content_type == "application/pdf":
        text = _extract_pdf_text(file_bytes)
    else:
        text = _extract_docx_text(file_bytes)

    if not text:
        return None, "Could not extract text from the file.", "extract"

    data, error = _parse_with_gemini(text)
    if not data:
        return None, error or "Gemini failed to parse resume.", "model"

    payload = {
        "parser_used": GEMINI_MODEL,
        "name": data.get("name"),
        "email": data.get("email"),
        "phone": data.get("phone"),
        "linkedin": data.get("linkedin"),
        "github": data.get("github"),
        "skills": data.get("skills") or [],
        "education": data.get("education") or [],
        "projects": data.get("projects") or [],
        "work_experience": data.get("work_experience") or [],
        "raw_text_preview": text[:2000],
        "parser_error": None,
    }
    return payload, None, None
