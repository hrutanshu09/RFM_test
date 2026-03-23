from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import re
import threading
from typing import Any, Optional
import uuid

from services.resume_parser import extract_text_for_resume, parse_resume_bytes

TAXONOMY_PATH = Path(__file__).resolve().parents[1] / "data" / "skills_taxonomy.json"

_JOB_LOCK = threading.Lock()
_JOBS: dict[str, dict[str, Any]] = {}
_TAXONOMY_CACHE: Optional[list[str]] = None

GENERIC_SKILL_LABEL_PATTERNS: tuple[str, ...] = (
    r"^skills?$",
    r"^key\s+skills?$",
    r"^relevant\s+skills?$",
    r"^technical\s+skills?$",
    r"^core\s+skills?$",
    r"^skills\s+summary$",
    r"^competencies$",
)
SECTION_HEADER_PATTERNS: dict[str, tuple[str, ...]] = {
    "skills": (
        r"^skills?$",
        r"^key\s+skills?$",
        r"^relevant\s+skills?$",
        r"^technical\s+skills?$",
        r"^core\s+skills?$",
        r"^skills\s+summary$",
        r"^competencies$",
    ),
    "projects": (
        r"^projects?$",
        r"^key\s+projects?$",
        r"^academic\s+projects?$",
    ),
    "work_experience": (
        r"^work\s+experience$",
        r"^experience$",
        r"^professional\s+experience$",
        r"^internships?$",
    ),
    "education": (
        r"^education$",
        r"^academic\s+background$",
        r"^qualifications?$",
    ),
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_skill(value: str) -> str:
    return "".join(ch for ch in value.lower().strip() if ch.isalnum() or ch in {"+", ".", "#"})


SKILL_ALIASES: dict[str, tuple[str, ...]] = {
    "javascript": ("js", "ecmascript", "java script", "nodejs", "node.js"),
    "typescript": ("ts", "type script"),
    "react": ("reactjs", "react.js", "react js"),
    "angular": ("angularjs", "angular.js", "angular js"),
    "vue": ("vuejs", "vue.js", "vue js"),
    "node.js": ("nodejs", "node js"),
    "java": ("core java", "java se", "javaee", "j2ee"),
    "spring": ("springboot", "spring boot", "spring framework"),
    "python": ("python3", "py", "python django", "python flask"),
    "django": ("django framework",),
    "flask": ("flask framework",),
    "fastapi": ("fast api",),
    "c#": ("csharp", "dotnet c#", ".net c#"),
    ".net": ("dotnet", ".net core", "asp.net", "aspnet", "dot net"),
    "c++": ("cpp", "c plus plus"),
    "ruby": ("ruby on rails", "rails"),
    "php": ("laravel", "symfony"),
    "kotlin": ("kot",),
    "swift": ("swiftui",),
    "sql": ("structured query language", "mysql sql", "postgres sql"),
    "postgresql": ("postgres", "psql"),
    "mysql": ("my sql",),
    "mongodb": ("mongo", "mongo db"),
    "redis": ("redis cache",),
    "elasticsearch": ("elastic search", "elk"),
    "aws": ("amazon web services", "ec2", "s3", "lambda"),
    "azure": ("microsoft azure",),
    "gcp": ("google cloud", "google cloud platform"),
    "docker": ("docker container", "containerization"),
    "kubernetes": ("k8s", "kube"),
    "terraform": ("tf",),
    "ansible": ("ansible automation",),
    "jenkins": ("jenkins ci",),
    "github actions": ("gha", "githubactions"),
    "ci/cd": ("cicd", "ci cd", "continuous integration", "continuous delivery"),
    "linux": ("ubuntu", "debian", "centos", "redhat"),
    "git": ("github", "gitlab", "bitbucket", "version control"),
    "rest": ("rest api", "restful", "restful api"),
    "graphql": ("graph ql",),
    "html": ("html5",),
    "css": ("css3", "sass", "scss"),
    "redux": ("redux toolkit", "rtk"),
    "jest": ("jestjs",),
    "pytest": ("py test",),
    "nlp": ("natural language processing", "nltk", "spacy"),
    "pandas": ("pd", "panda"),
    "numpy": ("np",),
    "scikit-learn": ("sklearn", "scikit learn"),
    "tensorflow": ("tf keras", "tensorflow keras"),
    "pytorch": ("torch",),
    "opencv": ("open cv",),
    "power bi": ("powerbi",),
    "tableau": ("tableau desktop",),
    "agile": ("scrum", "kanban", "jira agile"),
    "jira": ("atlassian jira",),
    "nmap": ("network mapper",),
    "metasploit": ("metasploit framework",),
    "wireshark": ("wire shark",),
    "burp suite": ("burpsuite", "burp"),
    "kali linux": ("kali",),
    "jupyter notebook": ("jupyter", "ipynb"),
    "lightgbm": ("lgbm",),
}


def _build_alias_maps() -> tuple[dict[str, str], dict[str, set[str]]]:
    alias_lookup: dict[str, str] = {}
    canonical_variants: dict[str, set[str]] = {}

    for canonical, variants in SKILL_ALIASES.items():
        canonical_norm = _normalize_skill(canonical)
        if not canonical_norm:
            continue
        variant_set = {canonical_norm}
        for variant in variants:
            normalized_variant = _normalize_skill(variant)
            if normalized_variant:
                variant_set.add(normalized_variant)
        canonical_variants[canonical_norm] = variant_set
        for variant in variant_set:
            alias_lookup[variant] = canonical_norm

    return alias_lookup, canonical_variants


_SKILL_ALIAS_LOOKUP, _SKILL_CANONICAL_VARIANTS = _build_alias_maps()


def _canonicalize_skill(value: str) -> str:
    normalized = _normalize_skill(value)
    return _SKILL_ALIAS_LOOKUP.get(normalized, normalized)


def _skill_variants(canonical_skill: str) -> set[str]:
    return _SKILL_CANONICAL_VARIANTS.get(canonical_skill, {canonical_skill})


def _line_ngrams(line: str, max_terms: int = 4) -> set[str]:
    tokens = [
        _normalize_skill(token)
        for token in re.findall(r"[A-Za-z0-9+#.]+", line)
        if _normalize_skill(token)
    ]
    ngrams: set[str] = set()
    for i in range(len(tokens)):
        joined = ""
        for width in range(1, max_terms + 1):
            j = i + width
            if j > len(tokens):
                break
            joined += tokens[j - 1]
            ngrams.add(joined)
    return ngrams


def _matched_variants_in_line(line: str, canonical_skill: str) -> list[str]:
    variants = _skill_variants(canonical_skill)
    ngrams = _line_ngrams(line)
    matched = [variant for variant in variants if variant in ngrams]
    matched.sort(key=len, reverse=True)
    return matched


def _segment_matches_skill(line: str, canonical_skill: str) -> bool:
    return len(_matched_variants_in_line(line, canonical_skill)) > 0

def _detect_section_header(line: str) -> Optional[str]:
    cleaned = re.sub(r"\s+", " ", line.strip().lower()).rstrip(":")
    if not cleaned:
        return None

    for section, patterns in SECTION_HEADER_PATTERNS.items():
        for pattern in patterns:
            if re.match(pattern, cleaned, flags=re.IGNORECASE):
                return section
    return None


def _is_generic_skill_label(value: str) -> bool:
    cleaned = re.sub(r"\s+", " ", value.strip().lower()).rstrip(":")
    if not cleaned:
        return True
    for pattern in GENERIC_SKILL_LABEL_PATTERNS:
        if re.match(pattern, cleaned, flags=re.IGNORECASE):
            return True
    return False


def _stringify_bucket_value(value: Any) -> str:
    if isinstance(value, dict):
        name = str(value.get("name") or "").strip()
        summary = str(value.get("summary") or "").strip()
        tech_stack = value.get("tech_stack")
        tech_text = ""
        if isinstance(tech_stack, list):
            tech_items = [str(item).strip() for item in tech_stack if str(item).strip()]
            if tech_items:
                tech_text = ", ".join(tech_items)
        elif tech_stack:
            tech_text = str(tech_stack).strip()

        parts: list[str] = []
        if name:
            parts.append(name)
        if summary:
            parts.append(summary)
        if tech_text:
            parts.append(f"Tech Stack: {tech_text}")
        return " - ".join(parts).strip()

    return str(value).strip()


def _evidence_fingerprint(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9+#.]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _is_duplicate_evidence(candidate: str, seen: set[str]) -> bool:
    fp = _evidence_fingerprint(candidate)
    if not fp:
        return True
    if fp in seen:
        return True
    # Treat contained snippets as duplicates of an already counted line.
    for existing in seen:
        if fp in existing or existing in fp:
            return True
    return False


def load_taxonomy() -> list[str]:
    global _TAXONOMY_CACHE
    if _TAXONOMY_CACHE is not None:
        return _TAXONOMY_CACHE
    try:
        payload = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
        skills = payload.get("skills", [])
        if not isinstance(skills, list):
            skills = []
        _TAXONOMY_CACHE = [str(skill) for skill in skills if str(skill).strip()]
        return _TAXONOMY_CACHE
    except Exception:
        _TAXONOMY_CACHE = []
        return _TAXONOMY_CACHE


def create_job(
    title: Optional[str],
    primary_skills: list[str],
    secondary_skills: list[str],
    min_match_percent: int,
) -> dict[str, Any]:
    job_id = f"job_{uuid.uuid4().hex[:10]}"
    job = {
        "job_id": job_id,
        "title": title or "",
        "primary_skills": primary_skills,
        "secondary_skills": secondary_skills,
        "min_match_percent": min_match_percent,
        "status": "created",
        "created_at": _now_iso(),
        "uploaded": 0,
        "processed": 0,
        "total": 0,
        "errors": [],
        "results": [],
        "queued_files": [],
    }
    with _JOB_LOCK:
        _JOBS[job_id] = job
    return job


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else None


def _update_job(job_id: str, **updates: Any) -> None:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        job.update(updates)


def _append_job_result(job_id: str, result: dict[str, Any]) -> None:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        job["results"].append(result)


def _append_job_error(job_id: str, error: dict[str, Any]) -> None:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        job["errors"].append(error)


def _increment_processed(job_id: str) -> None:
    with _JOB_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        job["processed"] += 1


def _extract_section_buckets(parsed: dict[str, Any]) -> dict[str, list[str]]:
    buckets: dict[str, list[str]] = {
        "skills": [],
        "skills_raw_section": [],
        "projects": [],
        "projects_raw_section": [],
        "work_experience": [],
        "work_experience_raw_section": [],
        "education": [],
        "education_raw_section": [],
    }

    for key in ("skills", "projects", "work_experience", "education"):
        values = parsed.get(key) or []
        if isinstance(values, list):
            for value in values:
                if value is None:
                    continue
                text = _stringify_bucket_value(value)
                if not text:
                    continue
                if key == "skills" and _is_generic_skill_label(text):
                    continue
                buckets[key].append(text)
        elif values:
            text = _stringify_bucket_value(values)
            if not text:
                continue
            if key == "skills" and _is_generic_skill_label(text):
                continue
            buckets[key].append(text)

    raw_text_source = str(
        parsed.get("_ta_raw_text")
        or parsed.get("raw_text_for_scoring")
        or parsed.get("raw_text_preview")
        or ""
    )
    if raw_text_source:
        active_section: Optional[str] = None
        for raw_line in raw_text_source.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            if ":" in line:
                left, right = line.split(":", 1)
                inline_section = _detect_section_header(left)
                if inline_section:
                    active_section = inline_section
                    inline_payload = right.strip()
                    if inline_payload:
                        if active_section != "skills" or not _is_generic_skill_label(inline_payload):
                            buckets[active_section].append(inline_payload)
                    continue

            section = _detect_section_header(line)
            if section:
                active_section = section
                continue

            if not active_section:
                continue
            if len(line) < 2:
                continue
            if active_section == "skills" and _is_generic_skill_label(line):
                continue

            buckets[active_section].append(line)
            if active_section == "skills":
                buckets["skills_raw_section"].append(line)
            elif active_section in {"projects", "work_experience", "education"}:
                buckets[f"{active_section}_raw_section"].append(line)

    return buckets

def _score_skill(skill: str, parsed: dict[str, Any]) -> tuple[int, list[str], dict[str, Any]]:
    normalized_skill = _canonicalize_skill(skill)
    if not normalized_skill:
        return 0, [], {
            "base": 0,
            "occurrence_bonus": 0,
            "matched_in_sections": [],
            "alias_used": False,
            "evidence_count": 0,
            "matched_tokens": [],
        }

    buckets = _extract_section_buckets(parsed)
    matched_sections: list[str] = []
    evidence: list[str] = []
    occurrences = 0
    matched_tokens: set[str] = set()

    seen_evidence: set[str] = set()

    for section in ("projects", "work_experience", "education"):
        raw_key = f"{section}_raw_section"
        raw_lines = buckets.get(raw_key, [])
        section_lines = raw_lines if raw_lines else buckets.get(section, [])

        section_matched = False
        for line in section_lines:
            matches = _matched_variants_in_line(line, normalized_skill)
            if not matches:
                continue

            if _is_duplicate_evidence(line, seen_evidence):
                continue

            fingerprint = _evidence_fingerprint(line)
            if fingerprint:
                seen_evidence.add(fingerprint)

            occurrences += 1
            section_matched = True
            matched_tokens.update(matches)
            if len(evidence) < 3:
                evidence.append(line)

        if section_matched:
            matched_sections.append(section)

    # Strict check: only raw text captured under a skills header qualifies for base=70.
    # Do not use parsed["skills"] here, because LLM parsing can infer skills from projects/experience.
    skills_section_match = False
    for line in buckets.get("skills_raw_section", []):
        matches = _matched_variants_in_line(line, normalized_skill)
        if not matches:
            continue
        skills_section_match = True
        matched_tokens.update(matches)
        break

    if skills_section_match:
        matched_sections.insert(0, "skills")

    if skills_section_match:
        base = 70
    elif occurrences > 0:
        base = 50
    else:
        base = 0

    occurrence_bonus = occurrences * 5

    if base == 70 and not evidence:
        evidence = ["Skill is mentioned in the resume skills section."]

    score = min(95, base + occurrence_bonus)

    debug = {
        "base": base,
        "occurrence_bonus": occurrence_bonus,
        "matched_in_sections": matched_sections,
        "alias_used": _normalize_skill(skill) != normalized_skill,
        "evidence_count": len(evidence),
        "matched_tokens": sorted(matched_tokens),
    }

    return score, evidence, debug

def _overall_score(primary_scores: list[int], secondary_scores: list[int]) -> int:
    primary_weight = 1.0
    secondary_weight = 0.5
    total_weight = 0.0
    weighted_sum = 0.0

    if primary_scores:
        weighted_sum += sum(primary_scores) * primary_weight
        total_weight += len(primary_scores) * primary_weight
    if secondary_scores:
        weighted_sum += sum(secondary_scores) * secondary_weight
        total_weight += len(secondary_scores) * secondary_weight

    if total_weight == 0:
        return 0

    return int(round(weighted_sum / total_weight))


def set_job_skills(
    job_id: str,
    title: Optional[str],
    primary_skills: list[str],
    secondary_skills: list[str],
    min_match_percent: int,
) -> None:
    updates = {
        "primary_skills": primary_skills,
        "secondary_skills": secondary_skills,
        "min_match_percent": min_match_percent,
    }
    if title is not None:
        updates["title"] = title
    _update_job(job_id, **updates)


def queue_files(job_id: str, files: list[dict[str, Any]]) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        return {}

    total = job.get("total", 0) + len(files)
    uploaded = job.get("uploaded", 0) + len(files)

    queued_files = list(job.get("queued_files", []))
    queued_files.extend(files)

    _update_job(
        job_id,
        status="uploaded",
        total=total,
        uploaded=uploaded,
        queued_files=queued_files,
    )
    return get_job(job_id) or {}


def process_job(job_id: str, files: Optional[list[dict[str, Any]]] = None) -> None:
    job = get_job(job_id)
    if not job:
        return

    if files is None:
        files = list(job.get("queued_files", []))

    _update_job(
        job_id,
        status="processing",
        processed=0,
        results=[],
        errors=[],
    )

    primary_skills = job.get("primary_skills", []) or []
    secondary_skills = job.get("secondary_skills", []) or []
    min_match_percent = int(job.get("min_match_percent", 0) or 0)

    if not files:
        _update_job(job_id, status="completed")
        return

    for item in files:
        filename = item.get("filename") or "resume"
        content_type = item.get("content_type") or ""
        file_bytes = item.get("file_bytes") or b""

        payload, error, _ = parse_resume_bytes(file_bytes, content_type)
        if error or not payload:
            _append_job_error(
                job_id,
                {
                    "filename": filename,
                    "error": error or "Parse failed",
                },
            )
            _increment_processed(job_id)
            continue

        raw_text, _, _ = extract_text_for_resume(file_bytes, content_type)
        if raw_text:
            payload["_ta_raw_text"] = raw_text

        buckets = _extract_section_buckets(payload)

        primary_scores = []
        secondary_scores = []
        skill_results = []

        for skill in primary_skills:
            score, evidence, debug = _score_skill(skill, payload)
            primary_scores.append(score)
            skill_results.append(
                {
                    "skill": skill,
                    "percent": score,
                    "evidence": evidence,
                    "is_primary": True,
                    "debug": debug,
                    "debug_buckets": {
                        "skills": buckets.get("skills", []),
                        "projects": buckets.get("projects", []),
                        "work_experience": buckets.get("work_experience", []),
                        "education": buckets.get("education", []),
                    },
                }
            )

        for skill in secondary_skills:
            score, evidence, debug = _score_skill(skill, payload)
            secondary_scores.append(score)
            skill_results.append(
                {
                    "skill": skill,
                    "percent": score,
                    "evidence": evidence,
                    "is_primary": False,
                    "debug": debug,
                    "debug_buckets": {
                        "skills": buckets.get("skills", []),
                        "projects": buckets.get("projects", []),
                        "work_experience": buckets.get("work_experience", []),
                        "education": buckets.get("education", []),
                    },
                }
            )

        overall = _overall_score(primary_scores, secondary_scores)
        if overall < min_match_percent:
            _increment_processed(job_id)
            continue

        candidate = {
            "candidate_id": f"cand_{uuid.uuid4().hex[:8]}",
            "name": payload.get("name") or filename,
            "overall_match_percent": overall,
            "skills": skill_results,
            "source_filename": filename,
        }

        _append_job_result(job_id, candidate)
        _increment_processed(job_id)

    final_job = get_job(job_id)
    if not final_job:
        return

    results = final_job.get("results", [])
    results.sort(key=lambda item: item.get("overall_match_percent", 0), reverse=True)
    _update_job(job_id, status="completed", results=results, queued_files=[])




















