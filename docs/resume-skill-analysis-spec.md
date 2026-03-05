# Resume Skill Analysis Specification (v1)

## 1) Objective
When HR creates an employee and uploads a resume, the system should:
- detect claimed skills from the resume text,
- detect project evidence for those skills,
- score skill proficiency per employee with transparent evidence.

This document defines the source-of-truth output contract and initial scoring rules.

## 2) Output JSON Contract (v1)
All extraction and scoring jobs must return this structure.

```json
{
  "employee_id": "uuid",
  "resume_id": "uuid",
  "claimed_skills": [
    {
      "skill": "React",
      "normalized_skill_id": "react",
      "evidence": "Skills: React, Redux, TypeScript"
    }
  ],
  "projects": [
    {
      "name": "E-commerce Dashboard",
      "date_range": "2024-01 to 2024-06",
      "description": "Built an admin dashboard with analytics and role-based access.",
      "skills_used": ["React", "TypeScript", "Node.js"],
      "evidence": "Implemented dashboard modules using React and TypeScript."
    }
  ],
  "skill_assessment": [
    {
      "skill": "React",
      "normalized_skill_id": "react",
      "claimed": true,
      "project_count": 2,
      "recent_usage": true,
      "proficiency_score": 86,
      "level": "Strong",
      "confidence": 0.89,
      "evidence_snippets": [
        "Skills: React, Redux, TypeScript",
        "Implemented dashboard modules using React and TypeScript."
      ]
    }
  ],
  "analysis_metadata": {
    "analysis_version": "v1",
    "analyzed_at": "2026-03-05T10:30:00Z",
    "model_or_pipeline": "hybrid_rules_plus_llm",
    "status": "completed"
  }
}
```

### Field Notes
- `claimed_skills`: skills explicitly listed or claimed in resume sections like `Skills`, `Tech Stack`, `Core Competencies`.
- `projects`: extracted project/work items with mapped skills.
- `skill_assessment`: final per-skill scored output.
- `confidence`: range `0.0 - 1.0`; low confidence should be flagged for HR review.

## 3) Scoring Formula (v1)
Score each skill on a `0-100` scale using deterministic rules:

- `+30` if skill is explicitly claimed.
- `+20` for each project with clear skill usage (`max +60` from projects).
- `+10` if skill appears in at least one recent project (within last 2 years from analysis date).
- `-10` if skill is claimed but no project/work evidence exists.

### Formula
`score = claim_points + project_points + recency_points - weak_claim_penalty`

Then clamp score:
- if score `< 0`, set to `0`
- if score `> 100`, set to `100`

### Skill Level Buckets
- `80-100`: `Strong`
- `50-79`: `Moderate`
- `0-49`: `Basic`

### Confidence Heuristic (v1)
Use confidence as extraction reliability, not proficiency.
- Start at `0.50`
- `+0.15` if skill claim has exact section evidence
- `+0.10` if mapped in at least one project bullet/sentence
- `+0.10` if same skill appears in multiple evidence snippets
- `-0.15` if skill mapping is inferred with ambiguous wording
- Clamp to `0.0 - 1.0`

## 4) Skill Normalization Dictionary (Starter)
- `react.js`, `reactjs` -> `React`
- `node`, `nodejs` -> `Node.js`
- `typescript` -> `TypeScript`
- `javascript`, `js` -> `JavaScript`
- `py` -> `Python`
- `cpp`, `c plus plus` -> `C++`
- `postgres`, `postgresql` -> `PostgreSQL`

## 5) Sample Resume Cases And Expected Outcomes
Use these as acceptance-style checks while implementing.

### Case A: React-Heavy Candidate
- Claimed skills: `React`, `Python`, `C++`
- Projects:
  - 2 projects explicitly using `React`
  - 0 project evidence for `Python`
  - 0 project evidence for `C++`
- Expected assessment:
  - `React`: score `80-100`, level `Strong`
  - `Python`: score `20-40`, level `Basic`
  - `C++`: score `20-40`, level `Basic`

### Case B: Python Backend Candidate
- Claimed skills: `Python`, `Django`, `React`
- Projects:
  - 3 projects using `Python`
  - 2 projects using `Django`
  - 1 older project using `React`
- Expected assessment:
  - `Python`: `Strong`
  - `Django`: `Strong` or high `Moderate`
  - `React`: `Moderate` (if limited evidence and older usage)

### Case C: Skill List With Weak Evidence
- Claimed skills: `Java`, `AWS`, `Kubernetes`
- Projects:
  - generic project descriptions with unclear tool usage
- Expected assessment:
  - all claimed skills likely `Basic` or low `Moderate`
  - confidence lower due weak evidence

## 6) Phase-1 Done Criteria
- Pipeline returns valid JSON matching section 2.
- Every assessed skill includes at least one evidence snippet.
- Deterministic scoring from section 3 is applied.
- HR can view detected skills, levels, and evidence (read-only is acceptable for first release).

