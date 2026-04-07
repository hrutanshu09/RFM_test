from services.resume_parser import _normalize_skill_list
from services.ta_jd_screening import _extract_candidate_years, _skill_component


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
    assert detail["mentions"] >= 4
    assert detail["score"] > 60


def test_experience_years_uses_date_ranges_before_explicit_year_hints():
    years, debug = _extract_candidate_years(
        ["Senior developer with 10+ years total experience. Worked 05/2021 \u2013 08/2023"]
    )

    # 28 months ~= 2.33 years from date range should win over "10+ years" hint.
    assert debug["method"] == "date_ranges"
    assert abs(years - 2.33) < 0.05
    assert debug["explicit_years_hint"] == 10.0
