import html
import json
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import HTMLResponse

from scripts.resume_skill_poc.run_resume_skill_poc import (
    analyze_resume,
    load_skill_dictionary,
    normalize_skill_map,
    read_resume_bytes,
    update_skill_dictionary_file,
)

BASE_DIR = Path(__file__).resolve().parent
SKILL_DICT_PATH = BASE_DIR / "skill_dictionary.json"
UPLOAD_OUTPUT_DIR = BASE_DIR / "outputs_upload"
UPLOAD_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Resume Skill Upload Test App")


def get_alias_map() -> dict[str, str]:
    skill_dict = load_skill_dictionary(SKILL_DICT_PATH)
    return normalize_skill_map(skill_dict)


def build_skill_categories(result: dict) -> dict[str, list[str]]:
    assessments = result.get("skill_assessment", [])
    core: list[tuple[str, int, int, int]] = []
    familiar: list[str] = []

    for item in assessments:
        skill = item.get("skill", "")
        project_count = int(item.get("project_count", 0))
        experience_count = int(item.get("experience_count", 0))
        score = int(item.get("proficiency_score", 0))
        if not skill:
            continue

        if project_count > 0 or experience_count > 0:
            core.append((skill, experience_count, project_count, score))
        else:
            familiar.append(skill)

    core_sorted = [
        name
        for name, _, _, _ in sorted(
            core,
            key=lambda x: (x[1], x[2], x[3], x[0].lower()),
            reverse=True,
        )
    ]

    return {
        "core_skills": list(dict.fromkeys(core_sorted)),
        "familiar_skills": sorted(set(familiar)),
    }


def render_home_page() -> str:
    return """
<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>Resume Skill Test App</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 2rem; background: #f7f9fc; color: #1c2430; }
    .card { background: #fff; border-radius: 12px; padding: 1.2rem; box-shadow: 0 8px 30px rgba(0,0,0,.06); max-width: 920px; }
    h1 { margin-top: 0; }
    .muted { color: #5f6b7a; font-size: 0.95rem; }
    button { margin-top: 1rem; padding: .55rem 1rem; border: 0; border-radius: 8px; background: #0b63f3; color: #fff; cursor: pointer; }
    input[type=file] { margin-top: .8rem; }
  </style>
</head>
<body>
  <div class=\"card\">
    <h1>Resume Skill Extraction Test</h1>
    <p class=\"muted\">Upload one or more PDF resumes. The app will extract skills, detect project evidence, and score proficiency.</p>
    <form action=\"/analyze\" method=\"post\" enctype=\"multipart/form-data\">
      <input type=\"file\" name=\"files\" accept=\".pdf\" multiple required />
      <br />
      <button type=\"submit\">Analyze Resumes</button>
    </form>
  </div>
</body>
</html>
"""


