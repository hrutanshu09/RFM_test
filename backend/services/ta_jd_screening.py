from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from datetime import datetime
from typing import Any, Optional

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - optional dependency at runtime
    genai = None

from services.resume_parser import extract_text_for_resume, parse_resume_bytes
from services.ta_resume_screening import load_taxonomy

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
    "jest": tuple(),
    "cypress": tuple(),
    "selenium": tuple(),
    "pytest": tuple(),
    "junit": tuple(),
    "postman": tuple(),
    "react native": ("react-native",),
    "flutter": tuple(),
    "android": tuple(),
    "ios": tuple(),
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


# Expanded aliases for better recall across resume formats and naming variants.
SKILL_ALIASES_TEST.update({
    "pyspark": ("py spark", "spark with python", "spark-python"),
    "spark": ("apache spark", "spark core", "spark framework", "spark sql"),
    "hadoop": ("apache hadoop", "hdfs", "mapreduce", "hadoop ecosystem"),
    "hive": ("apache hive", "hiveql"),
    "airflow": ("apache airflow",),
    "dbt": ("data build tool",),
    "snowflake": ("snowflake db", "snowflake data warehouse"),
    "redshift": ("amazon redshift",),
    "bigquery": ("google bigquery", "bq"),
    "databricks": ("databricks lakehouse",),
    "kafka": ("apache kafka",),
    "flink": ("apache flink",),
    "sqoop": ("apache sqoop",),
    "oozie": ("apache oozie",),
    "informatica": ("informatica powercenter",),
    "talend": ("talend etl",),
    "ssis": ("sql server integration services",),
    "etl": ("etl process", "etl processes", "extract transform load"),
    "elt": ("elt process", "extract load transform"),
    "data pipeline": ("data pipelines", "pipeline", "pipelines"),
    "data warehousing": ("data warehouse", "dwh", "dw"),
    "data modeling": ("data model", "dimensional modeling", "star schema", "snowflake schema"),
    "data architecture": ("data architect", "data design architecture"),
    "orchestration": ("workflow orchestration", "orchestration tools"),
    "mlops": ("ml ops",),
    "devops": ("dev ops",),
    "bash": ("shell scripting", "shell script", "bash scripting", "sh"),
    "unix": ("linux unix",),
    "powershell": ("power shell",),
    "scala": ("scala language",),
    "r": ("r language",),
    "go": ("golang",),
    "rust": tuple(),
    "perl": tuple(),
    "sas": tuple(),
    "numpy": ("np",),
    "pandas": ("pd",),
    "matplotlib": tuple(),
    "seaborn": tuple(),
    "plotly": tuple(),
    "scipy": tuple(),
    "xgboost": tuple(),
    "catboost": tuple(),
    "keras": tuple(),
    "transformers": ("huggingface transformers", "hf transformers"),
    "llm": ("large language model", "large language models", "genai", "generative ai"),
    "langchain": tuple(),
    "openai": ("openai api",),
    "azure openai": ("azure openai service",),
    "rag": ("retrieval augmented generation",),
    "vector database": ("vector db", "embedding database"),
    "pinecone": tuple(),
    "weaviate": tuple(),
    "milvus": tuple(),
    "chroma": ("chromadb",),
    "postgresql": ("postgres", "psql", "postgres sql"),
    "mysql": ("my sql",),
    "mssql": ("sql server", "ms sql", "t-sql", "tsql"),
    "oracle": ("oracle db", "pl/sql", "plsql"),
    "mongodb": ("mongo", "mongo db"),
    "cassandra": ("apache cassandra",),
    "dynamodb": ("aws dynamodb",),
    "neo4j": tuple(),
    "elasticsearch": ("elastic search", "elk"),
    "kibana": tuple(),
    "logstash": tuple(),
    "aws": ("amazon web services", "ec2", "s3", "lambda", "glue", "athena", "emr", "rds", "iam", "cloudwatch"),
    "azure": ("microsoft azure", "azure data factory", "adf", "synapse", "datalake", "azure databricks"),
    "gcp": ("google cloud", "google cloud platform", "gcs", "pubsub", "dataflow", "dataproc", "composer"),
    "terraform": ("iac", "infrastructure as code"),
    "docker": ("containerization", "containers"),
    "kubernetes": ("k8s",),
    "helm": tuple(),
    "jenkins": tuple(),
    "github actions": ("gh actions",),
    "gitlab ci": ("gitlab pipeline", "gitlab ci/cd"),
    "ci/cd": ("cicd", "ci cd", "continuous integration", "continuous delivery"),
    "rest": ("rest api", "rest apis", "restful", "restful api"),
    "graphql": ("graph ql",),
    "grpc": tuple(),
    "fastapi": tuple(),
    "flask": tuple(),
    "django": tuple(),
    "spring": ("spring framework",),
    "spring boot": ("springboot",),
    "node.js": ("nodejs", "node js"),
    "react": ("reactjs", "react.js", "react js"),
    "next.js": ("nextjs", "next js"),
    "vue": ("vue.js", "vuejs"),
    "angular": ("angular.js", "angularjs"),
    "javascript": ("js", "ecmascript", "java script"),
    "typescript": ("ts", "type script"),
    "html": ("html5",),
    "css": ("css3", "scss", "sass"),
    "tailwind css": ("tailwind", "tailwindcss"),
    "bootstrap": tuple(),
    "material ui": ("mui",),
    "redux": ("redux toolkit", "rtk"),
    "jest": tuple(),
    "cypress": tuple(),
    "playwright": tuple(),
    "selenium": tuple(),
    "pytest": tuple(),
    "junit": tuple(),
    "postman": tuple(),
    "git": ("git version control",),
    "github": tuple(),
    "jira": tuple(),
    "confluence": tuple(),
    "linux": ("ubuntu", "debian", "centos", "rhel", "redhat"),
    "nmap": tuple(),
    "wireshark": tuple(),
    "metasploit": tuple(),
    "burp suite": ("burpsuite", "burp-suite"),
    "kali linux": ("kali",),
    "owasp": tuple(),
})

