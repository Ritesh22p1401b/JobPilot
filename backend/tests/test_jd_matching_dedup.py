from __future__ import annotations

from app.schemas.job import RawJob
from app.schemas.preferences import Preferences
from app.services.deduplicator import ExistingJob, decide
from app.services.evidence import build_evidence_matrix
from app.services.html_text import html_to_text
from app.services.jd_parser import analyze_job_description, infer_seniority
from app.services.matcher import JobFacts, compute_match
from app.services.normalizer import normalize_job
from app.services.resume_parser import parse_resume


def _req(analysis, name):
    return next(r for r in analysis.requirements if (r.skill or r.requirement) == name)


def test_jd_classification_and_spans(sample_jd_text):
    a = analyze_job_description("LLM Engineer", sample_jd_text)
    assert a.has_explicit_sections
    assert {"Python", "Large Language Models", "RAG", "FastAPI", "Docker"} <= set(a.required_skills)
    assert "Kubernetes" in a.nice_to_have_skills and "Kubernetes" not in a.required_skills
    assert "AWS" in a.nice_to_have_skills  # "is a plus" inline cue
    assert a.min_years == 2
    assert a.work_mode == "hybrid"
    k = _req(a, "Kubernetes")
    assert k.source_span == "Kubernetes" and k.importance < 0.5
    for r in a.requirements:  # every requirement is traceable to the JD
        assert r.source_span and (r.category in ("JOB_TITLE", "DOMAIN") or r.source_span.lower() in sample_jd_text.lower())
    # Nothing from the "Benefits" context section becomes a requirement
    assert not any("insurance" in r.requirement.lower() for r in a.requirements)


def test_jd_without_sections_and_seniority():
    a = analyze_job_description("Senior Backend Engineer", "We use Go and PostgreSQL. 5+ years of experience required.")
    assert "PostgreSQL" in a.required_skills
    assert a.seniority == "senior" and a.min_years == 5
    assert infer_seniority("Software Engineer", 1) == "entry"
    assert infer_seniority("Machine Learning Intern", None) == "intern"


def test_html_to_text_handles_escaped_greenhouse_content():
    html = "&lt;h3&gt;Requirements&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;li&gt;Docker &amp;amp; AWS&lt;/li&gt;&lt;/ul&gt;"
    text = html_to_text(html)
    assert "Requirements" in text and "• Python" in text and "Docker & AWS" in text


def test_evidence_matrix_statuses(sample_resume_text, sample_jd_text):
    profile = parse_resume(sample_resume_text).profile
    a = analyze_job_description("LLM Engineer", sample_jd_text)
    m = {i.requirement: i for i in build_evidence_matrix(a, profile).items}
    assert m["Python"].status == "SUPPORTED" and m["Python"].evidence
    assert m["Kubernetes"].status == "RELATED_BUT_NOT_MATCH" and not m["Kubernetes"].matched
    assert m["AWS"].status in ("PARTIALLY_SUPPORTED", "MISSING")  # only a certificate, not demonstrated
    exp = next(i for i in m.values() if i.category == "REQUIRED_EXPERIENCE")
    assert exp.status == "PARTIALLY_SUPPORTED" and not exp.matched  # 1.5y + internship vs 2+ years
    comm = m["communication"]
    assert comm.status == "UNKNOWN"  # soft skills are never marked missing


def test_match_scores_are_traceable_and_reproducible(sample_resume_text, sample_jd_text):
    profile = parse_resume(sample_resume_text).profile
    a = analyze_job_description("LLM Engineer", sample_jd_text)
    prefs = Preferences(target_titles=["LLM Engineer", "AI Engineer"], locations=["Bengaluru"], work_modes=["hybrid", "remote"],
                        employment_types=["full_time"], experience_level="entry")
    job = JobFacts(title="LLM Engineer", company="FinCo", location="Bengaluru, India", remote=False, work_mode="hybrid",
                   employment_type="full_time", salary_min=None, salary_max=None, currency="INR", seniority=None)
    matrix = build_evidence_matrix(a, profile, prefs)
    r1 = compute_match(job, a, matrix, profile, prefs, semantic_similarity=0.7)
    r2 = compute_match(job, a, matrix, profile, prefs, semantic_similarity=0.7)
    assert r1 == r2
    assert r1.hard_filter_passed
    assert "Kubernetes" in r1.missing_nice_to_have_skills and "Kubernetes" not in r1.missing_required_skills
    assert r1.role_score == 100
    total = sum(c.score * c.weight for c in r1.components.values())
    assert abs(total - r1.overall_score) < 0.2
    assert all(c.reason for c in r1.components.values())
    assert 60 <= r1.overall_score <= 100


