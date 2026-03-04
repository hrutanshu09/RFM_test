import json
import os
from typing import Any

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - fallback path when SDK is unavailable
    genai = None


def _gemini_config() -> tuple[bool, str, str]:
    enabled = os.getenv("ENABLE_SKILL_RECOMMENDATION_AI", "false").lower() == "true"
    provider = os.getenv("SKILL_AI_PROVIDER", "gemini").strip().lower()
    model = os.getenv("SKILL_AI_MODEL", "gemini-1.5-flash").strip()
    return enabled, provider, model


def _build_prompt(
    requested_skills: list[str],
    candidates: list[dict[str, Any]],
    required_count: int,
) -> str:
    lines = []
    for idx, candidate in enumerate(candidates, 1):
        lines.append(
            f"{idx}. emp_id={candidate['emp_id']}; "
            f"name={candidate['full_name']}; "
            f"matched={', '.join(candidate.get('matched_skills', [])) or 'none'}; "
            f"related={', '.join(candidate.get('related_skills', [])) or 'none'}; "
            f"status={candidate.get('status', 'unknown')}"
        )

    candidate_block = "\n".join(lines)
    skills = ", ".join(requested_skills)

    return (
        "You are ranking employees for project staffing.\n"
        f"Requested skills: {skills}\n"
        f"Return top {required_count} employees as strict JSON only.\n"
        "Prefer exact match skills first, then relevant/related skills.\n"
        "Do not invent employee ids.\n"
        "Output schema:\n"
        '{"ranked_emp_ids": ["EMP-1", "EMP-2"], "rationales": {"EMP-1": "..."}}\n'
        "Candidates:\n"
        f"{candidate_block}"
    )


def _extract_json_from_text(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None


def _call_gemini(prompt: str, model: str, api_key: str) -> dict[str, Any] | None:
    if genai is None:
        return None

    try:
        genai.configure(api_key=api_key)
        generation_model = genai.GenerativeModel(model)
        response = generation_model.generate_content(
            prompt,
            generation_config={
                "temperature": 0.2,
                "response_mime_type": "application/json",
            },
        )
    except Exception:
        return None

    text = getattr(response, "text", "") or ""
    if not text:
        return None
    return _extract_json_from_text(text)


def ai_rerank_skill_candidates(
    requested_skills: list[str],
    candidates: list[dict[str, Any]],
    required_count: int,
) -> tuple[list[str], dict[str, str], bool]:
    enabled, provider, model = _gemini_config()
    if not enabled or provider != "gemini" or not candidates:
        return [], {}, False

    api_key = os.getenv("GEMINI_API_KEY", "").strip() or os.getenv("GOOGLE_API_KEY", "").strip()
    if not api_key:
        return [], {}, False

    prompt = _build_prompt(
        requested_skills=requested_skills,
        candidates=candidates,
        required_count=required_count,
    )
    parsed = _call_gemini(prompt=prompt, model=model, api_key=api_key)
    if not isinstance(parsed, dict):
        return [], {}, False

    ranked_emp_ids_raw = parsed.get("ranked_emp_ids")
    if not isinstance(ranked_emp_ids_raw, list):
        return [], {}, False

    known_emp_ids = {str(c["emp_id"]) for c in candidates if "emp_id" in c}
    ranked_emp_ids: list[str] = []
    for item in ranked_emp_ids_raw:
        emp_id = str(item)
        if emp_id in known_emp_ids and emp_id not in ranked_emp_ids:
            ranked_emp_ids.append(emp_id)

    rationales_raw = parsed.get("rationales")
    rationales: dict[str, str] = {}
    if isinstance(rationales_raw, dict):
        for emp_id, reason in rationales_raw.items():
            eid = str(emp_id)
            if eid in known_emp_ids and isinstance(reason, str):
                rationales[eid] = reason.strip()

    if not ranked_emp_ids:
        return [], {}, False
    return ranked_emp_ids, rationales, True
