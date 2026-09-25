"""Application Agent (+ Cover Letter / Question agents as its collaborators).

Modes:
  DISCOVERY_ONLY         – never prepares automatically.
  ASSISTED_APPLICATION   – prepares a package; the user submits on the employer's site.
  AUTHORIZED_AUTO_APPLY  – submits only via an authorized provider API, only if every policy check passes.
Every action is written to application_events (immutable audit trail).
"""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.agents.resume_agents.resume_optimizer_agent import create_tailored_version
from app.agents.resume_agents.resume_test_agent import run_version_tests
from app.application_providers.base import ApplicationPackage
from app.application_providers.registry import get_application_provider
from app.database import utcnow
from app.models import Application, ApplicationEvent, CandidateProfile, Job, JobMatch, ResumeVersion
from app.observability import APPLICATIONS_PREPARED, APPLICATIONS_SUBMITTED
from app.providers.greenhouse import GreenhouseProvider
from app.providers.registry import destination_links
from app.services import storage
from app.services.cover_letter import generate_cover_letter
from app.services.evidence import build_evidence_matrix
from app.services.llm import get_llm
from app.services.question_answering import DEFAULT_QUESTIONS, answer_question
from app.services.repository import ensure_job_analysis, get_prefs, notify, profile_data

logger = logging.getLogger(__name__)


class ApplicationError(RuntimeError):
    pass


def add_event(db: AsyncSession, app: Application, actor: str, action: str, from_status: str | None,
              to_status: str | None, details: dict | None = None, notes: str | None = None) -> None:
    db.add(ApplicationEvent(application_id=app.id, actor=actor, action=action, from_status=from_status,
                            to_status=to_status, details_json=details or {}, notes=notes))


async def get_or_create_application(db: AsyncSession, candidate_id: str, job: Job, actor: str) -> Application:
    app = (await db.execute(select(Application).where(Application.candidate_id == candidate_id,
                                                      Application.job_id == job.id))).scalars().first()
    if app is None:
        app = Application(candidate_id=candidate_id, job_id=job.id, status="SAVED",
                          application_url=job.application_url or job.source_url)
        db.add(app)
        await db.flush()
        add_event(db, app, actor, "created", None, "SAVED")
    return app


async def _questions_for(job: Job) -> list[dict]:
    """Real application questions where the source publishes them (Greenhouse public API); else a default set."""
    if job.source == "greenhouse":
        try:
            gh = GreenhouseProvider([])
            qs = await gh.get_application_questions(job.external_id)
            await gh.aclose()
            out = []
            for q in qs:
                fields = q.get("fields") or [{}]
                name = fields[0].get("name")
                if name in ("resume", "resume_text", "cover_letter", "cover_letter_text"):
                    continue
                out.append({"question": q.get("label", ""), "required": bool(q.get("required")), "field_name": name})
            if out:
                return out
        except Exception as exc:  # noqa: BLE001 - fall back to defaults
            logger.info("could not fetch Greenhouse questions: %s", exc)
    return [{"question": q, "required": True, "field_name": None} for q in DEFAULT_QUESTIONS]


