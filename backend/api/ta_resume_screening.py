from __future__ import annotations

import hashlib
import json
from datetime import datetime
import os
import re
import threading
from typing import Optional

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - optional dependency at runtime
    genai = None

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from services.resume_parser import parse_resume_bytes
from services.ta_jd_screening import parse_jd_validated, rank_uploaded_resumes, rank_uploaded_resumes_from_parsed
from services.ta_resume_screening import (
    apply_external_results,
    create_job,
    get_job,
    get_job_queued_files,
    job_store_stats,
    list_job_ids,
    load_taxonomy,
    process_job,
    queue_files,
    set_job_processing_state,
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


class JDParseRequest(BaseModel):
    job_description: str = ""
    strict_upper_bound: bool = False
    force_refresh: bool = False
    debug: bool = False


class JDProcessRequest(BaseModel):
    job_description: str = ""
    strict_upper_bound: bool = False
    force_refresh: bool = False
    debug: bool = False
    title: Optional[str] = None
    domain: Optional[str] = None
    primary_skills: list[str] = Field(default_factory=list)
    secondary_skills: list[str] = Field(default_factory=list)
    min_experience_years: Optional[float] = None
    max_experience_years: Optional[float] = None
    keywords: list[str] = Field(default_factory=list)
    nice_to_have: list[str] = Field(default_factory=list)


GEMINI_MODEL = os.getenv("SKILL_AI_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

DOMAIN_CHOICES: tuple[str, ...] = (
    "Frontend Engineering",
    "Backend Engineering",
    "Full Stack",
    "Data/AI",
    "DevOps/Cloud",
    "QA/Testing",
    "Security",
    "Mobile",
    "Other",
)

DOMAIN_RULES: dict[str, tuple[str, ...]] = {
    "Frontend Engineering": ("frontend", "front-end", "react", "javascript", "typescript", "html", "css", "ui", "ux"),
    "Backend Engineering": ("backend", "back-end", "spring", "django", "flask", "fastapi", "api", "microservice", "server-side"),
    "Full Stack": ("full stack", "fullstack", "front end and back end", "frontend and backend"),
    "Data/AI": ("machine learning", "ml", "ai", "data science", "nlp", "deep learning", "computer vision"),
    "DevOps/Cloud": ("devops", "kubernetes", "docker", "aws", "azure", "gcp", "terraform", "ci/cd", "cloud"),
    "QA/Testing": ("qa", "quality assurance", "testing", "test automation", "selenium", "cypress", "jest"),
    "Security": ("security", "cyber", "penetration", "vulnerability", "soc", "siem", "infosec"),
    "Mobile": ("android", "ios", "react native", "flutter", "swift", "kotlin", "mobile"),
}

SKILL_ALIASES_TEST: dict[str, tuple[str, ...]] = {
    # Core frontend
    "react": ("reactjs", "react.js", "react js"),
    "javascript": ("js", "javascript es6", "javascript es6+", "ecmascript", "java script"),
    "typescript": ("ts", "type script"),
    "html": ("html5",),
    "css": ("css3",),
    "sass": ("scss",),
    "tailwind css": ("tailwind", "tailwindcss"),
    "bootstrap": tuple(),
    "material ui": ("mui", "material-ui"),
    "redux": ("redux toolkit", "rtk"),
    "context api": ("react context", "contextapi"),
    "next.js": ("nextjs", "next js"),
    "vue": ("vue.js", "vuejs"),
    "angular": ("angularjs",),

    # Backend / APIs
    "node.js": ("nodejs", "node js"),
    "express": ("express.js", "expressjs"),
    "spring boot": ("springboot",),
    "spring": ("spring framework",),
    "django": tuple(),
    "flask": tuple(),
    "fastapi": tuple(),
    "laravel": tuple(),
    "asp.net": ("asp.net core", "dotnet", ".net", "c#"),
    "rest": ("rest api", "rest apis", "restful", "restful api", "restful apis"),
    "graphql": ("graph ql",),
    "microservices": ("microservice",),

    # Languages
    "python": ("python3", "py"),
    "java": tuple(),
    "c++": ("cpp",),
    "c#": ("csharp",),
    "go": ("golang",),
    "ruby": tuple(),
    "php": tuple(),
    "kotlin": tuple(),
    "swift": tuple(),
    "r": tuple(),
    "matlab": tuple(),

    # Data / ML / AI
    "sql": tuple(),
    "mysql": tuple(),
    "postgresql": ("postgres", "psql"),
    "mongodb": ("mongo", "mongo db"),
    "redis": tuple(),
    "elasticsearch": ("elastic search", "elk"),
    "pandas": tuple(),
    "numpy": tuple(),
    "scikit-learn": ("sklearn", "scikit learn"),
    "tensorflow": ("tf",),
    "pytorch": ("torch", "py torch"),
    "keras": tuple(),
    "xgboost": tuple(),
    "lightgbm": ("lgbm",),
    "nlp": ("natural language processing",),
    "llm": ("large language model", "large language models", "generative ai"),
    "rag": ("retrieval augmented generation",),

    # DevOps / Cloud
    "docker": tuple(),
    "kubernetes": ("k8s",),
    "jenkins": tuple(),
    "github actions": ("gh actions",),
    "ci/cd": ("cicd", "ci cd"),
    "terraform": tuple(),
    "ansible": tuple(),
    "nginx": tuple(),
    "aws": ("amazon web services",),
    "azure": ("microsoft azure",),
    "gcp": ("google cloud", "google cloud platform"),

    # Testing / Quality
    "jest": tuple(),
    "cypress": tuple(),
    "selenium": tuple(),
    "pytest": tuple(),
    "junit": tuple(),
    "postman": tuple(),

    # Mobile
    "react native": ("react-native",),
    "flutter": tuple(),
    "android": tuple(),
    "ios": tuple(),

    # Security / Infra
    "git": tuple(),
    "github": tuple(),
    "gitlab": tuple(),
    "jira": tuple(),
    "linux": tuple(),
    "kali linux": ("kali",),
    "wireshark": tuple(),
    "metasploit": tuple(),
    "nmap": tuple(),
    "burp suite": ("burpsuite", "burp-suite"),
    "owasp": tuple(),
}

JD_PARSE_VERSION = "v1"
_JD_PARSE_CACHE_LOCK = threading.Lock()
_JD_PARSE_CACHE: dict[str, dict[str, object]] = {}



def _normalize_domain_label(value: object) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip().lower()
    if not raw:
        return None

    aliases = {
        "frontend": "Frontend Engineering",
        "front-end": "Frontend Engineering",
        "front end": "Frontend Engineering",
        "backend": "Backend Engineering",
        "back-end": "Backend Engineering",
        "back end": "Backend Engineering",
        "full stack": "Full Stack",
        "fullstack": "Full Stack",
        "data": "Data/AI",
        "ai": "Data/AI",
        "ml": "Data/AI",
        "devops": "DevOps/Cloud",
        "cloud": "DevOps/Cloud",
        "qa": "QA/Testing",
        "testing": "QA/Testing",
        "security": "Security",
        "mobile": "Mobile",
        "other": "Other",
    }

    if raw in aliases:
        return aliases[raw]

    for choice in DOMAIN_CHOICES:
        if raw == choice.lower():
            return choice

    return None


def _detect_domain_from_text(jd_text: str) -> tuple[str, list[str]]:
    lowered = jd_text.lower()
    best_domain = "Other"
    best_signals: list[str] = []

    for domain, signals in DOMAIN_RULES.items():
        matched = [signal for signal in signals if signal in lowered]
        if len(matched) > len(best_signals):
            best_domain = domain
            best_signals = matched

    return best_domain, best_signals


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


def _normalize_jd_skills(raw_skills: object) -> list[str]:
    taxonomy = load_taxonomy()
    taxonomy_map = {skill.lower().strip(): skill for skill in taxonomy}

    if isinstance(raw_skills, list):
        parts = [str(item) for item in raw_skills if item is not None]
    elif raw_skills:
        parts = [str(raw_skills)]
    else:
        parts = []

    items: list[str] = []
    for part in parts:
        items.extend(token.strip() for token in re.split(r"[,;\n|]+", part) if token.strip())

    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        canon = taxonomy_map.get(item.lower().strip(), item.strip())
        key = canon.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(canon)
    return out


def _parse_experience_range_from_text(jd_text: str) -> tuple[Optional[float], Optional[float]]:
    # Supports patterns like "1-4 years", "2 to 5 years", "3+ years".
    range_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*years?", jd_text, flags=re.IGNORECASE)
    if range_match:
        start = float(range_match.group(1))
        end = float(range_match.group(2))
        if end < start:
            start, end = end, start
        return start, end

    plus_match = re.search(r"(\d+(?:\.\d+)?)\s*\+\s*years?", jd_text, flags=re.IGNORECASE)
    if plus_match:
        return float(plus_match.group(1)), None

    min_match = re.search(r"(?:minimum|min)\s*(\d+(?:\.\d+)?)\s*years?", jd_text, flags=re.IGNORECASE)
    if min_match:
        return float(min_match.group(1)), None

    return None, None


def _parse_jd_with_gemini(jd_text: str, strict_mode: bool = False) -> tuple[Optional[dict], Optional[str]]:
    if genai is None:
        return None, "google-generativeai is not installed"
    if not GEMINI_API_KEY:
        return None, "GEMINI_API_KEY is not set"

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    strict_tail = "Return exactly the requested keys and valid JSON only." if strict_mode else ""
    prompt = (
        "You are a job description parser. Extract structured JSON with keys only: "
        "title (string or null), domain (string or null), primary_skills (array of strings), "
        "secondary_skills (array of strings), min_experience_years (number or null), "
        "max_experience_years (number or null), strict_upper_bound (boolean), "
        "nice_to_have (array of strings), keywords (array of strings). "
        "For domain, return only one of: Frontend Engineering, Backend Engineering, Full Stack, Data/AI, DevOps/Cloud, QA/Testing, Security, Mobile, Other. "
        "Do not include any extra keys or commentary. If unknown, use null or [] (domain should default to Other instead of null if possible). "
        + strict_tail + "\n\n"
        "Job Description:\n" + jd_text[:60000]
    )

    try:
        response = model.generate_content(
            prompt,
            generation_config={"temperature": 0, "top_p": 0.1},
        )
        payload = _extract_json_from_text(getattr(response, "text", ""))
        if not payload:
            return None, "Model response was not valid JSON"
        return payload, None
    except Exception as exc:
        return None, str(exc)


def _prepare_jd_payload(parsed: dict, jd_text: str, strict_upper_bound: bool) -> dict:
    primary = _normalize_jd_skills(parsed.get("primary_skills") or [])
    secondary = _normalize_jd_skills(parsed.get("secondary_skills") or [])
    nice_to_have = _normalize_jd_skills(parsed.get("nice_to_have") or [])

    min_experience_years = parsed.get("min_experience_years")
    max_experience_years = parsed.get("max_experience_years")
    try:
        min_experience_years = float(min_experience_years) if min_experience_years is not None else None
    except Exception:
        min_experience_years = None
    try:
        max_experience_years = float(max_experience_years) if max_experience_years is not None else None
    except Exception:
        max_experience_years = None

    if min_experience_years is None and max_experience_years is None:
        parsed_min, parsed_max = _parse_experience_range_from_text(jd_text)
        min_experience_years = parsed_min
        max_experience_years = parsed_max

    if min_experience_years is not None and max_experience_years is not None and max_experience_years < min_experience_years:
        min_experience_years, max_experience_years = max_experience_years, min_experience_years

    llm_domain = _normalize_domain_label(parsed.get("domain"))
    fallback_domain, fallback_signals = _detect_domain_from_text(jd_text)
    domain = llm_domain or fallback_domain
    domain_source = "llm" if llm_domain else "rule_fallback"

    response = {
        "title": parsed.get("title"),
        "domain": domain,
        "domain_source": domain_source,
        "domain_signals": fallback_signals if domain_source == "rule_fallback" else [],
        "primary_skills": primary,
        "secondary_skills": secondary,
        "min_experience_years": min_experience_years,
        "max_experience_years": max_experience_years,
        "strict_upper_bound": bool(parsed.get("strict_upper_bound", strict_upper_bound)),
        "nice_to_have": nice_to_have,
        "keywords": [str(item) for item in (parsed.get("keywords") or []) if str(item).strip()],
    }

    present_fields = sum(
        1
        for value in [
            response["title"],
            response["domain"],
            response["primary_skills"],
            response["secondary_skills"],
            response["min_experience_years"],
            response["max_experience_years"],
            response["keywords"],
        ]
        if value not in (None, "", [])
    )
    response["confidence"] = int(round((present_fields / 7) * 100))
    response["missing_fields"] = [
        key
        for key in ["title", "domain", "primary_skills", "secondary_skills", "min_experience_years", "max_experience_years", "keywords"]
        if response.get(key) in (None, "", [])
    ]
    return response


def _normalize_jd_text_for_hash(jd_text: str) -> str:
    return re.sub(r"\s+", " ", jd_text.strip().lower())


def _jd_cache_key(jd_text: str, strict_upper_bound: bool) -> str:
    normalized = _normalize_jd_text_for_hash(jd_text)
    raw = f"{JD_PARSE_VERSION}|strict={int(strict_upper_bound)}|{normalized}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _validate_jd_payload(payload: dict) -> list[str]:
    errors: list[str] = []
    if payload.get("domain") not in DOMAIN_CHOICES:
        errors.append("domain is invalid or missing")

    min_years = payload.get("min_experience_years")
    max_years = payload.get("max_experience_years")
    if min_years is not None and min_years < 0:
        errors.append("min_experience_years must be >= 0")
    if max_years is not None and max_years < 0:
        errors.append("max_experience_years must be >= 0")
    if min_years is not None and max_years is not None and min_years > max_years:
        errors.append("min_experience_years cannot exceed max_experience_years")
    if not payload.get("primary_skills") and not payload.get("secondary_skills") and not payload.get("keywords"):
        errors.append("no skills/keywords were extracted")
    return errors


def _parse_jd_validated(
    jd_text: str,
    strict_upper_bound: bool,
    force_refresh: bool = False,
) -> tuple[Optional[dict], Optional[dict], Optional[str], dict[str, object]]:
    meta: dict[str, object] = {
        "cache_hit": False,
        "validated": False,
        "retry_used": False,
        "validation_errors": [],
    }

    key = _jd_cache_key(jd_text, strict_upper_bound)
    if not force_refresh:
        with _JD_PARSE_CACHE_LOCK:
            cached = _JD_PARSE_CACHE.get(key)
        if cached:
            meta["cache_hit"] = True
            meta["validated"] = True
            return cached["prepared"], cached.get("raw"), None, meta

    raw, error = _parse_jd_with_gemini(jd_text, strict_mode=False)
    if error or not raw:
        return None, None, error or "JD parse failed.", meta

    prepared = _prepare_jd_payload(raw, jd_text, strict_upper_bound)
    validation_errors = _validate_jd_payload(prepared)
    if validation_errors:
        meta["retry_used"] = True
        retry_raw, retry_error = _parse_jd_with_gemini(jd_text, strict_mode=True)
        if retry_error or not retry_raw:
            meta["validation_errors"] = validation_errors
            return None, raw, retry_error or "JD parse failed on retry.", meta

        retry_prepared = _prepare_jd_payload(retry_raw, jd_text, strict_upper_bound)
        retry_errors = _validate_jd_payload(retry_prepared)
        if retry_errors:
            meta["validation_errors"] = retry_errors
            return None, retry_raw, "JD parse validation failed.", meta

        prepared = retry_prepared
        raw = retry_raw

    with _JD_PARSE_CACHE_LOCK:
        _JD_PARSE_CACHE[key] = {"prepared": prepared, "raw": raw}

    meta["validated"] = True
    return prepared, raw, None, meta


def _resume_text_blob(parsed_resume: dict) -> str:
    parts: list[str] = []
    for key in ("skills", "projects", "work_experience", "education"):
        values = parsed_resume.get(key) or []
        if isinstance(values, list):
            parts.extend(str(v) for v in values if v)
        elif values:
            parts.append(str(values))
    return "\n".join(parts)


def _looks_like_internship_entry(entry: str) -> bool:
    lowered = entry.lower()
    internship_markers = (
        "intern",
        "internship",
        "trainee",
        "apprentice",
        "co-op",
        "co op",
    )
    return any(marker in lowered for marker in internship_markers)


def _extract_candidate_years(work_entries: list[str]) -> float:
    if not work_entries:
        return 0.0

    filtered_entries = [
        str(item)
        for item in work_entries
        if str(item).strip() and not _looks_like_internship_entry(str(item))
    ]
    if not filtered_entries:
        return 0.0

    text = "\n".join(filtered_entries)

    explicit = re.findall(r"(\d+(?:\.\d+)?)\s*\+?\s*years?", text, flags=re.IGNORECASE)
    if explicit:
        try:
            return max(float(v) for v in explicit)
        except Exception:
            pass

    years = [int(match) for match in re.findall(r"\b(19\d{2}|20\d{2})\b", text)]
    if len(years) < 2:
        return 0.0

    now_year = datetime.now().year
    min_year = min(years)
    max_year = max(years)
    if re.search(r"\b(present|current|now)\b", text, flags=re.IGNORECASE):
        max_year = now_year
    else:
        max_year = min(max_year, now_year)

    return float(max(0, max_year - min_year))


def _normalize_skill_token(value: str) -> str:
    return "".join(ch for ch in value.lower().strip() if ch.isalnum() or ch in {"+", ".", "#"})


def _tokenize_skill_text(value: str) -> list[str]:
    raw_tokens = re.findall(r"[A-Za-z0-9+#.]+", value or "")
    tokens: list[str] = []
    for token in raw_tokens:
        normalized = _normalize_skill_token(token)
        if normalized:
            tokens.append(normalized)
    return tokens


def _normalize_skill_phrase(value: str) -> str:
    return " ".join(_tokenize_skill_text(value))


def _build_skill_alias_lookup() -> tuple[dict[str, str], dict[str, set[str]]]:
    alias_to_canonical: dict[str, str] = {}
    canonical_to_variants: dict[str, set[str]] = {}

    for canonical, variants in SKILL_ALIASES_TEST.items():
        canonical_norm = _normalize_skill_phrase(canonical)
        if not canonical_norm:
            continue
        variant_set = {canonical_norm}
        for variant in variants:
            norm = _normalize_skill_phrase(variant)
            if norm:
                variant_set.add(norm)
        canonical_to_variants[canonical_norm] = variant_set
        for variant in variant_set:
            alias_to_canonical[variant] = canonical_norm

    return alias_to_canonical, canonical_to_variants


_SKILL_ALIAS_TO_CANONICAL, _SKILL_CANONICAL_VARIANTS = _build_skill_alias_lookup()


def _canonicalize_skill_token(value: str) -> str:
    normalized = _normalize_skill_phrase(value)
    return _SKILL_ALIAS_TO_CANONICAL.get(normalized, normalized)


def _skill_variants_for(token: str) -> set[str]:
    canonical = _canonicalize_skill_token(token)
    return _SKILL_CANONICAL_VARIANTS.get(canonical, {canonical})


def _count_phrase_mentions(tokens: list[str], phrase: str) -> int:
    phrase_tokens = phrase.split()
    if not phrase_tokens or not tokens:
        return 0

    width = len(phrase_tokens)
    if width > len(tokens):
        return 0

    count = 0
    for idx in range(0, len(tokens) - width + 1):
        if tokens[idx : idx + width] == phrase_tokens:
            count += 1
    return count


def _keyword_overlap_percent(jd_tokens: set[str], candidate_text: str) -> int:
    if not jd_tokens:
        return 0
    candidate_tokens = {token for token in re.findall(r"[A-Za-z0-9+#.]{3,}", candidate_text.lower())}
    overlap = len(jd_tokens.intersection(candidate_tokens))
    return int(round((overlap / max(1, len(jd_tokens))) * 100))


def _entry_to_text(entry: object) -> str:
    if isinstance(entry, dict):
        parts: list[str] = []
        for key in ("name", "summary", "description"):
            value = entry.get(key)
            if value:
                parts.append(str(value).strip())
        tech = entry.get("tech_stack")
        if isinstance(tech, list) and tech:
            parts.append("Tech Stack: " + ", ".join(str(v).strip() for v in tech if str(v).strip()))
        elif tech:
            parts.append("Tech Stack: " + str(tech).strip())
        joined = " - ".join(part for part in parts if part)
        return joined.strip()
    return str(entry).strip()


def _line_matches_variants(line: str, variants: set[str]) -> bool:
    return bool(_matched_aliases_in_text(line, variants))


def _matched_aliases_in_text(text: str, variants: set[str]) -> set[str]:
    tokens = _tokenize_skill_text(text)
    matched: set[str] = set()
    for variant in variants:
        if _count_phrase_mentions(tokens, variant) > 0:
            matched.add(variant)
    return matched


def _collect_skill_evidence(
    parsed_resume: dict,
    variants: set[str],
    max_items: int = 4,
    sections: tuple[str, ...] = ("skills", "projects", "work_experience", "education"),
) -> list[dict[str, str]]:
    evidence: list[dict[str, str]] = []
    seen: set[str] = set()

    for section in sections:
        values = parsed_resume.get(section) or []
        if not isinstance(values, list):
            values = [values]

        for raw_entry in values:
            text_value = _entry_to_text(raw_entry)
            if not text_value:
                continue
            key = re.sub(r"\s+", " ", text_value.strip().lower())
            if key in seen:
                continue
            if not _line_matches_variants(text_value, variants):
                continue

            seen.add(key)
            evidence.append({"section": section, "text": text_value})
            if len(evidence) >= max_items:
                return evidence

    return evidence


def _count_mentions_in_sections(parsed_resume: dict, variants: set[str], sections: tuple[str, ...]) -> tuple[int, set[str]]:
    mentions = 0
    matched_aliases: set[str] = set()
    seen: set[str] = set()

    for section in sections:
        values = parsed_resume.get(section) or []
        if not isinstance(values, list):
            values = [values]

        for raw_entry in values:
            text_value = _entry_to_text(raw_entry)
            if not text_value:
                continue
            key = re.sub(r"\s+", " ", text_value.strip().lower())
            if key in seen:
                continue
            seen.add(key)

            aliases_in_line = _matched_aliases_in_text(text_value, variants)
            if not aliases_in_line:
                continue

            mentions += 1
            matched_aliases.update(aliases_in_line)

    return mentions, matched_aliases


def _is_listed_in_skills_section(parsed_resume: dict, variants: set[str]) -> bool:
    values = parsed_resume.get("skills") or []
    if not isinstance(values, list):
        values = [values]

    for raw_entry in values:
        text_value = _entry_to_text(raw_entry)
        if not text_value:
            continue
        if _line_matches_variants(text_value, variants):
            return True
    return False


def _experience_score(candidate_years: float, min_years: Optional[float], max_years: Optional[float], strict_upper_bound: bool) -> tuple[int, str]:
    if min_years is None and max_years is None:
        return 100, "no_requirement"

    if min_years is not None and candidate_years < min_years:
        score = int(round((candidate_years / max(min_years, 0.1)) * 100.0))
        return max(0, min(score, 100)), "below_range"

    if max_years is not None and candidate_years > max_years:
        if strict_upper_bound:
            excess = candidate_years - max_years
            penalty = int(round(excess * 10))
            return max(0, 100 - penalty), "above_range"
        return 90, "above_range"

    return 100, "in_range"


def _skill_component(parsed_resume: dict, primary: list[str], secondary: list[str]) -> tuple[int, list[dict[str, object]]]:
    weighted_sum = 0.0
    total_weight = 0.0
    details: list[dict[str, object]] = []

    all_skills = [(s, True) for s in primary] + [(s, False) for s in secondary]
    for skill, is_primary in all_skills:
        canonical_skill = _canonicalize_skill_token(skill)
        variants = _skill_variants_for(canonical_skill)

        in_skills = _is_listed_in_skills_section(parsed_resume, variants)
        mentions, matched_aliases = _count_mentions_in_sections(
            parsed_resume,
            variants,
            sections=("projects", "work_experience", "education"),
        )

        base = 70 if in_skills else (50 if mentions > 0 else 0)
        bonus = mentions * 5
        score = min(95, base + bonus)
        weight = 1.0 if is_primary else 0.5

        weighted_sum += score * weight
        total_weight += weight

        evidence = _collect_skill_evidence(parsed_resume, variants)
        matched_sections = sorted({item.get("section", "") for item in evidence if item.get("section")})

        details.append(
            {
                "skill": skill,
                "is_primary": is_primary,
                "canonical": canonical_skill,
                "base": base,
                "bonus": bonus,
                "mentions": mentions,
                "score": score,
                "matched_aliases": sorted(matched_aliases),
                "mentioned_in_sections": matched_sections,
                "evidence": evidence,
            }
        )

    final = int(round(weighted_sum / total_weight)) if total_weight > 0 else 0
    return final, details


@router.get("/skills")
def get_skills_taxonomy():
    return {"skills": load_taxonomy()}


@router.post("/test/jd-parse")
def jd_parse_test(payload: JDParseRequest):
    jd_text = (payload.job_description or "").strip()
    if not jd_text:
        return JSONResponse(status_code=400, content={"detail": "job_description is required."})

    response, raw_output, error, parse_meta = parse_jd_validated(
        jd_text,
        strict_upper_bound=payload.strict_upper_bound,
        force_refresh=payload.force_refresh,
    )
    if error or not response:
        return JSONResponse(
            status_code=500,
            content={"detail": error or "JD parse failed.", "validation_errors": parse_meta.get("validation_errors", [])},
        )

    if payload.debug:
        response["raw_model_output"] = raw_output
        response["model_used"] = GEMINI_MODEL
        response["parse_meta"] = parse_meta

    return response



@router.post("/test/jd-rank-from-jd")
async def jd_rank_from_jd_test(
    files: list[UploadFile] = File(...),
    job_description: str = Form(""),
    strict_upper_bound: bool = Form(False),
    force_refresh: bool = Form(False),
    debug: bool = Form(False),
):
    jd_text = (job_description or "").strip()
    if not jd_text:
        return JSONResponse(status_code=400, content={"detail": "job_description is required."})
    if not files:
        return JSONResponse(status_code=400, content={"detail": "No files uploaded."})

    file_items = []
    for upload in files:
        file_items.append(
            {
                "filename": upload.filename,
                "content_type": upload.content_type or "",
                "file_bytes": await upload.read(),
            }
        )

    response, error_type = rank_uploaded_resumes(
        files=file_items,
        jd_text=jd_text,
        strict_upper_bound=strict_upper_bound,
        force_refresh=force_refresh,
        debug=debug,
    )

    if error_type == "jd_parse_error":
        return JSONResponse(status_code=500, content=response)

    return response



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


@router.post("/jobs/{job_id}/parse-jd")
def parse_jd_for_job(job_id: str, payload: JDParseRequest):
    job = get_job(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"detail": "Job not found."})

    jd_text = (payload.job_description or "").strip()
    if not jd_text:
        return JSONResponse(status_code=400, content={"detail": "job_description is required."})

    parsed, raw_output, error, parse_meta = parse_jd_validated(
        jd_text,
        strict_upper_bound=payload.strict_upper_bound,
        force_refresh=payload.force_refresh,
    )
    if error or not parsed:
        return JSONResponse(
            status_code=500,
            content={"detail": error or "JD parse failed.", "validation_errors": parse_meta.get("validation_errors", [])},
        )

    response: dict[str, object] = {"job_id": job_id, "parsed_jd": parsed}
    if payload.debug:
        response["raw_model_output"] = raw_output
        response["parse_meta"] = parse_meta
        response["model_used"] = GEMINI_MODEL

    return response


@router.post("/jobs/{job_id}/process-with-jd")
async def process_with_jd(job_id: str, payload: JDProcessRequest):
    try:
        job = get_job(job_id)
        if not job:
            return JSONResponse(status_code=404, content={"detail": "Job not found."})

        jd_text = (payload.job_description or "").strip()
        if not jd_text:
            return JSONResponse(status_code=400, content={"detail": "job_description is required."})

        queued_files = get_job_queued_files(job_id)
        if not queued_files:
            return JSONResponse(status_code=400, content={"detail": "No uploaded resumes found for this job."})

        parsed, _, parse_error, parse_meta = parse_jd_validated(
            jd_text,
            strict_upper_bound=payload.strict_upper_bound,
            force_refresh=payload.force_refresh,
        )
        if parse_error or not parsed:
            return JSONResponse(
                status_code=500,
                content={"detail": parse_error or "JD parse failed.", "validation_errors": parse_meta.get("validation_errors", [])},
            )

        if payload.title is not None:
            parsed["title"] = payload.title.strip() or None
        if payload.domain is not None:
            parsed["domain"] = payload.domain.strip() or parsed.get("domain")
        if payload.primary_skills:
            parsed["primary_skills"] = _normalize_jd_skills(payload.primary_skills)
        if payload.secondary_skills:
            parsed["secondary_skills"] = _normalize_jd_skills(payload.secondary_skills)
        if payload.min_experience_years is not None:
            parsed["min_experience_years"] = float(payload.min_experience_years)
        if payload.max_experience_years is not None:
            parsed["max_experience_years"] = float(payload.max_experience_years)
        if payload.keywords:
            parsed["keywords"] = [str(k).strip() for k in payload.keywords if str(k).strip()]
        if payload.nice_to_have:
            parsed["nice_to_have"] = _normalize_jd_skills(payload.nice_to_have)
        parsed["strict_upper_bound"] = bool(payload.strict_upper_bound)

        set_job_processing_state(job_id)

        response, error_type = rank_uploaded_resumes_from_parsed(
            files=queued_files,
            jd_text=jd_text,
            jd_parsed=parsed,
            debug=payload.debug,
        )

        if error_type or not response:
            return JSONResponse(status_code=500, content=response or {"detail": "JD processing failed."})

        jd_parsed = response.get("jd_parsed") or {}
        ranked_candidates = response.get("ranked_candidates") or []

        mapped_results = []
        for candidate in ranked_candidates:
            skill_details = candidate.get("skill_details") or []
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
                            "matched_in_sections": detail.get("mentioned_in_sections") or [],
                            "alias_used": bool(detail.get("matched_aliases")),
                            "evidence_count": len(evidence_lines),
                            "matched_tokens": detail.get("matched_aliases") or [],
                        },
                    }
                )

            mapped_results.append(
                {
                    "candidate_id": f"cand_jd_{abs(hash(str(candidate.get('filename') or candidate.get('name') or 'cand')))%100000000:08d}",
                    "name": candidate.get("name") or candidate.get("filename") or "resume",
                    "overall_match_percent": int(candidate.get("score", 0) or 0),
                    "skills": skills,
                    "source_filename": candidate.get("filename"),
                    "jd_breakdown": {
                        "skill_score": candidate.get("skill_score", 0),
                        "experience_score": candidate.get("experience_score", 0),
                        "jd_context_score": candidate.get("jd_context_score", 0),
                        "experience_years_detected": candidate.get("experience_years_detected", 0),
                        "experience_fit": candidate.get("experience_fit"),
                    },
                }
            )

        apply_external_results(
            job_id,
            title=jd_parsed.get("title") or job.get("title") or "",
            primary_skills=list(jd_parsed.get("primary_skills") or []),
            secondary_skills=list(jd_parsed.get("secondary_skills") or []),
            min_match_percent=0,
            results=mapped_results,
            errors=list(response.get("errors") or []),
            total=int(response.get("total_uploaded") or len(queued_files)),
        )

        return {
            "job_id": job_id,
            "status": "completed",
            "jd_parsed": jd_parsed,
            "ranked": len(mapped_results),
            "errors": len(response.get("errors") or []),
        }
    except Exception as exc:
        return JSONResponse(status_code=500, content={"detail": f"JD processing crashed: {exc.__class__.__name__}: {exc}"})


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


