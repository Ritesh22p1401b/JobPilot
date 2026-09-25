"""The system must never fabricate: rewrites, summaries, cover letters and answers are verified."""

from __future__ import annotations

import pytest

from app.schemas.preferences import Preferences
from app.services.claim_verifier import verify_document, verify_generated_text, verify_rewrite
from app.services.cover_letter import generate_cover_letter, template_letter
from app.services.evidence import build_evidence_matrix
from app.services.jd_parser import analyze_job_description
from app.services.question_answering import answer_question, classify
from app.services.resume_diff import diff_contents
from app.services.resume_document import content_from_profile
from app.services.resume_parser import parse_resume
from app.services.tailoring import tailor


@pytest.fixture
def profile(sample_resume_text):
    return parse_resume(sample_resume_text).profile


@pytest.fixture
def analysis(sample_jd_text):
    return analyze_job_description("LLM Engineer", sample_jd_text)


ORIGINAL = "Built a RAG pipeline in Python using LangChain and Qdrant for document question answering."


@pytest.mark.parametrize("rewrite,ok", [
    ("Developed a Python RAG pipeline with LangChain and Qdrant for document question answering.", True),
    ("Built a document question-answering RAG pipeline in Python using LangChain and Qdrant.", True),
    ("Built a RAG pipeline in Python using LangChain, Qdrant and Kubernetes for document QA.", False),  # new tech
    ("Built a RAG pipeline in Python that cut support tickets by 35%.", False),  # invented metric
    ("Led a team building a RAG pipeline in Python using LangChain and Qdrant.", False),  # scope inflation
    ("Built a RAG pipeline at Microsoft using Python, LangChain and Qdrant.", False),  # invented employer
    ("Managed cloud infrastructure budgets.", False),  # unrelated
])
def test_verify_rewrite(rewrite, ok):
    result, reasons = verify_rewrite(ORIGINAL, rewrite)
    assert result is ok, reasons


def test_verify_generated_text(profile):
    src = "\n".join(b for e in profile.experience for b in e.bullets)
    assert verify_generated_text("AI engineer experienced with Python, FastAPI and RAG.", profile, src)[0]
    ok, reasons = verify_generated_text("AI engineer with 7 years of Kubernetes experience.", profile, src)
    assert not ok and any("Kubernetes" in r for r in reasons) and any("7" in r for r in reasons)


async def test_deterministic_tailoring_reorders_without_inventing(profile, analysis):
    master = content_from_profile(profile)
    matrix = build_evidence_matrix(analysis, profile)
    result = await tailor(profile, master, analysis, matrix, llm=None, use_llm=False)
    content = result.content
    assert content.template == "ats_ai_ml"
    first_cat = next(iter(content.skills))
    assert set(content.skills[first_cat]) & {"Python", "RAG", "Large Language Models", "FastAPI"}
    assert all(c.verified for c in verify_document(content, profile))
    assert {s for v in content.skills.values() for s in v} == {s for v in master.skills.values() for s in v}
    assert content.experience[0].bullets[0].source_index is not None
    d = diff_contents(master, content)
    assert d.unsupported_additions == 0 and "REORDERED" in d.counts
    # The master content object is never mutated.
    assert master.template == "ats_classic"


async def test_llm_tailoring_rejects_hallucinated_rewrites(profile, analysis, fake_llm):
    def rewrites(vars_):
        lines = [ln.split(": ", 1) for ln in vars_["bullets"].splitlines()]
        out = []
        for idx, text in lines:
            i = int(idx)
            if i == 0:
                out.append({"index": i, "text": text.rstrip(".") + ", improving answer accuracy by 45%."})  # invented metric
            elif i == 1:
                out.append({"index": i, "text": "Engineered " + text[0].lower() + text[1:]})  # truthful rephrase
            else:
                out.append({"index": i, "text": text + " Deployed on Kubernetes."})  # invented tech
        return {"rewrites": out}

    fake_llm.responses = {
        "resume_bullet_rewriter": rewrites,
        "resume_summary_writer": {"summary": "AI engineer with 10 years of experience leading Kubernetes teams."},
    }
    master = content_from_profile(profile)
    matrix = build_evidence_matrix(analysis, profile)
    result = await tailor(profile, master, analysis, matrix, llm=fake_llm, use_llm=True)
    assert result.llm_used and result.rewrites_accepted >= 1 and result.rejected_rewrites
    texts = " ".join(b.text for b in result.content.all_bullets())
    assert "45%" not in texts and "Kubernetes" not in texts
    assert "10 years" not in (result.content.summary or "")  # rejected summary -> original kept
    assert result.content.summary == profile.summary
    assert all(c.verified for c in verify_document(result.content, profile))


