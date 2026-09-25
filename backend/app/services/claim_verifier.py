"""Claim verification: every generated statement must be traceable to verified candidate evidence.

Checks for a rewritten bullet (original -> rewritten):
* no new numbers / metrics;
* no new technologies (only skills in the original bullet or skills it genuinely implies);
* no new proper nouns (employers, products, certifications);
* no scope inflation verbs (led, managed, ...) absent from the original;
* the rewrite must still be about the same thing (content-word overlap).
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from app.schemas.profile import CandidateProfileData
from app.schemas.resume import ResumeContent
from app.services.skill_normalizer import extract_skills, implied_by, normalize_skill, unique_skills

NUMBER_RE = re.compile(r"(?<![A-Za-z])\d+(?:[.,]\d+)?\s*(?:%|x|k|m|\+)?", re.I)
INFLATION = {"led", "lead", "managed", "spearheaded", "architected", "owned", "headed", "directed", "mentored",
             "supervised", "pioneered", "launched", "founded", "senior", "principal", "million", "billion",
             "increased", "reduced", "improved", "saved", "grew", "boosted", "doubled", "tripled", "revenue"}
_STOP = {"a", "an", "the", "and", "or", "of", "to", "in", "for", "with", "on", "using", "by", "from", "as", "at",
         "that", "this", "via", "into", "over", "based", "through", "across", "its", "their", "is", "are", "was"}
_COMMON_CAPS = {"I", "API", "APIs", "REST", "UI", "UX", "AI", "ML", "LLM", "LLMs", "RAG", "NLP", "SQL", "Q&A",
                "CRUD", "JSON", "HTTP", "CI", "CD", "ETL", "PDF", "DOCX", "CSV", "OCR"}


class ClaimCheck(BaseModel):
    claim: str
    section: str
    source_type: str
    source_id: str | None = None
    original: str | None = None
    verified: bool
    confidence: float = 1.0
    reasons: list[str] = Field(default_factory=list)


def numbers(text: str) -> set[str]:
    return {re.sub(r"\s+", "", m.group(0)).rstrip("+").replace(",", "").lower() for m in NUMBER_RE.finditer(text)}


def _content_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#.]+", text.lower()) if w not in _STOP and len(w) > 2}


def _stem(w: str) -> str:
    return re.sub(r"(ing|ed|es|s)$", "", w.lower())


def _proper_nouns(text: str) -> set[str]:
    out = set()
    for sentence in re.split(r"(?<=[.;:!?])\s+", text):
        tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#.&\-]*", sentence)
        for i, tok in enumerate(tokens):
            if i == 0 or tok in _COMMON_CAPS:
                continue
            if tok[0].isupper() and not normalize_skill(tok):
                out.add(tok.strip(".").lower())
    return out


def allowed_skills_for(text: str) -> set[str]:
    base = set(unique_skills(extract_skills(text, list_context=False)))
    base |= set(unique_skills(extract_skills(text, list_context=True)))
    allowed = set(base)
    for s in base:
        allowed |= implied_by(s)
    return allowed


def verify_rewrite(original: str, rewritten: str) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if not rewritten.strip():
        return False, ["Empty rewrite."]
    new_nums = numbers(rewritten) - numbers(original)
    if new_nums:
        reasons.append(f"Introduces numbers not in the source: {', '.join(sorted(new_nums))}.")
    new_skills = set(unique_skills(extract_skills(rewritten))) - allowed_skills_for(original)
    if new_skills:
        reasons.append(f"Introduces technologies not in the source: {', '.join(sorted(new_skills))}.")
    orig_lower = original.lower()
    new_nouns = {n for n in _proper_nouns(rewritten) if n not in orig_lower}
    if new_nouns:
        reasons.append(f"Introduces names not in the source: {', '.join(sorted(new_nouns))}.")
    orig_words = {_stem(w) for w in re.findall(r"[a-z]+", orig_lower)}
    inflated = {w for w in re.findall(r"[a-z]+", rewritten.lower()) if w in INFLATION and _stem(w) not in orig_words}
    if inflated:
        reasons.append(f"Inflates scope/impact with: {', '.join(sorted(inflated))}.")
    ow = {_stem(w) for w in _content_words(original)}
    rw = {_stem(w) for w in _content_words(rewritten)}
    if ow and len(ow & rw) / len(ow) < 0.3:
        reasons.append("Rewrite no longer describes the original work.")
    if len(rewritten) > 2 * len(original) + 80:
        reasons.append("Rewrite is much longer than the source.")
    return not reasons, reasons


def verify_generated_text(text: str, profile: CandidateProfileData, source_text: str) -> tuple[bool, list[str]]:
    """Verify a generated summary / cover-letter paragraph against the whole verified profile."""
    reasons: list[str] = []
    allowed_nums = numbers(source_text)
    years = profile.years_experience
    for n in numbers(text) - allowed_nums:
        m = re.match(r"(\d+(?:\.\d+)?)", n)
        if m and re.search(rf"{re.escape(m.group(1))}\+?\s*(?:years?|yrs?)", text, re.I) and float(m.group(1)) <= max(years, 0):
            continue
        reasons.append(f"Unsupported number: {n}")
    cand = profile.skill_names()
    allowed = set(cand)
    for s in cand:
        allowed |= implied_by(s)
    extra = set(unique_skills(extract_skills(text))) - allowed
    if extra:
        reasons.append(f"Mentions skills not in the verified profile: {', '.join(sorted(extra))}.")
    ym = re.findall(r"(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)", text, re.I)
    for y in ym:
        if float(y) > max(years, profile.internship_months / 12) + 0.5:
            reasons.append(f"Claims {y} years of experience; verified total is {years:.1f}.")
    return not reasons, reasons


def profile_source_text(profile: CandidateProfileData) -> str:
    parts = [profile.summary or ""]
    for e in profile.experience:
        parts += [e.title or "", e.company or "", *e.bullets]
    for p in profile.projects:
        parts += [p.name, p.description or "", *p.bullets]
    for ed in profile.education:
        parts += [ed.raw or ""]
    parts += [c.name for c in profile.certifications] + profile.achievements
    return "\n".join(parts)


def verify_document(content: ResumeContent, master: CandidateProfileData) -> list[ClaimCheck]:
    """Verify every factual element of a (tailored) resume against the master profile."""
    checks: list[ClaimCheck] = []
    exp_by_id = {e.id: e for e in master.experience}
    proj_by_id = {p.id: p for p in master.projects}
    master_skills = master.skill_names()
    source_text = profile_source_text(master)

    for block in content.experience:
        src = exp_by_id.get(block.source_id)
        if src is None:
            checks.append(ClaimCheck(claim=f"{block.title} at {block.company}", section="experience", source_type="experience",
                                     source_id=block.source_id, verified=False, confidence=0.0,
                                     reasons=["Experience entry has no source in the master profile."]))
            continue
        header_ok = (block.title == src.title and block.company == src.company and block.start_date == src.start_date
                     and block.end_date == src.end_date)
        checks.append(ClaimCheck(claim=" | ".join(x for x in (block.title, block.company, block.start_date, block.end_date) if x),
                                 section="experience", source_type="experience", source_id=src.id, verified=header_ok,
                                 confidence=1.0 if header_ok else 0.0,
                                 reasons=[] if header_ok else ["Title/company/dates differ from the master resume."]))
        for b in block.bullets:
            original = src.bullets[b.source_index] if b.source_index is not None and b.source_index < len(src.bullets) else None
            if original is None:
                checks.append(ClaimCheck(claim=b.text, section="experience", source_type="experience", source_id=src.id,
                                         verified=False, confidence=0.0, reasons=["Bullet has no source bullet."]))
                continue
            ok, reasons = (True, []) if b.text == original else verify_rewrite(original, b.text)
            checks.append(ClaimCheck(claim=b.text, section="experience", source_type="experience", source_id=src.id,
                                     original=original, verified=ok, confidence=1.0 if b.text == original else 0.85 if ok else 0.0,
                                     reasons=reasons))
    for pblock in content.projects:
        psrc = proj_by_id.get(pblock.source_id)
        if psrc is None:
            checks.append(ClaimCheck(claim=pblock.name, section="projects", source_type="project", source_id=pblock.source_id,
                                     verified=False, confidence=0.0, reasons=["Project has no source in the master profile."]))
            continue
        for b in pblock.bullets:
            original = psrc.bullets[b.source_index] if b.source_index is not None and b.source_index < len(psrc.bullets) else None
            if original is None:
                checks.append(ClaimCheck(claim=b.text, section="projects", source_type="project", source_id=psrc.id,
                                         verified=False, confidence=0.0, reasons=["Bullet has no source bullet."]))
                continue
            ok, reasons = (True, []) if b.text == original else verify_rewrite(original, b.text)
            checks.append(ClaimCheck(claim=b.text, section="projects", source_type="project", source_id=psrc.id,
                                     original=original, verified=ok, confidence=1.0 if b.text == original else 0.85 if ok else 0.0,
                                     reasons=reasons))
    for items in content.skills.values():
        for s in items:
            ok = s in master_skills
            if not ok:
                checks.append(ClaimCheck(claim=s, section="skills", source_type="skill", verified=False, confidence=0.0,
                                         reasons=["Skill is not in the verified master profile."]))
    if content.summary and content.summary != master.summary:
        ok, reasons = verify_generated_text(content.summary, master, source_text)
        checks.append(ClaimCheck(claim=content.summary, section="summary", source_type="summary", verified=ok,
                                 original=master.summary, confidence=0.8 if ok else 0.0, reasons=reasons))
    master_edu = {(e.degree, e.institution) for e in master.education}
    for ed in content.education:
        if (ed.degree, ed.institution) not in master_edu:
            checks.append(ClaimCheck(claim=f"{ed.degree} {ed.institution}", section="education", source_type="education",
                                     verified=False, confidence=0.0, reasons=["Education entry not in master profile."]))
    master_certs = {c.name for c in master.certifications}
    for c in content.certifications:
        if c.name not in master_certs:
            checks.append(ClaimCheck(claim=c.name, section="certifications", source_type="certification", verified=False,
                                     confidence=0.0, reasons=["Certification not in master profile."]))
    return checks
