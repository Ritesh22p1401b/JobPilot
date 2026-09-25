"""Experience relevance: semantic similarity between resume evidence and the job's responsibilities."""

from __future__ import annotations

from app.schemas.jd import JDAnalysis
from app.schemas.profile import CandidateProfileData
from app.services.ats.models import TestResult
from app.services.embeddings import get_embedder, most_similar


def _scale(sim: float) -> float:
    if get_embedder().name.startswith("hash"):
        return max(0.0, min(100.0, sim * 140))
    return max(0.0, min(100.0, (sim - 0.5) / 0.35 * 100))


def run_relevance_test(analysis: JDAnalysis, doc_profile: CandidateProfileData, jd_text: str) -> TestResult:
    bullets = [b for e in doc_profile.experience for b in e.bullets] + [b for p in doc_profile.projects for b in p.bullets]
    if not bullets:
        return TestResult(name="experience_relevance", status="WARN", score=0.0,
                          details={"reason": "No experience or project bullets to compare."})
    targets = analysis.responsibilities or [jd_text[:1500]]
    per_target = []
    for t in targets[:10]:
        hit = most_similar(t, bullets)
        best = hit[1] if hit else 0.0
        per_target.append((t, best))
    avg = sum(s for _, s in per_target) / len(per_target)
    score = round(_scale(avg), 1)
    return TestResult(name="experience_relevance", status="PASS" if score >= 60 else "WARN", score=score,
                      details={"mean_similarity": round(avg, 3), "compared_responsibilities": len(per_target),
                               "embedder": get_embedder().name})
