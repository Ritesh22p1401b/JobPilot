"""Deterministic job-description requirement extraction.

Every requirement carries the exact source span it came from. Nothing is added that is not
literally present in the JD text; classification (required / preferred / nice-to-have) comes
from section headings and inline cues.
"""

from __future__ import annotations

import re

from app.schemas.jd import SKILL_CATEGORIES, JDAnalysis, Requirement, Tier
from app.services.resume_parser import DEGREE_PATTERNS, DOMAIN_KEYWORDS, is_bullet, strip_bullet
from app.services.skill_normalizer import extract_skills, extract_soft_skills

_SECTION_CUES: list[tuple[Tier, list[str]]] = [
    ("NICE_TO_HAVE", ["nice to have", "nice-to-have", "bonus", "bonus points", "pluses", "good to have",
                      "extra credit", "it would be great if", "brownie points", "added advantage"]),
    ("PREFERRED", ["preferred qualifications", "preferred skills", "preferred", "desired qualifications",
                   "desired skills", "desirable", "additional qualifications", "ideally you have",
                   "ideal candidate", "what sets you apart", "preferred experience"]),
    ("REQUIRED", ["requirements", "required qualifications", "minimum qualifications", "basic qualifications",
                  "qualifications", "what you'll need", "what you will need", "what we're looking for",
                  "what we are looking for", "what you bring", "must have", "must-have", "must haves",
                  "who you are", "you have", "you should have", "required skills", "skills required",
                  "key skills", "skills", "eligibility", "about you", "your profile", "desired profile",
                  "technical skills", "experience", "candidate profile", "skills and experience"]),
    ("RESPONSIBILITY", ["responsibilities", "key responsibilities", "what you'll do", "what you will do",
                        "the role", "your role", "role overview", "duties", "day to day", "in this role",
                        "job description", "what you will be doing", "what you'll be doing", "the opportunity",
                        "your impact", "your mission", "role description", "job responsibilities"]),
    ("CONTEXT", ["about us", "about the company", "who we are", "benefits", "perks", "what we offer",
                 "compensation", "our values", "equal opportunity", "why join", "life at", "about the team",
                 "salary", "our culture", "how we work", "location", "diversity"]),
]

_INLINE_NICE = re.compile(r"\b(nice[\s-]to[\s-]have|a plus|is a plus|bonus|good to have|not required|would be great|"
                          r"added advantage|advantageous)\b", re.I)
_INLINE_PREF = re.compile(r"\b(preferred|preferably|ideally|desired|desirable|familiarity with|exposure to)\b", re.I)
_INLINE_REQ = re.compile(r"\b(must|required|mandatory|minimum|at least|essential|strong (?:experience|knowledge)|"
                         r"proficien(?:t|cy)|solid (?:experience|understanding)|hands-on)\b", re.I)

_YEARS_RE = re.compile(
    r"(?P<min>\d{1,2}(?:\.\d)?)\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(?P<max>\d{1,2}))?\s*\+?\s*(?:years?|yrs?)",
    re.I,
)
_WORK_AUTH_RE = re.compile(r"authori[sz]ed to work|work authori[sz]ation|right to work|visa sponsorship|"
                           r"sponsorship|work permit|eligible to work", re.I)
