"""Achievement quality analysis for resume bullets (ACTION, TECHNOLOGY, TASK, SCOPE, RESULT, METRIC)."""

from __future__ import annotations

import re

from app.schemas.profile import CandidateProfileData
from app.services.ats.models import Issue, TestResult
from app.services.skill_normalizer import extract_skills

ACTION_VERBS = {
    "built", "developed", "designed", "implemented", "created", "engineered", "deployed", "automated", "optimized",
    "optimised", "integrated", "led", "migrated", "reduced", "improved", "launched", "architected", "trained",
    "fine-tuned", "analyzed", "analysed", "researched", "wrote", "delivered", "maintained", "refactored", "scaled",
    "containerized", "established", "collaborated", "configured", "evaluated", "prototyped", "shipped", "streamlined",
    "modeled", "benchmarked", "debugged", "tested", "documented", "published", "mentored", "managed", "owned",
    "orchestrated", "added", "enabled", "extended", "used", "applied", "set", "worked", "contributed", "conducted",
}
RESULT_CUES = re.compile(r"\b(reduc|improv|increas|decreas|enabl|result|saving|cutting|boost|accelerat|achiev|"
                         r"so that|allowing|leading to|which|to support|to serve|to power)\w*", re.I)
SCOPE_CUES = re.compile(r"\b(users?|customers?|clients?|teams?|production|company-wide|across|end-to-end|"
                        r"enterprise|internal|million|thousands?|daily|real-time|at scale)\b", re.I)
METRIC_RE = re.compile(r"\d")


def analyze_bullet(text: str) -> dict:
    first = re.findall(r"[A-Za-z\-]+", text.lower())[:1]
    action = bool(first) and (first[0] in ACTION_VERBS or first[0].endswith("ed"))
    tech = bool(extract_skills(text))
    metric = bool(METRIC_RE.search(text))
    result = bool(RESULT_CUES.search(text))
    scope = bool(SCOPE_CUES.search(text))
    task = len(text.split()) >= 6
    score = 25 * action + 20 * tech + 20 * task + 15 * result + 10 * scope + 10 * metric
    return {"text": text, "action": action, "technology": tech, "task": task, "scope": scope, "result": result,
            "metric": metric, "score": score}


def run_achievement_test(profile: CandidateProfileData) -> TestResult:
    bullets = [b for e in profile.experience for b in e.bullets] + [b for p in profile.projects for b in p.bullets]
    if not bullets:
        return TestResult(name="achievement_quality", status="SKIP", score=None)
    analysed = [analyze_bullet(b) for b in bullets]
    score = round(sum(a["score"] for a in analysed) / len(analysed), 1)
    issues: list[Issue] = []
    weak = [a for a in analysed if a["score"] < 50]
    for a in weak[:5]:
        missing = [k.upper() for k in ("action", "technology", "task", "result") if not a[k]]
        issues.append(Issue(type="WEAK_BULLET", severity="info",
                            message=f"'{a['text'][:90]}' lacks {', '.join(missing)}."))
    no_metric = sum(1 for a in analysed if not a["metric"])
    if no_metric / len(analysed) > 0.7:
        issues.append(Issue(type="FEW_METRICS", severity="info",
                            message="Most bullets have no measurable outcome. Add metrics only where you have real, "
                                    "verifiable numbers."))
    return TestResult(name="achievement_quality", status="PASS" if score >= 70 else "WARN", score=score,
                      details={"bullets": len(analysed), "weak_bullets": len(weak), "without_metrics": no_metric,
                               "analysis": analysed[:30]},
                      issues=issues)
