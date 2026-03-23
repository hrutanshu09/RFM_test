from fastapi import APIRouter, File, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse

from services.resume_parser import parse_resume_bytes
try:
    import fitz  # PyMuPDF
except Exception:  # pragma: no cover - optional dependency at runtime
    fitz = None

router = APIRouter(tags=["Resume Test UI"])


HTML_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Resume Parse Test UI</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f2ee;
        --panel: #ffffff;
        --accent: #1f4b99;
        --accent-2: #0b5fff;
        --text: #1c1c1c;
        --muted: #5f6b7a;
        --border: #e2e2e2;
        --chip: #eef3ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: radial-gradient(1200px 500px at 10% -10%, #e8f0ff, transparent), var(--bg);
        color: var(--text);
      }
      .wrap {
        max-width: 1020px;
        margin: 32px auto 60px;
        padding: 0 16px;
      }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 22px;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.05);
      }
      h1 {
        margin: 0 0 6px;
        font-size: 22px;
      }
      p {
        margin: 0 0 14px;
        color: var(--muted);
      }
      .row {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
      }
      .toolbar {
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        margin: 10px 0 18px;
        padding: 12px;
        background: #fafafa;
        border: 1px dashed var(--border);
        border-radius: 10px;
      }
      button {
        background: var(--accent);
        color: white;
        border: none;
        padding: 10px 14px;
        border-radius: 8px;
        cursor: pointer;
      }
      button.secondary {
        background: var(--chip);
        color: var(--accent);
        border: 1px solid #d8e3ff;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .hint {
        font-size: 12px;
        color: var(--muted);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      label {
        font-size: 12px;
        color: var(--muted);
        display: block;
        margin-bottom: 6px;
      }
      input, textarea {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 9px 12px;
        font-family: inherit;
        font-size: 14px;
      }
      textarea { min-height: 80px; }
      .full { grid-column: 1 / -1; }
      .section {
        margin-top: 18px;
        padding-top: 10px;
        border-top: 1px solid #f0f0f0;
      }
      .section h2 {
        font-size: 16px;
        margin: 0 0 10px;
      }
      .repeat-list {
        display: grid;
        gap: 10px;
      }
      .repeat-item {
        padding: 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #fcfcfc;
      }
      .repeat-item .remove {
        margin-top: 8px;
      }
      .tag-input {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding: 8px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: #fff;
      }
      .tag-input input {
        border: none;
        outline: none;
        padding: 4px 6px;
        min-width: 120px;
        flex: 1;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--chip);
        color: var(--accent);
        border: 1px solid #d8e3ff;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 12px;
      }
      .tag button {
        background: transparent;
        color: var(--accent);
        border: none;
        cursor: pointer;
        font-size: 12px;
        padding: 0;
      }
      pre {
        margin-top: 16px;
        background: #0b0b0b;
        color: #f3f3f3;
        padding: 14px;
        border-radius: 8px;
        overflow: auto;
        max-height: 300px;
      }
      @media (max-width: 720px) {
        .grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Resume Parse Test UI</h1>
        <p>Enter details manually, or upload a PDF/DOCX and auto-fill the form.</p>

        <div class="toolbar">
          <div class="row">
            <input id="file" type="file" accept=".pdf,.docx" />
            <button id="btn">Parse & Autofill</button>
          </div>
          <div class="hint">Supported: PDF, DOCX</div>
        </div>

        <form id="candidate-form" class="grid">
          <div>
            <label for="name">Name</label>
            <input id="name" name="name" type="text" />
          </div>
          <div>
            <label for="email">Email</label>
            <input id="email" name="email" type="email" />
          </div>
          <div>
            <label for="phone">Phone</label>
            <input id="phone" name="phone" type="text" />
          </div>
          <div>
            <label for="linkedin">LinkedIn</label>
            <input id="linkedin" name="linkedin" type="url" placeholder="https://linkedin.com/in/..." />
          </div>
          <div>
            <label for="github">GitHub</label>
            <input id="github" name="github" type="url" placeholder="https://github.com/..." />
          </div>
          <div>
            <label>Skills</label>
            <div class="tag-input" id="skills-tags">
              <input id="skills-input" type="text" placeholder="Type a skill and press Enter" />
            </div>
            <div class="hint">Press Enter or comma to add a skill</div>
          </div>

          <div class="full section">
            <h2>Education</h2>
            <div class="row" style="margin-bottom:8px;">
              <button type="button" id="add-education" class="secondary">Add Education</button>
            </div>
            <div id="education-list" class="repeat-list"></div>
          </div>

          <div class="full section">
            <h2>Projects</h2>
            <div class="row" style="margin-bottom:8px;">
              <button type="button" id="add-project" class="secondary">Add Project</button>
            </div>
            <div id="projects-list" class="repeat-list"></div>
          </div>

          <div class="full section">
            <h2>Work Experience</h2>
            <div class="row" style="margin-bottom:8px;">
              <button type="button" id="add-experience" class="secondary">Add Work Exp</button>
            </div>
            <div id="experience-list" class="repeat-list"></div>
          </div>
        </form>

        <pre id="out">{}</pre>
      </div>
    </div>
    <script>
      const btn = document.getElementById("btn");
      const out = document.getElementById("out");

      const educationList = document.getElementById("education-list");
      const projectsList = document.getElementById("projects-list");
      const experienceList = document.getElementById("experience-list");

      const skillsTags = document.getElementById("skills-tags");
      const skillsInput = document.getElementById("skills-input");
      const skillsSet = new Set();

      function setField(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value ?? "";
      }

      function renderSkillTags() {
        const inputs = skillsTags.querySelectorAll(".tag");
        inputs.forEach(el => el.remove());
        Array.from(skillsSet).forEach(skill => {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = skill;

          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "x";
          remove.addEventListener("click", () => {
            skillsSet.delete(skill);
            renderSkillTags();
          });

          tag.appendChild(remove);
          skillsTags.insertBefore(tag, skillsInput);
        });
      }

      function addSkill(skill) {
        const cleaned = (skill || "").trim();
        if (!cleaned) return;
        skillsSet.add(cleaned);
        renderSkillTags();
      }

      skillsInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          addSkill(skillsInput.value.replace(/,$/, ""));
          skillsInput.value = "";
        }
      });

      function setSkills(skills) {
        skillsSet.clear();
        (skills || []).forEach(addSkill);
        renderSkillTags();
      }

      function addRepeatItem(listEl, placeholder, value) {
        const wrapper = document.createElement("div");
        wrapper.className = "repeat-item";

        const label = document.createElement("label");
        label.textContent = placeholder;

        const textarea = document.createElement("textarea");
        textarea.value = value || "";

        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.className = "secondary remove";
        remove.addEventListener("click", () => wrapper.remove());

        wrapper.appendChild(label);
        wrapper.appendChild(textarea);
        wrapper.appendChild(remove);
        listEl.appendChild(wrapper);
      }

      function clearList(listEl) {
        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
      }

      document.getElementById("add-education").addEventListener("click", () => {
        addRepeatItem(educationList, "Education", "");
      });
      document.getElementById("add-project").addEventListener("click", () => {
        addRepeatItem(projectsList, "Project", "");
      });
      document.getElementById("add-experience").addEventListener("click", () => {
        addRepeatItem(experienceList, "Work Experience", "");
      });

      function fillRepeat(listEl, items, label) {
        clearList(listEl);
        if (!items || items.length === 0) {
          addRepeatItem(listEl, label, "");
          return;
        }
        items.forEach(item => addRepeatItem(listEl, label, item));
      }

      btn.addEventListener("click", async () => {
        const fileInput = document.getElementById("file");
        if (!fileInput.files || !fileInput.files[0]) {
          out.textContent = "Please choose a PDF or DOCX file.";
          return;
        }
        btn.disabled = true;
        out.textContent = "Parsing...";
        try {
          const fd = new FormData();
          fd.append("file", fileInput.files[0]);
          const res = await fetch("/api/resume-test/parse", { method: "POST", body: fd });
          const data = await res.json();

          setField("name", data.name);
          setField("email", data.email);
          setField("phone", data.phone);
          setField("linkedin", data.linkedin);
          setField("github", data.github);
          setSkills(data.skills || []);

          fillRepeat(educationList, data.education || [], "Education");
          fillRepeat(projectsList, data.projects || [], "Project");
          fillRepeat(experienceList, data.work_experience || [], "Work Experience");

          out.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
          out.textContent = String(err);
        } finally {
          btn.disabled = false;
        }
      });

      // Initialize with one empty field per section
      fillRepeat(educationList, [], "Education");
      fillRepeat(projectsList, [], "Project");
      fillRepeat(experienceList, [], "Work Experience");
    </script>
  </body>
