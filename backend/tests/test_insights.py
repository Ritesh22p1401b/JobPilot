"""Job search filters and the /insights aggregates (funnel, resume performance, skill gaps, companies, follow-ups)."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import update

from app.database import get_sessionmaker, utcnow
from app.models import Application
from app.workers.worker import drain
from tests.conftest import register
from tests.test_e2e_pipeline import patched_providers, resume_pdf  # noqa: F401  (fixtures)

PREFS = {"target_titles": ["LLM Engineer"], "locations": ["Bengaluru"], "work_modes": ["hybrid", "remote"],
         "employment_types": ["full_time"], "experience_level": "entry", "minimum_match_score": 50}


async def _setup(client, resume_pdf):  # noqa: F811
    h = await register(client)
    r = await client.post("/api/v1/resume/upload", headers=h, files={"file": ("cv.pdf", resume_pdf, "application/pdf")})
    assert r.status_code == 201
    await drain()
    assert (await client.put("/api/v1/preferences", headers=h, json=PREFS)).status_code == 200
    await client.post("/api/v1/jobs/search", headers=h, json={})
    await drain()
    return h


async def test_job_filters_and_skills(client, resume_pdf, patched_providers):  # noqa: F811
    h = await _setup(client, resume_pdf)

    async def titles(qs: str) -> set[str]:
        res = await client.get(f"/api/v1/jobs?include_filtered=true&{qs}", headers=h)
        assert res.status_code == 200, res.text
        return {j["title"] for j in res.json()["jobs"]}

    assert await titles("location=bengaluru") == {"LLM Engineer"}
    assert await titles("location=london") == {"LLM Research Scientist"}
    assert await titles("company=finco") == {"LLM Engineer"}
    assert await titles("skill=fastapi") == {"LLM Engineer"}
    assert await titles("skill=cobol") == set()
    assert "LLM Engineer" in await titles("posted_within_days=7")
    assert await titles("min_salary=1") == set()  # no salaries were published
    assert (await client.get("/api/v1/jobs?sort=salary", headers=h)).status_code == 200
    assert (await client.get("/api/v1/jobs?sort=bogus", headers=h)).status_code == 422

    job = next(j for j in (await client.get("/api/v1/jobs", headers=h)).json()["jobs"] if j["source"] == "greenhouse")
    assert "Python" in job["skills"] and len(job["skills"]) <= 6


async def test_insights_reflect_real_activity(client, resume_pdf, patched_providers):  # noqa: F811
    h = await _setup(client, resume_pdf)
    empty = (await client.get("/api/v1/insights", headers=h)).json()
    assert empty["funnel"]["applied"] == 0 and empty["funnel"]["response_rate"] is None  # no invented rates
    assert empty["skill_gaps"]["based_on_postings"] >= 1
    assert any(c["company"] == "FinCo" and c["matching_roles"] == 1 for c in empty["companies"])
    zeta = next(c for c in empty["companies"] if c["company"] == "Zeta")
    assert zeta["matching_roles"] == 0 and zeta["best_score"] is None  # hard-filtered roles never count as matches
    assert any(s["skill"] == "Python" and s["you_have"] for s in empty["market_skills"]["skills"])

    job = next(j for j in (await client.get("/api/v1/jobs", headers=h)).json()["jobs"] if j["source"] == "greenhouse")
    await client.post(f"/api/v1/applications/{job['id']}/prepare", headers=h)
    await drain()
    app = (await client.get("/api/v1/applications", headers=h)).json()["applications"][0]
    assert (await client.patch(f"/api/v1/applications/{app['id']}", headers=h, json={"status": "APPLIED"})).status_code == 200

    # Backdate the application and its events so it is due for a follow-up.
    async with get_sessionmaker()() as db:
        old = utcnow() - timedelta(days=10)
        await db.execute(update(Application).where(Application.id == app["id"]).values(applied_at=old))
        from app.models import ApplicationEvent

        await db.execute(update(ApplicationEvent).where(ApplicationEvent.application_id == app["id"]).values(created_at=old))
        await db.commit()

    data = (await client.get("/api/v1/insights", headers=h)).json()
    assert data["funnel"]["applied"] == 1 and data["funnel"]["responses"] == 0 and data["funnel"]["response_rate"] == 0.0
    assert data["follow_ups"] and data["follow_ups"][0]["days_since_activity"] >= 10
    assert any(b["kind"] == "follow_ups" for b in data["brief"])
    perf = data["resume_performance"]
    assert perf and perf[0]["applications"] == 1 and perf[0]["resume_version_id"] == app["resume_version_id"]

    # Moving to INTERVIEW counts as a response and an interview; the follow-up disappears.
    await client.patch(f"/api/v1/applications/{app['id']}", headers=h, json={"status": "INTERVIEW"})
    data = (await client.get("/api/v1/insights", headers=h)).json()
    assert data["funnel"]["responses"] == 1 and data["funnel"]["interviews"] == 1 and data["funnel"]["interview_rate"] == 100.0
    assert data["kpis"]["interviews"] == 1 and not data["follow_ups"]


async def test_approved_answers_persist_and_apps_carry_match(client, resume_pdf, patched_providers):  # noqa: F811
    """Regression: approve() mutated JSON in place, so SQLAlchemy skipped the UPDATE and answers were lost."""
    h = await _setup(client, resume_pdf)
    job = next(j for j in (await client.get("/api/v1/jobs", headers=h)).json()["jobs"] if j["source"] == "greenhouse")
    await client.post(f"/api/v1/applications/{job['id']}/prepare", headers=h)
    await drain()
    app = (await client.get("/api/v1/applications", headers=h)).json()["applications"][0]
    assert app["job"]["match"]["overall_score"] == job["match"]["overall_score"]  # list includes the match
    unanswered = [a["question"] for a in app["answers"] if a["answer"] is None]
    assert unanswered, "fixture should leave sensitive questions for the user"
    body = {"answers": {q: "Prefer not to say" for q in unanswered}, "approve_resume": True}
    assert (await client.post(f"/api/v1/applications/{job['id']}/approve", headers=h, json=body)).status_code == 200
    fresh = (await client.get(f"/api/v1/applications/{app['id']}", headers=h)).json()  # re-read from the database
    by_q = {a["question"]: a for a in fresh["answers"]}
    for q in unanswered:
        assert by_q[q]["answer"] == "Prefer not to say" and by_q[q]["source"] == "user" and not by_q[q]["requires_approval"]
    assert fresh["job"]["match"] is not None


async def test_insights_requires_profile(client):
    h = await register(client, email="noprofile@example.com")
    assert (await client.get("/api/v1/insights", headers=h)).status_code == 409
