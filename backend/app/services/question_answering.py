"""Application question classification + answer lookup with confidence. Unknown answers are never invented."""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel

from app.schemas.preferences import Preferences
from app.schemas.profile import CandidateProfileData
from app.services.claim_verifier import profile_source_text, verify_generated_text
from app.services.dates import merged_months
from app.services.evidence import EvidenceMatrix
from app.services.llm import LLMClient, LLMOutputError, LLMUnavailable
from app.services.prompts import APPLICATION_ANSWER_DRAFTER
from app.services.skill_normalizer import extract_skills, relation

Category = Literal["PERSONAL", "EDUCATION", "EXPERIENCE", "TECHNICAL", "SALARY", "LOCATION", "WORK_AUTHORIZATION",
                   "VISA", "DEMOGRAPHIC", "CUSTOM"]
Confidence = Literal["HIGH", "MEDIUM", "LOW", "UNKNOWN"]
SENSITIVE = {"SALARY", "VISA", "WORK_AUTHORIZATION", "DEMOGRAPHIC"}

_RULES: list[tuple[Category, re.Pattern[str]]] = [
    ("DEMOGRAPHIC", re.compile(r"\b(gender|race|racial|ethnic|veteran|disabilit|sexual orientation|pronoun|hispanic|"
                               r"latin[oax]|date of birth|marital|religion|caste)\b", re.I)),
    ("VISA", re.compile(r"\b(visa|sponsor)", re.I)),
    ("WORK_AUTHORIZATION", re.compile(r"authori[sz]ed to work|work permit|right to work|legally (?:eligible|able|authori)|"
                                      r"citizenship|\bcitizen\b|eligible to work", re.I)),
    ("SALARY", re.compile(r"\b(salary|compensation|ctc|expected pay|pay expectation|remuneration|notice period)\b", re.I)),
    ("LOCATION", re.compile(r"\b(relocat\w*|location|where are you (?:based|located)|commute|on-?site|hybrid|"
                            r"current city|willing to work from)\b", re.I)),
    ("PERSONAL", re.compile(r"^\s*(first name|last name|full name|name|e-?mail|email address|phone|mobile|linkedin|"
                            r"github|portfolio|website|personal site)\b", re.I)),
    ("EDUCATION", re.compile(r"\b(degree|university|college|gpa|cgpa|graduat\w*|education|school)\b", re.I)),
    ("EXPERIENCE", re.compile(r"\b(years? of (?:professional )?experience|how many years|how long have you)\b", re.I)),
    ("TECHNICAL", re.compile(r"\b(experience (?:with|in|using)|proficien\w*|familiar\w* with|have you (?:used|worked))\b", re.I)),
]


class AnswerDraft(BaseModel):
    question: str
    category: Category
    answer: str | None
    confidence: Confidence
    requires_approval: bool
    source: str
    reason: str
    required: bool = False
    field_name: str | None = None


def classify(question: str) -> Category:
    for cat, rx in _RULES:
        if rx.search(question):
            return cat
    return "CUSTOM"


def _skill_months(profile: CandidateProfileData, skill: str) -> int:
    intervals: list[tuple[str | None, str | None]] = [
        (e.start_date, e.end_date) for e in profile.experience if skill in e.skills and e.start_date]
    return merged_months(intervals)


