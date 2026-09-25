"""Parser compatibility (field extraction) and round-trip fidelity tests."""

from __future__ import annotations

import re

from rapidfuzz import fuzz

from app.schemas.profile import CandidateProfileData
from app.services.ats.models import Issue, TestResult

ROUND_TRIP_WEIGHTS = {"contact": 0.20, "experience": 0.20, "education": 0.15, "skills": 0.15, "dates": 0.10,
                      "company_title": 0.10, "links": 0.10}


def _pct(n: float, d: float) -> float:
    return round(100.0 * n / d, 1) if d else 100.0


def extraction_tests(parsed: CandidateProfileData, text: str) -> list[TestResult]:
    """Tests 1-4 & 6 of the resume suite, run on what the parser recovered from the document."""
    results: list[TestResult] = []

    words = len(text.split())
    results.append(TestResult(
        name="text_extraction", status="PASS" if words >= 100 else "FAIL" if words < 30 else "WARN",
        score=100.0 if words >= 100 else _pct(words, 100), critical=words < 30,
        details={"words_extracted": words},
        issues=[] if words >= 100 else [Issue(type="TEXT_EXTRACTION", severity="error" if words < 30 else "warning",
                                               message=f"Only {words} words could be extracted.")]))

    c = parsed.contact
    fields = {"name": c.name, "email": c.email, "phone": c.phone, "linkedin": c.linkedin, "github": c.github}
    core_found = sum(1 for k in ("name", "email", "phone") if fields[k])
    issues = [Issue(type="CONTACT_EXTRACTION", severity="error" if k == "email" else "warning",
                    message=f"{k.title()} could not be extracted.") for k in ("name", "email", "phone") if not fields[k]]
    results.append(TestResult(
        name="contact_extraction", status="PASS" if core_found == 3 else "FAIL" if not c.email else "WARN",
        score=_pct(core_found, 3), critical=not c.email,
        details={k: bool(v) for k, v in fields.items()}, issues=issues))

    expected = ["summary", "skills", "experience", "education", "projects"]
    found = [s for s in expected if s in parsed.sections_found or (s == "experience" and "internships" in parsed.sections_found)]
    core = [s for s in ("experience", "education", "skills") if s in found or (s == "experience" and parsed.experience)]
    results.append(TestResult(
        name="section_extraction", status="PASS" if len(core) == 3 else "WARN" if core else "FAIL",
        score=_pct(len(found), len(expected)), critical=not core,
        details={"found": found, "missing": [s for s in expected if s not in found]},
        issues=[Issue(type="SECTION_EXTRACTION", severity="warning", message=f"Section not detected: {s}.")
                for s in ("experience", "education", "skills") if s not in core]))

    exp_scores = []
    exp_issues = []
    for e in parsed.experience:
        parts = [bool(e.company), bool(e.title), bool(e.start_date), bool(e.end_date or e.current)]
        exp_scores.append(sum(parts) / 4)
        missing = [n for n, ok in zip(("company", "title", "start date", "end date/current"), parts, strict=True) if not ok]
        if missing:
            exp_issues.append(Issue(type="EXPERIENCE_EXTRACTION", severity="warning",
                                    message=f"Entry '{e.title or e.company or e.id}': missing {', '.join(missing)}."))
    if parsed.experience:
        exp_score = round(100 * sum(exp_scores) / len(exp_scores), 1)
        results.append(TestResult(name="experience_extraction", status="PASS" if exp_score >= 90 else "WARN",
                                  score=exp_score, details={"entries": len(parsed.experience)}, issues=exp_issues))
    else:
        results.append(TestResult(name="experience_extraction", status="WARN", score=None,
                                  details={"entries": 0},
                                  issues=[Issue(type="EXPERIENCE_EXTRACTION", severity="info",
                                                message="No work experience entries parsed (fine for students; "
                                                        "otherwise check headings and date formats).")]))

    n_skills = len(parsed.skills)
    results.append(TestResult(name="skills_extraction", status="PASS" if n_skills >= 5 else "WARN" if n_skills else "FAIL",
                              score=min(100.0, n_skills * 10.0), details={"skills": n_skills},
                              issues=[] if n_skills >= 5 else [Issue(type="SKILL_EXTRACTION", severity="warning",
                                                                     message=f"Only {n_skills} skills recognised.")]))

    dated = [e for e in parsed.experience if e.start_date]
    edu_dated = [e for e in parsed.education if e.end_date or e.start_date]
    total = len(parsed.experience) + len(parsed.education)
    date_score = _pct(len(dated) + len(edu_dated), total) if total else 100.0
    results.append(TestResult(name="date_extraction", status="PASS" if date_score >= 90 else "WARN", score=date_score,
                              details={"dated_entries": len(dated) + len(edu_dated), "entries": total},
                              issues=[] if date_score >= 90 else [Issue(type="DATE_EXTRACTION", severity="warning",
                                      message="Some dates could not be parsed; use formats like 'Jan 2024 – Present'.")]))
    return results