async def test_cover_letter_template_and_llm_verification(profile, analysis, fake_llm):
    matrix = build_evidence_matrix(analysis, profile)
    letter = template_letter(profile, "LLM Engineer", "FinCo", matrix)
    assert letter.startswith("Dear Hiring Team") and "Ritesh Pandey" in letter and "Kubernetes" not in letter
    fake_llm.responses = {"cover_letter_writer": {"paragraphs": [
        "Dear John Smith,", "I increased revenue by 300% using Kubernetes at FinCo for 9 years. " * 3]}}
    res = await generate_cover_letter(profile, "LLM Engineer", "FinCo", matrix, fake_llm)
    assert res.source == "template" and res.rejected_reasons
    fake_llm.responses = {"cover_letter_writer": {"paragraphs": [
        "Dear Hiring Team,",
        "I am applying for the LLM Engineer role at FinCo. In my AI internship I built a RAG pipeline in Python using "
        "LangChain and Qdrant, and developed REST APIs with FastAPI and PostgreSQL to serve LLM responses.",
        "I have also built Django applications and React dashboards, and I containerized services with Docker.",
        "I would welcome the chance to discuss the role."]}}
    res = await generate_cover_letter(profile, "LLM Engineer", "FinCo", matrix, fake_llm)
    assert res.source == "llm"


@pytest.mark.parametrize("q,cat", [
    ("What is your gender?", "DEMOGRAPHIC"), ("Will you require visa sponsorship?", "VISA"),
    ("Are you legally authorized to work in India?", "WORK_AUTHORIZATION"), ("Expected CTC?", "SALARY"),
    ("Email", "PERSONAL"), ("What is your highest degree?", "EDUCATION"),
    ("How many years of experience do you have with Python?", "EXPERIENCE"),
    ("Do you have experience with Kubernetes?", "TECHNICAL"), ("Why do you want to join us?", "CUSTOM"),
    ("Are you willing to relocate?", "LOCATION"),
])
def test_question_classification(q, cat):
    assert classify(q) == cat


async def test_answers_never_invented(profile, analysis):
    matrix = build_evidence_matrix(analysis, profile)
    prefs = Preferences(minimum_salary=800000, currency="INR")

    async def ask(q):
        return await answer_question(q, profile, prefs, matrix, "LLM Engineer", "FinCo", None)

    email = await ask("Email")
    assert email.answer == "ritesh.pandey@example.com" and email.confidence == "HIGH" and not email.requires_approval
    assert (await ask("Do you have experience with FastAPI?")).answer == "Yes"
    kube = await ask("Do you have experience with Kubernetes?")
    assert kube.answer is None and kube.confidence == "UNKNOWN"
    visa = await ask("Will you now or in the future require visa sponsorship?")
    assert visa.answer is None and visa.requires_approval  # never inferred
    gender = await ask("What is your gender?")
    assert gender.answer is None and gender.requires_approval
    salary = await ask("What are your salary expectations?")
    assert salary.answer == "800,000 INR" and salary.requires_approval
    years = await ask("How many years of experience do you have with Python?")
    assert years.answer is not None and years.confidence == "MEDIUM"
    why = await ask("Why do you want to join us?")
    assert why.answer is None  # no LLM -> unknown, not guessed
    explicit = Preferences(visa_sponsorship_required=False)
    v2 = await answer_question("Do you require sponsorship?", profile, explicit, matrix, "x", "y", None)
    assert v2.answer == "No" and v2.requires_approval
