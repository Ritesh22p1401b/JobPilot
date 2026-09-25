"""Deterministic, explainable job ↔ candidate scoring.

Final Score = 30% skills + 20% role + 15% experience + 10% location + 10% education
            + 10% preferences + 5% seniority

Every component carries a textual reason so that each number is traceable to extracted data.
Hard constraints are evaluated separately and can never be overridden by the LLM.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

from pydantic import BaseModel, Field
from rapidfuzz import fuzz

from app.schemas.jd import SKILL_CATEGORIES, JDAnalysis
from app.schemas.preferences import Preferences
from app.schemas.profile import CandidateProfileData
from app.services.embeddings import get_embedder, similarity
from app.services.evidence import EvidenceMatrix

WEIGHTS = {"skill": 0.30, "role": 0.20, "experience": 0.15, "location": 0.10, "education": 0.10,
           "preference": 0.10, "seniority": 0.05}
SKILL_CREDIT = {"SUPPORTED": 1.0, "PARTIALLY_SUPPORTED": 0.85, "SEMANTIC_MATCH": 0.7}
LEVELS = ["intern", "entry", "mid", "senior", "lead", "manager"]
CITY_ALIASES = {"bangalore": "bengaluru", "gurgaon": "gurugram", "bombay": "mumbai", "madras": "chennai",
                "calcutta": "kolkata", "new delhi": "delhi", "ncr": "delhi"}
MATCHER_VERSION = "matcher:v2"
SKILL_PRIOR_WEIGHT = 1.5  # pseudo-requirements at a neutral 50: few explicit skills => less extreme scores

ROLE_FAMILIES: dict[str, list[str]] = {
    "engineering": ["engineer", "developer", "programmer", "sde", "swe", "devops", "sre", "architect", "mlops"],
    "science": ["scientist", "researcher"],
    "analytics": ["analyst"],
    "sales": ["account executive", "sales", "business development", "account manager", "solutions consultant",
              "partner manager", "bdr", "sdr"],
    "product": ["product manager", "product owner", "program manager", "owner", "product lead"],
    "design": ["designer"],
    "marketing": ["marketing", "growth marketer", "content", "community manager", "brand"],
    "people": ["recruiter", "talent", "people partner", "hr business partner"],
    "support": ["customer support", "customer success", "support specialist", "technical support"],
    "legal_finance": ["counsel", "legal", "accountant", "finance", "tax", "paralegal", "controller"],
}
TECHNICAL_FAMILIES = {"engineering", "science", "analytics"}

INDIA_PLACES = {"india", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi", "noida", "gurgaon", "gurugram",
                "chennai", "kolkata", "ahmedabad", "jaipur", "kochi", "coimbatore", "chandigarh", "indore", "lucknow"}
COUNTRY_ALIASES: dict[str, list[str]] = {
    "india": ["india"],
    "united states": ["united states", "usa", "us", "u.s.", "america", "san francisco", "new york", "seattle", "austin",
                      "boston", "chicago", "los angeles", "denver", "atlanta", "washington, dc"],
    "canada": ["canada"], "united kingdom": ["united kingdom", "uk", "england", "london"],
    "ireland": ["ireland", "dublin"], "germany": ["germany", "berlin", "munich"], "france": ["france", "paris"],
    "netherlands": ["netherlands", "amsterdam"], "spain": ["spain", "madrid", "barcelona"], "poland": ["poland"],
    "singapore": ["singapore"], "australia": ["australia", "sydney", "melbourne"], "japan": ["japan", "tokyo"],
    "brazil": ["brazil"], "mexico": ["mexico"], "israel": ["israel"], "uae": ["uae", "dubai"], "portugal": ["portugal"],
    "sweden": ["sweden"], "switzerland": ["switzerland"], "denmark": ["denmark"], "romania": ["romania"],
    "philippines": ["philippines"], "south korea": ["korea"], "costa rica": ["costa rica"], "argentina": ["argentina"],
    "colombia": ["colombia"],
}


def role_families(title: str) -> set[str]:
    t = f" {title.lower()} "
    return {fam for fam, words in ROLE_FAMILIES.items() if any(re.search(rf"\b{re.escape(w)}\b", t) for w in words)}


def countries_in(text: str | None) -> set[str]:
    if not text:
        return set()
    t = text.lower()
    found = {c for c, aliases in COUNTRY_ALIASES.items()
             if any(re.search(rf"(?<![a-z]){re.escape(a)}(?![a-z])", t) for a in aliases)}
    if any(re.search(rf"\b{re.escape(p)}\b", t) for p in INDIA_PLACES):
        found.add("india")
    return found


def candidate_countries(profile: CandidateProfileData, prefs: Preferences | None) -> set[str]:
    out: set[str] = set()
    for loc in (prefs.locations if prefs else []) + [profile.contact.location or ""]:
        if loc and loc.lower() != "remote":
            out |= countries_in(loc)
    return out


@dataclass
class JobFacts:
    title: str
    company: str
    location: str | None
    remote: bool
    work_mode: str | None
    employment_type: str | None
    salary_min: float | None
    salary_max: float | None
    currency: str | None
    seniority: str | None
    description: str = ""


class ComponentScore(BaseModel):
    score: float
    weight: float
    reason: str


class MatchResult(BaseModel):
    overall_score: float
    skill_score: float
    role_score: float
    experience_score: float
    location_score: float
    education_score: float
    preference_score: float
    seniority_score: float
    semantic_similarity: float | None = None
    hard_filter_passed: bool = True
    hard_filter_reasons: list[str] = Field(default_factory=list)
    matched_skills: list[str] = Field(default_factory=list)
    missing_required_skills: list[str] = Field(default_factory=list)
    missing_preferred_skills: list[str] = Field(default_factory=list)
    missing_nice_to_have_skills: list[str] = Field(default_factory=list)
    related_not_matched: list[str] = Field(default_factory=list)
    weak_evidence_skills: list[str] = Field(default_factory=list)
    components: dict[str, ComponentScore] = Field(default_factory=dict)
    explanation: str = ""
    version: str = MATCHER_VERSION


def _norm_place(text: str) -> str:
    t = text.lower()
    for k, v in CITY_ALIASES.items():
        t = re.sub(rf"\b{re.escape(k)}\b", v, t)
    return t


def norm_title(t: str) -> str:
    t = t.lower()
    t = re.sub(r"\b(senior|sr\.?|junior|jr\.?|lead|staff|principal|intern(ship)?|i{1,3}|iv|entry[- ]level|associate)\b", " ", t)
    t = re.sub(r"[^a-z0-9+#/ ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def candidate_level(profile: CandidateProfileData, prefs: Preferences | None) -> str:
    if prefs and prefs.experience_level:
        return prefs.experience_level
    years = profile.total_experience_months / 12
    if years < 1:
        return "entry"
    if years < 4:
        return "mid"
    return "senior"


def _clamp(v: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, v))


def _semantic_scale(sim: float) -> float:
    """Map raw cosine to 0-100. Calibrated for bge-small (unrelated ~0.55, near-identical ~0.9)."""
    if get_embedder().name.startswith("hash"):
        return _clamp(sim * 100)
    return _clamp((sim - 0.55) / 0.35 * 100)


def score_skills(matrix: EvidenceMatrix, semantic: float | None) -> tuple[float, str, dict[str, list[str]]]:
    items = matrix.by_category(*SKILL_CATEGORIES)
    lists: dict[str, list[str]] = {"matched": [], "missing_required": [], "missing_preferred": [],
                                   "missing_nice": [], "related": [], "weak": []}
    if not items:
        if semantic is not None:
            s = _semantic_scale(semantic)
            return s, f"The posting lists no explicit skills; score from semantic similarity ({semantic:.2f}).", lists
        return 50.0, "The posting lists no explicit skills; neutral score.", lists
    total = earned = 0.0
    for it in items:
        total += it.importance
        credit = SKILL_CREDIT.get(it.status, 0.0)
        earned += it.importance * credit
        name = it.skill or it.requirement
        if it.matched:
            lists["matched"].append(name)
            if it.status == "PARTIALLY_SUPPORTED":
                lists["weak"].append(name)
        else:
            key = {"REQUIRED_SKILL": "missing_required", "PREFERRED_SKILL": "missing_preferred"}.get(it.category, "missing_nice")
            lists[key].append(name)
            if it.status == "RELATED_BUT_NOT_MATCH":
                lists["related"].append(f"{name} (has {it.evidence_skill})")
    score = (100 * earned + 50 * SKILL_PRIOR_WEIGHT) / (total + SKILL_PRIOR_WEIGHT) if total else 50
    req = [i for i in items if i.category == "REQUIRED_SKILL"]
    req_hit = sum(1 for i in req if i.matched)
    reason = (f"{len(lists['matched'])}/{len(items)} skill requirements evidenced"
              + (f"; {req_hit}/{len(req)} required" if req else "")
              + ". Weighted by importance (required 1.0, preferred 0.6, nice-to-have 0.3), "
              + f"smoothed toward 50 by {SKILL_PRIOR_WEIGHT} pseudo-requirements.")
    return score, reason, lists


def role_function_conflict(job_title: str, profile: CandidateProfileData, prefs: Preferences | None) -> str | None:
    """A non-technical role function (sales, product, legal...) when all targets are technical is a mismatch."""
    targets = (prefs.target_titles if prefs and prefs.target_titles else profile.target_roles) or profile.job_titles
    target_fams: set[str] = set().union(*(role_families(t) for t in targets)) if targets else set()
    job_fams = role_families(job_title)
    if not job_fams or not target_fams or job_fams & target_fams:
        return None
    if target_fams <= TECHNICAL_FAMILIES and not job_fams & TECHNICAL_FAMILIES:
        return f"Role function ({', '.join(sorted(job_fams))}) is outside your target roles ({', '.join(sorted(target_fams))})."
    return None


def score_role(job: JobFacts, profile: CandidateProfileData, prefs: Preferences | None) -> tuple[float, str]:
    targets = list(dict.fromkeys((prefs.target_titles if prefs else []) + profile.target_roles + profile.job_titles))
    if not targets:
        return 50.0, "No target titles configured; neutral score."
    conflict = role_function_conflict(job.title, profile, prefs)
    if conflict:
        return 5.0, conflict
    job_fams = role_families(job.title)
    target_fams: set[str] = set().union(*(role_families(t) for t in targets))
    jt = norm_title(job.title)
    best_t, best = None, 0.0
    for t in targets:
        fz = fuzz.token_set_ratio(jt, norm_title(t))
        sem = _semantic_scale(similarity(jt, norm_title(t))) if jt else 0
        s = max(fz * 0.9 if fz < 100 else 100, sem)
        if s > best:
            best, best_t = s, t
    if job_fams and target_fams and not job_fams & target_fams:
        return min(_clamp(best), 60.0), f"Adjacent role function ({', '.join(sorted(job_fams))}); closest target '{best_t}'."
    return _clamp(best), f"Closest target title: '{best_t}' vs job title '{job.title}'."


def score_experience(analysis: JDAnalysis, profile: CandidateProfileData) -> tuple[float, str]:
    years = profile.total_experience_months / 12
    eff = years + profile.internship_months / 12 * 0.5
    need = analysis.min_years
    if need is None:
        return 100.0, f"No minimum experience stated; candidate has {years:.1f} years full-time."
    if need == 0 or eff >= need:
        if analysis.max_years is not None and years > analysis.max_years + 3:
            return 80.0, f"Candidate ({years:.1f}y) exceeds the {analysis.max_years:g}-year upper range."
        return 100.0, f"Meets {need:g}+ years ({years:.1f}y full-time, internships counted at 50%)."
    return _clamp(100 * eff / need), f"Has ~{eff:.1f} effective years vs {need:g}+ required (internships counted at 50%)."


def score_location(job: JobFacts, prefs: Preferences | None,
                   profile: CandidateProfileData | None = None) -> tuple[float, str, bool]:
    if prefs is None or not prefs.locations:
        return 100.0, "No location preference set.", True
    wants_remote = "remote" in (prefs.work_modes or []) or any(loc.lower() == "remote" for loc in prefs.locations)
    if job.remote and wants_remote:
        # "Remote, United States" usually means remote *within* that country.
        job_c = countries_in(job.location)
        cand_c = candidate_countries(profile, prefs) if profile else set()
        worldwide = bool(re.search(r"\b(anywhere|worldwide|global|international)\b", (job.location or "").lower()))
        if job_c and cand_c and not job_c & cand_c and not worldwide:
            return 10.0, f"Remote role appears limited to {', '.join(sorted(job_c))}.", False
        return 100.0, "Remote role and remote work is acceptable.", True
    if not job.location:
        return 50.0, "Job location not specified.", True
    loc = _norm_place(job.location)
    for p in prefs.locations:
        if p.lower() == "remote":
            continue
        if _norm_place(p) in loc:
            return 100.0, f"Located in preferred location '{p}'.", True
    if re.search(r"\b(anywhere|multiple locations|various)\b", loc):
        return 60.0, "Multiple/unspecified locations.", True
    return 0.0, f"'{job.location}' is not in your preferred locations.", False


def score_education(matrix: EvidenceMatrix) -> tuple[float, str]:
    edu = matrix.by_category("EDUCATION")
    if not edu:
        return 100.0, "No education requirement stated."
    it = max(edu, key=lambda i: i.importance)
    if it.status == "SUPPORTED":
        return 100.0, f"Meets education requirement: {it.requirement}."
    if it.status == "UNKNOWN":
        return 50.0, "Education requirement stated but no degree found in resume."
    return (70.0 if it.tier in ("PREFERRED", "NICE_TO_HAVE") else 30.0), f"Education requirement not met: {it.requirement}."


def score_preferences(job: JobFacts, analysis: JDAnalysis, prefs: Preferences | None) -> tuple[float, str, list[str]]:
    if prefs is None:
        return 100.0, "No preferences set.", []
    checks: list[tuple[str, float]] = []
    failures: list[str] = []
    et = job.employment_type or analysis.employment_type
    if et:
        ok = et in prefs.employment_types
        checks.append((f"employment type {et}", 1.0 if ok else 0.0))
        if not ok:
            failures.append(f"Employment type '{et}' not in preferences.")
    wm = job.work_mode or ("remote" if job.remote else None) or analysis.work_mode
    if wm and prefs.work_modes:
        ok = wm in prefs.work_modes
        checks.append((f"work mode {wm}", 1.0 if ok else 0.0))
    if prefs.minimum_salary and (job.salary_max or job.salary_min):
        top = job.salary_max or job.salary_min or 0
        same_currency = not job.currency or job.currency.upper() == prefs.currency.upper()
        if same_currency:
            ok = top >= prefs.minimum_salary
            checks.append(("salary", 1.0 if ok else 0.0))
            if not ok:
                failures.append(f"Salary up to {top:,.0f} is below your minimum {prefs.minimum_salary:,.0f}.")
    elif prefs.minimum_salary:
        checks.append(("salary unknown", 0.7))
    if any(c.lower() == job.company.lower() for c in prefs.excluded_companies):
        failures.append("Company is in your excluded list.")
        checks.append(("excluded company", 0.0))
    if not checks:
        return 100.0, "No preference conflicts detected.", failures
    score = 100 * sum(v for _, v in checks) / len(checks)
    return score, "Checked: " + ", ".join(f"{n} ({'ok' if v >= 1 else 'partial' if v > 0 else 'mismatch'})" for n, v in checks) + ".", failures


def score_seniority(analysis: JDAnalysis, job: JobFacts, level: str) -> tuple[float, str]:
    js = job.seniority or analysis.seniority
    if not js or js == "unspecified" or js not in LEVELS:
        return 80.0, "Seniority not specified in the posting."
    diff = abs(LEVELS.index(js) - LEVELS.index(level))
    if js == "intern" and level == "entry":
        diff = 0
    return {0: 100.0, 1: 60.0}.get(diff, 10.0), f"Job seniority '{js}' vs your level '{level}'."


def hard_filters(job: JobFacts, analysis: JDAnalysis, profile: CandidateProfileData, prefs: Preferences | None,
                 location_ok: bool, pref_failures: list[str]) -> list[str]:
    reasons: list[str] = []
    if not location_ok:
        reasons.append(f"Location '{job.location}' is outside your preferred locations"
                       + (" (remote only within those countries)." if job.remote else " and the role is not remote."))
    conflict = role_function_conflict(job.title, profile, prefs)
    if conflict:
        reasons.append(conflict)
    reasons.extend(pref_failures)
    level = candidate_level(profile, prefs)
    js = job.seniority or analysis.seniority
    if js in ("senior", "lead", "manager") and level in ("intern", "entry"):
        reasons.append(f"Role seniority '{js}' is well above your level '{level}'.")
    years = (profile.total_experience_months + profile.internship_months * 0.5) / 12
    if analysis.min_years is not None and analysis.min_years >= years + 3:
        reasons.append(f"Requires {analysis.min_years:g}+ years; you have ~{years:.1f}.")
    if prefs and prefs.visa_sponsorship_required and analysis.sponsorship == "not_available":
        reasons.append("The posting states visa sponsorship is not available.")
    return list(dict.fromkeys(reasons))


def explain(result: MatchResult, job: JobFacts) -> str:
    band = "Strong" if result.overall_score >= 80 else "Moderate" if result.overall_score >= 60 else "Weak"
    parts = [f"{band} match ({result.overall_score:.0f}/100) for {job.title} at {job.company}."]
    if result.matched_skills:
        parts.append("Evidenced skills: " + ", ".join(result.matched_skills[:8]) + ".")
    if result.missing_required_skills:
        parts.append("Missing required: " + ", ".join(result.missing_required_skills) + ".")
    if result.missing_preferred_skills:
        parts.append("Missing preferred: " + ", ".join(result.missing_preferred_skills) + " (not a hard rejection).")
    if result.missing_nice_to_have_skills:
        parts.append("Nice-to-have gaps: " + ", ".join(result.missing_nice_to_have_skills) + ".")
    if result.related_not_matched:
        parts.append("Related but not equivalent: " + ", ".join(result.related_not_matched) + ".")
    if not result.hard_filter_passed:
        parts.append("Filtered out: " + " ".join(result.hard_filter_reasons))
    return " ".join(parts)


def compute_match(job: JobFacts, analysis: JDAnalysis, matrix: EvidenceMatrix, profile: CandidateProfileData,
                  prefs: Preferences | None, semantic_similarity: float | None = None) -> MatchResult:
    skill, skill_reason, lists = score_skills(matrix, semantic_similarity)
    role, role_reason = score_role(job, profile, prefs)
    exp, exp_reason = score_experience(analysis, profile)
    loc, loc_reason, loc_ok = score_location(job, prefs, profile)
    edu, edu_reason = score_education(matrix)
    pref, pref_reason, pref_fail = score_preferences(job, analysis, prefs)
    sen, sen_reason = score_seniority(analysis, job, candidate_level(profile, prefs))
    components = {
        "skill": ComponentScore(score=round(skill, 1), weight=WEIGHTS["skill"], reason=skill_reason),
        "role": ComponentScore(score=round(role, 1), weight=WEIGHTS["role"], reason=role_reason),
        "experience": ComponentScore(score=round(exp, 1), weight=WEIGHTS["experience"], reason=exp_reason),
        "location": ComponentScore(score=round(loc, 1), weight=WEIGHTS["location"], reason=loc_reason),
        "education": ComponentScore(score=round(edu, 1), weight=WEIGHTS["education"], reason=edu_reason),
        "preference": ComponentScore(score=round(pref, 1), weight=WEIGHTS["preference"], reason=pref_reason),
        "seniority": ComponentScore(score=round(sen, 1), weight=WEIGHTS["seniority"], reason=sen_reason),
    }
    overall = sum(c.score * c.weight for c in components.values())
    reasons = hard_filters(job, analysis, profile, prefs, loc_ok, pref_fail)
    result = MatchResult(
        overall_score=round(overall, 1),
        skill_score=components["skill"].score,
        role_score=components["role"].score,
        experience_score=components["experience"].score,
        location_score=components["location"].score,
        education_score=components["education"].score,
        preference_score=components["preference"].score,
        seniority_score=components["seniority"].score,
        semantic_similarity=round(semantic_similarity, 4) if semantic_similarity is not None else None,
        hard_filter_passed=not reasons,
        hard_filter_reasons=reasons,
        matched_skills=lists["matched"],
        missing_required_skills=lists["missing_required"],
        missing_preferred_skills=lists["missing_preferred"],
        missing_nice_to_have_skills=lists["missing_nice"],
        related_not_matched=lists["related"],
        weak_evidence_skills=lists["weak"],
        components=components,
    )
    result.explanation = explain(result, job)
    return result


def match_input_hash(profile: CandidateProfileData, prefs: Preferences | None, job_content_hash: str, analyzer_version: str) -> str:
    blob = json.dumps(
        {"p": profile.model_dump(mode="json"), "pr": prefs.model_dump(mode="json") if prefs else None,
         "j": job_content_hash, "a": analyzer_version, "m": MATCHER_VERSION, "e": get_embedder().name},
        sort_keys=True,
    )
    return hashlib.sha256(blob.encode()).hexdigest()


def candidate_embedding_text(profile: CandidateProfileData, prefs: Preferences | None) -> str:
    titles = (prefs.target_titles if prefs else []) or profile.target_roles
    parts = [
        "Target roles: " + ", ".join(titles[:5]),
        "Skills: " + ", ".join(s.name for s in profile.skills[:40]),
        profile.summary or "",
        " ".join(f"{e.title or ''} {' '.join(e.bullets[:3])}" for e in profile.experience[:4]),
        " ".join(f"{p.name} {' '.join(p.bullets[:2])}" for p in profile.projects[:4]),
    ]
    return "\n".join(p for p in parts if p.strip())


def job_embedding_text(title: str, company: str, description: str) -> str:
    return f"{title} at {company}\n{description[:3000]}"