def parser_compatibility_score(tests: list[TestResult]) -> float:
    weights = {"text_extraction": 0.2, "contact_extraction": 0.25, "section_extraction": 0.15,
               "experience_extraction": 0.2, "skills_extraction": 0.1, "date_extraction": 0.1}
    tot = w_sum = 0.0
    for t in tests:
        if t.name in weights and t.score is not None:
            tot += t.score * weights[t.name]
            w_sum += weights[t.name]
    return round(tot / w_sum, 1) if w_sum else 0.0


def _norm_link(u: str | None) -> str:
    if not u:
        return ""
    return re.sub(r"^(https?://)?(www\.)?", "", u.lower()).rstrip("/")


def _digits(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")[-10:]


def round_trip(reference: CandidateProfileData, reparsed: CandidateProfileData) -> TestResult:
    """Compare the profile recovered from a (generated) document against its source profile."""
    parts: dict[str, float] = {}
    notes: list[Issue] = []

    rc, pc = reference.contact, reparsed.contact
    checks = []
    if rc.name:
        checks.append(fuzz.ratio(rc.name.lower(), (pc.name or "").lower()) >= 90)
    if rc.email:
        checks.append((pc.email or "").lower() == rc.email.lower())
    if rc.phone:
        checks.append(_digits(rc.phone) == _digits(pc.phone))
    parts["contact"] = _pct(sum(checks), len(checks)) if checks else 100.0

    ref_bullets = [b for e in reference.experience for b in e.bullets]
    got_bullets = [b for e in reparsed.experience for b in e.bullets]
    if ref_bullets:
        found = sum(1 for b in ref_bullets if any(fuzz.ratio(b, g) >= 90 for g in got_bullets))
        count_ok = 1.0 if len(reparsed.experience) == len(reference.experience) else 0.7
        parts["experience"] = round(_pct(found, len(ref_bullets)) * count_ok, 1)
    else:
        parts["experience"] = 100.0 if len(reparsed.experience) == len(reference.experience) else 70.0

    if reference.education:
        ok = 0
        for ed in reference.education:
            if any((not ed.degree or fuzz.partial_ratio((ed.degree or "").lower(), (g.degree or "").lower()) >= 85)
                   and (not ed.institution or fuzz.token_set_ratio(ed.institution, g.institution or "") >= 85)
                   for g in reparsed.education):
                ok += 1
        parts["education"] = _pct(ok, len(reference.education))
    else:
        parts["education"] = 100.0

    ref_sk = {s.name.lower() for s in reference.skills}
    got_sk = {s.name.lower() for s in reparsed.skills}
    parts["skills"] = _pct(len(ref_sk & got_sk), len(ref_sk)) if ref_sk else 100.0

    date_checks = []
    ct_checks = []
    for e in reference.experience:
        best = max(reparsed.experience, key=lambda g: fuzz.token_set_ratio(f"{e.title} {e.company}", f"{g.title} {g.company}"),
                   default=None)
        if best is None:
            date_checks.append(False)
            ct_checks.append(False)
            continue
        if e.start_date:
            date_checks.append(best.start_date == e.start_date and (best.end_date == e.end_date or (e.current and best.current)))
        ct_checks.append(fuzz.token_set_ratio(e.company or "", best.company or "") >= 85
                         and fuzz.token_set_ratio(e.title or "", best.title or "") >= 85)
    parts["dates"] = _pct(sum(date_checks), len(date_checks)) if date_checks else 100.0
    parts["company_title"] = _pct(sum(ct_checks), len(ct_checks)) if ct_checks else 100.0

    link_checks = [_norm_link(getattr(pc, k)) == _norm_link(getattr(rc, k)) for k in ("linkedin", "github") if getattr(rc, k)]
    parts["links"] = _pct(sum(link_checks), len(link_checks)) if link_checks else 100.0

    score = round(sum(parts[k] * w for k, w in ROUND_TRIP_WEIGHTS.items()), 1)
    for k, v in parts.items():
        if v < 90:
            notes.append(Issue(type="ROUND_TRIP", severity="warning" if v >= 70 else "error",
                               message=f"Round-trip {k.replace('_', '/')} accuracy is {v:.0f}%."))
    status = "PASS" if score >= 90 else "WARN" if score >= 75 else "FAIL"
    return TestResult(name="round_trip_parsing", status=status, score=score, critical=score < 75,
                      severity="error" if status == "FAIL" else "warning" if status == "WARN" else "info",
                      details={f"{k}_accuracy": v for k, v in parts.items()}, issues=notes)