</html>
"""


@router.get("/resume-test", response_class=HTMLResponse)
def resume_test_ui():
    return HTMLResponse(HTML_PAGE)


@router.post("/api/resume-test/parse")
async def parse_resume(file: UploadFile = File(...)):
    content_type = file.content_type or ""
    file_bytes = await file.read()

    payload, error, error_type = parse_resume_bytes(file_bytes, content_type)
    if error:
        status_code = 400 if error_type in {"unsupported", "extract"} else 500
        return JSONResponse(status_code=status_code, content={"detail": error})

    return JSONResponse(content=payload)


PYMUPDF_HTML_PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PyMuPDF Resume Text Test</title>
    <style>
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: #f4f6fb;
        color: #1d2433;
      }
      .wrap {
        max-width: 980px;
        margin: 30px auto;
        padding: 0 16px;
      }
      .card {
        background: #fff;
        border: 1px solid #e1e7f0;
        border-radius: 12px;
        padding: 18px;
        box-shadow: 0 10px 24px rgba(20, 30, 55, 0.07);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 22px;
      }
      p {
        margin: 0 0 14px;
        color: #5a657a;
      }
      .row {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .toolbar {
        padding: 12px;
        border: 1px dashed #d5ddeb;
        border-radius: 10px;
        background: #fafcff;
      }
      button {
        border: none;
        background: #1f4b99;
        color: #fff;
        border-radius: 8px;
        padding: 9px 14px;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      input[type="number"] {
        width: 130px;
        border: 1px solid #d5ddeb;
        border-radius: 8px;
        padding: 8px 10px;
      }
      pre {
        margin-top: 14px;
        background: #0f172a;
        color: #e5edf8;
        border-radius: 10px;
        padding: 14px;
        overflow: auto;
        max-height: 520px;
      }
      .hint {
        font-size: 12px;
        color: #66748f;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>PyMuPDF Resume Text Test</h1>
        <p>Upload a PDF and inspect the exact text extracted by PyMuPDF.</p>

        <div class="toolbar row">
          <input id="file" type="file" accept=".pdf" />
          <label>Preview chars <input id="preview" type="number" min="200" max="20000" value="4000" /></label>
          <label><input id="full" type="checkbox" /> Include full text</label>
          <button id="btn">Extract Text</button>
        </div>
        <div class="hint">Endpoint: /api/resume-test/pymupdf</div>
        <pre id="out">{}</pre>
      </div>
    </div>
    <script>
      const btn = document.getElementById("btn");
      const out = document.getElementById("out");

      btn.addEventListener("click", async () => {
        const fileInput = document.getElementById("file");
        const preview = document.getElementById("preview");
        const full = document.getElementById("full");
        if (!fileInput.files || !fileInput.files[0]) {
          out.textContent = "Please choose a PDF file.";
          return;
        }

        btn.disabled = true;
        out.textContent = "Extracting with PyMuPDF...";
        try {
          const fd = new FormData();
          fd.append("file", fileInput.files[0]);
          const query = new URLSearchParams({
            preview_chars: String(preview.value || 4000),
            include_full: full.checked ? "true" : "false",
          });
          const res = await fetch("/api/resume-test/pymupdf?" + query.toString(), {
            method: "POST",
            body: fd
          });
          const data = await res.json();
          out.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
          out.textContent = String(err);
        } finally {
          btn.disabled = false;
        }
      });
    </script>
  </body>
</html>
"""