async def answer_question(question: str, profile: CandidateProfileData, prefs: Preferences | None,
                          matrix: EvidenceMatrix | None, job_title: str, company: str, llm: LLMClient | None,
                          required: bool = False, field_name: str | None = None) -> AnswerDraft:
    cat = classify(question)
    q = question.lower()
    answer: str | None = None
    conf: Confidence = "UNKNOWN"
    source = "none"
    reason = "Information not available in your verified profile."
    c = profile.contact

    if cat == "PERSONAL":
        mapping = [("first name", (c.name or "").split(" ")[0] or None), ("last name", " ".join((c.name or "").split(" ")[1:]) or None),
                   ("name", c.name), ("mail", c.email), ("phone", c.phone), ("mobile", c.phone),
                   ("linkedin", c.linkedin), ("github", c.github), ("portfolio", c.portfolio), ("website", c.portfolio)]
        for key, val in mapping:
            if key in q:
                answer, source = val, "profile.contact"
                break
        if answer:
            conf, reason = "HIGH", "Taken verbatim from your resume contact details."
    elif cat == "EDUCATION":
        edu = next((e for e in profile.education if e.degree), None)
        if edu and re.search(r"\b(c?gpa|grade|percentage)\b", q):
            if edu.grade:
                answer, conf, source, reason = edu.grade, "HIGH", f"education.{edu.id}", "Grade from your resume."
        elif edu:
            answer = ", ".join(x for x in (f"{edu.degree}{' in ' + edu.field if edu.field else ''}", edu.institution) if x)
            conf, source, reason = "HIGH", f"education.{edu.id}", "Highest listed degree from your resume."
    elif cat == "EXPERIENCE":
        skills = [m.skill for m in extract_skills(question)]
        if skills:
            months = _skill_months(profile, skills[0])
            if months:
                answer = f"{months / 12:.1f}"
                conf, source = "MEDIUM", "experience dates"
                reason = f"Sum of dated roles that mention {skills[0]}; review rounding before submitting."
        elif profile.experience:
            answer = f"{profile.years_experience:.1f}"
            conf, source = "MEDIUM", "experience dates"
            reason = (f"Full-time experience from resume dates (internships: {profile.internship_months} months "
                      "not included). Review before submitting.")
    elif cat == "TECHNICAL":
        skills = [m.skill for m in extract_skills(question)]
        if skills:
            kind, via = relation(skills[0], profile.skill_names())
            status = None
            if matrix:
                status = next((i.status for i in matrix.items if i.skill == skills[0]), None)
            if kind == "EXACT":
                answer, source = "Yes", "skills evidence"
                conf = "HIGH" if status in (None, "SUPPORTED") else "MEDIUM"
                reason = f"{skills[0]} is evidenced in your resume."
            elif kind == "SEMANTIC":
                answer, conf, source = "Yes", "MEDIUM", "skills evidence"
                reason = f"Evidenced via {via}; confirm this answers the question."
            else:
                reason = f"No evidence of {skills[0]} in your resume. Answer this yourself; it will not be guessed."
    elif cat == "SALARY":
        if prefs and prefs.minimum_salary and "notice" not in q:
            answer = f"{prefs.minimum_salary:,.0f} {prefs.currency}"
            conf, source, reason = "MEDIUM", "preferences.minimum_salary", "Your configured minimum salary. Confirm before submitting."
    elif cat == "LOCATION":
        if "relocat" in q:
            reason = "Relocation willingness must come from you."
        elif prefs and prefs.locations:
            answer = ", ".join(prefs.locations)
            conf, source, reason = "MEDIUM", "preferences.locations", "Your preferred locations."
        elif c.location:
            answer, conf, source, reason = c.location, "MEDIUM", "profile.contact.location", "Location from your resume."
    elif cat == "VISA":
        if prefs is not None and prefs.visa_sponsorship_required is not None:
            answer = "Yes" if prefs.visa_sponsorship_required else "No"
            conf, source, reason = "MEDIUM", "preferences.visa_sponsorship_required", "From your explicit preference setting."
        else:
            reason = "Visa status is never inferred. Please answer."
    elif cat == "WORK_AUTHORIZATION":
        if prefs and prefs.work_authorization_countries:
            answer = "Authorized to work in: " + ", ".join(prefs.work_authorization_countries)
            conf, source, reason = "MEDIUM", "preferences.work_authorization_countries", "From your explicit settings."
        else:
            reason = "Work authorization is never inferred. Please answer."
    elif cat == "DEMOGRAPHIC":
        reason = "Demographic questions are always left for you to answer (or decline)."
    elif cat == "CUSTOM" and llm is not None and await llm.is_enabled():
        facts = {"titles": [f"{e.title} at {e.company}" for e in profile.experience][:4],
                 "skills": sorted(profile.skill_names())[:30], "projects": [p.name for p in profile.projects][:4],
                 "summary": profile.summary}
        try:
            class _A(BaseModel):
                answer: str | None = None
                used_facts: list[str] = []

            draft, _meta = await llm.structured(APPLICATION_ANSWER_DRAFTER, _A, question=question, title=job_title,
                                                company=company, facts_json=json.dumps(facts))
            if draft.answer:
                ok, reasons = verify_generated_text(draft.answer, profile, profile_source_text(profile))
                if ok:
                    answer, conf, source = draft.answer, "LOW", "llm draft from verified facts"
                    reason = "AI-drafted from your verified facts. Review and personalise before submitting."
                else:
                    reason = "AI draft rejected by claim verification: " + "; ".join(reasons)
        except (LLMUnavailable, LLMOutputError) as exc:
            reason = f"Could not draft an answer: {str(exc)[:120]}"

    if answer is None:
        conf = "UNKNOWN"
    approval_cats = set(prefs.require_user_approval_for) if prefs else SENSITIVE | {"CUSTOM"}
    requires_approval = conf != "HIGH" or cat in approval_cats or cat in {"DEMOGRAPHIC"}
    return AnswerDraft(question=question, category=cat, answer=answer, confidence=conf, requires_approval=requires_approval,
                       source=source, reason=reason, required=required, field_name=field_name)


DEFAULT_QUESTIONS = [
    "Full name", "Email", "Phone", "LinkedIn profile", "What is your highest degree?",
    "How many years of professional experience do you have?", "What are your salary expectations?",
    "Will you now or in the future require visa sponsorship?", "Are you legally authorized to work in this country?",
    "Why are you interested in this role?",
]