def test_hard_filters():
    profile = parse_resume("A Person\na@b.com\nExperience\nIntern | X\nJan 2026 - Present\n• Python").profile
    a = analyze_job_description("Staff Engineer", "10+ years of experience with Python required. Visa sponsorship is not available.")
    prefs = Preferences(locations=["Pune"], work_modes=["onsite"], experience_level="entry", visa_sponsorship_required=True)
    job = JobFacts(title="Staff Engineer", company="X", location="London, UK", remote=False, work_mode=None,
                   employment_type="full_time", salary_min=None, salary_max=None, currency=None, seniority="lead")
    r = compute_match(job, a, build_evidence_matrix(a, profile, prefs), profile, prefs)
    assert not r.hard_filter_passed
    text = " ".join(r.hard_filter_reasons)
    assert "London" in text and "seniority" in text and "sponsorship" in text


def _raw(**kw):
    base = dict(source="greenhouse", external_id="b:1", company="Acme Inc.", title="AI Engineer", location="Bengaluru",
                description="<p>Build RAG systems with Python and LangChain for our customers.</p>" * 3, url="https://x/1")
    base.update(kw)
    return RawJob(**base)


def test_normalize_and_dedup():
    a = normalize_job(_raw())
    assert a.job_id == "greenhouse:b:1" and "RAG" in a.skills and a.url
    ex = [ExistingJob("id1", a.source, a.external_id, a.company, a.title, a.location, a.fingerprint, a.description)]
    assert decide(a, ex).kind == "same_record"
    same_content_other_source = normalize_job(_raw(source="adzuna", external_id="999", company="ACME"))
    assert decide(same_content_other_source, ex).kind == "fingerprint_duplicate"
    truncated = normalize_job(_raw(source="adzuna", external_id="998", title="AI  Engineer",
                                   description="Build RAG systems with Python and LangChain for our customers. Build RAG"))
    assert decide(truncated, ex).kind in ("fuzzy_duplicate", "fingerprint_duplicate")
    different = normalize_job(_raw(source="adzuna", external_id="997", title="Sales Manager", description="Sell things."))
    assert decide(different, ex).kind == "new"


def test_remote_and_employment_detection():
    j = normalize_job(_raw(title="Machine Learning Intern", location="Remote - India"))
    assert j.remote and j.employment_type == "internship" and j.seniority == "intern"


def _facts(title, location, remote):
    return JobFacts(title=title, company="X", location=location, remote=remote, work_mode="remote" if remote else None,
                    employment_type="full_time", salary_min=None, salary_max=None, currency=None, seniority=None)


def test_live_regressions_role_function_and_remote_country(sample_resume_text):
    """Cases observed in live Greenhouse data: sales/product roles with 'AI' in the title, and US-only remote roles."""
    profile = parse_resume(sample_resume_text).profile
    prefs = Preferences(target_titles=["AI Engineer", "Machine Learning Engineer"], locations=["Bengaluru", "Remote"],
                        work_modes=["remote", "hybrid"], experience_level="entry")
    a = analyze_job_description("x", "Requirements:\n- Python\n- LLMs")

    def run(title, location, remote):
        return compute_match(_facts(title, location, remote), a, build_evidence_matrix(a, profile, prefs), profile, prefs)

    sales = run("Strategic Account Executive, AI - San Francisco", "Remote, US", True)
    assert not sales.hard_filter_passed and any("Role function" in r for r in sales.hard_filter_reasons)
    owner = run("AI Transformation Owner, Product & Design", "Remote, India", True)
    assert not owner.hard_filter_passed and owner.role_score <= 5
    us_remote = run("AI Engineer", "Remote, Canada; Remote, United States", True)
    assert not us_remote.hard_filter_passed and "limited to" in us_remote.components["location"].reason
    india_remote = run("AI Engineer", "Remote - India", True)
    assert india_remote.hard_filter_passed and india_remote.location_score == 100
    anywhere = run("AI Engineer", "Remote - Anywhere", True)
    assert anywhere.hard_filter_passed
    scientist = run("Research Scientist, LLMs", "Bengaluru", False)
    assert scientist.hard_filter_passed and scientist.role_score <= 60  # adjacent technical family: soft penalty


def test_skill_score_is_smoothed_when_few_requirements(sample_resume_text):
    profile = parse_resume(sample_resume_text).profile
    a = analyze_job_description("AI Engineer", "Requirements:\n- Python")
    r = compute_match(_facts("AI Engineer", "Bengaluru", False), a, build_evidence_matrix(a, profile), profile, None)
    assert r.skill_score == 70.0  # (100*1 + 50*1.5) / 2.5: 1/1 matched is evidence, but not certainty