_NO_SPONSOR_RE = re.compile(
    r"(unable|not able|cannot|can't|will not|won't|do not|does not|no)\s+(to\s+)?(offer\s+|provide\s+)?(visa\s+)?sponsor"
    r"|sponsorship\s+(is\s+|will\s+)?(not|un)\s*(be\s+)?(available|offered|provided|possible)"
    r"|without\s+(the\s+need\s+for\s+)?(visa\s+)?sponsorship",
    re.I,
)
_EMPLOYMENT_RE = {
    "full_time": re.compile(r"\bfull[\s-]?time\b", re.I),
    "part_time": re.compile(r"\bpart[\s-]?time\b", re.I),
    "contract": re.compile(r"\bcontract(?:or)?\b|\bfreelance\b", re.I),
    "internship": re.compile(r"\bintern(?:ship)?\b", re.I),
    "temporary": re.compile(r"\btemporary\b|\btemp\b", re.I),
}
# Order matters: "remote-friendly hybrid" is hybrid.
_WORK_MODE_RE = {
    "hybrid": re.compile(r"\bhybrid\b", re.I),
    "onsite": re.compile(r"\bon[\s-]?site\b|\bin[\s-]office\b|\bwork from office\b", re.I),
    "remote": re.compile(r"\bremote\b|\bwork from home\b|\bwfh\b|\bdistributed team\b", re.I),
}
_LANG_RE = re.compile(r"\b(?:fluen(?:t|cy) in|proficien(?:t|cy) in|native|business[- ]level)\s+"
                      r"(English|Hindi|German|French|Spanish|Japanese|Mandarin|Chinese|Portuguese|Arabic|Dutch|"
                      r"Italian|Korean|Kannada|Tamil|Telugu|Marathi|Bengali)\b|\b(English|Hindi|German|French|"
                      r"Spanish|Japanese|Mandarin)\s+(?:language\s+)?(?:fluency|proficiency|speaking)\b", re.I)
_CERT_RE = re.compile(r"\b([A-Z][A-Za-z0-9+&/ ]{2,60}?(?:Certified|Certification|Certificate)[A-Za-z0-9 ]{0,40})", re.M)

_SENIORITY_TITLE = [
    ("intern", re.compile(r"\bintern(ship)?\b|\btrainee\b|\bapprentice\b", re.I)),
    ("entry", re.compile(r"\bjunior\b|\bjr\.?\b|\bentry[\s-]level\b|\bgraduate\b|\bfresher\b|\bnew grad\b|"
                         r"\bassociate\b|\b(?:engineer|developer)\s+i\b", re.I)),
    ("lead", re.compile(r"\blead\b|\bstaff\b|\bprincipal\b|\barchitect\b", re.I)),
    ("manager", re.compile(r"\bmanager\b|\bdirector\b|\bhead of\b|\bvp\b", re.I)),
    ("senior", re.compile(r"\bsenior\b|\bsr\.?\b|\b(?:engineer|developer)\s+(?:iii|iv)\b", re.I)),
]

TIER_IMPORTANCE = {"REQUIRED": 1.0, "PREFERRED": 0.6, "NICE_TO_HAVE": 0.3, "RESPONSIBILITY": 0.5,
                   "UNSPECIFIED": 0.8, "CONTEXT": 0.0}


def _heading_tier(line: str) -> Tier | None:
    stripped = strip_bullet(line).strip()
    if is_bullet(line) or len(stripped) > 70 or len(stripped.split()) > 9:
        return None
    if stripped.endswith(".") and not stripped.endswith(":"):
        return None
    key = re.sub(r"[^a-z' \-&]", "", stripped.lower()).strip()
    if not key:
        return None
    has_content = bool(extract_skills(stripped)) or bool(_YEARS_RE.search(stripped))
    for tier, cues in _SECTION_CUES:
        for cue in cues:
            if key == cue:
                return tier
            if key.startswith(cue) and (
                stripped.endswith(":") or (not has_content and len(key) <= len(cue) + 25)
            ):
                return tier
    return None


def infer_seniority(title: str, min_years: float | None) -> str:
    for label, pattern in _SENIORITY_TITLE:
        if pattern.search(title):
            return label
    if min_years is None:
        return "unspecified"
    if min_years < 2:
        return "entry"
    if min_years < 5:
        return "mid"
    return "senior"


def _line_tier(line: str, section_tier: Tier) -> Tier:
    if section_tier == "CONTEXT":
        return "CONTEXT"
    if _INLINE_NICE.search(line):
        return "NICE_TO_HAVE"
    if _INLINE_PREF.search(line) and not re.search(r"\b(must|required)\b", line, re.I):
        return "PREFERRED"
    if _INLINE_REQ.search(line) and section_tier in ("UNSPECIFIED", "RESPONSIBILITY"):
        return "REQUIRED"
    return section_tier


