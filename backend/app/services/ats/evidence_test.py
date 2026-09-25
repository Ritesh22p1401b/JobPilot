"""Evidence integrity (test 8) and hallucination / claim verification (test 9)."""

from __future__ import annotations

from app.schemas.jd import SKILL_CATEGORIES
from app.schemas.profile import CandidateProfileData
from app.services.ats.models import Issue, TestResult
from app.services.claim_verifier import ClaimCheck, numbers, profile_source_text
from app.services.evidence import EvidenceMatrix
from app.services.skill_normalizer import implied_by


def run_evidence_test(doc_matrix: EvidenceMatrix) -> TestResult:
    matched = [i for i in doc_matrix.items if i.category in SKILL_CATEGORIES and i.matched]
    if not matched:
        return TestResult(name="evidence_integrity", status="SKIP", score=None, details={"matched_skills": 0})
    credit = {"SUPPORTED": 1.0, "SEMANTIC_MATCH": 0.75, "PARTIALLY_SUPPORTED": 0.5}
    tot = sum(i.importance for i in matched)
    score = round(100 * sum(i.importance * credit.get(i.status, 0) for i in matched) / tot, 1)
    weak = [i.requirement for i in matched if i.status == "PARTIALLY_SUPPORTED"]
    issues = [Issue(type="WEAK_EVIDENCE", severity="info",
                    message=f"'{w}' is listed but not demonstrated in any experience or project bullet.") for w in weak]
    return TestResult(name="evidence_integrity", status="PASS" if score >= 80 else "WARN", score=score,
                      details={"matched_skills": len(matched), "weak_evidence": weak}, issues=issues)


def run_hallucination_test(doc_profile: CandidateProfileData, master: CandidateProfileData,
                           claim_checks: list[ClaimCheck] | None) -> TestResult:
    """Everything in the document must exist in the master profile (skills, numbers, employers, claims)."""
    issues: list[Issue] = []
    allowed = set(master.skill_names())
    for s in list(allowed):
        allowed |= implied_by(s)
    unknown_skills = sorted(s.name for s in doc_profile.skills if s.known and s.name not in allowed)
    for s in unknown_skills:
        issues.append(Issue(type="UNSUPPORTED_SKILL", severity="error", message=f"'{s}' is not in the verified profile."))
    master_text = profile_source_text(master)
    doc_text = "\n".join([doc_profile.summary or ""] + [b for e in doc_profile.experience for b in e.bullets]
                         + [b for p in doc_profile.projects for b in p.bullets])
    new_nums = numbers(doc_text) - numbers(master_text) - numbers(master.summary or "")
    # Year counts in a generated summary may legitimately round the verified total.
    new_nums = {n for n in new_nums if not n.isdigit() or int(n) > master.years_experience + 1}
    for n in sorted(new_nums):
        issues.append(Issue(type="UNSUPPORTED_NUMBER", severity="error", message=f"Number/metric '{n}' has no source in the master resume."))
    master_companies = {(e.company or "").lower() for e in master.experience}
    for e in doc_profile.experience:
        if e.company and e.company.lower() not in master_companies and not any(e.company.lower() in c or c in e.company.lower() for c in master_companies if c):
            issues.append(Issue(type="UNSUPPORTED_EMPLOYER", severity="error", message=f"Employer '{e.company}' is not in the master resume."))
    failed_claims = [c for c in (claim_checks or []) if not c.verified]
    for c in failed_claims:
        issues.append(Issue(type="UNVERIFIED_CLAIM", severity="error",
                            message=f"Unverified {c.section} claim: '{c.claim[:120]}' ({'; '.join(c.reasons)})"))
    unsupported = len(unknown_skills) + len(new_nums) + len(failed_claims) + sum(1 for i in issues if i.type == "UNSUPPORTED_EMPLOYER")
    total_claims = max(len(claim_checks or []), 1)
    score = 100.0 if unsupported == 0 else max(0.0, 100 - 100 * unsupported / total_claims)
    return TestResult(name="hallucination_check", status="PASS" if unsupported == 0 else "FAIL", score=round(score, 1),
                      critical=unsupported > 0, severity="error" if unsupported else "info",
                      details={"unsupported_claims": unsupported, "claims_checked": len(claim_checks or [])},
                      issues=issues)
