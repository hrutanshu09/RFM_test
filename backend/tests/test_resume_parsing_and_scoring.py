from services.resume_parser import _normalize_skill_list
from services.ta_jd_screening import _extract_candidate_years, _jd_tokens_from_text, _skill_component, score_candidate_against_jd


def test_normalize_skill_list_preserves_compound_skills_and_cleans_punctuation():
    parsed = _normalize_skill_list(
        ["CI/CD", "AWS.", "Node.js,", "React.js", "C/C++", "Machine Learning"]
    )
    lowered = {item.lower() for item in parsed}

    assert "ci/cd" in lowered
    assert "aws" in lowered
    assert "node.js" in lowered
    assert "react" in lowered
    assert "c/c++" in lowered


def test_skills_section_detection_does_not_leak_other_inline_headers():
    raw_text = """
Skills: Python, FastAPI
Projects: Built APIs with Python
Experience: Python backend engineer
"""
    score, details = _skill_component(
        {"skills": [], "projects": [], "work_experience": [], "education": []},
        raw_text,
        ["Python"],
        [],
    )
    detail = details[0]

    assert detail["base"] == 70
    assert detail["mentions"] >= 2
    assert "projects" in detail["mentioned_in_sections"]
    assert "work_experience" in detail["mentioned_in_sections"]


def test_skill_mentions_count_multiple_occurrences_in_same_line():
    raw_text = """
Projects: Python Python Python automation
Experience: Built Python services
"""
    score, details = _skill_component(
        {"skills": [], "projects": [], "work_experience": [], "education": []},
        raw_text,
        ["Python"],
        [],
    )
    detail = details[0]

    assert detail["base"] == 50
    # Mention counting is unit-based (section evidence events), not repeated-token based.
    assert detail["mentions"] == 2
    assert detail["score"] == 60


def test_experience_years_uses_date_ranges_before_explicit_year_hints():
    years, debug = _extract_candidate_years(
        ["Senior developer with 10+ years total experience. Worked 05/2021 \u2013 08/2023"]
    )

    # 28 months ~= 2.33 years from date range should win over "10+ years" hint.
    assert debug["method"] == "date_ranges"
    assert abs(years - 2.33) < 0.05
    assert debug["explicit_years_hint"] == 10.0


def test_unified_scoring_uses_section_caps_for_mentions():
    raw_text = """
Skills: React
Projects: React dashboard
Projects: React analytics portal
Projects: React reusable components
Work Experience: Built React apps
"""
    parsed_resume = {"name": "Sample", "skills": [], "projects": [], "work_experience": [], "education": []}
    scored = score_candidate_against_jd(
        parsed_resume=parsed_resume,
        raw_text=raw_text,
        primary=["React.js"],
        secondary=[],
        jd_tokens=_jd_tokens_from_text("Need React developer"),
        min_years=None,
        max_years=None,
        strict_upper_bound=False,
        filename="sample.pdf",
        debug=True,
    )
    detail = scored["skill_details"][0]

    # Projects are capped at 2 mention events even if raw lines contain more.
    assert detail["raw_section_mentions"]["projects"] == 3
    assert detail["capped_section_mentions"]["projects"] == 2
    assert detail["mentions"] == 3  # 2 from projects cap + 1 from work_experience
