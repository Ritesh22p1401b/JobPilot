"""Evidence-grounded cover letters. LLM drafts are verified; otherwise a deterministic template is used."""

from __future__ import annotations

import json
import re

from pydantic import BaseModel, Field

from app.schemas.jd import SKILL_CATEGORIES
from app.schemas.profile import CandidateProfileData
from app.services.claim_verifier import profile_source_text, verify_generated_text
from app.services.evidence import EvidenceMatrix
from app.services.llm import LLMClient, LLMOutputError, LLMUnavailable
from app.services.prompts import COVER_LETTER_WRITER


class _Letter(BaseModel):
    paragraphs: list[str] = Field(default_factory=list)


class CoverLetterResult(BaseModel):
    text: str
    source: str  # llm | template
    prompt_version: str | None = None
    rejected_reasons: list[str] = Field(default_factory=list)


def _lower_first(s: str) -> str:
    first = s.split(" ", 1)[0]
    return s if first.isupper() and len(first) > 1 else s[:1].lower() + s[1:]


def matched_evidence(matrix: EvidenceMatrix, limit: int = 6) -> list[dict]:
    out = []
    for it in matrix.items:
        if it.category in SKILL_CATEGORIES and it.status in ("SUPPORTED", "SEMANTIC_MATCH") and it.evidence:
            ev = next((e for e in it.evidence if e.section in ("experience", "projects")), None)
            if ev:
                out.append({"requirement": it.requirement, "tier": it.tier, "evidence": ev.text, "source_id": ev.source_id})
    return out[:limit]


def template_letter(profile: CandidateProfileData, title: str, company: str, matrix: EvidenceMatrix) -> str:
    name = profile.contact.name or ""
    matched = matched_evidence(matrix)
    skills = list(dict.fromkeys(m["requirement"] for m in matched))[:5]
    paras = [f"I am applying for the {title} position at {company}."]
    if skills:
        paras[0] += f" The role calls for {', '.join(skills)}, and each of these is demonstrated in my recent work."
    exp_by_id = {e.id: e for e in profile.experience}
    proj_by_id = {p.id: p for p in profile.projects}
    used: set[str] = set()
    sentences = []
    for m in matched:
        sid = m["source_id"]
        if sid in used or not sid:
            continue
        used.add(sid)
        bullet = m["evidence"].split(": ", 1)[-1].rstrip(".")
        if sid in exp_by_id:
            e = exp_by_id[sid]
            role = " at ".join(x for x in (e.title, e.company) if x)
            sentences.append(f"As {role}, I {_lower_first(bullet)}." if role else f"I {_lower_first(bullet)}.")
        elif sid in proj_by_id:
            sentences.append(f"In my project {proj_by_id[sid].name}, I {_lower_first(bullet)}.")
        if len(sentences) >= 3:
            break
    if sentences:
        paras.append(" ".join(sentences))
    edu = next((e for e in profile.education if e.degree), None)
    if edu:
        paras.append(f"I hold a {edu.degree}{' in ' + edu.field if edu.field else ''}"
                     f"{' from ' + edu.institution if edu.institution else ''}.")
    paras.append(f"I would welcome the opportunity to discuss how my experience fits the needs of the {title} role.")
    body = "\n\n".join(paras)
    return f"Dear Hiring Team,\n\n{body}\n\nSincerely,\n{name}".strip()


async def generate_cover_letter(profile: CandidateProfileData, title: str, company: str, matrix: EvidenceMatrix,
                                llm: LLMClient | None) -> CoverLetterResult:
    fallback = template_letter(profile, title, company, matrix)
    if llm is None or not await llm.is_enabled():
        return CoverLetterResult(text=fallback, source="template")
    facts = {
        "name": profile.contact.name,
        "titles_held": [f"{e.title} at {e.company}" for e in profile.experience if e.title][:4],
        "years_experience": profile.years_experience,
        "projects": [{"name": p.name, "bullets": p.bullets[:2]} for p in profile.projects[:3]],
        "education": [f"{e.degree} {e.field or ''} {e.institution or ''}".strip() for e in profile.education][:2],
        "verified_skills": sorted(profile.skill_names())[:40],
    }
    try:
        letter, meta = await llm.structured(
            COVER_LETTER_WRITER, _Letter, title=title, company=company,
            matched_json=json.dumps(matched_evidence(matrix)), facts_json=json.dumps(facts),
            company_facts=json.dumps({"name": company}),
        )
    except (LLMUnavailable, LLMOutputError) as exc:
        return CoverLetterResult(text=fallback, source="template", rejected_reasons=[str(exc)[:200]])
    text = "\n\n".join(p.strip() for p in letter.paragraphs if p.strip())
    source_text = profile_source_text(profile) + "\n" + company + "\n" + title
    ok, reasons = verify_generated_text(text, profile, source_text)
    salutation = re.search(r"\bDear\s+([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?", text)
    if salutation and salutation.group(1) not in ("Hiring",):
        ok = False
        reasons.append("Letter addresses a named person that is not in the provided facts.")
    if not ok or len(text.split()) < 60:
        return CoverLetterResult(text=fallback, source="template", prompt_version=meta.get("prompt_version"),
                                 rejected_reasons=reasons or ["Draft too short."])
    if not text.lower().startswith("dear"):
        text = "Dear Hiring Team,\n\n" + text
    if profile.contact.name and profile.contact.name not in text[-80:]:
        text += f"\n\nSincerely,\n{profile.contact.name}"
    return CoverLetterResult(text=text, source="llm", prompt_version=meta.get("prompt_version"))