def _normalize_block_text(text: str) -> str:
    cleaned = text.replace("\r", "\n")
    cleaned = "\n".join(line.strip() for line in cleaned.splitlines() if line.strip())
    return cleaned.strip()


def _looks_like_name_line(line: str) -> bool:
    parts = [p for p in line.replace(".", " ").split() if p]
    if len(parts) < 2 or len(parts) > 4:
        return False
    return all(part[:1].isupper() and part[1:].isalpha() for part in parts if part.isalpha())


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

    top_text = "\n".join(first_window)
    if "education" in top_text:
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
        return "", "single_column", {"x_gap": 0.0, "column_split": 0.0}

    sorted_by_x = sorted(text_blocks, key=lambda b: b["x_center"])
    min_x = float(sorted_by_x[0]["x_center"])
    max_x = float(sorted_by_x[-1]["x_center"])
    x_gap = max_x - min_x

    # Heuristic: if horizontal spread is large, treat as multi-column.
    is_multi = x_gap > 140.0 and len(sorted_by_x) >= 6
    layout_mode = "multi_column" if is_multi else "single_column"

    if not is_multi:
        ordered = sorted(text_blocks, key=lambda b: (float(b["y0"]), float(b["x0"])))
        text = "\n".join(str(b["text"]) for b in ordered)
        return text, layout_mode, {"x_gap": x_gap, "column_split": 0.0}

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
    combined = right_then_left if use_rtl else left_then_right
    column_order = "right_to_left" if use_rtl else "left_to_right"

    return combined, layout_mode, {
        "x_gap": x_gap,
        "column_split": column_split,
        "score_ltr": score_ltr,
        "score_rtl": score_rtl,
        "column_order": column_order,
    }


