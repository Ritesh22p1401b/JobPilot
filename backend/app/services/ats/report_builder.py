"""Runs the full resume test suite and assembles the Job-Specific ATS Compatibility Assessment."""

from __future__ import annotations

from app.schemas.jd import JDAnalysis
from app.schemas.preferences import Preferences
from app.schemas.profile import CandidateProfileData
from app.services.ats import DISCLAIMER
from app.services.ats.achievement import run_achievement_test
from app.services.ats.evidence_test import run_evidence_test, run_hallucination_test
from app.services.ats.formatting_test import run_formatting_test, run_length_test
from app.services.ats.keyword_test import run_keyword_test
from app.services.ats.models import AssessmentReport, Issue, KeywordResult, TestResult
from app.services.ats.parser_test import extraction_tests, parser_compatibility_score, round_trip
from app.services.ats.profiles import get_profile
from app.services.ats.requirement_test import run_requirement_test
from app.services.ats.score_engine import assessment_label, quality_index
from app.services.ats.semantic_match import run_relevance_test
from app.services.claim_verifier import ClaimCheck
from app.services.evidence import build_evidence_matrix
from app.services.resume_parser import parse_resume
from app.services.text_extraction import ExtractedDocument, ExtractionError, extract

EXPLANATIONS = {
    "parser_compatibility": "Weighted success of extracting text, contact details, sections, experience entries, skills and dates.",
    "requirement_coverage": "Importance-weighted share of the job's explicit requirements that this resume evidences.",
    "evidence_strength": "Matched skills demonstrated in experience/project bullets (1.0), semantic (0.75), or only listed (0.5).",
    "keyword_alignment": "Exact (1.0, or 0.8 if only in Skills) and semantic (0.7) matches of job skill terms; related terms earn 0.",
    "experience_relevance": "Semantic similarity between your bullets and the job's responsibilities.",
    "formatting_compatibility": "100 minus penalties for documented parsing risks (columns, tables, text boxes, images, header-only contact...).",
    "round_trip_fidelity": "Re-parsing the document and comparing against the verified profile (contact 20%, experience 20%, education 15%, skills 15%, dates 10%, company/title 10%, links 10%).",
}


def _recommendations(tests: list[TestResult]) -> list[str]:
    recs: list[str] = []
    by_type: dict[str, list[Issue]] = {}
    for t in tests:
        for i in t.issues:
            by_type.setdefault(i.type, []).append(i)
    for i in by_type.get("MISSING_EVIDENCE", [])[:4]:
        skill = i.message.split(" appears")[0]
        recs.append(f"Add verified {skill} usage to the relevant project or experience bullet, if applicable.")
    if by_type.get("UNSURFACED_REQUIREMENT"):
        recs.append("Some requirements you meet are not visible in this resume — generate a tailored version to surface them.")
    for i in by_type.get("MISSING_KEYWORD", [])[:3]:
        skill = i.message.split("'")[1]
        recs.append(f"{skill} is required but not evidenced. Do not add it without real experience; consider a project to build it.")
    if by_type.get("FEW_METRICS") or by_type.get("WEAK_BULLET"):
        recs.append("Strengthen bullets with action, technology and outcome; add measurable results only where evidence exists.")
    for kind in ("IMAGE_BASED", "TEXT_BOXES", "MULTI_COLUMN", "TABLES", "HEADER_CONTACT", "IMAGES", "NONSTANDARD_HEADINGS", "SMALL_FONT"):
        for i in by_type.get(kind, [])[:1]:
            recs.append(i.message)
    if by_type.get("KEYWORD_STUFFING"):
        recs.append("Reduce repeated keywords; show each skill through concrete evidence instead.")
    return list(dict.fromkeys(recs))