async def prepare_application(db: AsyncSession, candidate: CandidateProfile, job: Job, actor: str = "agent:application_agent",
                              auto: bool = False, ctx: AgentContext | None = None) -> Application:
    prefs = await get_prefs(db, candidate.user_id)
    master = profile_data(candidate)
    app = await get_or_create_application(db, candidate.id, job, actor)
    prev = app.status

    # 1. Resume: approved tailored version for this job > latest tailored > create one now.
    versions = list((await db.execute(select(ResumeVersion).where(
        ResumeVersion.candidate_id == candidate.id, ResumeVersion.job_id == job.id, ResumeVersion.version_type == "TAILORED")
        .order_by(ResumeVersion.version_number.desc()))).scalars())
    version = next((v for v in versions if v.status == "APPROVED"), None) or (versions[0] if versions else None)
    if version is None:
        version = await create_tailored_version(db, candidate, job, None, None, ctx)
        await run_version_tests(db, version, master, job, prefs)
    app.resume_version_id = version.id

    # 2. Cover letter.
    analysis = await ensure_job_analysis(db, job)
    matrix = build_evidence_matrix(analysis, master, prefs)
    letter = await generate_cover_letter(master, job.title, job.company, matrix, get_llm())
    app.cover_letter, app.cover_letter_source = letter.text, letter.source

    # 3. Application questions.
    answers = []
    for q in await _questions_for(job):
        draft = await answer_question(q["question"], master, prefs, matrix, job.title, job.company, get_llm(),
                                      required=q["required"], field_name=q["field_name"])
        answers.append(draft.model_dump())
    app.answers_json = answers

    # 4. Submission method + status.
    provider = get_application_provider(job.source)
    authorized = bool(provider and provider.is_authorized(job.external_id))
    needs_approval = (version.status != "APPROVED" or any(a["requires_approval"] for a in answers)
                      or any(a["required"] and a["answer"] is None for a in answers))
    app.status = "APPROVAL_REQUIRED" if needs_approval else "READY"
    app.mode = "AUTHORIZED_AUTO_APPLY" if (authorized and prefs.application_mode == "AUTHORIZED_AUTO_APPLY") else "ASSISTED_APPLICATION"
    app.package_json = {
        "resume_version_id": version.id,
        "resume_status": version.status,
        "cover_letter_source": letter.source,
        "cover_letter_rejections": letter.rejected_reasons,
        "submission_method": "authorized_api" if authorized else "assisted",
        "provider_authorized": authorized,
        "application_url": job.application_url or job.source_url,
        "destination_links": destination_links(f"{job.title} {job.company}", job.location),
        "unanswered_required": [a["question"] for a in answers if a["required"] and a["answer"] is None],
        "prepared_at": utcnow().isoformat(),
        "auto": auto,
    }
    add_event(db, app, actor, "prepared", prev, app.status,
              {"resume_version_id": version.id, "cover_letter_source": letter.source,
               "answers": len(answers), "needs_approval": needs_approval, "authorized": authorized})
    APPLICATIONS_PREPARED.inc()
    if app.status == "APPROVAL_REQUIRED":
        await notify(db, candidate.user_id, "approval_required", "Application needs your approval",
                     f"{job.title} at {job.company}: review the tailored resume, cover letter and answers.",
                     {"application_id": app.id})
    return app


class ApproveRequest(BaseModel):
    answers: dict[str, str | None] = Field(default_factory=dict)  # question -> user-confirmed answer
    approve_resume: bool = True
    cover_letter: str | None = None
    notes: str | None = None


async def approve_application(db: AsyncSession, app: Application, req: ApproveRequest, actor: str = "user") -> Application:
    prev = app.status
    answers = list(app.answers_json or [])
    for a in answers:
        if a["question"] in req.answers:
            val = req.answers[a["question"]]
            a["answer"] = val.strip() if isinstance(val, str) and val.strip() else None
            a["confidence"] = "USER_CONFIRMED" if a["answer"] else "UNKNOWN"
            a["source"] = "user"
            a["requires_approval"] = False
        elif a.get("answer") is not None and a.get("requires_approval"):
            a["requires_approval"] = False  # user reviewed the draft and approved it as-is
            a["confidence"] = "USER_CONFIRMED"
    app.answers_json = answers
    if req.cover_letter is not None:
        app.cover_letter = req.cover_letter
        app.cover_letter_source = "user"
    if req.approve_resume and app.resume_version_id:
        version = await db.get(ResumeVersion, app.resume_version_id)
        if version and version.status in ("DRAFT", "NEEDS_REVIEW"):
            version.status = "APPROVED"
            version.approved_at = utcnow()
    missing = [a["question"] for a in answers if a.get("required") and not a.get("answer")]
    app.status = "APPROVAL_REQUIRED" if missing else "READY"
    app.package_json = {**(app.package_json or {}), "unanswered_required": missing, "approved_at": utcnow().isoformat()}
    add_event(db, app, actor, "approved", prev, app.status, {"answers_confirmed": len(req.answers), "missing": missing},
              notes=req.notes)
    return app


class SubmitResult(BaseModel):
    method: str
    status: str
    application_url: str | None = None
    submission_reference: str | None = None
    message: str = ""
    missing_required: list[str] = Field(default_factory=list)


