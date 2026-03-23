from __future__ import annotations

from io import BytesIO
import json
import os
import re
from typing import Optional

try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover - optional dependency at runtime
    fitz = None

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


def _normalize_block_text(text: str) -> str:
    cleaned = text.replace("\r", "\n")
    cleaned = "\n".join(line.strip() for line in cleaned.splitlines() if line.strip())
    return cleaned.strip()


def _looks_like_name_line(line: str) -> bool:
    parts = [p for p in line.replace(".", " ").split() if p]
    if len(parts) < 2 or len(parts) > 4:
        return False
    alpha_parts = [part for part in parts if part.isalpha()]
    return bool(alpha_parts) and all(part[:1].isupper() and part[1:].islower() for part in alpha_parts)


def _score_resume_start(text: str) -> float:
    if not text:
        return 0.0

    lines = [line.strip().lower() for line in text.splitlines() if line.strip()]
    if not lines:
        return 0.0

    first_window = lines[:14]
    score = 0.0

    first_line = text.splitlines()[0].strip() if text.splitlines() else ""
    if _looks_like_name_line(first_line):
        score += 6.0

    strong_headers = (
        "profile",
        "summary",
        "objective",
        "professional experience",
        "work experience",
        "experience",
        "projects",
    )
    sidebar_headers = (
        "personal information",
        "contact",
        "key skills",
        "skills",
        "technical skills",
        "tools",
    )

    for idx, line in enumerate(first_window):
        weight = max(1.0, 4.0 - (idx * 0.2))
        if any(h in line for h in strong_headers):
            score += 2.0 * weight
        if any(h in line for h in sidebar_headers):
            score -= 1.2 * weight

    if "education" in "\n".join(first_window):
        score += 1.0

    return score


def _reconstruct_page_text_from_blocks(blocks: list[tuple]) -> tuple[str, str, dict[str, object]]:
    text_blocks: list[dict[str, object]] = []
    for block in blocks:
        if len(block) < 5:
            continue
        x0, y0, x1, y1, text = block[0], block[1], block[2], block[3], block[4]
        normalized_text = _normalize_block_text(str(text or ""))
        if not normalized_text:
            continue
        text_blocks.append(
            {
                "x0": float(x0),
                "y0": float(y0),
                "x1": float(x1),
                "y1": float(y1),
                "x_center": (float(x0) + float(x1)) / 2.0,
                "text": normalized_text,
            }
        )

    if not text_blocks:
        return "", "single_column", {"x_gap": 0.0, "column_split": 0.0, "column_order": "left_to_right"}

    sorted_by_x = sorted(text_blocks, key=lambda b: b["x_center"])
    min_x = float(sorted_by_x[0]["x_center"])
    max_x = float(sorted_by_x[-1]["x_center"])
    x_gap = max_x - min_x

    is_multi = x_gap > 140.0 and len(sorted_by_x) >= 6
    layout_mode = "multi_column" if is_multi else "single_column"

    if not is_multi:
        ordered = sorted(text_blocks, key=lambda b: (float(b["y0"]), float(b["x0"])))
        text = "\n".join(str(b["text"]) for b in ordered)
        return text, layout_mode, {"x_gap": x_gap, "column_split": 0.0, "column_order": "left_to_right"}

    column_split = (min_x + max_x) / 2.0
    left_blocks = [b for b in text_blocks if float(b["x_center"]) <= column_split]
    right_blocks = [b for b in text_blocks if float(b["x_center"]) > column_split]

    left_sorted = sorted(left_blocks, key=lambda b: (float(b["y0"]), float(b["x0"])))
    right_sorted = sorted(right_blocks, key=lambda b: (float(b["y0"]), float(b["x0"])))

    left_text = "\n".join(str(b["text"]) for b in left_sorted)
    right_text = "\n".join(str(b["text"]) for b in right_sorted)

    left_then_right = left_text + ("\n\n" if left_text and right_text else "") + right_text
    right_then_left = right_text + ("\n\n" if left_text and right_text else "") + left_text

    score_ltr = _score_resume_start(left_then_right)
    score_rtl = _score_resume_start(right_then_left)
    use_rtl = score_rtl > score_ltr

    return (
        right_then_left if use_rtl else left_then_right,
        layout_mode,
        {
            "x_gap": x_gap,
            "column_split": column_split,
            "column_order": "right_to_left" if use_rtl else "left_to_right",
            "score_ltr": score_ltr,
            "score_rtl": score_rtl,
        },
    )


