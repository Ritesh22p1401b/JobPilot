from __future__ import annotations

import pytest

from app.services.dates import find_date_range, merged_months, months_between, parse_date_token
from app.services.resume_parser import parse_resume, split_sections
from app.services.skill_normalizer import extract_skills, normalize_skill, relation, unique_skills


@pytest.mark.parametrize("term,expected", [
    ("postgres", "PostgreSQL"), ("PostgreSQL", "PostgreSQL"), ("postgresql database", "PostgreSQL"),
    ("lang chain", "LangChain"), ("LangChain", "LangChain"), ("k8s", "Kubernetes"), ("JS", "JavaScript"),
    ("Node", "Node.js"), ("nodejs", "Node.js"), ("sklearn", "scikit-learn"), ("LLMs", "Large Language Models"),
    ("retrieval-augmented generation", "RAG"), ("golang", "Go"), ("unknown-thing", None),
])
def test_alias_normalisation(term, expected):
    assert normalize_skill(term) == expected


def test_extraction_ignores_english_words_in_prose():
    text = "I react quickly and excel at communication after our Series C round. Go to market."
    assert unique_skills(extract_skills(text)) == []


def test_extraction_in_skill_lists_and_prose():
    skills = unique_skills(extract_skills("Skills: Python, Go, R, C++, C#, React\nBuilt a RAG app with FastAPI and Postgres."))
    for s in ("Python", "Go", "R", "C++", "C#", "React", "RAG", "FastAPI", "PostgreSQL"):
        assert s in skills


def test_relations_never_upgrade_related_to_exact():
    assert relation("Kubernetes", {"Docker"}) == ("RELATED", "Docker")
    assert relation("PostgreSQL", {"PostgreSQL"}) == ("EXACT", "PostgreSQL")
    assert relation("postgres", {"PostgreSQL"})[0] == "EXACT"
    assert relation("Deep Learning", {"PyTorch"}) == ("SEMANTIC", "PyTorch")
    assert relation("PyTorch", {"Deep Learning"})[0] == "MISSING"  # broader skill does not imply a specific tool
    assert relation("Kubernetes", set())[0] == "MISSING"


@pytest.mark.parametrize("text,start,end,current", [
    ("Jan 2024 – Present", "2024-01", None, True),
    ("January 2022 - March 2023", "2022-01", "2023-03", False),
    ("01/2021 to 06/2022", "2021-01", "2022-06", False),
    ("2019 - 2023", "2019-01", "2023-12", False),
    ("Aug '23 – Current", "2023-08", None, True),
    ("2022-05 — 2023-02", "2022-05", "2023-02", False),
])
def test_date_ranges(text, start, end, current):
    s, e, cur, _ = find_date_range(text)
    assert (s, e, cur) == (start, end, current)


def test_month_arithmetic():
    assert parse_date_token("Sept 2020") == "2020-09"
    assert months_between("2024-01", "2024-12") == 12
    assert merged_months([("2020-01", "2020-12"), ("2020-06", "2021-06")]) == 18  # overlap counted once
    assert merged_months([("2020-01", "2020-03"), ("2021-01", "2021-03")]) == 6


def test_parse_sample_resume(sample_resume_text):
    result = parse_resume(sample_resume_text)
    p = result.profile
    assert p.contact.name == "Ritesh Pandey"
    assert p.contact.email == "ritesh.pandey@example.com"
    assert p.contact.phone and p.contact.phone.replace(" ", "").endswith("9876543210")
    assert p.contact.linkedin == "linkedin.com/in/ritesh-pandey"
    assert p.contact.github == "github.com/riteshpandey"
    assert p.contact.location == "Bengaluru, India"
    assert len(p.experience) == 2
    intern, dev = p.experience
    assert (intern.title, intern.company, intern.start_date, intern.current, intern.is_internship) == (
        "AI Intern", "Example AI Labs", "2026-01", True, True)
    assert (dev.title, dev.company, dev.start_date, dev.end_date) == ("Software Developer", "Acme Software Pvt Ltd", "2024-07", "2025-12")
    assert p.total_experience_months == 18
    assert p.education[0].degree_level == "bachelor" and p.education[0].grade == "8.4/10"
    assert [pr.name for pr in p.projects] == ["JobPilot AI", "Medical Chatbot"]
    assert {c.name for c in p.certifications} == {"AWS Certified Cloud Practitioner", "Deep Learning Specialization"}
    python = p.skill("Python")
    assert python and {"skills", "experience", "projects"} <= set(python.sections)
    mongo = p.skill("MongoDB")
    assert mongo and mongo.sections == ["skills"]  # listed only, no evidence
    assert "AI Engineer" in p.target_roles and "AI" not in p.target_roles
    assert result.warnings == []


def test_sections_and_missing_fields_warn():
    text = "Some Person\nNo headings here at all, just a paragraph about Python work."
    result = parse_resume(text)
    assert any("section headings" in w for w in result.warnings)
    assert any("email" in w.lower() for w in result.warnings)
    header, sections = split_sections("A B\nEXPERIENCE:\nfoo\nTechnical Skills\nPython")
    assert set(sections) == {"experience", "skills"}


def test_nonstandard_date_formats_and_paragraph_bullets():
    text = """Jane Roe
jane@example.com | +1 415 555 0100

Work Experience
Globex Corporation — Machine Learning Engineer
03/2020 to 12/2022
Designed recommendation systems in Python and PyTorch for the storefront.

Education
M.S. in Computer Science, Stanford University, 2019
"""
    p = parse_resume(text).profile
    e = p.experience[0]
    assert e.company == "Globex Corporation" and e.title == "Machine Learning Engineer"
    assert (e.start_date, e.end_date) == ("2020-03", "2022-12")
    assert e.bullets and "PyTorch" in e.skills
    assert p.education[0].degree_level == "master"
    assert p.total_experience_months == 34
