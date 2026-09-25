"""ORM models. Importing this package registers every table on Base.metadata."""

from app.models.application import Application, ApplicationEvent
from app.models.candidate import CandidatePreferences, CandidateProfile, CandidateSkill
from app.models.job import JdRequirement, Job, JobMatch, JobSkill, JobSource, RequirementMatch
from app.models.resume import ResumeClaim, ResumeFile, ResumeTest, ResumeVersion
from app.models.system import AgentRun, AuditLog, EventTask, Notification, SystemSetting
from app.models.user import User

__all__ = [
    "AgentRun",
    "Application",
    "ApplicationEvent",
    "AuditLog",
    "CandidatePreferences",
    "CandidateProfile",
    "CandidateSkill",
    "EventTask",
    "JdRequirement",
    "Job",
    "JobMatch",
    "JobSkill",
    "JobSource",
    "Notification",
    "RequirementMatch",
    "ResumeClaim",
    "ResumeFile",
    "ResumeTest",
    "ResumeVersion",
    "SystemSetting",
    "User",
]