def _extract_pdf_text_pymupdf(file_bytes: bytes) -> tuple[str, dict[str, object]]:
    if fitz is None:
        return "", {"extractor": "pymupdf_unavailable"}

    reconstructed_pages: list[str] = []
    page_stats: list[dict[str, object]] = []
    multi_column_pages = 0

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        for idx, page in enumerate(doc):
            blocks = page.get_text("blocks")
            reconstructed, layout_mode, meta = _reconstruct_page_text_from_blocks(blocks)
            reconstructed_pages.append(reconstructed)
            if layout_mode == "multi_column":
                multi_column_pages += 1
            page_stats.append(
                {
                    "page": idx + 1,
                    "layout_mode": layout_mode,
                    "x_gap": round(float(meta.get("x_gap", 0.0)), 2),
                    "column_split": round(float(meta.get("column_split", 0.0)), 2),
                    "column_order": meta.get("column_order", "left_to_right"),
                }
            )
    finally:
        doc.close()

    text = "\n".join(reconstructed_pages)
    return text, {
        "extractor": "pymupdf",
        "layout_mode": "multi_column" if multi_column_pages > 0 else "single_column",
        "page_stats": page_stats,
        "page_count": len(page_stats),
    }


def _extract_docx_text(file_bytes: bytes) -> str:
    if Document is None:
        return ""
    doc = Document(BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text)


def _clean_extracted_text(text: str) -> str:
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").replace("\u00ad", "")

    replacement_map = {
        "\u00d3": "-",
        "\u00af": "-",
    }
    for source, target in replacement_map.items():
        cleaned = cleaned.replace(source, target)

    cleaned = re.sub(r"([A-Za-z])\-\n([A-Za-z])", r"\1\2", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _extract_text_for_resume_with_meta(
    file_bytes: bytes,
    content_type: str,
) -> tuple[Optional[str], Optional[str], Optional[str], dict[str, object]]:
    if content_type not in SUPPORTED_CONTENT_TYPES:
        return None, "Only PDF and DOCX are supported.", "unsupported", {}

    metadata: dict[str, object] = {}

    if content_type == "application/pdf":
        text, metadata = _extract_pdf_text_pymupdf(file_bytes)
        if not text and fitz is None:
            return None, "PyMuPDF is not installed. Install with: pip install pymupdf", "extract", metadata
    else:
        text = _extract_docx_text(file_bytes)
        metadata = {"extractor": "python-docx", "layout_mode": "single_column"}

    if not text:
        return None, "Could not extract text from the file.", "extract", metadata

    cleaned = _clean_extracted_text(text)
    if not cleaned:
        return None, "Could not extract text from the file.", "extract", metadata

    metadata["chars_extracted"] = len(cleaned)
    return cleaned, None, None, metadata


def extract_text_for_resume(file_bytes: bytes, content_type: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    text, error, error_type, _ = _extract_text_for_resume_with_meta(file_bytes, content_type)
    return text, error, error_type


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
    text, error, error_type, extraction_meta = _extract_text_for_resume_with_meta(file_bytes, content_type)
    if error or not text:
        return None, error, error_type

    data, error = _parse_with_gemini(text)
    if not data:
        return None, error or "Gemini failed to parse resume.", "model"

    payload = {
        "parser_used": GEMINI_MODEL,
        "extractor_used": extraction_meta.get("extractor"),
        "layout_mode": extraction_meta.get("layout_mode"),
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
