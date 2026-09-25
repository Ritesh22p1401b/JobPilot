"""End-to-end pipeline through the HTTP API with the event bus drained synchronously."""

from __future__ import annotations

import pytest

from app.agents import discovery_agent
from app.schemas.job import RawJob
from app.services.resume_document import content_from_profile, render_pdf
from app.services.resume_parser import parse_resume
from app.workers.worker import drain
from tests.conftest import register

JD_HTML = (
    "<h3>What you'll do</h3><ul><li>Build LLM-powered services and RAG pipelines.</li></ul>"
    "<h3>Requirements</h3><ul><li>Strong Python and FastAPI experience</li><li>Experience with LLMs and RAG</li>"
    "<li>Hands-on Docker</li><li>Bachelor's degree in Computer Science</li></ul>"
    "<h3>Nice to have</h3><ul><li>Kubernetes</li></ul><p>Hybrid role in Bengaluru.</p>"
)


class FakeProvider:
    def __init__(self, name: str, jobs: list[RawJob], fail: bool = False) -> None:
        self.name = name
        self.jobs = jobs
        self.fail = fail
        self.errors: list[str] = []

    async def search(self, query, location=None, page=1):
        if self.fail:
            raise RuntimeError("provider is down")
        return [j for j in self.jobs if query.split()[0].lower() in j.title.lower()]

    async def get_job(self, external_id):
        return None

    async def aclose(self):
        return None


def fake_jobs() -> list[FakeProvider]:
    gh = RawJob(source="greenhouse", external_id="finco:1", company="FinCo", title="LLM Engineer", location="Bengaluru, India",
                description=JD_HTML, url="https://boards.greenhouse.io/finco/jobs/1",
                application_url="https://boards.greenhouse.io/finco/jobs/1")
    dup = RawJob(source="adzuna", external_id="555", company="FinCo", title="LLM Engineer", location="Bengaluru, India",
                 description="Build LLM-powered services and RAG pipelines. Strong Python and FastAPI experience",
                 description_truncated=True, url="https://www.adzuna.in/details/555")
    other = RawJob(source="lever", external_id="zeta:9", company="Zeta", title="LLM Research Scientist", location="London, UK",
                   description="<p>PhD required. 8+ years of experience in deep learning research. JAX and TPUs.</p>",
                   url="https://jobs.lever.co/zeta/9")
    return [FakeProvider("greenhouse", [gh]), FakeProvider("adzuna", [dup]), FakeProvider("lever", [other]),
            FakeProvider("broken", [], fail=True)]


@pytest.fixture
def resume_pdf(sample_resume_text) -> bytes:
    return render_pdf(content_from_profile(parse_resume(sample_resume_text).profile))


@pytest.fixture
def patched_providers(monkeypatch):
    async def _build(db):
        return fake_jobs()

    monkeypatch.setattr(discovery_agent, "build_providers", _build)