JD_PARSE_VERSION = "v1"
_JD_PARSE_CACHE_LOCK = threading.Lock()
_JD_PARSE_CACHE: dict[str, dict[str, object]] = {}

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
        r"^employment\s+history$",
        r"^work\s+history$",
        r"^career\s+history$",
        r"^professional\s+background$",
        r"^internships?$",
    ),
    "education": (
        r"^education$",
        r"^academic\s+background$",
        r"^qualifications?$",
    ),
}


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


def parse_jd_validated(
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
    return bool(re.search(r"\b(intern(?:ship)?|trainee|apprentice|co[-\s]?op)\b", lowered))


def _normalize_entry_key(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _build_work_experience_entries(parsed_resume: dict, raw_text: str) -> list[str]:
    buckets = _extract_section_buckets(parsed_resume, raw_text)
    entries: list[str] = []
    seen: set[str] = set()

    for key in ("work_experience_raw_section", "work_experience"):
        for value in buckets.get(key, []):
            text_value = str(value or "").strip()
            if len(text_value) < 2:
                continue
            norm = _normalize_entry_key(text_value)
            if not norm or norm in seen:
                continue
            seen.add(norm)
            entries.append(text_value)

    return entries


def _looks_like_date_range_line(entry: str) -> bool:
    text = str(entry or "").strip()
    if not text:
        return False
    if _extract_month_ranges(text):
        return True
    return bool(
        re.search(
            r"\b(19\d{2}|20\d{2})\b.*(?:-|to|\u2013|\u2014).*(?:\b(19\d{2}|20\d{2})\b|present|current|now)",
            text,
            flags=re.IGNORECASE,
        )
    )


def _month_number(value: str) -> Optional[int]:
    month = value.strip().lower()[:3]
    mapping = {
        "jan": 1,
        "feb": 2,
        "mar": 3,
        "apr": 4,
        "may": 5,
        "jun": 6,
        "jul": 7,
        "aug": 8,
        "sep": 9,
        "oct": 10,
        "nov": 11,
        "dec": 12,
    }
    return mapping.get(month)


def _month_index(year: int, month: int) -> int:
    return year * 12 + (month - 1)


def _extract_numeric_month_ranges(text: str) -> list[tuple[int, int]]:
    now = datetime.now()
    now_idx = _month_index(now.year, now.month)
    ranges: list[tuple[int, int]] = []
    sep = r"(?:-|\u2013|\u2014|to)"

    # MM/YYYY - MM/YYYY (or present)
    mm_yyyy = re.finditer(
        rf"(?<!\d)(?P<sm>0?[1-9]|1[0-2])[/-](?P<sy>19\d{{2}}|20\d{{2}})\s*{sep}\s*(?:(?P<em>0?[1-9]|1[0-2])[/-](?P<ey>19\d{{2}}|20\d{{2}})|(?P<present>present|current|now))(?!\d)",
        text,
        flags=re.IGNORECASE,
    )
    for m in mm_yyyy:
        sy = int(m.group("sy"))
        sm = int(m.group("sm"))
        if m.group("present"):
            ey, em = now.year, now.month
        else:
            ey = int(m.group("ey"))
            em = int(m.group("em"))
        start_idx = _month_index(sy, sm)
        end_idx = _month_index(ey, em)
        if end_idx >= start_idx:
            ranges.append((start_idx, min(end_idx, now_idx)))

    # YYYY/MM - YYYY/MM (or present)
    yyyy_mm = re.finditer(
        rf"(?<!\d)(?P<sy>19\d{{2}}|20\d{{2}})[/-](?P<sm>0?[1-9]|1[0-2])\s*{sep}\s*(?:(?P<ey>19\d{{2}}|20\d{{2}})[/-](?P<em>0?[1-9]|1[0-2])|(?P<present>present|current|now))(?!\d)",
        text,
        flags=re.IGNORECASE,
    )
    for m in yyyy_mm:
        sy = int(m.group("sy"))
        sm = int(m.group("sm"))
        if m.group("present"):
            ey, em = now.year, now.month
        else:
            ey = int(m.group("ey"))
            em = int(m.group("em"))
        start_idx = _month_index(sy, sm)
        end_idx = _month_index(ey, em)
        if end_idx >= start_idx:
            ranges.append((start_idx, min(end_idx, now_idx)))

    return ranges


def _extract_month_ranges(text: str) -> list[tuple[int, int]]:
    now = datetime.now()
    now_idx = _month_index(now.year, now.month)
    ranges: list[tuple[int, int]] = []

    month_name = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    sep = r"(?:-|\u2013|\u2014|to)"

    month_year_range = re.finditer(
        rf"(?P<sm>{month_name})[\s,./-]+(?P<sy>19\d{{2}}|20\d{{2}})\s*{sep}\s*(?:(?P<em>{month_name})[\s,./-]+(?P<ey>19\d{{2}}|20\d{{2}})|(?P<present>present|current|now))",
        text,
        flags=re.IGNORECASE,
    )
    for match in month_year_range:
        sy = int(match.group("sy"))
        sm = _month_number(match.group("sm") or "") or 1
        if match.group("present"):
            ey, em = now.year, now.month
        else:
            ey = int(match.group("ey"))
            em = _month_number(match.group("em") or "") or 12

        start_idx = _month_index(sy, sm)
        end_idx = _month_index(ey, em)
        if end_idx >= start_idx:
            ranges.append((start_idx, min(end_idx, now_idx)))

    year_range = re.finditer(
        rf"(?<!\d)(?P<sy>19\d{{2}}|20\d{{2}})\s*{sep}\s*(?:(?P<ey>19\d{{2}}|20\d{{2}})|(?P<present>present|current|now))(?!\d)",
        text,
        flags=re.IGNORECASE,
    )
    for match in year_range:
        sy = int(match.group("sy"))
        start_idx = _month_index(sy, 1)
        if match.group("present"):
            end_idx = now_idx
        else:
            ey = int(match.group("ey"))
            end_idx = _month_index(ey, 12)
        if end_idx >= start_idx:
            ranges.append((start_idx, min(end_idx, now_idx)))

    ranges.extend(_extract_numeric_month_ranges(text))

    return ranges


def _merge_month_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not ranges:
        return []

    ordered = sorted(ranges, key=lambda item: item[0])
    merged: list[list[int]] = [[ordered[0][0], ordered[0][1]]]

    for start, end in ordered[1:]:
        prev = merged[-1]
        if start <= prev[1] + 1:
            prev[1] = max(prev[1], end)
        else:
            merged.append([start, end])

    return [(item[0], item[1]) for item in merged]


def _extract_candidate_years(work_entries: list[str]) -> tuple[float, dict[str, Any]]:
    if not work_entries:
        return 0.0, {
            "entries_raw": [],
            "entries_used": [],
            "excluded_as_internship": [],
            "ranges_detected": [],
            "months_total": 0,
            "method": "none",
        }

    raw_entries = [str(item).strip() for item in work_entries if str(item).strip()]
    excluded: list[str] = []
    filtered_entries: list[str] = []
    excluded_indexes: set[int] = set()

    # Exclude internship title lines and adjacent date-range lines so internship
    # periods are not counted via orphan date entries.
    for idx, entry in enumerate(raw_entries):
        if not _looks_like_internship_entry(entry):
            continue
        excluded_indexes.add(idx)
        if idx + 1 < len(raw_entries) and _looks_like_date_range_line(raw_entries[idx + 1]):
            excluded_indexes.add(idx + 1)
        if idx - 1 >= 0 and _looks_like_date_range_line(raw_entries[idx - 1]):
            excluded_indexes.add(idx - 1)

    for idx, entry in enumerate(raw_entries):
        if idx in excluded_indexes:
            excluded.append(entry)
        else:
            filtered_entries.append(entry)

    if not filtered_entries:
        return 0.0, {
            "entries_raw": raw_entries,
            "entries_used": [],
            "excluded_as_internship": excluded,
            "ranges_detected": [],
            "months_total": 0,
            "method": "all_filtered",
        }

    text = "\n".join(filtered_entries)

    explicit = re.findall(r"(\d+(?:\.\d+)?)\s*\+?\s*years?", text, flags=re.IGNORECASE)
    if explicit:
        try:
            years = max(float(v) for v in explicit)
            return years, {
                "entries_raw": raw_entries,
                "entries_used": filtered_entries,
                "excluded_as_internship": excluded,
                "ranges_detected": [],
                "months_total": int(round(years * 12)),
                "method": "explicit_years",
            }
        except Exception:
            pass

    ranges = _extract_month_ranges(text)
    merged = _merge_month_ranges(ranges)
    months_total = 0
    serializable_ranges: list[dict[str, int]] = []
    for start, end in merged:
        months = max(0, end - start + 1)
        months_total += months
        serializable_ranges.append({"start": start, "end": end, "months": months})

    if months_total > 0:
        years = round(months_total / 12.0, 2)
        return years, {
            "entries_raw": raw_entries,
            "entries_used": filtered_entries,
            "excluded_as_internship": excluded,
            "ranges_detected": serializable_ranges,
            "months_total": months_total,
            "method": "date_ranges",
        }

    years = [int(match) for match in re.findall(r"\b(19\d{2}|20\d{2})\b", text)]
    if len(years) >= 2:
        now_year = datetime.now().year
        min_year = min(years)
        max_year = max(years)
        if re.search(r"\b(present|current|now)\b", text, flags=re.IGNORECASE):
            max_year = now_year
        else:
            max_year = min(max_year, now_year)

        years_value = float(max(0, max_year - min_year))
        return years_value, {
            "entries_raw": raw_entries,
            "entries_used": filtered_entries,
            "excluded_as_internship": excluded,
            "ranges_detected": [],
            "months_total": int(round(years_value * 12)),
            "method": "year_fallback",
        }

    return 0.0, {
        "entries_raw": raw_entries,
        "entries_used": filtered_entries,
        "excluded_as_internship": excluded,
        "ranges_detected": [],
        "months_total": 0,
        "method": "no_dates",
    }


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

_ALL_SKILL_VARIANTS: set[str] = set(_SKILL_ALIAS_TO_CANONICAL.keys())


def _contains_any_known_skill(text: str) -> bool:
    tokenized = _tokenize_skill_text(text)
    if not tokenized:
        return False
    for variant in _ALL_SKILL_VARIANTS:
        if _count_phrase_mentions(tokenized, variant) > 0:
            return True
    return False




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
        for key in (
            "name",
            "project_name",
            "title",
            "role",
            "company",
            "summary",
            "brief_summary",
            "description",
            "dates",
        ):
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


def _matched_aliases_in_text(text: str, variants: set[str]) -> set[str]:
    tokens = _tokenize_skill_text(text)
    matched: set[str] = set()
    for variant in variants:
        if _count_phrase_mentions(tokens, variant) > 0:
            matched.add(variant)
    return matched


def _line_matches_variants(line: str, variants: set[str]) -> bool:
    return bool(_matched_aliases_in_text(line, variants))


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


def _looks_like_skill_list_line(line: str) -> bool:
    cleaned = line.strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    if "@" in cleaned or "http://" in lowered or "https://" in lowered:
        return False
    if re.search(r"\+?\d[\d\s().-]{7,}", cleaned):
        return False

    words = re.findall(r"[A-Za-z0-9+#.]+", cleaned)
    if len(words) > 16:
        return False

    has_delimiters = bool(re.search(r"[;|,?/]+", cleaned))
    has_known_skill = _contains_any_known_skill(cleaned)

    if has_delimiters:
        return has_known_skill

    return has_known_skill and len(words) <= 8


def _looks_like_explicit_skill_entry(line: str) -> bool:
    """
    Conservative fallback check when raw skills section is unavailable.
    Prevents long project/experience sentences from being treated as
    explicit skills-list entries.
    """
    cleaned = str(line or "").strip()
    if not cleaned:
        return False
    if _detect_section_header(cleaned) or _is_generic_skill_label(cleaned):
        return False
    if len(cleaned) > 80:
        return False
    if "@" in cleaned or "http://" in cleaned.lower() or "https://" in cleaned.lower():
        return False
    words = re.findall(r"[A-Za-z0-9+#.]+", cleaned)
    if not words or len(words) > 8:
        return False
    # Full sentences usually indicate non-skills content in parsed fallbacks.
    if re.search(r"[.!?]", cleaned) and not re.search(r"[,;|/]", cleaned):
        return False
    return True


def _split_skill_candidates(line: str) -> list[str]:
    pieces = re.split(r"[;|,?/]+", line)
    out: list[str] = []
    for piece in pieces:
        value = re.sub(r"^[\-??*]+", "", piece).strip()
        if not value:
            continue
        if _is_generic_skill_label(value):
            continue
        out.append(value)
    return out


def _extract_skills_window_lines(raw_text: str) -> list[str]:
    lines = [line.strip() for line in str(raw_text or "").splitlines() if line.strip()]
    collected: list[str] = []
    in_skills = False

    for line in lines:
        if ":" in line:
            left, right = line.split(":", 1)
            inline_section = _detect_section_header(left)
            if inline_section == "skills":
                in_skills = True
                payload = right.strip()
                if payload and _looks_like_skill_list_line(payload):
                    chunks = _split_skill_candidates(payload) or [payload]
                    collected.extend(chunks)
                continue

        section = _detect_section_header(line)
        if section:
            in_skills = section == "skills"
            continue

        if not in_skills:
            continue
        if not _looks_like_skill_list_line(line):
            continue

        chunks = _split_skill_candidates(line) or [line]
        collected.extend(chunks)

    deduped: list[str] = []
    seen: set[str] = set()
    for item in collected:
        norm = re.sub(r"\s+", " ", item.strip().lower())
        if not norm or norm in seen:
            continue
        seen.add(norm)
        deduped.append(item.strip())

    return deduped


def _merged_section_lines(buckets: dict[str, list[str]], section: str) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()

    for key in (f"{section}_raw_section", section):
        for value in buckets.get(key, []):
            text_value = str(value or "").strip()
            if not text_value:
                continue
            norm = re.sub(r"\s+", " ", text_value.lower())
            if norm in seen:
                continue
            seen.add(norm)
            merged.append(text_value)

    return merged


def _extract_section_buckets(parsed: dict, raw_text: str) -> dict[str, list[str]]:
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
        if not isinstance(values, list):
            values = [values]

        for value in values:
            text = _entry_to_text(value)
            if not text:
                continue
            if key == "skills" and _is_generic_skill_label(text):
                continue
            buckets[key].append(text)

    text_source = str(raw_text or "")
    if text_source:
        active_section: Optional[str] = None
        for raw_line in text_source.splitlines():
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
                            if active_section != "skills" or _looks_like_skill_list_line(inline_payload):
                                buckets[active_section].append(inline_payload)
                                if active_section == "skills":
                                    buckets["skills_raw_section"].append(inline_payload)
                            elif active_section in {"projects", "work_experience", "education"}:
                                buckets[f"{active_section}_raw_section"].append(inline_payload)
                    continue

            section = _detect_section_header(line)
            if section:
                active_section = section
                continue

            if not active_section or len(line) < 2:
                continue
            if active_section == "skills" and _is_generic_skill_label(line):
                continue
            if active_section == "skills" and not _looks_like_skill_list_line(line):
                continue

            buckets[active_section].append(line)
            if active_section == "skills":
                buckets["skills_raw_section"].append(line)
            elif active_section in {"projects", "work_experience", "education"}:
                buckets[f"{active_section}_raw_section"].append(line)

    # Dedicated skills-window extraction to handle multi-column drift and compact delimiter formats.
    for skill_line in _extract_skills_window_lines(text_source):
        buckets["skills_raw_section"].append(skill_line)
        buckets["skills"].append(skill_line)

    return buckets


def _collect_skill_evidence(
    buckets: dict[str, list[str]],
    variants: set[str],
    max_items: int = 4,
    sections: tuple[str, ...] = ("skills", "projects", "work_experience", "education"),
) -> list[dict[str, str]]:
    evidence: list[dict[str, str]] = []
    seen: set[str] = set()

    for section in sections:
        section_lines = _merged_section_lines(buckets, section)

        for text_value in section_lines:
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


def _count_mentions_in_sections(
    buckets: dict[str, list[str]],
    variants: set[str],
    sections: tuple[str, ...],
) -> tuple[int, set[str]]:
    mentions = 0
    matched_aliases: set[str] = set()
    seen: set[str] = set()

    for section in sections:
        section_lines = _merged_section_lines(buckets, section)

        for text_value in section_lines:
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


def _count_mentions_in_raw_fallback(
    raw_text: str,
    variants: set[str],
    max_evidence: int = 4,
) -> tuple[int, set[str], list[str]]:
    mentions = 0
    matched_aliases: set[str] = set()
    evidence_lines: list[str] = []
    seen: set[str] = set()

    for line in (raw_text or "").splitlines():
        text_value = str(line or "").strip()
        if len(text_value) < 3:
            continue
        if _detect_section_header(text_value):
            continue
        if _is_generic_skill_label(text_value):
            continue
        # Skip compact skill-list style lines to avoid adding bonus from "Skills:" text.
        if _looks_like_skill_list_line(text_value) and len(text_value) < 90:
            continue

        key = re.sub(r"\s+", " ", text_value.lower())
        if key in seen:
            continue
        seen.add(key)

        aliases_in_line = _matched_aliases_in_text(text_value, variants)
        if not aliases_in_line:
            continue

        mentions += 1
        matched_aliases.update(aliases_in_line)
        if len(evidence_lines) < max_evidence:
            evidence_lines.append(text_value)

    return mentions, matched_aliases, evidence_lines


def _is_listed_in_skills_section(buckets: dict[str, list[str]], variants: set[str]) -> bool:
    # Strict first: base=70 when matched under an actual skills header in raw text.
    for text_value in buckets.get("skills_raw_section", []):
        if text_value and _line_matches_variants(text_value, variants):
            return True

    # Conservative fallback: if raw skills window could not be extracted, use only
    # parsed skills entries that look like explicit skill list items.
    if not buckets.get("skills_raw_section"):
        for text_value in buckets.get("skills", []):
            if not _looks_like_explicit_skill_entry(text_value):
                continue
            if text_value and _line_matches_variants(text_value, variants):
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


def _skill_component(
    parsed_resume: dict,
    raw_text: str,
    primary: list[str],
    secondary: list[str],
) -> tuple[int, list[dict[str, object]]]:
    buckets = _extract_section_buckets(parsed_resume, raw_text)

    weighted_sum = 0.0
    total_weight = 0.0
    details: list[dict[str, object]] = []

    all_skills = [(s, True) for s in primary] + [(s, False) for s in secondary]
    for skill, is_primary in all_skills:
        canonical_skill = _canonicalize_skill_token(skill)
        variants = _skill_variants_for(canonical_skill)

        in_skills = _is_listed_in_skills_section(buckets, variants)
        mentions_in_sections, matched_aliases = _count_mentions_in_sections(
            buckets,
            variants,
            sections=("projects", "work_experience", "education"),
        )
        mentions = mentions_in_sections
        mentions_in_raw_fallback = 0
        raw_fallback_evidence: list[str] = []
        mention_source = "sections"
        if mentions == 0 and raw_text:
            (
                mentions_in_raw_fallback,
                raw_fallback_aliases,
                raw_fallback_evidence,
            ) = _count_mentions_in_raw_fallback(raw_text, variants)
            if mentions_in_raw_fallback > 0:
                mentions = mentions_in_raw_fallback
                matched_aliases.update(raw_fallback_aliases)
                mention_source = "raw_fallback"

        base = 70 if in_skills else (50 if mentions > 0 else 0)
        bonus = mentions * 5
        score = min(95, base + bonus)
        weight = 1.0 if is_primary else 0.5

        weighted_sum += score * weight
        total_weight += weight

        evidence = _collect_skill_evidence(buckets, variants)
        if not evidence and raw_fallback_evidence:
            evidence = [{"section": "raw_text", "text": line} for line in raw_fallback_evidence]
        matched_sections = sorted({item.get("section", "") for item in evidence if item.get("section")})

        details.append(
            {
                "skill": skill,
                "is_primary": is_primary,
                "canonical": canonical_skill,
                "base": base,
                "bonus": bonus,
                "mentions": mentions,
                "mentions_in_sections": mentions_in_sections,
                "mentions_in_raw_fallback": mentions_in_raw_fallback,
                "mention_source": mention_source,
                "score": score,
                "matched_aliases": sorted(matched_aliases),
                "mentioned_in_sections": matched_sections,
                "evidence": evidence,
            }
        )

    final = int(round(weighted_sum / total_weight)) if total_weight > 0 else 0
    return final, details


def rank_uploaded_resumes(
    files: list[dict[str, Any]],
    jd_text: str,
    strict_upper_bound: bool = False,
    force_refresh: bool = False,
    debug: bool = False,
) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    jd_parsed, jd_parsed_raw, jd_error, parse_meta = parse_jd_validated(
        jd_text,
        strict_upper_bound=strict_upper_bound,
        force_refresh=force_refresh,
    )
    if jd_error or not jd_parsed:
        return {
            "detail": jd_error or "JD parse failed.",
            "validation_errors": parse_meta.get("validation_errors", []),
        }, "jd_parse_error"

    min_years = jd_parsed.get("min_experience_years")
    max_years = jd_parsed.get("max_experience_years")
    strict = bool(jd_parsed.get("strict_upper_bound"))

    jd_tokens = {
        token
        for token in re.findall(r"[A-Za-z0-9+#.]{3,}", jd_text.lower())
        if token not in {"with", "from", "that", "this", "have", "will", "and", "for", "the"}
    }

    ranked_candidates: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    primary = jd_parsed.get("primary_skills") or []
    secondary = jd_parsed.get("secondary_skills") or []

    for file_item in files:
        file_bytes = file_item.get("file_bytes") or b""
        content_type = file_item.get("content_type") or ""
        filename = str(file_item.get("filename") or "resume")

        raw_text, _, _ = extract_text_for_resume(file_bytes, content_type)
        parsed_resume, parse_error, _ = parse_resume_bytes(file_bytes, content_type)
        if parse_error or not parsed_resume:
            errors.append({"filename": filename, "error": parse_error or "Parse failed"})
            continue

        skill_score, skill_details = _skill_component(parsed_resume, raw_text or "", primary, secondary)
        work_entries = _build_work_experience_entries(parsed_resume, raw_text or "")
        candidate_years, experience_debug = _extract_candidate_years(work_entries)
        experience_score, experience_fit = _experience_score(candidate_years, min_years, max_years, strict)
        jd_context_score = _keyword_overlap_percent(jd_tokens, _resume_text_blob(parsed_resume))

        final_score = int(round((skill_score * 0.6) + (experience_score * 0.3) + (jd_context_score * 0.1)))

        item: dict[str, Any] = {
            "filename": filename,
            "name": parsed_resume.get("name") or filename,
            "score": final_score,
            "skill_score": skill_score,
            "experience_score": experience_score,
            "jd_context_score": jd_context_score,
            "experience_years_detected": candidate_years,
            "experience_fit": experience_fit,
            "experience_debug": experience_debug,
            "skill_details": skill_details,
        }

        if debug:
            item["weights"] = {"skills": 0.6, "experience": 0.3, "jd_context": 0.1}

        ranked_candidates.append(item)

    ranked_candidates.sort(key=lambda x: x.get("score", 0), reverse=True)

    response: dict[str, Any] = {
        "jd_parsed": jd_parsed,
        "weights": {"skills": 0.6, "experience": 0.3, "jd_context": 0.1},
        "ranked_candidates": ranked_candidates,
        "errors": errors,
        "total_uploaded": len(files),
        "total_ranked": len(ranked_candidates),
    }
    if debug:
        response["raw_jd_model_output"] = jd_parsed_raw
        response["parse_meta"] = parse_meta

    return response, None


def rank_uploaded_resumes_from_parsed(
    files: list[dict[str, Any]],
    jd_text: str,
    jd_parsed: dict[str, Any],
    debug: bool = False,
) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    min_years = jd_parsed.get("min_experience_years")
    max_years = jd_parsed.get("max_experience_years")
    strict = bool(jd_parsed.get("strict_upper_bound"))

    jd_tokens = {
        token
        for token in re.findall(r"[A-Za-z0-9+#.]{3,}", jd_text.lower())
        if token not in {"with", "from", "that", "this", "have", "will", "and", "for", "the"}
    }

    ranked_candidates: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []

    primary = list(jd_parsed.get("primary_skills") or [])
    secondary = list(jd_parsed.get("secondary_skills") or [])

    for file_item in files:
        file_bytes = file_item.get("file_bytes") or b""
        content_type = file_item.get("content_type") or ""
        filename = str(file_item.get("filename") or "resume")

        raw_text, _, _ = extract_text_for_resume(file_bytes, content_type)
        parsed_resume, parse_error, _ = parse_resume_bytes(file_bytes, content_type)
        if parse_error or not parsed_resume:
            errors.append({"filename": filename, "error": parse_error or "Parse failed"})
            continue

        skill_score, skill_details = _skill_component(parsed_resume, raw_text or "", primary, secondary)
        work_entries = _build_work_experience_entries(parsed_resume, raw_text or "")
        candidate_years, experience_debug = _extract_candidate_years(work_entries)
        experience_score, experience_fit = _experience_score(candidate_years, min_years, max_years, strict)
        jd_context_score = _keyword_overlap_percent(jd_tokens, _resume_text_blob(parsed_resume))

        final_score = int(round((skill_score * 0.6) + (experience_score * 0.3) + (jd_context_score * 0.1)))

        item: dict[str, Any] = {
            "filename": filename,
            "name": parsed_resume.get("name") or filename,
            "score": final_score,
            "skill_score": skill_score,
            "experience_score": experience_score,
            "jd_context_score": jd_context_score,
            "experience_years_detected": candidate_years,
            "experience_fit": experience_fit,
            "experience_debug": experience_debug,
            "skill_details": skill_details,
        }

        if debug:
            item["weights"] = {"skills": 0.6, "experience": 0.3, "jd_context": 0.1}

        ranked_candidates.append(item)

    ranked_candidates.sort(key=lambda x: x.get("score", 0), reverse=True)

    response: dict[str, Any] = {
        "jd_parsed": jd_parsed,
        "weights": {"skills": 0.6, "experience": 0.3, "jd_context": 0.1},
        "ranked_candidates": ranked_candidates,
        "errors": errors,
        "total_uploaded": len(files),
        "total_ranked": len(ranked_candidates),
    }

    return response, None
