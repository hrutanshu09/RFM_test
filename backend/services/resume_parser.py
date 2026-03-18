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

GENERIC_SKILL_LABEL_PATTERNS: tuple[str, ...] = (
    r"^skills?$",
    r"^key\s+skills?$",
    r"^relevant\s+skills?$",
    r"^technical\s+skills?$",
    r"^core\s+skills?$",
    r"^skills\s+summary$",
    r"^competencies$",
)

SKILL_ALIASES: dict[str, tuple[str, ...]] = {
    "javascript": ("js", "ecmascript", "java script"),
    "typescript": ("ts", "type script"),
    "react": ("reactjs", "react.js", "react js"),
    "angular": ("angularjs", "angular.js", "angular js"),
    "vue": ("vuejs", "vue.js", "vue js"),
    "node.js": ("nodejs", "node js"),
    "java": ("core java", "java se", "javaee", "j2ee"),
    "spring": ("springboot", "spring boot", "spring framework"),
    "python": ("python3", "python django", "python flask"),
    "django": ("django framework",),
    "flask": ("flask framework",),
    "fastapi": ("fast api",),
    "c#": ("csharp", "dotnet c#", ".net c#"),
    ".net": ("dotnet", ".net core", "asp.net", "aspnet", "dot net"),
    "c++": ("cpp", "c plus plus"),
    "sql": ("structured query language",),
    "postgresql": ("postgres", "psql"),
    "mongodb": ("mongo", "mongo db"),
    "kubernetes": ("k8s", "kube"),
    "scikit-learn": ("sklearn", "scikit learn"),
    "power bi": ("powerbi",),
    "burp suite": ("burpsuite", "burp"),
    "kali linux": ("kali",),
    "jupyter notebook": ("jupyter", "ipynb"),
}


def _normalize_skill_token(value: str) -> str:
    return "".join(ch for ch in value.lower().strip() if ch.isalnum() or ch in {"+", ".", "#"})


def _build_skill_alias_lookup() -> dict[str, str]:
    alias_lookup: dict[str, str] = {}
    for canonical, variants in SKILL_ALIASES.items():
        canonical_norm = _normalize_skill_token(canonical)
        if not canonical_norm:
            continue
        alias_lookup[canonical_norm] = canonical
        for variant in variants:
            variant_norm = _normalize_skill_token(variant)
            if variant_norm:
                alias_lookup[variant_norm] = canonical
    return alias_lookup


_SKILL_ALIAS_LOOKUP = _build_skill_alias_lookup()


def _is_generic_skill_label(value: str) -> bool:
    cleaned = re.sub(r"\s+", " ", value.strip().lower()).rstrip(":")
    if not cleaned:
        return True
    for pattern in GENERIC_SKILL_LABEL_PATTERNS:
        if re.match(pattern, cleaned, flags=re.IGNORECASE):
            return True
    return False


def _canonicalize_skill_name(value: str) -> str:
    normalized = _normalize_skill_token(value)
    if not normalized:
        return ""
    return _SKILL_ALIAS_LOOKUP.get(normalized, value.strip())


def _normalize_skill_list(raw_skills: object) -> list[str]:
    parts: list[str] = []
    if isinstance(raw_skills, list):
        for item in raw_skills:
            if item is None:
                continue
            parts.append(str(item))
    elif raw_skills:
        parts.append(str(raw_skills))

    candidates: list[str] = []
    for part in parts:
        # Split only obvious separators; avoid splitting C++/C#.
        for token in re.split(r"\s*[,|/]\s*", part):
            cleaned = token.strip().strip("-* ")
            if cleaned:
                candidates.append(cleaned)

    normalized: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        if _is_generic_skill_label(item):
            continue
        canonical = _canonicalize_skill_name(item)
        if not canonical:
            continue
        key = _normalize_skill_token(canonical)
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(canonical)

    return normalized


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
        "Return valid JSON only with these keys: "
        "name (string or null), email (string or null), phone (string or null), "
        "linkedin (string or null), github (string or null), "
        "skills (array of strings), education (array of strings), projects (array of strings), "
        "work_experience (array of strings). "
        "For work_experience include company, role, and dates. "
        "For projects include project name, brief summary, and tech stack if mentioned. "
        "For education, keep one entry per degree/qualification. "
        "IMPORTANT for skills: include only concrete skill names and technologies. "
        "Do NOT include section labels or headings like Skills, Key Skills, Relevant Skills, Technical Skills, Competencies. "
        "Normalize common variants to canonical names where possible (e.g., React.js -> React, ReactJS -> React, NodeJS -> Node.js, Python (Django) -> Python). "
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
        "skills": _normalize_skill_list(data.get("skills") or []),
        "education": data.get("education") or [],
        "projects": data.get("projects") or [],
        "work_experience": data.get("work_experience") or [],
        "raw_text_preview": text[:2000],
        "parser_error": None,
    }
    return payload, None, None