def _extract_with_pymupdf(file_bytes: bytes) -> dict[str, object]:
    if fitz is None:
        return {
            "raw_text": "",
            "reconstructed_text": "",
            "page_stats": [],
            "layout_mode": "unavailable",
        }

    raw_pages: list[str] = []
    reconstructed_pages: list[str] = []
    page_stats: list[dict[str, object]] = []
    multi_column_pages = 0

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        for idx, page in enumerate(doc):
            raw_text = page.get_text("text") or ""
            raw_pages.append(raw_text)

            blocks = page.get_text("blocks")
            reconstructed_text, page_layout, layout_meta = _reconstruct_page_text_from_blocks(blocks)
            reconstructed_pages.append(reconstructed_text)

            if page_layout == "multi_column":
                multi_column_pages += 1

            page_stats.append(
                {
                    "page": idx + 1,
                    "chars_raw": len(raw_text),
                    "chars_reconstructed": len(reconstructed_text),
                    "layout_mode": page_layout,
                    "x_gap": round(float(layout_meta.get("x_gap", 0.0)), 2),
                    "column_split": round(float(layout_meta.get("column_split", 0.0)), 2),
                    "column_order": layout_meta.get("column_order", "left_to_right"),
                    "score_ltr": round(float(layout_meta.get("score_ltr", 0.0)), 2),
                    "score_rtl": round(float(layout_meta.get("score_rtl", 0.0)), 2),
                }
            )
    finally:
        doc.close()

    doc_layout = "multi_column" if multi_column_pages > 0 else "single_column"
    return {
        "raw_text": "\n".join(raw_pages),
        "reconstructed_text": "\n".join(reconstructed_pages),
        "page_stats": page_stats,
        "layout_mode": doc_layout,
    }

@router.get("/resume-test-pymupdf", response_class=HTMLResponse)
def resume_test_pymupdf_ui():
    return HTMLResponse(PYMUPDF_HTML_PAGE)


@router.post("/api/resume-test/pymupdf")
async def parse_resume_pymupdf(
    file: UploadFile = File(...),
    preview_chars: int = 4000,
    include_full: bool = False,
):
    if fitz is None:
        return JSONResponse(
            status_code=500,
            content={"detail": "PyMuPDF is not installed. Install with: pip install pymupdf"},
        )

    content_type = file.content_type or ""
    if content_type != "application/pdf":
        return JSONResponse(
            status_code=400,
            content={"detail": "Only PDF is supported for this test endpoint."},
        )

    file_bytes = await file.read()
    extracted = _extract_with_pymupdf(file_bytes)
    raw_text = str(extracted.get("raw_text") or "")
    reconstructed_text = str(extracted.get("reconstructed_text") or "")
    page_stats = extracted.get("page_stats") or []
    if not raw_text and not reconstructed_text:
        return JSONResponse(
            status_code=400,
            content={"detail": "Could not extract text from PDF using PyMuPDF."},
        )

    preview_chars = max(200, min(20000, int(preview_chars)))
    payload = {
        "extractor_used": "pymupdf",
        "content_type": content_type,
        "chars_extracted_raw": len(raw_text),
        "chars_extracted_reconstructed": len(reconstructed_text),
        "page_count": len(page_stats),
        "layout_mode": extracted.get("layout_mode", "single_column"),
        "page_stats": page_stats,
        "raw_text_preview": raw_text[:preview_chars],
        "reconstructed_text_preview": reconstructed_text[:preview_chars],
    }
    if include_full:
        payload["raw_text"] = raw_text
        payload["reconstructed_text"] = reconstructed_text

    return JSONResponse(content=payload)