async def test_full_pipeline(client, resume_pdf, patched_providers):
    h = await register(client)
    assert (await client.get("/api/v1/auth/me", headers=h)).json()["has_profile"] is False
    assert (await client.get("/api/v1/jobs", headers=h)).status_code == 409  # no profile yet
    assert (await client.get("/api/v1/jobs")).status_code == 401

    # --- upload validation + ingestion
    bad = await client.post("/api/v1/resume/upload", headers=h, files={"file": ("x.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 422
    r = await client.post("/api/v1/resume/upload", headers=h, files={"file": ("Ritesh_Pandey.pdf", resume_pdf, "application/pdf")})
    assert r.status_code == 201, r.text
    assert r.json()["experience_entries"] == 2 and r.json()["skills"] > 10
    await drain()
    resume = (await client.get("/api/v1/resume", headers=h)).json()
    assert resume["profile"]["contact"]["email"] == "ritesh.pandey@example.com"
    master = resume["master_version"]
    assert master["version_type"] == "MASTER" and master["parser_score"] >= 90 and master["round_trip_score"] == 100

    # --- preferences + discovery (one provider fails; the pipeline continues)
    prefs = {"target_titles": ["LLM Engineer", "AI Engineer"], "locations": ["Bengaluru"], "work_modes": ["hybrid", "remote"],
             "employment_types": ["full_time"], "experience_level": "entry", "minimum_match_score": 50,
             "search_frequency": "daily"}
    assert (await client.put("/api/v1/preferences", headers=h, json=prefs)).status_code == 200
    task = (await client.post("/api/v1/jobs/search", headers=h, json={})).json()
    assert "linkedin.com/jobs/search" in task["destination_links"]["linkedin"]
    await drain()
    t = (await client.get(f"/api/v1/tasks/{task['task']['id']}", headers=h)).json()
    assert t["status"] == "DONE" and t["result"]["providers"]["broken"]["errors"]
    assert t["result"]["providers"]["greenhouse"]["count"] == 1

    jobs = (await client.get("/api/v1/jobs", headers=h)).json()
    titles = {(j["source"], j["title"]) for j in jobs["jobs"]}
    assert ("greenhouse", "LLM Engineer") in titles
    assert ("adzuna", "LLM Engineer") not in titles  # deduplicated into the Greenhouse record
    assert ("lever", "LLM Research Scientist") not in titles  # hard-filtered (location/seniority)
    filtered = (await client.get("/api/v1/jobs?include_filtered=true", headers=h)).json()
    lever = next(j for j in filtered["jobs"] if j["source"] == "lever")
    assert lever["match"]["hard_filter_passed"] is False and lever["match"]["hard_filter_reasons"]
    job = next(j for j in jobs["jobs"] if j["source"] == "greenhouse")
    assert job["alternate_sources"] and job["alternate_sources"][0]["url"] == "https://www.adzuna.in/details/555"
    m = job["match"]
    assert m["overall_score"] >= 60 and set(m["breakdown"]) == {"skill", "role", "experience", "location", "education",
                                                                 "preference", "seniority"}
    assert "Kubernetes" in m["missing_skills"]["nice_to_have"] and not m["missing_skills"]["required"]

    detail = (await client.get(f"/api/v1/jobs/{job['id']}", headers=h)).json()
    matrix = {row["requirement"]: row for row in detail["requirement_matrix"]}
    assert matrix["Python"]["matched"] and matrix["Kubernetes"]["status"] == "RELATED_BUT_NOT_MATCH"
    assert detail["analysis"]["has_explicit_sections"]

    notes = (await client.get("/api/v1/notifications", headers=h)).json()
    assert notes["unread"] >= 1 and any(n["kind"] == "new_matches" for n in notes["notifications"])

    # --- Resume Lab: job-specific assessment
    report = (await client.post("/api/v1/resume/analyze", headers=h, json={"job_id": job["id"]})).json()
    assert report["assessment"] in ("STRONG", "GOOD", "FAIR") and report["requirement_coverage"] is not None
    assert "does not predict" in report["disclaimer"]

    # --- tailoring -> tests -> diff -> approval
    tr = await client.post("/api/v1/resume/tailor", headers=h, json={"job_id": job["id"]})
    assert tr.status_code == 202
    await drain()
    versions = (await client.get("/api/v1/resume/versions", headers=h)).json()["versions"]
    tailored = next(v for v in versions if v["version_type"] == "TAILORED")
    assert tailored["status"] == "DRAFT" and tailored["round_trip_score"] >= 95 and tailored["has_pdf"]
    vdetail = (await client.get(f"/api/v1/resume/{tailored['id']}", headers=h)).json()
    assert vdetail["claims"] and all(c["verified"] for c in vdetail["claims"])
    tests = (await client.get(f"/api/v1/resume/{tailored['id']}/test-results", headers=h)).json()["tests"]
    assert {"round_trip_parsing", "round_trip_parsing_pdf", "hallucination_check"} <= {x["name"] for x in tests}
    diff = (await client.get(f"/api/v1/resume/{tailored['id']}/diff", headers=h)).json()
    assert diff["diff"]["unsupported_additions"] == 0 and diff["from"]["version_type"] == "MASTER"
    for fmt, ctype in (("docx", "officedocument"), ("pdf", "pdf"), ("txt", "text/plain"), ("json", "json")):
        dl = await client.get(f"/api/v1/resume/{tailored['id']}/download?format={fmt}", headers=h)
        assert dl.status_code == 200 and ctype in dl.headers["content-type"]
    orig = await client.get(f"/api/v1/resume/{master['id']}/download?format=original", headers=h)
    assert orig.content == resume_pdf
    cmp_ = (await client.post("/api/v1/resume/compare", headers=h,
                              json={"version_ids": [master["id"], tailored["id"]], "job_id": job["id"]})).json()
    assert len(cmp_["rows"]) == 2 and "do not predict" in cmp_["note"]
    approved = (await client.post(f"/api/v1/resume/{tailored['id']}/approve", headers=h, json={})).json()
    assert approved["status"] == "APPROVED"

    # --- application: prepare -> approve -> submit (assisted: no authorized key) -> track
    prep = await client.post(f"/api/v1/applications/{job['id']}/prepare", headers=h)
    assert prep.status_code == 202
    await drain()
    app_id = prep.json()["application_id"]
    app = (await client.get(f"/api/v1/applications/{app_id}", headers=h)).json()
    assert app["status"] == "APPROVAL_REQUIRED"
    assert app["resume_version_id"] == tailored["id"] and app["cover_letter"].startswith("Dear Hiring Team")
    answers = {a["question"]: a for a in app["answers"]}
    assert answers["Email"]["answer"] == "ritesh.pandey@example.com"
    visa = answers["Will you now or in the future require visa sponsorship?"]
    assert visa["answer"] is None and visa["confidence"] == "UNKNOWN"
    assert app["package"]["submission_method"] == "assisted"
    early = await client.post(f"/api/v1/applications/{job['id']}/submit", headers=h)
    assert early.status_code == 409  # cannot submit before approval
    fill = {a["question"]: "User provided answer" for a in app["answers"] if a["answer"] is None}
    approved_app = (await client.post(f"/api/v1/applications/{job['id']}/approve", headers=h, json={"answers": fill})).json()
    assert approved_app["status"] == "READY"
    sub = (await client.post(f"/api/v1/applications/{job['id']}/submit", headers=h)).json()
    assert sub["result"]["method"] == "assisted" and sub["result"]["application_url"] == job["application_url"]
    marked = (await client.patch(f"/api/v1/applications/{app_id}", headers=h, json={"status": "APPLIED"})).json()
    assert marked["status"] == "APPLIED" and marked["applied_at"]
    bad_status = await client.patch(f"/api/v1/applications/{app_id}", headers=h, json={"status": "HACKED"})
    assert bad_status.status_code == 400
    events = (await client.get(f"/api/v1/applications/{app_id}", headers=h)).json()["events"]
    actions = [e["action"] for e in events]
    for a in ("created", "prepared", "approved", "assisted_submission_opened", "status_changed"):
        assert a in actions

    dash = (await client.get("/api/v1/dashboard", headers=h)).json()
    assert dash["applications"] == 1 and dash["high_match_jobs"] >= 1
    runs = (await client.get("/api/v1/agents/runs", headers=h)).json()["runs"]
    agents = {r["agent"] for r in runs}
    assert {"resume_agent", "discovery_agent", "normalization_agent", "matching_agent", "job_analyst_agent",
            "resume_optimizer_agent", "resume_test_agent", "application_agent"} <= agents
    assert all(r["status"] == "SUCCEEDED" for r in runs)

    # --- profile edit => new master version + regression summary, re-matching
    prof = (await client.get("/api/v1/profile", headers=h)).json()["profile"]
    prof["skills"].append({"name": "k8s", "category": "other", "sections": ["skills"]})
    upd = (await client.patch("/api/v1/profile", headers=h, json={"skills": prof["skills"]})).json()
    assert "Kubernetes" in upd["regression"]["skills_added"]
    await drain()
    job_after = (await client.get(f"/api/v1/jobs/{job['id']}", headers=h)).json()
    assert "Kubernetes" not in job_after["match"]["missing_skills"]["nice_to_have"]

    # --- privacy
    export = await client.get("/api/v1/privacy/export", headers=h)
    assert export.status_code == 200 and export.json()["applications"]
    assert (await client.delete("/api/v1/privacy/account", headers=h)).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=h)).status_code == 401


async def test_users_are_isolated(client, resume_pdf, patched_providers):
    a = await register(client, "a@example.com")
    b = await register(client, "b@example.com")
    await client.post("/api/v1/resume/upload", headers=a, files={"file": ("r.pdf", resume_pdf, "application/pdf")})
    await client.post("/api/v1/resume/upload", headers=b, files={"file": ("r.pdf", resume_pdf, "application/pdf")})
    await drain()
    va = (await client.get("/api/v1/resume", headers=a)).json()["master_version"]["id"]
    assert (await client.get(f"/api/v1/resume/{va}", headers=b)).status_code == 404
    assert (await client.get(f"/api/v1/resume/{va}/download?format=original", headers=b)).status_code == 404


async def test_auth_validation(client):
    assert (await client.post("/api/v1/auth/register", json={"email": "bad", "password": "x"})).status_code == 422
    await register(client, "c@example.com")
    dupe = await client.post("/api/v1/auth/register", json={"email": "c@example.com", "password": "Sup3rSecret!"})
    assert dupe.status_code == 409
    wrong = await client.post("/api/v1/auth/login", json={"email": "c@example.com", "password": "WrongPass1"})
    assert wrong.status_code == 401
    ok = await client.post("/api/v1/auth/login", json={"email": "C@example.com", "password": "Sup3rSecret!"})
    assert ok.status_code == 200
    assert (await client.get("/api/v1/health")).json()["status"] == "ok"


async def test_manual_import_and_llm_explanation(client, resume_pdf, fake_llm):
    fake_llm.responses = {"job_match_explainer": {
        "match_summary": "Good fit on Python and RAG.", "recommendation_reason": "Core skills are evidenced.",
        "experience_alignment": "Entry-level aligns.", "application_strategy": ["Lead with the RAG internship project."]},
        "jd_requirement_extractor": {"requirements": [
            {"requirement": "Terraform", "category": "REQUIRED_SKILL", "source_span": "this text is not in the JD"},
            {"requirement": "Snowpark", "category": "REQUIRED_SKILL", "source_span": "Experience with Snowpark is a plus"}]}}
    h = await register(client, "d@example.com")
    await client.post("/api/v1/resume/upload", headers=h, files={"file": ("r.pdf", resume_pdf, "application/pdf")})
    await drain()
    imp = await client.post("/api/v1/jobs/import", headers=h, json={
        "title": "AI Engineer", "company": "SeenOnLinkedIn Ltd", "url": "https://www.linkedin.com/jobs/view/123",
        "description": "Requirements:\n- Python and RAG\n- FastAPI\nExperience with Snowpark is a plus\nRemote role."})
    assert imp.status_code == 201
    await drain()
    job_id = imp.json()["job_id"]
    job = (await client.get(f"/api/v1/jobs/{job_id}", headers=h)).json()
    assert job["source"] == "manual" and job["match"]["overall_score"] > 0
    m = (await client.post(f"/api/v1/matches/{job['match']['id']}/explain", headers=h)).json()
    assert m["explanation_source"] == "llm" and "RAG internship" in m["explanation"]
    # LLM JD enrichment only keeps requirements whose span is verbatim in the JD, with tier from inline cues.
    from app.agents.resume_agents.jd_analysis_agent import _LLMReq, validate_llm_requirements
    from app.services.jd_parser import analyze_job_description

    desc = "Requirements:\n- Python and RAG\nExperience with Snowpark is a plus"
    kept = validate_llm_requirements([_LLMReq(**r) for r in fake_llm.responses["jd_requirement_extractor"]["requirements"]],
                                     analyze_job_description("AI Engineer", desc), desc)
    assert [(r.requirement, r.category, r.extracted_by) for r in kept] == [("Snowpark", "NICE_TO_HAVE", "llm")]