def _skill_category(tier: Tier) -> str:
    return {"REQUIRED": "REQUIRED_SKILL", "PREFERRED": "PREFERRED_SKILL", "NICE_TO_HAVE": "NICE_TO_HAVE"}.get(
        tier, "PREFERRED_SKILL" if tier == "RESPONSIBILITY" else "REQUIRED_SKILL"
    )


def analyze_job_description(title: str, description: str) -> JDAnalysis:
    lines = [ln.strip() for ln in description.split("\n") if ln.strip()]
    section: Tier = "UNSPECIFIED"
    has_sections = False
    reqs: dict[tuple[str, str], Requirement] = {}

    def add(req: Requirement) -> None:
        key = (req.category if req.category not in SKILL_CATEGORIES else "SKILL", req.requirement.lower())
        existing = reqs.get(key)
        if existing is None or req.importance > existing.importance:
            reqs[key] = req

    min_years: float | None = None
    max_years: float | None = None
    responsibilities: list[str] = []
    sponsorship: str | None = None

    for line in lines:
        tier_heading = _heading_tier(line)
        if tier_heading:
            section = tier_heading
            has_sections = has_sections or tier_heading in ("REQUIRED", "PREFERRED", "NICE_TO_HAVE")
            continue
        text = strip_bullet(line)
        tier = _line_tier(text, section)
        span = text[:400]

        if _WORK_AUTH_RE.search(text):
            if _NO_SPONSOR_RE.search(text):
                sponsorship = "not_available"
            elif re.search(r"\b(we|will|can)\s+(offer|provide)?\s*(visa\s+)?sponsor", text, re.I):
                sponsorship = "available"
            add(Requirement(requirement=span[:200], category="WORK_AUTHORIZATION", tier=tier,
                            importance=1.0 if tier != "CONTEXT" else 0.5, evidence_required=False, source_span=span))

        if tier == "CONTEXT":
            continue

        # Skills
        for skill in dict.fromkeys(m.skill for m in extract_skills(text)):
            add(Requirement(requirement=skill, category=_skill_category(tier), tier=tier,  # type: ignore[arg-type]
                            importance=TIER_IMPORTANCE[tier], source_span=span, skill=skill))

        # Years of experience
        ym = _YEARS_RE.search(text)
        if ym and re.search(r"experience|exp\b|background|working|industry|professional", text, re.I):
            lo = float(ym.group("min"))
            hi = float(ym.group("max")) if ym.group("max") else None
            if lo <= 30:
                cat = "PREFERRED_EXPERIENCE" if tier in ("PREFERRED", "NICE_TO_HAVE") else "REQUIRED_EXPERIENCE"
                add(Requirement(requirement=f"{ym.group(0).strip()} experience", category=cat, tier=tier,  # type: ignore[arg-type]
                                importance=TIER_IMPORTANCE[tier] if tier != "UNSPECIFIED" else 1.0,
                                source_span=span, min_years=lo, max_years=hi))
                if cat == "REQUIRED_EXPERIENCE" and (min_years is None or lo < min_years):
                    min_years, max_years = lo, hi
        elif re.search(r"\bfreshers?\b|\bno experience required\b|\b0\s*(?:-|to)\s*1\s*years?\b", text, re.I):
            add(Requirement(requirement="Entry level (0 years)", category="REQUIRED_EXPERIENCE", tier=tier,
                            importance=0.5, source_span=span, min_years=0))
            min_years = 0 if min_years is None else min_years

        # Education
        for pattern, level in DEGREE_PATTERNS:
            if level == "high_school":
                continue
            dm = re.search(pattern, text)
            if dm or (level == "bachelor" and re.search(r"\b(bachelor'?s?|undergraduate|degree in)\b", text, re.I)):
                add(Requirement(requirement=(dm.group(0).strip() if dm else "Bachelor's degree"), category="EDUCATION",
                                tier=tier, importance=TIER_IMPORTANCE[tier] if tier != "RESPONSIBILITY" else 0.5,
                                source_span=span, degree_level=level))
                break
        if re.search(r"\bdegree\b", text, re.I) and not any(r.category == "EDUCATION" for r in reqs.values()):
            add(Requirement(requirement="Degree", category="EDUCATION", tier=tier, importance=0.6,
                            source_span=span, degree_level="bachelor"))

        # Certifications
        for cm in _CERT_RE.finditer(text):
            add(Requirement(requirement=cm.group(1).strip(), category="CERTIFICATION", tier=tier,
                            importance=TIER_IMPORTANCE[tier], source_span=span))

        # Languages
        for lm in _LANG_RE.finditer(text):
            lang = (lm.group(1) or lm.group(2)).title()
            add(Requirement(requirement=lang, category="LANGUAGE", tier=tier, importance=0.6, source_span=span))

        # Soft skills (only when stated as requirements)
        if tier in ("REQUIRED", "PREFERRED", "NICE_TO_HAVE", "UNSPECIFIED"):
            for soft in extract_soft_skills(text):
                add(Requirement(requirement=soft, category="SOFT_SKILL", tier=tier, importance=0.3,
                                evidence_required=False, source_span=span))

        if tier == "RESPONSIBILITY" and len(text.split()) >= 4 and len(responsibilities) < 15:
            responsibilities.append(text)
            add(Requirement(requirement=text[:300], category="RESPONSIBILITY", tier="RESPONSIBILITY",
                            importance=0.4, evidence_required=False, source_span=span))

    full = f"{title}\n{description}"
    work_mode = next((mode for mode, rx in _WORK_MODE_RE.items() if rx.search(full)), None)
    if work_mode:
        span = _find_span(full, _WORK_MODE_RE[work_mode])
        add(Requirement(requirement=work_mode, category="WORK_MODE", importance=0.5, evidence_required=False,
                        source_span=span))
    employment = next((k for k, rx in _EMPLOYMENT_RE.items() if rx.search(title)), None) or next(
        (k for k, rx in _EMPLOYMENT_RE.items() if k != "internship" and rx.search(description)), None
    )
    if employment:
        add(Requirement(requirement=employment, category="EMPLOYMENT_TYPE", importance=0.5, evidence_required=False,
                        source_span=_find_span(full, _EMPLOYMENT_RE[employment])))
    lowered = full.lower()
    domains = [d for d, kws in DOMAIN_KEYWORDS.items() if any(re.search(rf"\b{re.escape(k)}\b", lowered) for k in kws)]
    for d in domains:
        add(Requirement(requirement=d, category="DOMAIN", importance=0.2, evidence_required=False,
                        source_span=d))
    add(Requirement(requirement=title, category="JOB_TITLE", importance=0.5, evidence_required=False,
                    source_span=title))

    requirements = list(reqs.values())
    # If the JD has no explicit requirements sections, unsectioned skills are treated as requirements
    # with reduced confidence (importance 0.8) — they remain traceable via source_span.
    analysis = JDAnalysis(
        role_title=title,
        seniority=infer_seniority(title, min_years),
        required_skills=[r.skill for r in requirements if r.category == "REQUIRED_SKILL" and r.skill],
        preferred_skills=[r.skill for r in requirements if r.category == "PREFERRED_SKILL" and r.skill],
        nice_to_have_skills=[r.skill for r in requirements if r.category == "NICE_TO_HAVE" and r.skill],
        education=[r.requirement for r in requirements if r.category == "EDUCATION"],
        experience_requirements=[r.requirement for r in requirements if r.category.endswith("_EXPERIENCE")],
        responsibilities=responsibilities,
        keywords=list(dict.fromkeys(r.skill for r in requirements if r.skill)),
        domain_terms=domains,
        soft_skills=[r.requirement for r in requirements if r.category == "SOFT_SKILL"],
        min_years=min_years,
        max_years=max_years,
        work_mode=work_mode,
        employment_type=employment,
        sponsorship=sponsorship,
        has_explicit_sections=has_sections,
        requirements=requirements,
    )
    return analysis


def _find_span(text: str, rx: re.Pattern[str]) -> str:
    m = rx.search(text)
    if not m:
        return ""
    start = text.rfind("\n", 0, m.start()) + 1
    end = text.find("\n", m.end())
    return text[start: end if end != -1 else len(text)].strip()[:300]
