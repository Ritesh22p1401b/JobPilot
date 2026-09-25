from __future__ import annotations

import pytest

from app.services.ats.achievement import analyze_bullet
from app.services.ats.formatting_test import run_formatting_test
from app.services.ats.parser_test import round_trip
from app.services.ats.profiles import get_profile
from app.services.ats.report_builder import assess_document
from app.services.ats.score_engine import quality_index
from app.services.jd_parser import analyze_job_description
from app.services.resume_document import TEMPLATES, content_from_profile, render_docx, render_pdf, render_txt
from app.services.resume_parser import parse_resume
from app.services.text_extraction import ExtractionError, extract
from tests.golden_layouts import GOLDEN


@pytest.fixture
def profile(sample_resume_text):
    return parse_resume(sample_resume_text).profile


@pytest.mark.parametrize("template", list(TEMPLATES))
@pytest.mark.parametrize("fmt", ["docx", "pdf"])
def test_generated_resumes_round_trip(profile, template, fmt):
    """Every template must survive DOCX/PDF generation -> extraction -> parsing with high fidelity."""
    content = content_from_profile(profile, template)
    data = render_docx(content) if fmt == "docx" else render_pdf(content)
    doc = extract(f"r.{fmt}", data)
    reparsed = parse_resume(doc.text).profile
    rt = round_trip(profile, reparsed)
    assert rt.score is not None and rt.score >= 95, rt.details
    fmt_result = run_formatting_test(doc, reparsed, get_profile("generic"))
    assert fmt_result.score == 100, [i.message for i in fmt_result.issues]


def test_txt_rendering_contains_body_contact(profile):
    txt = render_txt(content_from_profile(profile))
    assert "ritesh.pandey@example.com" in txt.splitlines()[1]


def test_certificate_only_skills_not_promoted_to_skill_list(profile):
    content = content_from_profile(profile)
    listed = {s for items in content.skills.values() for s in items}
    assert "Python" in listed and "Deep Learning" not in listed


@pytest.mark.parametrize("name", list(GOLDEN))
def test_golden_layout_risks_are_detected(name):
    ext, builder, expected = GOLDEN[name]
    doc = extract(f"golden.{ext}", builder())
    parsed = parse_resume(doc.text).profile
    result = run_formatting_test(doc, parsed, get_profile("generic"))
    found = {i.type for i in result.issues}
    assert expected <= found, f"{name}: expected {expected}, got {found}"
    if not expected:
        assert result.score == 100
    else:
        assert result.score < 100


def test_header_only_contact_is_not_visible_to_body_parser():
    ext, builder, _ = GOLDEN["header_contact"]
    doc = extract("g.docx", builder())
    assert parse_resume(doc.text).profile.contact.email is None
    assert any("asha.verma@example.com" in t for t in doc.layout["header_footer_text"])


def test_greenhouse_profile_penalises_tables_more():
    ext, builder, _ = GOLDEN["tables"]
    doc = extract("g.docx", builder())
    parsed = parse_resume(doc.text).profile
    generic = run_formatting_test(doc, parsed, get_profile("generic")).score
    gh = run_formatting_test(doc, parsed, get_profile("greenhouse_style")).score
    assert gh < generic


def test_invalid_uploads_rejected():
    with pytest.raises(ExtractionError):
        extract("resume.pdf", b"not really a pdf")
    with pytest.raises(ExtractionError):
        extract("resume.exe", b"MZ\x90\x00binary")
    with pytest.raises(ExtractionError):
        extract("resume.docx", b"PK\x03\x04garbage")


def test_full_assessment_report(profile, sample_jd_text):
    analysis = analyze_job_description("LLM Engineer", sample_jd_text)
    content = content_from_profile(profile, "ats_ai_ml")
    report = assess_document("r.docx", render_docx(content), master=profile, reference=profile, analysis=analysis,
                             jd_text=sample_jd_text, prefs=None)
    names = {t.name for t in report.tests}
    for required in ("text_extraction", "contact_extraction", "section_extraction", "experience_extraction",
                     "skills_extraction", "date_extraction", "requirement_coverage", "evidence_integrity",
                     "formatting_compatibility", "hallucination_check", "round_trip_parsing", "keyword_coverage", "length"):
        assert required in names
    assert report.unsupported_claims == 0 and not report.critical_failures
    assert report.assessment in ("STRONG", "GOOD")
    assert "not a vendor" in report.disclaimer and "does not predict" in report.disclaimer
    kube = next(k for k in report.keywords if k.keyword == "Kubernetes")
    assert kube.classification == "RELATED_TERM" and not kube.resume_present
    matrix = {r["requirement"]: r for r in report.requirement_matrix}
    assert matrix["Python"]["matched"] is True and matrix["Kubernetes"]["matched"] is False
    assert abs(sum(report.component_weights.values()) - 1) < 1e-6


def test_hallucination_check_flags_invented_content(profile, sample_jd_text):
    content = content_from_profile(profile)
    content.experience[0].bullets[0].text = "Led a team of 12 engineers building Kubernetes platforms at Google, cutting costs 40%."
    content.skills["DevOps & Infrastructure"].append("Kubernetes")
    report = assess_document("r.docx", render_docx(content), master=profile, reference=profile, analysis=None,
                             jd_text="", prefs=None)
    h = next(t for t in report.tests if t.name == "hallucination_check")
    assert h.status == "FAIL" and h.critical
    msgs = " ".join(i.message for i in h.issues)
    assert "Kubernetes" in msgs and "40%" in msgs
    assert report.assessment == "NEEDS_REVIEW"


def test_quality_index_redistributes_missing_components():
    score, weights = quality_index({"parser_compatibility": 100, "formatting_compatibility": 50, "requirement_coverage": None},
                                   get_profile("generic"))
    assert weights == {"parser_compatibility": pytest.approx(0.6667, abs=1e-3), "formatting_compatibility": pytest.approx(0.3333, abs=1e-3)}
    assert score == pytest.approx(83.3, abs=0.1)


def test_achievement_analysis():
    weak = analyze_bullet("Worked on an AI chatbot.")
    strong = analyze_bullet("Developed a Python RAG chatbot over internal documentation, reducing manual lookup time by 40%.")
    assert strong["score"] > weak["score"]
    assert strong["metric"] and strong["technology"] and strong["result"]