def render_results_page(results: list[dict], errors: list[str]) -> str:
    def _render_profile_experiences(profile: dict, result: dict) -> str:
        entries = profile.get("experiences", [])
        if (not isinstance(entries, list) or not entries) and isinstance(result.get("experiences"), list):
            entries = result.get("experiences", [])
        if not isinstance(entries, list) or not entries:
            return "-"

        rendered: list[str] = []
        for entry in entries[:8]:
            if not isinstance(entry, dict):
                continue
            # employee_profile uses "headline", analysis experiences use "title".
            headline = str(entry.get("headline") or entry.get("title") or "-").strip()
            date_range = str(entry.get("date_range") or "Unknown").strip()
            rendered.append(f"{headline} ({date_range})")

        return "<br/>".join(html.escape(x) for x in rendered) if rendered else "-"

    def _render_profile_education(profile: dict) -> str:
        entries = profile.get("education", [])
        if not isinstance(entries, list) or not entries:
            return "-"

        def _institution_from_details(details: str) -> str:
            for token in details.split():
                # keep lightweight split path first
                if any(k in token.lower() for k in ["university", "college", "institute", "school", "academy"]):
                    return ""
            lines = [x.strip() for x in details.replace("  ", "\n").split("\n") if x.strip()]
            for ln in lines[:8]:
                low = ln.lower()
                if any(k in low for k in ["university", "college", "institute", "school", "academy"]):
                    return ln
            return ""

        rendered: list[str] = []
        for entry in entries[:6]:
            if not isinstance(entry, dict):
                continue
            headline = str(entry.get("headline") or "-").strip()
            date_range = str(entry.get("date_range") or "Unknown").strip()
            details = str(entry.get("details") or "").strip()
            if details and not any(k in headline.lower() for k in ["university", "college", "institute", "school", "academy"]):
                inst = _institution_from_details(details)
                if inst:
                    headline = f"{headline} - {inst}"
            rendered.append(f"{headline} ({date_range})")

        return "<br/>".join(html.escape(x) for x in rendered) if rendered else "-"

    rows = []
    for result in results:
        categories = result.get("skill_categories", {})
        profile = result.get("employee_profile", {})
        profile_debug = result.get("employee_profile_debug", {})
        core = html.escape(", ".join(categories.get("core_skills", [])) or "-")
        familiar = html.escape(", ".join(categories.get("familiar_skills", [])) or "-")
        name = html.escape(str(profile.get("name") or "-"))
        email = html.escape(str(profile.get("email") or "-"))
        phone = html.escape(str(profile.get("phone_number") or "-"))
        linkedin = html.escape(str(profile.get("linkedin") or "-"))
        github = html.escape(str(profile.get("github") or "-"))
        experiences = _render_profile_experiences(profile, result)
        education = _render_profile_education(profile)
        auto_added = html.escape(", ".join(result.get("auto_added_skills", []) or []) or "-")
        llm_status = html.escape(str(profile_debug.get("llm_status") or "-"))
        mode = html.escape(str(profile_debug.get("mode") or "-"))
        field_conf = profile_debug.get("field_confidence") or {}
        field_conf_text = html.escape(
            ", ".join(
                f"{k}:{v.get('source','?')}"
                for k, v in field_conf.items()
                if isinstance(v, dict)
            ) or "-"
        )

        category_text = (
            f"Name: {name}<br/>"
            f"Email: {email}<br/>"
            f"Phone: {phone}<br/>"
            f"LinkedIn: {linkedin}<br/>"
            f"GitHub: {github}<br/>"
            f"Experience: <br/>{experiences}<br/>"
            f"Education: <br/>{education}<br/>"
            f"Profile Mode: {mode}<br/>"
            f"LLM Status: {llm_status}<br/>"
            f"Auto-added Skills: {auto_added}<br/>"
            f"Field Sources: {field_conf_text}<br/>"
            "<hr/>"
            f"Core Skills: {core}<br/>"
            f"Familiar Skills: {familiar}"
        )
        rows.append(
            "<tr>"
            f"<td>{html.escape(result.get('resume_id', 'unknown'))}</td>"
            f"<td>{category_text}</td>"
            "</tr>"
        )

    error_html = ""
    if errors:
        error_items = "".join(f"<li>{html.escape(e)}</li>" for e in errors)
        error_html = f"<div class='errors'><h3>Errors</h3><ul>{error_items}</ul></div>"

    pretty_json = html.escape(json.dumps(results, indent=2))
    return f"""
<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>Analysis Results</title>
  <style>
    body {{ font-family: Segoe UI, Arial, sans-serif; margin: 2rem; background: #f7f9fc; color: #1c2430; }}
    .card {{ background: #fff; border-radius: 12px; padding: 1.2rem; box-shadow: 0 8px 30px rgba(0,0,0,.06); max-width: 1100px; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: .75rem; }}
    th, td {{ border-bottom: 1px solid #e3e8ef; padding: .55rem .35rem; text-align: left; vertical-align: top; }}
    th {{ background: #f2f6ff; }}
    pre {{ background: #0f1720; color: #d9e3ef; padding: 1rem; border-radius: 8px; overflow: auto; }}
    .errors {{ background: #fff1f1; border: 1px solid #f7c7c7; padding: .8rem; border-radius: 8px; margin-top: .75rem; }}
    a {{ color: #0b63f3; text-decoration: none; }}
  </style>
</head>
<body>
  <div class=\"card\">
    <h1>Resume Analysis Results</h1>
    <p><a href=\"/\">Upload more resumes</a></p>
    <table>
      <thead><tr><th>Resume</th><th>Skill Categories</th></tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
    {error_html}
    <h3>Raw JSON</h3>
    <pre>{pretty_json}</pre>
  </div>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
async def home() -> str:
    return render_home_page()


@app.post("/analyze", response_class=HTMLResponse)
async def analyze(files: list[UploadFile] = File(...)) -> str:
    alias_map = get_alias_map()
    results: list[dict] = []
    errors: list[str] = []

    for idx, upload in enumerate(files, start=1):
        filename = upload.filename or f"resume_{idx}.pdf"
        try:
            data = await upload.read()
            text = read_resume_bytes(filename, data)
            result = analyze_resume(
                employee_id=f"UPLOAD-EMP-{idx:03d}",
                resume_id=Path(filename).stem,
                resume_text=text,
                alias_map=alias_map,
            )
            suggested = result.get("suggested_new_skills", []) or []
            added = update_skill_dictionary_file(SKILL_DICT_PATH, [str(x) for x in suggested if str(x).strip()])
            if added:
                alias_map = get_alias_map()
                result["auto_added_skills"] = added
            else:
                result["auto_added_skills"] = []
            result["skill_categories"] = build_skill_categories(result)
            out_file = UPLOAD_OUTPUT_DIR / f"{Path(filename).stem}.analysis.json"
            out_file.write_text(json.dumps(result, indent=2), encoding="utf-8")
            results.append(result)
        except Exception as exc:
            errors.append(f"{filename}: {exc}")

    return render_results_page(results, errors)
