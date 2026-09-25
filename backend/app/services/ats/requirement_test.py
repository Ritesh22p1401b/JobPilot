"""Requirement coverage (test 6): are the requirements the candidate genuinely satisfies represented in the resume?"""

from __future__ import annotations

from app.services.ats.models import Issue, TestResult
from app.services.evidence import EvidenceMatrix

COVERAGE_CATS = {"REQUIRED_SKILL", "PREFERRED_SKILL", "NICE_TO_HAVE", "REQUIRED_EXPERIENCE", "PREFERRED_EXPERIENCE",
                 "EDUCATION", "CERTIFICATION"}


def run_requirement_test(doc_matrix: EvidenceMatrix, verified_matrix: EvidenceMatrix) -> TestResult:
    doc_items = [i for i in doc_matrix.items if i.category in COVERAGE_CATS]
    ver = {(i.category, i.requirement): i for i in verified_matrix.items}
    total = earned = 0.0
    required_total = required_met = 0
    issues: list[Issue] = []
    for it in doc_items:
        total += it.importance
        if it.matched:
            earned += it.importance
        if it.category in ("REQUIRED_SKILL", "REQUIRED_EXPERIENCE", "EDUCATION") and it.tier in ("REQUIRED", "UNSPECIFIED"):
            required_total += 1
            required_met += int(it.matched)
        v = ver.get((it.category, it.requirement))
        if v and v.matched and not it.matched:
            issues.append(Issue(type="UNSURFACED_REQUIREMENT", severity="warning",
                                message=f"You meet '{it.requirement}' according to your verified profile, but this resume "
                                        "does not show it."))
    score = round(100 * earned / total, 1) if total else None
    req_cov = round(100 * required_met / required_total, 1) if required_total else None
    status = "SKIP" if score is None else "PASS" if not issues else "WARN"
    return TestResult(name="requirement_coverage", status=status, score=score,
                      details={"weighted_coverage": score, "required_coverage": req_cov,
                               "required_met": required_met, "required_total": required_total,
                               "unsurfaced": len(issues)},
                      issues=issues)
