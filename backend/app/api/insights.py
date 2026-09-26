"""Career insights computed from the user's own data: daily brief, funnel, resume performance, skill gaps,
companies and follow-ups. Everything here is a deterministic aggregate of stored rows; nothing is estimated
or generated, and every figure states what it is based on."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_candidate
from app.database import as_utc, get_db, utcnow
from app.models import Application, ApplicationEvent, CandidateProfile, Job, JobMatch, JobSkill, ResumeVersion
from app.services.repository import get_prefs, profile_data

router = APIRouter(tags=["insights"])

APPLIED_OR_LATER = {"APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"}
RESPONDED = {"ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"}
INTERVIEWED = {"INTERVIEW", "OFFER"}
FOLLOW_UP_AFTER = timedelta(days=7)


def _level(share: float) -> str:
    return "High" if share >= 0.25 else "Medium" if share >= 0.10 else "Low"


def _utc(dt: datetime | None) -> datetime:
    out = as_utc(dt)
    assert out is not None
    return out


def _rate(num: int, den: int) -> float | None:
    return round(100 * num / den, 1) if den else None


@router.get("/insights")
async def insights(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    prefs = await get_prefs(db, candidate.user_id)
    profile = profile_data(candidate)
    now = utcnow()
    high_threshold = max(prefs.minimum_match_score, 80)

    rows = (await db.execute(
        select(JobMatch, Job).join(Job, Job.id == JobMatch.job_id)
        .where(JobMatch.candidate_id == candidate.id, Job.duplicate_of_id.is_(None))
    )).all()
    passing = [(m, j) for m, j in rows if m.hard_filter_passed and not m.dismissed]

    apps = (await db.execute(select(Application, Job).join(Job, Job.id == Application.job_id)
                             .where(Application.candidate_id == candidate.id))).all()
    app_ids = [a.id for a, _ in apps]
    events = (await db.execute(select(ApplicationEvent).where(ApplicationEvent.application_id.in_(app_ids)))).scalars().all() if app_ids else []
    reached: dict[str, set[str]] = defaultdict(set)  # statuses each application has ever been in
    last_event: dict[str, datetime] = {}
    for e in events:
        if e.to_status:
            reached[e.application_id].add(e.to_status)
        prev = last_event.get(e.application_id)
        if prev is None or _utc(e.created_at) > prev:
            last_event[e.application_id] = _utc(e.created_at)
    for a, _ in apps:
        reached[a.id].add(a.status)
        if a.applied_at:
            reached[a.id].add("APPLIED")

    # ---------------------------------------------------------------- funnel
    applied = [a for a, _ in apps if reached[a.id] & APPLIED_OR_LATER]
    responded = [a for a in applied if reached[a.id] & RESPONDED]
    interviewed = [a for a in applied if reached[a.id] & INTERVIEWED]
    offers = [a for a in applied if "OFFER" in reached[a.id]]
    funnel = {
        "saved": len(apps), "applied": len(applied), "responses": len(responded), "interviews": len(interviewed),
        "offers": len(offers), "response_rate": _rate(len(responded), len(applied)),
        "interview_rate": _rate(len(interviewed), len(applied)),
    }

    # ---------------------------------------------------------------- resume performance
    versions = {v.id: v for v in (await db.execute(select(ResumeVersion).where(
        ResumeVersion.candidate_id == candidate.id))).scalars()}
    by_version: dict[str, list[Application]] = defaultdict(list)
    for a in applied:
        if a.resume_version_id:
            by_version[a.resume_version_id].append(a)
    resume_performance: list[dict[str, Any]] = []
    for vid, group in by_version.items():
        v = versions.get(vid)
        n_resp = sum(1 for a in group if reached[a.id] & RESPONDED)
        n_int = sum(1 for a in group if reached[a.id] & INTERVIEWED)
        resume_performance.append({
            "resume_version_id": vid, "label": (v.label if v else None) or (f"v{v.version_number}" if v else "Deleted version"),
            "version_number": v.version_number if v else None, "applications": len(group), "responses": n_resp,
            "interviews": n_int, "response_rate": _rate(n_resp, len(group)), "interview_rate": _rate(n_int, len(group)),
        })
    resume_performance.sort(key=lambda r: -r["applications"])

    # ---------------------------------------------------------------- skill gaps (from your passing matches)
    missing_req: Counter[str] = Counter()
    missing_pref: Counter[str] = Counter()
    strengths: Counter[str] = Counter()
    for m, _ in passing:
        ms = m.missing_skills_json or {}
        missing_req.update(set(ms.get("required") or []))
        missing_pref.update(set(ms.get("preferred") or []))
        strengths.update(set(m.matched_skills_json or []))
    n_postings = len(passing)
    gaps: list[dict[str, Any]] = []
    for skill in set(missing_req) | set(missing_pref):
        share = (missing_req[skill] + missing_pref[skill]) / n_postings if n_postings else 0
        gaps.append({"skill": skill, "required_in": missing_req[skill], "preferred_in": missing_pref[skill],
                     "share": round(share, 3), "demand": _level(share)})
    gaps.sort(key=lambda g: (-g["required_in"], -g["preferred_in"], g["skill"]))

    # Market demand: how often each skill is asked for across your passing postings, and whether you have it.
    have = {s.name.lower() for s in profile.skills}
    job_ids = [j.id for _, j in passing]
    demand: Counter[str] = Counter()
    for i in range(0, len(job_ids), 500):
        for skill, in (await db.execute(select(JobSkill.skill).where(JobSkill.job_id.in_(job_ids[i: i + 500])))).all():
            demand[skill] += 1
    market = [{"skill": s, "postings": n, "share": round(n / n_postings, 3) if n_postings else 0, "you_have": s.lower() in have}
              for s, n in demand.most_common(25)]

    # ---------------------------------------------------------------- companies
    comp: dict[str, dict[str, Any]] = {}
    for m, j in rows:
        c = comp.setdefault(j.company, {"company": j.company, "open_roles": 0, "matching_roles": 0, "best_score": None,
                                        "saved": 0, "applications": 0, "sources": set()})
        c["open_roles"] += 1
        c["sources"].add(j.source)
        if m.hard_filter_passed and m.overall_score >= prefs.minimum_match_score:
            c["matching_roles"] += 1
        if m.hard_filter_passed:
            c["best_score"] = max(c["best_score"] or 0, m.overall_score)
        c["saved"] += int(m.saved)
    for _, j in apps:
        if j.company in comp:
            comp[j.company]["applications"] += 1
    companies = sorted(({**c, "sources": sorted(c["sources"])} for c in comp.values()),
                       key=lambda c: (-c["matching_roles"], -(c["best_score"] or 0), c["company"]))

    # ---------------------------------------------------------------- follow-ups
    follow_ups: list[dict[str, Any]] = []
    for a, j in apps:
        if a.status != "APPLIED" or not a.applied_at:
            continue
        last = max(_utc(a.applied_at), last_event.get(a.id) or _utc(a.applied_at))
        if now - last >= FOLLOW_UP_AFTER:
            follow_ups.append({"application_id": a.id, "job_id": j.id, "title": j.title, "company": j.company,
                               "applied_at": _utc(a.applied_at).isoformat(), "days_since_activity": (now - last).days})
    follow_ups.sort(key=lambda f: -f["days_since_activity"])

    # ---------------------------------------------------------------- daily brief
    new_high = [(m, j) for m, j in passing if m.overall_score >= high_threshold and not m.saved
                and _utc(j.first_seen_at) >= now - timedelta(days=1)]
    unreviewed_high = [(m, j) for m, j in passing if m.overall_score >= high_threshold and not m.saved]
    approvals = [a for a, _ in apps if a.status == "APPROVAL_REQUIRED"]
    reviews = [v for v in versions.values() if v.status in ("DRAFT", "NEEDS_REVIEW")]
    brief: list[dict[str, Any]] = []
    if unreviewed_high:
        brief.append({"kind": "jobs", "tone": "primary", "count": len(unreviewed_high),
                      "text": f"{len(unreviewed_high)} high-match job{'s' if len(unreviewed_high) != 1 else ''} (score ≥ {high_threshold:g}) "
                              f"{'are' if len(unreviewed_high) != 1 else 'is'} waiting for review"
                              + (f", {len(new_high)} new today." if new_high else "."),
                      "action": {"label": "Review jobs", "href": f"/jobs?min_score={high_threshold:g}"}})
    if approvals:
        brief.append({"kind": "applications", "tone": "warning", "count": len(approvals),
                      "text": f"{len(approvals)} prepared application{'s need' if len(approvals) != 1 else ' needs'} your input before submission.",
                      "action": {"label": "Review applications", "href": "/applications?status=APPROVAL_REQUIRED"}})
    if follow_ups:
        brief.append({"kind": "follow_ups", "tone": "warning", "count": len(follow_ups),
                      "text": f"{len(follow_ups)} application{'s have' if len(follow_ups) != 1 else ' has'} had no activity for 7+ days; consider following up.",
                      "action": {"label": "See follow-ups", "href": "/applications/follow-ups"}})
    if reviews:
        brief.append({"kind": "resumes", "tone": "info", "count": len(reviews),
                      "text": f"{len(reviews)} tailored resume{'s are' if len(reviews) != 1 else ' is'} waiting for your review.",
                      "action": {"label": "Review resumes", "href": "/resume-lab"}})
    top_high_gap = Counter(s for m, _ in unreviewed_high for s in (m.missing_skills_json or {}).get("required") or [])
    if top_high_gap:
        skill, n = top_high_gap.most_common(1)[0]
        brief.append({"kind": "skills", "tone": "info", "count": n,
                      "text": f"{skill} is a required skill you have no resume evidence for in {n} of your high-match job{'s' if n != 1 else ''}.",
                      "action": {"label": "See skill gaps", "href": "/skills"}})

    return {
        "generated_at": now.isoformat(),
        "kpis": {"high_matches": len([1 for m, _ in passing if m.overall_score >= high_threshold]),
                 "saved": sum(1 for m, _ in rows if m.saved), "applications": len(applied),
                 "interviews": len(interviewed), "follow_ups_due": len(follow_ups), "high_threshold": high_threshold},
        "brief": brief,
        "funnel": funnel,
        "resume_performance": resume_performance,
        "skill_gaps": {"based_on_postings": n_postings, "gaps": gaps[:30],
                       "strengths": [{"skill": s, "postings": n} for s, n in strengths.most_common(15)]},
        "market_skills": {"based_on_postings": n_postings, "skills": market},
        "companies": companies[:200],
        "follow_ups": follow_ups,
    }