@router.get("/jobs/debug/ids")
def get_job_ids_debug():
    return {"job_ids": list_job_ids()}


@router.get("/jobs/debug/stats")
def get_job_stats_debug():
    return job_store_stats()


JD_PARSE_TEST_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JD Resume Rank Test</title>
    <style>
      :root {
        --bg: #f3f6fb;
        --card: #ffffff;
        --muted: #64748b;
        --text: #0f172a;
        --border: #dbe3ef;
        --primary: #1f4b99;
        --primary-soft: #e8efff;
        --good: #0f766e;
        --warn: #b45309;
        --bad: #b91c1c;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: var(--bg); color: var(--text); }
      .wrap { max-width: 1180px; margin: 24px auto; padding: 0 14px; }
      .layout { display: grid; grid-template-columns: 360px 1fr; gap: 14px; }
      .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 14px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06); }
      h1 { margin: 0 0 8px; font-size: 22px; }
      h2 { margin: 0 0 8px; font-size: 16px; }
      p { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
      label { display: block; font-size: 12px; color: #475569; margin-bottom: 6px; }
      textarea { width: 100%; min-height: 180px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; }
      input[type="file"] { width: 100%; }
      .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
      .btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      button { border: none; background: var(--primary); color: #fff; border-radius: 8px; padding: 10px 12px; font-weight: 600; cursor: pointer; }
      button.secondary { background: var(--good); }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      .hint { font-size: 12px; color: var(--muted); }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .chip { background: var(--primary-soft); color: var(--primary); border: 1px solid #d7e3ff; border-radius: 999px; padding: 4px 8px; font-size: 11px; }
      .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; margin: 10px 0; }
      .summary-item { border: 1px solid var(--border); border-radius: 10px; padding: 10px; background: #f8fafc; }
      .summary-item .k { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
      .summary-item .v { font-size: 18px; font-weight: 700; margin-top: 3px; }
      .results { display: grid; gap: 10px; margin-top: 10px; }
      .candidate { border: 1px solid var(--border); border-radius: 12px; padding: 10px; background: #fbfdff; cursor: pointer; }
      .candidate:hover { border-color: #bfd0ef; }
      .candidate-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
      .candidate-name { font-weight: 700; }
      .candidate-score { font-size: 18px; font-weight: 700; color: var(--primary); }
      .meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
      .score-row { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; margin-top: 9px; }
      .score-box { border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: #fff; }
      .score-box .k { font-size: 11px; color: var(--muted); }
      .score-box .v { font-weight: 700; margin-top: 3px; }
      .tag { display: inline-block; margin-top: 6px; font-size: 11px; border-radius: 999px; padding: 3px 8px; }
      .fit-in { background: #e6f8f1; color: #0f766e; }
      .fit-below { background: #fff5e6; color: #b45309; }
      .fit-above { background: #fdecec; color: #b91c1c; }
      .details { margin-top: 10px; border-top: 1px dashed #dbe3ef; padding-top: 10px; display: none; }
      .details.active { display: block; }
      .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
      .detail-card { border: 1px solid var(--border); border-radius: 10px; padding: 8px; background: #fff; }
      .detail-title { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
      .skill-list { display: grid; gap: 8px; max-height: 280px; overflow: auto; }
      .skill-item { border: 1px solid #e6ebf5; border-radius: 8px; padding: 8px; font-size: 12px; background: #fafcff; }
      .skill-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
      .skill-meta { color: var(--muted); margin-bottom: 4px; }
      .skill-evidence { border-left: 2px solid #dbe7ff; padding-left: 8px; margin: 4px 0; color: #0f172a; }
      .ev-sec { color: #1d4ed8; font-weight: 600; text-transform: capitalize; }
      pre { margin-top: 10px; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 10px; max-height: 260px; overflow: auto; }
      @media (max-width: 980px) {
        .layout { grid-template-columns: 1fr; }
        .summary-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
        .detail-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>JD Resume Rank Test</h1>
      <p>Parse JD, rank resumes, and inspect section-wise scores, fitting, and relevancy.</p>

      <div class="layout">
        <div class="card">
          <h2>Inputs</h2>
          <label for="jd">Job Description</label>
          <textarea id="jd" placeholder="Paste full JD here"></textarea>

          <div class="row">
            <label><input id="strict" type="checkbox" /> Strict upper bound</label>
            <label><input id="refresh" type="checkbox" /> Force refresh (skip cache)</label>
            <label><input id="debug" type="checkbox" checked /> Include debug</label>
          </div>

          <label for="files">Resumes (PDF/DOCX)</label>
          <input id="files" type="file" multiple accept=".pdf,.docx" />
          <div class="hint">Uploads are used only for this test request.</div>

          <div class="btns">
            <button id="parseBtn">Parse JD</button>
            <button id="rankBtn" class="secondary">Parse + Rank</button>
          </div>

          <pre id="raw">{}</pre>
        </div>

        <div class="card">
          <h2>Analysis</h2>

          <div id="jdSummary" class="detail-card" style="display:none; margin-bottom:10px;"></div>

          <div id="metrics" class="summary-grid" style="display:none;"></div>

          <div id="results" class="results"></div>
        </div>
      </div>
    </div>

    <script>
      const parseBtn = document.getElementById("parseBtn");
      const rankBtn = document.getElementById("rankBtn");
      const raw = document.getElementById("raw");
      const jdSummary = document.getElementById("jdSummary");
      const metrics = document.getElementById("metrics");
      const results = document.getElementById("results");

      function fitClass(value) {
        if (value === "in_range" || value === "no_requirement") return "fit-in";
        if (value === "below_range") return "fit-below";
        return "fit-above";
      }

      function relevancyLabel(score) {
        if (score >= 80) return "High";
        if (score >= 60) return "Medium";
        return "Low";
      }

      function scoreQuality(score) {
        if (score >= 80) return "Strong";
        if (score >= 60) return "Moderate";
        return "Weak";
      }

      function renderJDSummary(jd) {
        jdSummary.style.display = "block";
        const chips = (arr) => (arr && arr.length)
          ? `<div class="chips">${arr.map(s => `<span class="chip">${s}</span>`).join("")}</div>`
          : `<div class="hint">None</div>`;

        jdSummary.innerHTML = `
          <div class="detail-title">Parsed JD</div>
          <div><b>Title:</b> ${jd.title || "-"}</div>
          <div><b>Domain:</b> ${jd.domain || "-"} <span class="hint">(${jd.domain_source || "-"})</span></div>
          <div><b>Experience Range:</b> ${jd.min_experience_years ?? "-"} to ${jd.max_experience_years ?? "-"}</div>
          <div><b>Primary Skills</b></div>
          ${chips(jd.primary_skills || [])}
          <div style="margin-top:6px;"><b>Secondary Skills</b></div>
          ${chips(jd.secondary_skills || [])}
        `;
      }

      function renderMetrics(data) {
        metrics.style.display = "grid";
        metrics.innerHTML = `
          <div class="summary-item"><div class="k">Uploaded</div><div class="v">${data.total_uploaded || 0}</div></div>
          <div class="summary-item"><div class="k">Ranked</div><div class="v">${data.total_ranked || 0}</div></div>
          <div class="summary-item"><div class="k">Errors</div><div class="v">${(data.errors || []).length}</div></div>
          <div class="summary-item"><div class="k">JD Confidence</div><div class="v">${data.jd_parsed?.confidence ?? 0}%</div></div>
        `;
      }

      function renderResults(data) {
        results.innerHTML = "";
        const list = data.ranked_candidates || [];
        if (!list.length) {
          results.innerHTML = `<div class="hint">No ranked candidates yet.</div>`;
          return;
        }

        list.forEach((c, idx) => {
          const card = document.createElement("div");
          card.className = "candidate";

          const skillRel = relevancyLabel(c.skill_score || 0);
          const ctxRel = relevancyLabel(c.jd_context_score || 0);
          const expFit = c.experience_fit || "no_requirement";
          const expTag = `<span class="tag ${fitClass(expFit)}">${expFit.replace("_", " ")}</span>`;

          card.innerHTML = `
            <div class="candidate-head">
              <div>
                <div class="candidate-name">#${idx + 1} ${c.name || c.filename}</div>
                <div class="meta">${c.filename || "resume"}</div>
              </div>
              <div class="candidate-score">${c.score}%</div>
            </div>
            <div class="score-row">
              <div class="score-box"><div class="k">Skill Score</div><div class="v">${c.skill_score}% (${scoreQuality(c.skill_score)})</div><div class="hint">Relevancy: ${skillRel}</div></div>
              <div class="score-box"><div class="k">Experience</div><div class="v">${c.experience_score}%</div><div class="hint">Detected: ${c.experience_years_detected ?? 0} years</div>${expTag}</div>
              <div class="score-box"><div class="k">JD Context</div><div class="v">${c.jd_context_score}% (${scoreQuality(c.jd_context_score)})</div><div class="hint">Relevancy: ${ctxRel}</div></div>
            </div>
            <div class="details">
              <div class="detail-grid">
                <div class="detail-card">
                  <div class="detail-title">Component Weights</div>
                  <div>Skills: 60%</div>
                  <div>Experience: 30%</div>
                  <div>JD Context: 10%</div>
                </div>
                <div class="detail-card">
                  <div class="detail-title">Fit Summary</div>
                  <div>Skill relevancy: <b>${skillRel}</b></div>
                  <div>Experience fit: <b>${expFit.replace("_", " ")}</b></div>
                  <div>JD context relevancy: <b>${ctxRel}</b></div>
                </div>
              </div>
              ${Array.isArray(c.skill_details) ? `
                <div style="margin-top:10px;" class="detail-card">
                  <div class="detail-title">Per-skill Details</div>
                  <div class="skill-list">
                    ${c.skill_details.map(s => {
                      const sections = Array.isArray(s.mentioned_in_sections) && s.mentioned_in_sections.length
                        ? s.mentioned_in_sections.join(", ")
                        : "none";
                      const evidenceHtml = Array.isArray(s.evidence) && s.evidence.length
                        ? s.evidence.map(e => `<div class="skill-evidence"><span class="ev-sec">${e.section || "section"}</span>: ${e.text || ""}</div>`).join("")
                        : `<div class="hint">No evidence lines captured.</div>`;
                      return `<div class="skill-item">
                        <div class="skill-head"><b>${s.skill}</b><span>${s.score}%</span></div>
                        <div class="skill-meta">Base ${s.base}, bonus ${s.bonus}, mentions ${s.mentions}, sections: ${sections}</div>
                        ${evidenceHtml}
                      </div>`;
                    }).join("")}
                  </div>
                </div>
              ` : ""}
            </div>
          `;

          card.addEventListener("click", () => {
            const d = card.querySelector(".details");
            if (d) d.classList.toggle("active");
          });

          results.appendChild(card);
        });
      }

      async function parseJDOnly() {
        const jd = document.getElementById("jd").value || "";
        const debug = document.getElementById("debug").checked;
        const strict = document.getElementById("strict").checked;
        const forceRefresh = document.getElementById("refresh").checked;
        if (!jd.trim()) {
          raw.textContent = "Please paste a job description.";
          return;
        }

        parseBtn.disabled = true;
        raw.textContent = "Parsing JD...";
        try {
          const res = await fetch("/api/ta/test/jd-parse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_description: jd, strict_upper_bound: strict, force_refresh: forceRefresh, debug })
          });
          const data = await res.json();
          raw.textContent = JSON.stringify(data, null, 2);
          if (res.ok) {
            renderJDSummary(data);
            results.innerHTML = "";
            metrics.style.display = "none";
          }
        } catch (err) {
          raw.textContent = String(err);
        } finally {
          parseBtn.disabled = false;
        }
      }

      async function parseAndRank() {
        const files = document.getElementById("files").files;
        const jd = document.getElementById("jd").value || "";
        const debug = document.getElementById("debug").checked;
        const strict = document.getElementById("strict").checked;
        const forceRefresh = document.getElementById("refresh").checked;

        if (!jd.trim()) {
          raw.textContent = "Please paste a job description.";
          return;
        }
        if (!files || files.length === 0) {
          raw.textContent = "Please choose one or more resumes.";
          return;
        }

        rankBtn.disabled = true;
        raw.textContent = "Ranking resumes...";

        try {
          const fd = new FormData();
          for (const file of files) fd.append("files", file);
          fd.append("job_description", jd);
          fd.append("strict_upper_bound", strict ? "true" : "false");
          fd.append("force_refresh", forceRefresh ? "true" : "false");
          fd.append("debug", debug ? "true" : "false");

          const res = await fetch("/api/ta/test/jd-rank-from-jd", {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          raw.textContent = JSON.stringify(data, null, 2);

          if (res.ok) {
            renderJDSummary(data.jd_parsed || {});
            renderMetrics(data);
            renderResults(data);
          }
        } catch (err) {
          raw.textContent = String(err);
        } finally {
          rankBtn.disabled = false;
        }
      }

      parseBtn.addEventListener("click", parseJDOnly);
      rankBtn.addEventListener("click", parseAndRank);
    </script>
  </body>
</html>
"""

@router.get("/test/jd-parse-ui", response_class=HTMLResponse)
def jd_parse_test_ui():
    return HTMLResponse(JD_PARSE_TEST_HTML)


JD_RANK_TEST_HTML = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JD Rank From JD Test</title>
    <style>
      body { font-family: "Segoe UI", Arial, sans-serif; background: #f4f6fb; color: #0f172a; margin: 0; }
      .wrap { max-width: 980px; margin: 28px auto; padding: 0 16px; }
      .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; box-shadow: 0 10px 24px rgba(15,23,42,.08); }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0 0 12px; color: #64748b; }
      label { display: block; font-size: 12px; color: #475569; margin-bottom: 6px; }
      textarea, input[type="file"] { width: 100%; box-sizing: border-box; }
      textarea { min-height: 160px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; }
      .row { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
      button { border: none; background: #1f4b99; color: #fff; padding: 10px 14px; border-radius: 8px; font-weight: 600; cursor: pointer; }
      button:disabled { opacity: .6; cursor: not-allowed; }
      pre { margin-top: 12px; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 12px; max-height: 560px; overflow: auto; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>JD Rank From JD Test UI</h1>
        <p>Paste JD, upload resumes, and run JD-aware ranking.</p>

        <label for="jd">Job Description</label>
        <textarea id="jd" placeholder="Paste full job description here"></textarea>

        <div class="row">
          <label><input id="strict" type="checkbox" /> Strict upper bound</label>
          <label><input id="debug" type="checkbox" /> Include debug</label>
        </div>

        <div style="margin-top:10px;">
          <label for="files">Resumes (PDF/DOCX)</label>
          <input id="files" type="file" multiple accept=".pdf,.docx" />
        </div>

        <div style="margin-top:12px;">
          <button id="run">Run JD Rank Test</button>
        </div>

        <pre id="out">{}</pre>
      </div>
    </div>

    <script>
      const runBtn = document.getElementById("run");
      const out = document.getElementById("out");

      runBtn.addEventListener("click", async () => {
        const jd = document.getElementById("jd").value || "";
        const strict = document.getElementById("strict").checked;
        const debug = document.getElementById("debug").checked;
        const files = document.getElementById("files").files;

        if (!jd.trim()) {
          out.textContent = "Please paste a job description.";
          return;
        }
        if (!files || files.length === 0) {
          out.textContent = "Please upload one or more resumes.";
          return;
        }

        runBtn.disabled = true;
        out.textContent = "Running JD ranking...";

        try {
          const fd = new FormData();
          fd.append("job_description", jd);
          fd.append("strict_upper_bound", strict ? "true" : "false");
          fd.append("force_refresh", forceRefresh ? "true" : "false");
          fd.append("debug", debug ? "true" : "false");
          for (const f of files) fd.append("files", f);

          const res = await fetch("/api/ta/test/jd-rank-from-jd", {
            method: "POST",
            body: fd,
          });
          const data = await res.json();
          out.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
          out.textContent = String(err);
        } finally {
          runBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>
"""


@router.get("/test/jd-rank-from-jd-ui", response_class=HTMLResponse)
def jd_rank_from_jd_test_ui():
    return HTMLResponse(JD_RANK_TEST_HTML)
