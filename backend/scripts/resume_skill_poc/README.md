# Resume Skill PoC

This PoC validates hybrid resume skill extraction and deterministic skill ranking before integrating with HR employee creation flow.

## What it does
- Reads sample resumes from `samples/` (`.txt` and `.pdf`).
- Detects claimed skills (rule-based).
- Extracts project blocks and maps project skills (rules + Gemini).
- Scores each skill using the v1 formula in `docs/resume-skill-analysis-spec.md`.
- Writes JSON analysis files to `outputs/`.

## Folder layout
- `run_resume_skill_poc.py`: CLI runner.
- `skill_dictionary.json`: canonical skills and aliases.
- `samples/*.txt|*.pdf`: resume test inputs.
- `expected/*.json`: expected high-level outcomes.
- `outputs/*.analysis.json`: generated results.

## Run
From `backend/`:

```bash
python scripts/resume_skill_poc/run_resume_skill_poc.py
```

For PDF support, install:

```bash
pip install pypdf
```

This PoC always runs in hybrid mode and requires Gemini key in `backend/.env`:

```env
GEMINI_API_KEY=your_key_here
```

## Upload test app (PDF UI)
Run a local app where you can upload resume PDFs from browser:

```bash
python -m uvicorn scripts.resume_skill_poc.upload_test_app:app --reload --port 8010
```

Open:

`http://127.0.0.1:8010/`

The app stores generated JSON in:

`scripts/resume_skill_poc/outputs_upload/`

## Scoring (v1)
Per skill:
- `+30` explicit claim
- `+20` per project evidence (`max +60`)
- `+10` recent usage
- `-10` claimed but no project evidence

Level buckets:
- `80-100`: Strong
- `50-79`: Moderate
- `0-49`: Basic

## Next integration step
Once this PoC behavior is acceptable, plug the same pipeline into:
1. HR employee create endpoint (resume upload).
2. Async analysis job.
3. Persistence into `resumes`, `employee_skills`, and evidence tables.