async def submit_application(db: AsyncSession, app: Application, actor: str = "user") -> SubmitResult:
    job = await db.get(Job, app.job_id)
    candidate = await db.get(CandidateProfile, app.candidate_id)
    if job is None or candidate is None:
        raise ApplicationError("Application references missing data")
    if app.status not in ("READY",):
        raise ApplicationError(f"Application must be READY to submit (current: {app.status}). Approve it first.")
    provider = get_application_provider(job.source)
    url = job.application_url or job.source_url
    if provider is None or not provider.is_authorized(job.external_id):
        # Assisted application: never automate unsupported sites. The user submits on the employer's page.
        add_event(db, app, actor, "assisted_submission_opened", app.status, app.status, {"application_url": url})
        APPLICATIONS_SUBMITTED.labels("assisted_opened").inc()
        return SubmitResult(method="assisted", status=app.status, application_url=url,
                            message="Open the employer's application page, submit with your approved resume and cover "
                                    "letter, then mark the application as Applied.")
    version = await db.get(ResumeVersion, app.resume_version_id) if app.resume_version_id else None
    if version is None or version.status != "APPROVED" or not version.file_path:
        raise ApplicationError("An approved resume version is required for submission.")
    c = profile_data(candidate).contact
    if not c.email or not c.name:
        raise ApplicationError("Name and email are required in your verified profile.")
    first, _, last = c.name.partition(" ")
    answers = {a["field_name"]: a["answer"] for a in app.answers_json or [] if a.get("field_name") and a.get("answer")}
    package = ApplicationPackage(first_name=first, last_name=last, email=c.email, phone=c.phone,
                                 resume_filename=f"{c.name.replace(' ', '_')}_Resume.docx",
                                 resume_bytes=storage.read_bytes(version.file_path), cover_letter=app.cover_letter,
                                 answers=answers, urls={k: v for k, v in {"LinkedIn": c.linkedin, "GitHub": c.github}.items() if v})
    validation = await provider.validate_application(job.external_id, package)
    if not validation.ok:
        prev = app.status
        app.status = "APPROVAL_REQUIRED"
        add_event(db, app, actor, "submission_validation_failed", prev, app.status,
                  {"missing_required": validation.missing_required, "errors": validation.errors})
        return SubmitResult(method="authorized_api", status=app.status, missing_required=validation.missing_required,
                            message="; ".join(validation.errors) or "Required answers are missing.")
    result = await provider.submit_application(job.external_id, package)
    prev = app.status
    if result.ok:
        app.status = "APPLIED"
        app.applied_at = utcnow()
        app.submission_reference = result.reference
        APPLICATIONS_SUBMITTED.labels("authorized_api").inc()
    add_event(db, app, actor, "submitted" if result.ok else "submission_failed", prev, app.status,
              {"provider": provider.name, "status_code": result.status_code, "reference": result.reference,
               "message": result.message[:300]})
    return SubmitResult(method="authorized_api", status=app.status, submission_reference=result.reference,
                        message="Submitted via authorized provider API." if result.ok else f"Submission failed: {result.message[:200]}")


class ApplicationOutput(BaseModel):
    application_id: str
    status: str
    submitted: bool = False


class ApplicationAgent(BaseAgent):
    name = "application_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> ApplicationOutput:
        candidate = await db.get(CandidateProfile, payload["candidate_id"])
        job = await db.get(Job, payload["job_id"])
        if candidate is None or job is None:
            raise ValueError("Candidate or job not found")
        auto = bool(payload.get("auto"))
        app = await prepare_application(db, candidate, job, auto=auto, ctx=ctx)
        await db.commit()
        submitted = False
        if auto and app.status == "READY":
            prefs = await get_prefs(db, candidate.user_id)
            match = (await db.execute(select(JobMatch).where(JobMatch.job_id == job.id,
                                                             JobMatch.candidate_id == candidate.id))).scalars().first()
            if (prefs.auto_apply and prefs.application_mode == "AUTHORIZED_AUTO_APPLY" and match
                    and match.overall_score >= prefs.auto_apply_minimum_score):
                res = await submit_application(db, app, actor="agent:auto_apply")
                submitted = res.status == "APPLIED"
                await db.commit()
        return ApplicationOutput(application_id=app.id, status=app.status, submitted=submitted)