def assess_extracted(
    doc: ExtractedDocument,
    master: CandidateProfileData,
    reference: CandidateProfileData | None,
    analysis: JDAnalysis | None,
    jd_text: str,
    prefs: Preferences | None,
    ats_profile: str = "generic",
    claim_checks: list[ClaimCheck] | None = None,
    custom_profile: dict | None = None,
) -> AssessmentReport:
    ats = get_profile(ats_profile, custom_profile)
    parsed = parse_resume(doc.text).profile
    tests: list[TestResult] = extraction_tests(parsed, doc.text)
    parser_score = parser_compatibility_score(tests)
    fmt = run_formatting_test(doc, parsed, ats)
    tests.append(fmt)
    tests.append(run_length_test(doc, parsed))

    rt_score = None
    if reference is not None:
        rt = round_trip(reference, parsed)
        tests.append(rt)
        rt_score = rt.score
    else:
        tests.append(TestResult(name="round_trip_parsing", status="SKIP", details={"reason": "No reference profile."}))

    req_score = kw_score = ev_score = rel_score = None
    keywords: list[KeywordResult] = []
    matrix_rows: list[dict] = []
    if analysis is not None:
        doc_matrix = build_evidence_matrix(analysis, parsed, prefs)
        verified_matrix = build_evidence_matrix(analysis, master, prefs)
        kw_test, keywords = run_keyword_test(analysis, parsed, doc.text, ats)
        req_test = run_requirement_test(doc_matrix, verified_matrix)
        ev_test = run_evidence_test(doc_matrix)
        rel_test = run_relevance_test(analysis, parsed, jd_text)
        tests += [kw_test, req_test, ev_test, rel_test]
        kw_score, req_score, ev_score, rel_score = kw_test.score, req_test.score, ev_test.score, rel_test.score
        verified_lookup = {(i.category, i.requirement): i for i in verified_matrix.items}
        for it in doc_matrix.items:
            v = verified_lookup.get((it.category, it.requirement))
            row = it.model_dump()
            row["in_verified_profile"] = bool(v and v.matched)
            matrix_rows.append(row)
    else:
        for name in ("keyword_coverage", "requirement_coverage", "evidence_integrity", "experience_relevance"):
            tests.append(TestResult(name=name, status="SKIP", details={"reason": "Select a job to run job-specific tests."}))

    halluc = run_hallucination_test(parsed, master, claim_checks)
    tests.append(halluc)
    tests.append(run_achievement_test(parsed))

    components = {
        "parser_compatibility": parser_score,
        "requirement_coverage": req_score,
        "evidence_strength": ev_score,
        "keyword_alignment": kw_score,
        "experience_relevance": rel_score,
        "formatting_compatibility": fmt.score,
        "round_trip_fidelity": rt_score,
    }
    qi, eff_weights = quality_index(components, ats)
    critical = [t.name for t in tests if t.critical and t.status == "FAIL"]
    issues = [i for t in tests for i in t.issues]
    severity_rank = {"error": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: severity_rank[i.severity])
    return AssessmentReport(
        ats_profile=ats.name,
        assessment=assessment_label(qi, critical),  # type: ignore[arg-type]
        quality_index=qi,
        parser_compatibility=parser_score,
        requirement_coverage=req_score,
        keyword_alignment=kw_score,
        experience_evidence=ev_score,
        experience_relevance=rel_score,
        formatting_compatibility=fmt.score or 0.0,
        round_trip_fidelity=rt_score,
        unsupported_claims=int(halluc.details.get("unsupported_claims", 0)),
        component_weights=eff_weights,
        score_explanations=EXPLANATIONS,
        tests=tests,
        issues=issues,
        recommendations=_recommendations(tests),
        keywords=keywords,
        requirement_matrix=matrix_rows,
        extracted_text_preview=doc.text[:6000],
        critical_failures=critical,
        disclaimer=DISCLAIMER,
    )


def assess_document(filename: str, data: bytes, **kwargs) -> AssessmentReport:  # type: ignore[no-untyped-def]
    try:
        doc = extract(filename, data)
    except ExtractionError as exc:
        return AssessmentReport(
            ats_profile=kwargs.get("ats_profile", "generic"), assessment="NEEDS_REVIEW", quality_index=0,
            parser_compatibility=0, requirement_coverage=None, keyword_alignment=None, experience_evidence=None,
            experience_relevance=None, formatting_compatibility=0, round_trip_fidelity=None,
            tests=[TestResult(name="text_extraction", status="FAIL", score=0, critical=True,
                              issues=[Issue(type="TEXT_EXTRACTION", severity="error", message=str(exc))])],
            issues=[Issue(type="TEXT_EXTRACTION", severity="error", message=str(exc))],
            critical_failures=["text_extraction"], disclaimer=DISCLAIMER,
        )
    return assess_extracted(doc, **kwargs)
