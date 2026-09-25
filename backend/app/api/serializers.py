"""ORM -> JSON helpers for API responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.models import Application, ApplicationEvent, EventTask, Job, JobMatch, Notification, ResumeVersion


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def job_out(job: Job, match: JobMatch | None = None, include_description: bool = False) -> dict:
    data: dict[str, Any] = {
        "id": job.id, "job_id": f"{job.source}:{job.external_id}", "source": job.source, "company": job.company,
        "title": job.title, "location": job.location, "remote": job.remote, "work_mode": job.work_mode,
        "employment_type": job.employment_type, "seniority": job.seniority, "salary_min": job.salary_min,
        "salary_max": job.salary_max, "currency": job.currency, "url": job.source_url,
        "application_url": job.application_url, "posted_at": iso(job.posted_at), "first_seen_at": iso(job.first_seen_at),
        "last_seen_at": iso(job.last_seen_at), "description_truncated": job.description_truncated,
        "alternate_sources": job.alternate_sources_json or [], "duplicate_of_id": job.duplicate_of_id,
        "salary_is_predicted": bool((job.raw_json or {}).get("salary_is_predicted")),
    }
    if include_description:
        data["description"] = job.description
    if match is not None:
        data["match"] = match_out(match)
    return data


def match_out(m: JobMatch) -> dict:
    return {
        "id": m.id, "job_id": m.job_id, "overall_score": m.overall_score, "skill_score": m.skill_score,
        "role_score": m.role_score, "experience_score": m.experience_score, "location_score": m.location_score,
        "education_score": m.education_score, "preference_score": m.preference_score,
        "seniority_score": m.seniority_score, "semantic_similarity": m.semantic_similarity,
        "hard_filter_passed": m.hard_filter_passed, "hard_filter_reasons": m.hard_filter_reasons_json or [],
        "matched_skills": m.matched_skills_json or [], "missing_skills": m.missing_skills_json or {},
        "breakdown": m.breakdown_json or {}, "explanation": m.explanation, "explanation_source": m.explanation_source,
        "resume_compatibility": m.resume_compatibility, "saved": m.saved, "dismissed": m.dismissed,
        "created_at": iso(m.created_at), "updated_at": iso(m.updated_at),
    }


def version_out(v: ResumeVersion) -> dict:
    return {
        "id": v.id, "version_number": v.version_number, "version_type": v.version_type, "label": v.label,
        "job_id": v.job_id, "parent_version_id": v.parent_version_id, "template": v.template, "status": v.status,
        "quality_index": v.quality_index, "parser_score": v.parser_score, "keyword_score": v.keyword_score,
        "requirement_score": v.requirement_score, "evidence_score": v.evidence_score,
        "round_trip_score": v.round_trip_score, "formatting_score": v.formatting_score, "created_at": iso(v.created_at),
        "approved_at": iso(v.approved_at), "has_docx": bool(v.file_path), "has_pdf": bool(v.pdf_path),
        "has_original": bool(v.resume_file_id), "last_job_id": (v.last_report_json or {}).get("job_id"),
    }


def application_out(a: Application, job: Job | None = None, events: list[ApplicationEvent] | None = None) -> dict:
    data = {
        "id": a.id, "job_id": a.job_id, "status": a.status, "mode": a.mode, "applied_at": iso(a.applied_at),
        "application_url": a.application_url, "resume_version_id": a.resume_version_id, "cover_letter": a.cover_letter,
        "cover_letter_source": a.cover_letter_source, "answers": a.answers_json or [], "package": a.package_json or {},
        "submission_reference": a.submission_reference, "notes": a.notes, "created_at": iso(a.created_at),
        "updated_at": iso(a.updated_at),
    }
    if job is not None:
        data["job"] = job_out(job)
    if events is not None:
        data["events"] = [{"id": e.id, "actor": e.actor, "action": e.action, "from_status": e.from_status,
                           "to_status": e.to_status, "details": e.details_json, "notes": e.notes,
                           "created_at": iso(e.created_at)} for e in events]
    return data


def task_out(t: EventTask) -> dict:
    return {"id": t.id, "event_type": t.event_type, "status": t.status, "attempts": t.attempts,
            "result": t.result_json, "error": t.last_error, "created_at": iso(t.created_at), "updated_at": iso(t.updated_at)}


def notification_out(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "data": n.data_json, "read": n.read,
            "created_at": iso(n.created_at)}
