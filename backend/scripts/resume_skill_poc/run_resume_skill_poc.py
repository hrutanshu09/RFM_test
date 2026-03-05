import argparse
import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

try:
    from dotenv import dotenv_values, load_dotenv
except Exception:  # pragma: no cover
    dotenv_values = None
    load_dotenv = None

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = BACKEND_ROOT / ".env"


def load_backend_env() -> None:
    if load_dotenv is None:
        return
    if ENV_PATH.exists():
        # Keep process env untouched; direct .env reads below are the source of truth.
        load_dotenv(ENV_PATH, override=False)


load_backend_env()


@dataclass
class SkillScore:
    skill: str
    normalized_skill_id: str
    claimed: bool
    project_count: int
    recent_usage: bool
    proficiency_score: int
    level: str
    confidence: float
    evidence_snippets: list[str]


def get_required_llm_config() -> tuple[str, str]:
    file_env: dict[str, str] = {}
    if dotenv_values is not None and ENV_PATH.exists():
        file_env = {k: str(v) for k, v in dotenv_values(ENV_PATH).items() if v is not None}

    model = (
        file_env.get("RESUME_SKILL_LLM_MODEL", "").strip()
        or os.getenv("RESUME_SKILL_LLM_MODEL", "").strip()
        or "gemini-2.5-flash"
    )
    api_key = (
        file_env.get("GEMINI_API_KEY", "").strip()
        or file_env.get("GOOGLE_API_KEY", "").strip()
        or os.getenv("GEMINI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
    )
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required in backend/.env for hybrid mode.")
    return model, api_key


def load_skill_dictionary(path: Path) -> dict[str, list[str]]:
    with path.open("r", encoding="utf-8-sig") as f:
        raw = json.load(f)
    return {k.lower().strip(): [a.lower().strip() for a in v] for k, v in raw.items()}


def extract_text_from_pdf(file_path: Path) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise RuntimeError(
            "PDF parsing requires 'pypdf'. Install it with: pip install pypdf"
        ) from exc

    reader = PdfReader(str(file_path))
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n".join(pages).strip()
    if not text:
        raise RuntimeError(f"No readable text extracted from PDF: {file_path.name}")
    return text


def extract_text_from_pdf_bytes(data: bytes, filename: str = "uploaded.pdf") -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise RuntimeError(
            "PDF parsing requires 'pypdf'. Install it with: pip install pypdf"
        ) from exc

    reader = PdfReader(BytesIO(data))
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n".join(pages).strip()
    if not text:
        raise RuntimeError(f"No readable text extracted from PDF: {filename}")
    return text


def read_resume_text(file_path: Path) -> str:
    suffix = file_path.suffix.lower()
    if suffix == ".txt":
        return file_path.read_text(encoding="utf-8")
    if suffix == ".pdf":
        return extract_text_from_pdf(file_path)
    raise ValueError(f"Unsupported resume file type: {file_path.name}")


def read_resume_bytes(filename: str, data: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".txt":
        return data.decode("utf-8")
    if suffix == ".pdf":
        return extract_text_from_pdf_bytes(data, filename=filename)
    raise ValueError(f"Unsupported resume file type: {filename}")


def normalize_skill_map(skill_dict: dict[str, list[str]]) -> dict[str, str]:
    alias_map: dict[str, str] = {}
    for canonical, aliases in skill_dict.items():
        alias_map[canonical] = canonical
        for alias in aliases:
            alias_map[alias] = canonical
    return alias_map


def tokenize_for_match(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def title_case_skill(skill: str) -> str:
    pretty = {
        "c++": "C++",
        "aws": "AWS",
        "node.js": "Node.js",
        "javascript": "JavaScript",
        "typescript": "TypeScript",
    }
    return pretty.get(skill, skill.title())


def normalize_ocr_word_gaps(text: str) -> str:
    fixed = text
    while True:
        updated = re.sub(r"\b([A-Za-z])\s+([A-Za-z]{2,})\b", r"\1\2", fixed)
        if updated == fixed:
            break
        fixed = updated
    return fixed


def normalize_free_skill_token(token: str) -> str:
    value = normalize_ocr_word_gaps(token)
    value = re.sub(r"\s+", " ", value).strip(" .:-")
    return value


def skill_id_from_token(token: str) -> str:
    cleaned = re.sub(r"[^a-z0-9+.#]+", "-", token.lower()).strip("-")
    return cleaned or token.lower()


def is_valid_skill_token(token: str) -> bool:
    lowered = token.lower()
    stopwords = {
        "skills",
        "technical skills",
        "tech stack",
        "core competencies",
        "languages",
        "frameworks",
        "libraries",
        "frameworks/libraries",
        "tools",
        "certifications",
        "experience",
        "education",
        "projects",
        "summary",
    }
    if not token or lowered in stopwords:
        return False
    if len(token) < 2 or len(token) > 40:
        return False
    if len(token.split()) > 4:
        return False
    return bool(re.search(r"[A-Za-z]", token))


def find_skills_in_text(text: str, alias_map: dict[str, str]) -> list[str]:
    text_l = tokenize_for_match(text)
    found: set[str] = set()
    for alias, canonical in alias_map.items():
        pattern = rf"(?<!\w){re.escape(alias)}(?!\w)"
        if re.search(pattern, text_l):
            found.add(canonical)
    return sorted(found)


def is_potential_new_skill_token(token: str) -> bool:
    t = normalize_free_skill_token(token)
    if not t:
        return False
    low = t.lower()
    blocked = {
        "skills", "skill", "languages", "frameworks", "libraries", "tools", "technologies",
        "experience", "project", "projects", "education", "summary", "objective",
        "basic", "basics", "advanced", "familiar", "proficient", "good", "knowledge",
    }
    if low in blocked:
        return False
    if len(low) < 2 or len(low) > 32:
        return False
    words = low.split()
    if len(words) > 3:
        return False
    if not re.search(r"[a-z]", low):
        return False
    return True


def suggest_new_skills(resume_text: str, alias_map: dict[str, str], max_items: int = 15) -> list[str]:
    # Learn only from detected skills section to avoid adding random text from projects/experience.
    sections = segment_resume_sections(resume_text)
    source_text = sections.get("skills", "")
    if not source_text:
        return []
    chunks = re.split(r"[,|;/\n]+", source_text)

    known = set(alias_map.keys()) | set(alias_map.values())
    candidates: list[str] = []
    seen: set[str] = set()
    for raw in chunks:
        token = normalize_free_skill_token(raw)
        token = re.sub(
            r"(?i)^(languages?|frameworks?|libraries?|tools?|technologies?|skills?)\s*:\s*",
            "",
            token,
        ).strip()
        token = re.sub(r"(?i)^[a-z][a-z0-9/&+\-\s]{1,24}:\s*", "", token).strip()
        if not is_potential_new_skill_token(token):
            continue
        norm = token.lower()
        if any(x in norm for x in ["http", "www.", ".com", ".in", "project", "education", "summary"]):
            continue
        if any(ch in norm for ch in "()[]{}"):
            continue
        if ":" in norm:
            continue
        words = norm.split()
        if len(words) > 2:
            continue
        if any(w in {"and", "or", "with", "for", "while", "through"} for w in words):
            continue
        if norm in known or norm in seen:
            continue
        # Keep mostly tech-looking tokens.
        if not (
            re.search(r"[+#.]|\d", norm)
            or norm in {"docker", "kubernetes", "terraform", "jenkins", "ansible", "airflow", "snowflake"}
            or len(words) == 2
        ):
            continue
        seen.add(norm)
        candidates.append(norm)
        if len(candidates) >= max_items:
            break
    return candidates


def update_skill_dictionary_file(skill_dict_path: Path, new_skills: list[str]) -> list[str]:
    if not new_skills:
        return []
    with skill_dict_path.open("r", encoding="utf-8-sig") as f:
        raw = json.load(f)
    if not isinstance(raw, dict):
        raise RuntimeError("skill_dictionary.json must be a JSON object mapping skill -> aliases list.")

    added: list[str] = []
    for skill in new_skills:
        key = skill.lower().strip()
        if not key:
            continue
        if key not in raw:
            raw[key] = []
            added.append(key)

    if added:
        with skill_dict_path.open("w", encoding="utf-8") as f:
            json.dump(raw, f, indent=2, ensure_ascii=False)
            f.write("\n")
    return added


def extract_claimed_skills(
    resume_text: str,
    alias_map: dict[str, str],
    model: str,
    api_key: str,
) -> list[dict[str, str]]:
    lines = resume_text.splitlines()
    skill_lines: list[str] = []
    in_skill_section = False

    section_start = re.compile(
        r"^(skills|technical skills|tech stack|core competencies)\s*:?\s*$",
        flags=re.IGNORECASE,
    )
    section_stop = re.compile(
        r"^(experience|work experience|education|projects|certifications|achievements|summary)\b",
        flags=re.IGNORECASE,
    )
    inline_skill_prefix = re.compile(
        r"^(languages?|frameworks?|libraries?|frameworks/libraries|tools?|technologies?)\s*:\s*(.+)$",
        flags=re.IGNORECASE,
    )

    for raw_line in lines:
        stripped = normalize_free_skill_token(raw_line.strip().lstrip("•*-"))
        if not stripped:
            if in_skill_section:
                in_skill_section = False
            continue

        if section_start.match(stripped):
            in_skill_section = True
            continue
        if in_skill_section and section_stop.match(stripped):
            in_skill_section = False

        pref = inline_skill_prefix.match(stripped)
        if pref:
            skill_lines.append(pref.group(2))
            continue
        if in_skill_section:
            skill_lines.append(stripped)

    block_text = " ".join(skill_lines) if skill_lines else resume_text
    canonical_skills = sorted(set(alias_map.values()))
    rule_found = set(find_skills_in_text(block_text, alias_map))
    llm_found = set(
        map_context_skills_with_gemini(
            context_text=block_text,
            context_label="skills",
            canonical_skills=canonical_skills,
            model=model,
            api_key=api_key,
        )
    )
    final_found = sorted(rule_found | llm_found)

    return [
        {
            "skill": title_case_skill(skill),
            "normalized_skill_id": skill,
            "evidence": block_text[:250] if block_text else "Found in resume",
        }
        for skill in final_found
    ]


def parse_date_range(text: str) -> tuple[int, int] | None:
    m = re.search(r"(20\d{2})(?:[-/](\d{2}))?\s*(?:to|[-–—])\s*(present|20\d{2})(?:[-/](\d{2}))?", text.lower())
    if not m:
        return None
    start_year = int(m.group(1))
    end_val = m.group(3)
    end_year = datetime.now(UTC).year if end_val == "present" else int(end_val)
    return start_year, end_year


def normalize_line(line: str) -> str:
    return normalize_ocr_word_gaps(line.strip().lstrip("•*-")).strip()


def extract_email(text: str) -> str | None:
    m = re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", text)
    return m.group(0) if m else None


def extract_phone(text: str) -> str | None:
    patterns = [
        r"(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)",
        r"(?<!\d)\+?\d[\d\s-]{8,14}\d(?!\d)",
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group(0).strip()
    return None


def extract_url(text: str, keyword: str) -> str | None:
    m = re.search(rf"(https?://[^\s]*{re.escape(keyword)}[^\s]*)", text, flags=re.IGNORECASE)
    if m:
        return m.group(1).rstrip(").,;")
    m2 = re.search(rf"\b[^\s]*{re.escape(keyword)}[^\s]*\b", text, flags=re.IGNORECASE)
    return m2.group(0).rstrip(").,;") if m2 else None


def extract_date_of_birth(text: str) -> str | None:
    patterns = [
        r"(?i)\b(?:date of birth|dob)\s*[:\-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})",
        r"(?i)\b(?:date of birth|dob)\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group(1).strip()
    return None


def extract_name(lines: list[str]) -> str | None:
    section_like = {
        "resume", "curriculum vitae", "cv", "skills", "education", "experience", "projects", "summary"
    }
    for raw in lines[:10]:
        line = normalize_line(raw)
        lower = line.lower()
        if not line:
            continue
        if "@" in line or re.search(r"\d{7,}", line):
            # Contact header line often contains name + role + phone/email.
            head = re.split(r"\||@", line, maxsplit=1)[0]
            words = re.findall(r"[A-Za-z]{2,}", head)
            if len(words) >= 2:
                return f"{words[0].title()} {words[1].title()}"
            continue
        if "linkedin" in lower or "github" in lower:
            continue
        if any(token in lower for token in section_like):
            continue
        words = [w for w in re.split(r"\s+", line) if w]
        if 2 <= len(words) <= 5 and all(re.match(r"^[A-Za-z'.-]+$", w) for w in words):
            return line
    return None


def infer_name_from_email(email: str | None) -> str | None:
    if not email:
        return None
    local = email.split("@", 1)[0]
    cleaned = re.sub(r"[^A-Za-z._-]+", "", local).strip("._-")
    if not cleaned:
        return None
    parts = [p for p in re.split(r"[._-]+", cleaned) if p]
    if len(parts) < 2:
        return None
    if any(len(p) <= 1 for p in parts):
        return None
    candidate = " ".join(p.capitalize() for p in parts[:3]).strip()
    return candidate if len(candidate) >= 4 else None


def extract_address(lines: list[str]) -> str | None:
    for raw in lines[:12]:
        line = normalize_line(raw)
        lower = line.lower()
        if not line:
            continue
        if any(x in lower for x in ["linkedin", "github", "@", "dob", "date of birth"]):
            continue
        if re.search(r"\b(street|road|lane|nagar|city|state|india|usa|zip|pincode)\b", lower) or "," in line:
            if len(line) >= 8:
                return line
    return None


def parse_entries(section_text: str, max_items: int = 6) -> list[dict[str, str]]:
    if not section_text:
        return []
    blocks = [b.strip() for b in re.split(r"\n\s*\n+", section_text) if b.strip()]
    if len(blocks) <= 1:
        blocks = [b.strip() for b in re.split(r"\n\s*[-*]\s+", section_text) if b.strip()]
    entries: list[dict[str, str]] = []
    for block in blocks[:max_items]:
        lines = [normalize_line(x) for x in block.splitlines() if normalize_line(x)]
        if not lines:
            continue
        headline = lines[0][:140]
        details = " ".join(lines[1:])[:500] if len(lines) > 1 else ""
        date_match = re.search(r"(20\d{2}.*?(?:20\d{2}|present))", block, flags=re.IGNORECASE)
        entries.append(
            {
                "headline": headline,
                "date_range": date_match.group(1) if date_match else "Unknown",
                "details": details,
            }
        )
    return entries


def parse_education_entries(section_text: str, max_items: int = 6) -> list[dict[str, str]]:
    entries = parse_entries(section_text, max_items=max_items)
    for entry in entries:
        headline = str(entry.get("headline") or "").strip()
        details = str(entry.get("details") or "").strip()
        if not details:
            continue

        detail_lines = [normalize_line(x) for x in re.split(r"\s{2,}|\n", details) if normalize_line(x)]
        institution = ""
        for ln in detail_lines[:6]:
            low = ln.lower()
            if any(k in low for k in ["university", "college", "institute", "school", "academy"]):
                institution = ln
                break
        if institution and institution.lower() not in headline.lower():
            entry["headline"] = f"{headline} - {institution}"[:140] if headline else institution[:140]
    return entries


def is_bullet_line(line: str) -> bool:
    return bool(re.match(r"^[•·*\-]\s*", line))


def is_date_like_line(line: str) -> bool:
    month = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
    patterns = [
        rf"(?i)\b{month}\b.*\b(19|20)\d{{2}}\b",
        r"(?i)\b(19|20)\d{2}\b\s*(?:[-–—]|to)\s*(?:present|\b(19|20)\d{2}\b)",
        r"(?i)\bpresent\b",
    ]
    return any(re.search(p, line) for p in patterns)


def extract_date_like_text(text: str) -> str | None:
    month = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
    patterns = [
        rf"(?i)\b{month}\b\s+\d{{4}}\s*(?:[-–—]|to)\s*(?:\b{month}\b\s+\d{{4}}|present)",
        r"(?i)\b(19|20)\d{2}\b\s*(?:[-–—]|to)\s*(?:present|\b(19|20)\d{2}\b)",
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group(0).strip()
    return None


def looks_like_heading_line(line: str) -> bool:
    if not line or is_bullet_line(line) or is_date_like_line(line):
        return False
    if not re.match(r"^[A-Z]", line):
        return False
    words = line.split()
    if len(words) > 10:
        return False
    return len(line) <= 120


def looks_like_role_line(line: str) -> bool:
    if not line or is_bullet_line(line) or is_date_like_line(line):
        return False
    if "," in line:
        return False
    words = line.split()
    return 1 <= len(words) <= 8 and len(line) <= 80


def is_experience_header_candidate(line: str) -> bool:
    if not line or is_bullet_line(line):
        return False
    if len(line) > 170:
        return False
    if not re.search(r"[A-Za-z]", line):
        return False
    if looks_like_heading_line(line):
        return True
    # Many resumes put company/role/date on a single line; treat those as entry starts.
    if re.match(r"^[A-Z]", line) and extract_date_like_text(line):
        return True
    return False


def parse_experience_entries(section_text: str, max_items: int = 8) -> list[dict[str, str]]:
    if not section_text:
        return []

    lines = [normalize_line(x) for x in section_text.splitlines() if normalize_line(x)]
    entries: list[dict[str, str]] = []
    i = 0
    while i < len(lines) and len(entries) < max_items:
        line = lines[i]
        if not is_experience_header_candidate(line):
            i += 1
            continue

        # A new experience typically starts with organization/project and role.
        j = i + 1
        role = ""
        inline_date = extract_date_like_text(line)
        if j < len(lines) and looks_like_role_line(lines[j]):
            role = lines[j]
            j += 1

        date_range = "Unknown"
        if inline_date:
            date_range = inline_date
        elif j < len(lines) and is_date_like_line(lines[j]):
            date_range = lines[j]
            j += 1

        details: list[str] = []
        while j < len(lines):
            if is_experience_header_candidate(lines[j]):
                has_next_role_or_date = (
                    j + 1 < len(lines) and (looks_like_role_line(lines[j + 1]) or is_date_like_line(lines[j + 1]))
                )
                if has_next_role_or_date or extract_date_like_text(lines[j]):
                    break
            details.append(lines[j])
            j += 1

        headline_base = line
        if inline_date:
            headline_base = re.sub(re.escape(inline_date), "", headline_base, flags=re.IGNORECASE).strip(" -–|")
        role_l = role.lower().strip()
        is_generic_role = role_l in {"internship", "experience", "work"}
        if role and not is_generic_role and role_l not in headline_base.lower():
            headline = f"{headline_base} - {role}"
        else:
            headline = headline_base
        detail_text = " ".join(details)[:800]
        headline_l = headline.lower()
        role_like_terms = {
            "intern", "engineer", "developer", "analyst", "consultant",
            "manager", "lead", "research", "assistant", "specialist", "executive",
        }
        skillish_terms = {
            "docker", "kubernetes", "terraform", "jenkins", "pipeline", "ci/cd",
            "iac", "containerization", "languages", "frameworks", "tools", "skills",
        }
        looks_skillish = (
            date_range == "Unknown"
            and len(detail_text) < 80
            and any(t in headline_l for t in skillish_terms)
            and not any(t in headline_l for t in role_like_terms)
        )
        if looks_skillish:
            i = j if j > i else i + 1
            continue

        entries.append(
            {
                "headline": headline[:140],
                "date_range": date_range,
                "details": detail_text,
            }
        )
        i = j if j > i else i + 1

    return entries


def extract_employee_profile_with_rules(resume_text: str) -> dict[str, Any]:
    lines = [line for line in resume_text.splitlines() if line.strip()]
    email = extract_email(resume_text)
    phone = extract_phone(resume_text)
    linkedin = extract_url(resume_text, "linkedin.com")
    github = extract_url(resume_text, "github.com")
    dob = extract_date_of_birth(resume_text)
    name = extract_name(lines)
    if not name:
        name = infer_name_from_email(email)
    address = extract_address(lines)

    education_text = extract_section_text(
        resume_text,
        section_headers=["education", "academic background", "academics"],
    )
    experience_text = extract_section_text(
        resume_text,
        section_headers=[
            "experience",
            "work experience",
            "professional experience",
            "employment",
            "employment history",
            "internship",
            "internships",
            "work history",
            "positions of responsibility",
        ],
    )
    if not experience_text:
        experience_text = extract_section_text(
            resume_text,
            section_headers=["projects", "project experience", "academic projects"],
        )

    education_entries = parse_education_entries(education_text, max_items=6)
    experience_entries = parse_experience_entries(experience_text, max_items=8)

    return {
        "name": name,
        "address": address,
        "phone_number": phone,
        "email": email,
        "linkedin": linkedin,
        "github": github,
        "date_of_birth": dob,
        "education": education_entries,
        "experiences": experience_entries,
    }


def segment_resume_sections(resume_text: str) -> dict[str, str]:
    alias_to_section = {
        "contact": "contact",
        "profile summary": "summary",
        "summary": "summary",
        "career objective": "summary",
        "objective": "summary",
        "education": "education",
        "academic background": "education",
        "academics": "education",
        "experience": "experience",
        "work experience": "experience",
        "professional experience": "experience",
        "employment": "experience",
        "employment history": "experience",
        "work history": "experience",
        "internship": "experience",
        "internships": "experience",
        "positions of responsibility": "experience",
        "projects": "projects",
        "project experience": "projects",
        "academic projects": "projects",
        "skills": "skills",
        "technical skills": "skills",
        "tech stack": "skills",
        "core competencies": "skills",
        "certifications": "certifications",
        "certifications & courses": "certifications",
        "achievements": "achievements",
    }
    canonical_sections = [
        "contact",
        "summary",
        "education",
        "experience",
        "projects",
        "skills",
        "certifications",
        "achievements",
        "other",
    ]
    buckets: dict[str, list[str]] = {k: [] for k in canonical_sections}
    current = "other"
    for raw in resume_text.splitlines():
        line = normalize_line(raw)
        if not line:
            continue
        key = re.sub(r"\s+", " ", line.lower().rstrip(":")).strip()
        if key in alias_to_section:
            current = alias_to_section[key]
            continue
        buckets[current].append(line)
    return {k: "\n".join(v).strip() for k, v in buckets.items() if v}


def parse_json_payload(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^\s*```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        payload = json.loads(cleaned)
        return payload if isinstance(payload, dict) else None
    except Exception:
        pass

    m = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not m:
        return None
    try:
        payload = json.loads(m.group(0))
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def normalize_profile_entries(raw: Any, max_items: int) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []

    entries: list[dict[str, str]] = []
    for item in raw[:max_items]:
        headline = ""
        date_range = "Unknown"
        details = ""
        if isinstance(item, dict):
            headline = str(
                item.get("headline")
                or item.get("title")
                or item.get("degree")
                or item.get("institution")
                or item.get("company")
                or ""
            ).strip()
            date_range = str(item.get("date_range") or item.get("duration") or item.get("dates") or "Unknown").strip()
            details = str(item.get("details") or item.get("description") or "").strip()
        elif item is not None:
            headline = str(item).strip()

        if not headline and not details:
            continue
        entries.append(
            {
                "headline": headline[:140] if headline else "-",
                "date_range": date_range if date_range else "Unknown",
                "details": details[:800],
            }
        )
    return entries


def normalize_employee_profile_payload(payload: dict[str, Any]) -> dict[str, Any]:
    profile_raw: Any = payload.get("employee_profile", payload)
    if not isinstance(profile_raw, dict):
        profile_raw = {}

    def norm(v: Any) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        if not s or s.lower() in {"none", "null", "na", "n/a", "-"}:
            return None
        return s

    return {
        "name": norm(profile_raw.get("name")),
        "address": norm(profile_raw.get("address")),
        "phone_number": norm(profile_raw.get("phone_number") or profile_raw.get("phone")),
        "email": norm(profile_raw.get("email")),
        "linkedin": norm(profile_raw.get("linkedin")),
        "github": norm(profile_raw.get("github")),
        "date_of_birth": norm(profile_raw.get("date_of_birth") or profile_raw.get("dob")),
        "education": normalize_profile_entries(profile_raw.get("education"), max_items=8),
        "experiences": normalize_profile_entries(
            profile_raw.get("experiences") or profile_raw.get("experience"),
            max_items=12,
        ),
    }


def refine_experience_entries_with_gemini(
    experience_entries: list[dict[str, str]],
    model: str,
    api_key: str,
) -> list[dict[str, str]] | None:
    if not experience_entries:
        return []
    try:
        import google.generativeai as genai
    except Exception:
        return None

    # Send only compact fields to reduce token usage and force deterministic cleanup.
    compact_entries = [
        {
            "headline": str(x.get("headline") or "")[:160],
            "date_range": str(x.get("date_range") or "Unknown")[:80],
            "details": str(x.get("details") or "")[:360],
        }
        for x in experience_entries
    ]
    prompt = (
        "You are cleaning resume experience entries extracted by regex.\n"
        "Input may contain noisy tokens, skills, or random words.\n"
        "Keep only true work/internship/professional responsibility experiences.\n"
        "Drop skills/tools/certifications/random fragments.\n"
        "Return STRICT JSON only in schema:\n"
        '{"experiences":[{"headline":"...","date_range":"...","details":"..."}]}\n'
        f"Input entries JSON:\n{json.dumps(compact_entries, ensure_ascii=False)}"
    )

    try:
        genai.configure(api_key=api_key)
        gm = genai.GenerativeModel(model)
        response = gm.generate_content(
            prompt,
            generation_config={"temperature": 0.1, "response_mime_type": "application/json"},
        )
        payload = parse_json_payload((getattr(response, "text", "") or "").strip())
        if not payload:
            return None
        cleaned = normalize_profile_entries(payload.get("experiences"), max_items=12)
        return cleaned
    except Exception as exc:
        print(f"[WARN] Gemini call failed for experience refinement: {exc}")
        return None


def extract_employee_profile_with_gemini(
    resume_text: str,
    sections: dict[str, str],
    model: str,
    api_key: str,
) -> tuple[dict[str, Any], str] | None:
    try:
        import google.generativeai as genai
    except Exception:
        print("[WARN] Gemini profile extraction skipped: google-generativeai is not installed.")
        return None

    section_context = json.dumps(sections, ensure_ascii=False)
    prompt = (
        "Extract employee profile information from resume text. "
        "Return STRICT JSON only and no extra commentary. "
        'Schema: {"employee_profile":{"name":string|null,"address":string|null,'
        '"phone_number":string|null,"email":string|null,"linkedin":string|null,"github":string|null,'
        '"date_of_birth":string|null,"education":[{"headline":string,"date_range":string,"details":string}],'
        '"experiences":[{"headline":string,"date_range":string,"details":string}]}}. '
        "Keep arrays concise and factual from the resume text. "
        "Use section context first and do not hallucinate."
        f"\nSection Context JSON:\n{section_context[:12000]}"
        f"\nResume Text:\n{resume_text[:18000]}"
    )

    try:
        genai.configure(api_key=api_key)
        gm = genai.GenerativeModel(model)
        raw_text = ""
        payload: dict[str, Any] | None = None
        for attempt in range(2):
            response = gm.generate_content(
                prompt,
                generation_config={"temperature": 0.1, "response_mime_type": "application/json"},
            )
            raw_text = (getattr(response, "text", "") or "").strip()
            payload = parse_json_payload(raw_text)
            if payload:
                break
            if attempt == 0:
                prompt = prompt + "\nIMPORTANT: Output valid JSON object only, no markdown."
        if not payload:
            return None
        profile = normalize_employee_profile_payload(payload)
        has_any_data = any(
            [
                profile.get("name"),
                profile.get("email"),
                profile.get("phone_number"),
                profile.get("address"),
                profile.get("education"),
                profile.get("experiences"),
            ]
        )
        return (profile, raw_text) if has_any_data else None
    except Exception as exc:
        print(f"[WARN] Gemini call failed for employee profile extraction: {exc}")
        return None


def merge_profile_entries(
    primary: list[dict[str, str]],
    fallback: list[dict[str, str]],
    max_items: int,
) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[str] = set()

    for src in [primary, fallback]:
        for item in src:
            headline = str(item.get("headline") or "").strip()
            date_range = str(item.get("date_range") or "Unknown").strip()
            details = str(item.get("details") or "").strip()
            if not headline and not details:
                continue
            key = f"{headline.lower()}::{date_range.lower()}"
            if key in seen:
                continue
            seen.add(key)
            merged.append(
                {
                    "headline": headline[:140] if headline else "-",
                    "date_range": date_range or "Unknown",
                    "details": details[:800],
                }
            )
            if len(merged) >= max_items:
                return merged
    return merged


def is_plausible_experience_entry(entry: dict[str, str]) -> bool:
    headline = str(entry.get("headline") or "").strip()
    date_range = str(entry.get("date_range") or "Unknown").strip()
    details = str(entry.get("details") or "").strip()
    if not headline:
        return False

    headline_l = headline.lower()
    if re.fullmatch(r"[^\w]*", headline):
        return False
    role_terms = {
        "intern", "engineer", "developer", "analyst", "consultant",
        "manager", "lead", "research", "assistant", "specialist", "executive", "captain", "mentor",
    }
    skillish_terms = {
        "docker", "kubernetes", "terraform", "jenkins", "pipeline", "ci/cd",
        "iac", "containerization", "languages", "frameworks", "tools", "skills",
    }
    bad_single_tokens = {
        "in", "and", "or", "to", "for", "with", "of", "on", "at", "by",
        "basics", "development", "codepipeline", "iac", "ci/cd",
    }
    weak_start_tokens = {
        "i", "we", "while", "the", "a", "an", "found", "wrote", "solve",
        "not", "then", "and", "or", "to", "for", "with", "by",
    }
    company_markers = {"inc", "ltd", "llc", "corp", "company", "co.", "technologies", "solutions", "systems"}

    words = [w for w in re.findall(r"[A-Za-z0-9+/.-]+", headline_l) if w]
    first_word = words[0] if words else ""

    if len(headline.split()) == 1 and headline_l in bad_single_tokens:
        return False
    if len(headline.split()) == 1 and date_range == "Unknown" and not any(t in headline_l for t in role_terms):
        return False
    if first_word in weak_start_tokens:
        return False

    # Common OCR fragments like "I - wrote", "CLI - commands", "GCP. - While".
    if "-" in headline and date_range == "Unknown":
        parts = [p.strip().lower() for p in headline.split("-") if p.strip()]
        if parts:
            p0 = re.sub(r"[^a-z0-9+/]", "", parts[0])
            p1 = re.sub(r"[^a-z0-9+/]", "", parts[1]) if len(parts) > 1 else ""
            if p0 in weak_start_tokens or p1 in weak_start_tokens:
                return False
            if (len(p0) <= 4 or len(p1) <= 8) and not any(t in headline_l for t in role_terms):
                return False

    if date_range != "Unknown":
        return True
    if any(m in headline_l for m in company_markers):
        return True
    if "," in headline and len(words) >= 4:
        return True
    if len(details) >= 100:
        return True
    if any(t in headline_l for t in role_terms):
        return True
    if any(t in headline_l for t in skillish_terms):
        return False
    return len(headline.split()) >= 3


def merge_employee_profiles(
    rule_profile: dict[str, Any],
    llm_profile: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    merged = {}
    confidence: dict[str, Any] = {}
    scalar_fields = ["name", "address", "phone_number", "email", "linkedin", "github", "date_of_birth"]
    for field in scalar_fields:
        llm_val = llm_profile.get(field)
        rule_val = rule_profile.get(field)
        if llm_val:
            merged[field] = llm_val
            confidence[field] = {"source": "llm", "score": 0.9}
        elif rule_val:
            merged[field] = rule_val
            confidence[field] = {"source": "rules_fallback", "score": 0.65}
        else:
            merged[field] = None
            confidence[field] = {"source": "missing", "score": 0.0}

    llm_edu = llm_profile.get("education") or []
    rule_edu = rule_profile.get("education") or []
    llm_exp = llm_profile.get("experiences") or []
    rule_exp = rule_profile.get("experiences") or []
    merged["education"] = merge_profile_entries(llm_edu, rule_edu, max_items=8)
    merged_exp = merge_profile_entries(llm_exp, rule_exp, max_items=12)
    merged["experiences"] = [x for x in merged_exp if is_plausible_experience_entry(x)]
    confidence["education"] = {"source": "llm_plus_rules", "score": 0.85 if llm_edu else 0.6 if rule_edu else 0.0}
    exp_score = 0.85 if llm_exp else 0.6 if rule_exp else 0.0
    if merged_exp and not merged["experiences"]:
        exp_score = 0.0
    confidence["experiences"] = {"source": "llm_plus_rules", "score": exp_score}
    return merged, confidence


def extract_employee_profile(
    resume_text: str,
    model: str | None = None,
    api_key: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    sections = segment_resume_sections(resume_text)
    rule_profile = extract_employee_profile_with_rules(resume_text)
    if not model or not api_key:
        merged, confidence = merge_employee_profiles(rule_profile, {})
        debug = {
            "mode": "rules_only",
            "section_keys": sorted(sections.keys()),
            "field_confidence": confidence,
            "llm_raw_text": "",
            "experience_refinement_status": "skipped",
        }
        return merged, debug

    refined_rule_exp = refine_experience_entries_with_gemini(
        rule_profile.get("experiences") or [],
        model=model,
        api_key=api_key,
    )
    exp_refine_status = "ok" if refined_rule_exp is not None else "failed"
    if refined_rule_exp is not None:
        rule_profile["experiences"] = refined_rule_exp

    llm_raw_text = ""
    llm_profile: dict[str, Any] = {}
    llm_status = "ok"
    llm_error = ""
    llm_result = extract_employee_profile_with_gemini(
        resume_text,
        sections=sections,
        model=model,
        api_key=api_key,
    )
    if llm_result:
        llm_profile, llm_raw_text = llm_result
    else:
        llm_status = "failed"
        llm_error = "Gemini returned invalid/empty profile payload."

    merged, confidence = merge_employee_profiles(rule_profile, llm_profile)
    debug = {
        "mode": "llm_with_field_fallback",
        "llm_status": llm_status,
        "llm_error": llm_error,
        "experience_refinement_status": exp_refine_status,
        "section_keys": sorted(sections.keys()),
        "field_confidence": confidence,
        "llm_raw_text": llm_raw_text,
    }
    return merged, debug


def extract_section_text(resume_text: str, section_headers: list[str]) -> str:
    text = resume_text.replace("\r\n", "\n")
    header_pattern = "|".join(re.escape(h) for h in section_headers)
    start_match = re.search(
        rf"(?im)^\s*(?:{header_pattern})\s*:?\s*$",
        text,
    )
    if not start_match:
        return ""

    start_idx = start_match.end()
    remainder = text[start_idx:]
    stop_match = re.search(
        r"(?im)^\s*(skills|technical skills|tech stack|core competencies|experience|work experience|professional experience|employment history|work history|positions of responsibility|projects|project experience|education|certifications|achievements|summary|profile summary|career objective|objective|relevant courses)\s*:?\s*$",
        remainder,
    )
    if stop_match:
        remainder = remainder[: stop_match.start()]

    return remainder.strip()


def split_project_blocks(resume_text: str) -> list[str]:
    project_area = extract_section_text(
        resume_text,
        section_headers=["projects", "project experience", "academic projects"],
    )
    if not project_area:
        return []

    blocks = [b.strip() for b in re.split(r"\n\s*[-*]\s+", project_area) if b.strip()]
    if len(blocks) <= 1:
        blocks = [b.strip() for b in re.split(r"\n\n+", project_area) if b.strip()]
    return blocks[:12]


def map_project_skills_with_rules(project_text: str, alias_map: dict[str, str]) -> list[str]:
    return find_skills_in_text(project_text, alias_map)


def map_experience_skills_with_rules(experience_text: str, alias_map: dict[str, str]) -> list[str]:
    return find_skills_in_text(experience_text, alias_map)


def map_context_skills_with_gemini(
    context_text: str,
    context_label: str,
    canonical_skills: list[str],
    model: str,
    api_key: str,
) -> list[str]:
    try:
        import google.generativeai as genai
    except Exception:
        raise RuntimeError("google-generativeai dependency is required for hybrid mode.")

    prompt = (
        "You are a Professional high skilled HR and your job is to filter and extract skills from employee Resumes"
        "Also use your knowledge to identify whether a particular text is a skill or not"
        "If you find any skill which are irrelevant like for example Career-Objective, Familiar-Swift, etc. extract only the skill not the entire text. "
        f"Extract only skills from this {context_label} text. Return strict JSON only in schema "
        '{"skills_used": ["react", "python"]}. '
        f"Choose only from this allowed list: {', '.join(canonical_skills)}. "
        f"{context_label.title()} text: {context_text}"
    )

    try:
        genai.configure(api_key=api_key)
        gm = genai.GenerativeModel(model)
        response = gm.generate_content(
            prompt,
            generation_config={"temperature": 0.1, "response_mime_type": "application/json"},
        )
        payload = json.loads((getattr(response, "text", "") or "{}").strip())
    except Exception as exc:
        print(f"[WARN] Gemini call failed for {context_label} mapping: {exc}")
        return []

    skills = payload.get("skills_used", []) if isinstance(payload, dict) else []
    return [s for s in skills if s in canonical_skills]


def split_experience_blocks(resume_text: str) -> list[str]:
    experience_area = extract_section_text(
        resume_text,
        section_headers=[
            "experience",
            "work experience",
            "professional experience",
            "employment",
            "employment history",
            "internship",
            "internships",
            "work history",
            "positions of responsibility",
        ],
    )
    if not experience_area:
        experience_area = extract_section_text(
            resume_text,
            section_headers=["projects", "project experience", "academic projects"],
        )
    if not experience_area:
        return []

    parsed = parse_experience_entries(experience_area, max_items=12)
    if not parsed and experience_area:
        parsed = parse_entries(experience_area, max_items=12)
    blocks: list[str] = []
    for item in parsed:
        block = "\n".join(
            [
                item.get("headline", "").strip(),
                item.get("date_range", "").strip(),
                item.get("details", "").strip(),
            ]
        ).strip()
        if block:
            blocks.append(block)
    return blocks[:12]


def extract_projects(
    resume_text: str,
    alias_map: dict[str, str],
    model: str,
    api_key: str,
) -> list[dict[str, Any]]:
    projects: list[dict[str, Any]] = []
    canonical_skills = sorted(set(alias_map.values()))

    for block in split_project_blocks(resume_text):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        name = lines[0][:120]
        description = " ".join(lines[1:])[:800] if len(lines) > 1 else block[:800]

        rule_skills = map_project_skills_with_rules(block, alias_map)
        llm_skills = map_context_skills_with_gemini(
            block,
            "project",
            canonical_skills,
            model=model,
            api_key=api_key,
        )
        skill_set = sorted(set(rule_skills) | set(llm_skills))

        if not skill_set:
            continue

        projects.append(
            {
                "name": name,
                "date_range": date_range_label(block),
                "description": description,
                "skills_used": [title_case_skill(s) for s in skill_set],
                "skills_used_norm": skill_set,
                "evidence": block[:300],
            }
        )

    return projects


def extract_experiences(
    resume_text: str,
    alias_map: dict[str, str],
    model: str,
    api_key: str,
) -> list[dict[str, Any]]:
    experiences: list[dict[str, Any]] = []
    canonical_skills = sorted(set(alias_map.values()))
    experience_area = extract_section_text(
        resume_text,
        section_headers=[
            "experience",
            "work experience",
            "professional experience",
            "employment",
            "employment history",
            "internship",
            "internships",
            "work history",
            "positions of responsibility",
        ],
    )
    if not experience_area:
        experience_area = extract_section_text(
            resume_text,
            section_headers=["projects", "project experience", "academic projects"],
        )

    parsed_entries = parse_experience_entries(experience_area, max_items=12)
    if not parsed_entries and experience_area:
        parsed_entries = parse_entries(experience_area, max_items=12)
    for entry in parsed_entries:
        title = str(entry.get("headline") or "").strip()[:120]
        date_range = str(entry.get("date_range") or "Unknown").strip()
        details = str(entry.get("details") or "").strip()
        block = "\n".join([title, date_range, details]).strip()
        description = details[:900] if details else block[:900]

        rule_skills = map_experience_skills_with_rules(block, alias_map)
        llm_skills = map_context_skills_with_gemini(
            block,
            "experience",
            canonical_skills,
            model=model,
            api_key=api_key,
        )
        skill_set = sorted(set(rule_skills) | set(llm_skills))

        experiences.append(
            {
                "title": title,
                "date_range": date_range if date_range != "Unknown" else date_range_label(block),
                "description": description,
                "skills_used": [title_case_skill(s) for s in skill_set],
                "skills_used_norm": skill_set,
                "evidence": block[:300],
            }
        )

    return experiences


def date_range_label(text: str) -> str:
    parsed = parse_date_range(text)
    if not parsed:
        return "Unknown"
    start_year, end_year = parsed
    return f"{start_year} to {end_year}"


def is_recent_project(project: dict[str, Any], recent_years: int = 2) -> bool:
    label = project.get("date_range", "")
    parsed = parse_date_range(label)
    if not parsed:
        return False
    _, end_year = parsed
    return end_year >= (datetime.now(UTC).year - recent_years)


def determine_priority(claimed: bool, project_count: int, experience_count: int) -> tuple[str, str]:
    if claimed and project_count > 0 and experience_count > 0:
        return "Very High", "Mentioned and validated by both project and experience evidence."
    if claimed and experience_count > 0:
        return "High", "Mentioned and validated by experience evidence."
    if claimed and project_count > 0:
        return "Medium", "Mentioned and validated by project evidence."
    if claimed:
        return "Low", "Only mentioned in resume with no project/experience evidence."
    if project_count > 0 and experience_count > 0:
        return "Very High", "Inferred from both project and experience evidence."
    if experience_count > 0:
        return "High", "Inferred from experience evidence."
    if project_count > 0:
        return "Medium", "Inferred from project evidence."
    return "Low", "No strong evidence found."


def score_skill(
    skill: str,
    claimed: bool,
    projects: list[dict[str, Any]],
    experiences: list[dict[str, Any]],
    claim_evidence: str,
) -> tuple[SkillScore, str, str, int]:
    project_hits = [p for p in projects if skill in p.get("skills_used_norm", [])]
    experience_hits = [e for e in experiences if skill in e.get("skills_used_norm", [])]
    project_count = len(project_hits)
    experience_count = len(experience_hits)
    recent_usage = any(is_recent_project(p) for p in project_hits)

    claim_points = 30 if claimed else 0
    project_points = min(project_count * 20, 60)
    experience_points = min(experience_count * 25, 50)
    recency_points = 10 if recent_usage else 0
    weak_claim_penalty = 10 if claimed and project_count == 0 and experience_count == 0 else 0

    score = max(0, min(100, claim_points + project_points + experience_points + recency_points - weak_claim_penalty))
    level = "Strong" if score >= 80 else "Moderate" if score >= 50 else "Basic"
    priority, priority_reason = determine_priority(claimed, project_count, experience_count)

    confidence = 0.50
    evidence_snippets: list[str] = []
    if claimed and claim_evidence:
        confidence += 0.15
        evidence_snippets.append(claim_evidence[:200])
    if project_count >= 1:
        confidence += 0.10
        evidence_snippets.append(project_hits[0].get("evidence", "")[:200])
    if experience_count >= 1:
        confidence += 0.10
        evidence_snippets.append(experience_hits[0].get("evidence", "")[:200])
    if project_count >= 2:
        confidence += 0.10
    if project_count == 0 and experience_count == 0 and claimed:
        confidence -= 0.15

    confidence = max(0.0, min(1.0, round(confidence, 2)))

    return SkillScore(
        skill=title_case_skill(skill),
        normalized_skill_id=skill,
        claimed=claimed,
        project_count=project_count,
        recent_usage=recent_usage,
        proficiency_score=score,
        level=level,
        confidence=confidence,
        evidence_snippets=[s for s in evidence_snippets if s],
    ), priority, priority_reason, experience_count


def analyze_resume(
    employee_id: str,
    resume_id: str,
    resume_text: str,
    alias_map: dict[str, str],
) -> dict[str, Any]:
    model, api_key = get_required_llm_config()
    employee_profile, employee_profile_debug = extract_employee_profile(
        resume_text,
        model=model,
        api_key=api_key,
    )
    claimed_skills = extract_claimed_skills(
        resume_text=resume_text,
        alias_map=alias_map,
        model=model,
        api_key=api_key,
    )
    projects = extract_projects(resume_text, alias_map, model=model, api_key=api_key)
    experiences = extract_experiences(resume_text, alias_map, model=model, api_key=api_key)
    experiences = [
        x
        for x in experiences
        if is_plausible_experience_entry(
            {
                "headline": str(x.get("title", "")),
                "date_range": str(x.get("date_range", "Unknown")),
                "details": str(x.get("description", "")),
            }
        )
    ]
    if not employee_profile.get("experiences") and experiences:
        fallback_exp = [
            {
                "headline": x.get("title", ""),
                "date_range": x.get("date_range", "Unknown"),
                "details": x.get("description", ""),
            }
            for x in experiences
            if is_plausible_experience_entry(
                {
                    "headline": str(x.get("title", "")),
                    "date_range": str(x.get("date_range", "Unknown")),
                    "details": str(x.get("description", "")),
                }
            )
        ]
        if fallback_exp:
            employee_profile["experiences"] = fallback_exp

    claim_map = {x["normalized_skill_id"]: x for x in claimed_skills}
    project_skill_set = {s for project in projects for s in project.get("skills_used_norm", [])}
    experience_skill_set = {s for item in experiences for s in item.get("skills_used_norm", [])}
    all_skills = sorted(set(claim_map.keys()) | project_skill_set | experience_skill_set)

    assessments = []
    for skill in all_skills:
        claim_ev = claim_map.get(skill, {}).get("evidence", "")
        result, priority, priority_reason, experience_count = score_skill(
            skill=skill,
            claimed=skill in claim_map,
            projects=projects,
            experiences=experiences,
            claim_evidence=claim_ev,
        )
        row = result.__dict__
        row["experience_count"] = experience_count
        row["priority"] = priority
        row["priority_reason"] = priority_reason
        assessments.append(row)

    cleaned_projects = [
        {
            "name": p["name"],
            "date_range": p["date_range"],
            "description": p["description"],
            "skills_used": p["skills_used"],
            "evidence": p["evidence"],
        }
        for p in projects
    ]
    cleaned_experiences = [
        {
            "title": x["title"],
            "date_range": x["date_range"],
            "description": x["description"],
            "skills_used": x["skills_used"],
            "evidence": x["evidence"],
        }
        for x in experiences
    ]
    suggested_new_skills = suggest_new_skills(resume_text, alias_map)

    return {
        "employee_id": employee_id,
        "resume_id": resume_id,
        "employee_profile": employee_profile,
        "employee_profile_debug": employee_profile_debug,
        "suggested_new_skills": suggested_new_skills,
        "claimed_skills": claimed_skills,
        "projects": cleaned_projects,
        "experiences": cleaned_experiences,
        "skill_assessment": assessments,
        "analysis_metadata": {
            "analysis_version": "v1",
            "analyzed_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "model_or_pipeline": "hybrid_rules_plus_llm",
            "status": "completed",
        },
    }


def run_poc(
    samples_dir: Path,
    outputs_dir: Path,
    skill_dict_path: Path,
) -> None:
    outputs_dir.mkdir(parents=True, exist_ok=True)
    skill_dict = load_skill_dictionary(skill_dict_path)
    alias_map = normalize_skill_map(skill_dict)

    sample_files = sorted(list(samples_dir.glob("*.txt")) + list(samples_dir.glob("*.pdf")))
    if not sample_files:
        raise FileNotFoundError(f"No .txt or .pdf resumes found in {samples_dir}")

    for idx, sample_file in enumerate(sample_files, start=1):
        text = read_resume_text(sample_file)
        result = analyze_resume(
            employee_id=f"POC-EMP-{idx:03d}",
            resume_id=sample_file.stem,
            resume_text=text,
            alias_map=alias_map,
        )

        out_file = outputs_dir / f"{sample_file.stem}.analysis.json"
        out_file.write_text(json.dumps(result, indent=2), encoding="utf-8")

        print(f"[OK] {sample_file.name} -> {out_file.name}")
        for skill in result["skill_assessment"]:
            print(
                f"    - {skill['skill']}: score={skill['proficiency_score']} "
                f"level={skill['level']} projects={skill['project_count']}"
            )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Resume skill extraction and ranking PoC")
    base_dir = Path(__file__).resolve().parent
    parser.add_argument("--samples-dir", type=Path, default=base_dir / "samples")
    parser.add_argument("--outputs-dir", type=Path, default=base_dir / "outputs")
    parser.add_argument("--skill-dict", type=Path, default=base_dir / "skill_dictionary.json")
    return parser


def main() -> None:
    args = build_arg_parser().parse_args()
    run_poc(
        samples_dir=args.samples_dir,
        outputs_dir=args.outputs_dir,
        skill_dict_path=args.skill_dict,
    )


if __name__ == "__main__":
    main()
