from fastapi import APIRouter, File, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse

from services.resume_parser import parse_resume_bytes

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
