from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

WorkMode = Literal["remote", "hybrid", "onsite"]
EmploymentType = Literal["full_time", "part_time", "contract", "internship", "temporary"]
ApplicationMode = Literal["DISCOVERY_ONLY", "ASSISTED_APPLICATION", "AUTHORIZED_AUTO_APPLY"]


class Preferences(BaseModel):
    target_titles: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    work_modes: list[WorkMode] = Field(default_factory=lambda: list[WorkMode](["remote", "hybrid", "onsite"]))
    minimum_salary: float | None = None
    currency: str = "INR"
    experience_level: Literal["intern", "entry", "mid", "senior", "lead"] | None = None
    employment_types: list[EmploymentType] = Field(default_factory=lambda: list[EmploymentType](["full_time"]))
    visa_sponsorship_required: bool | None = None  # None = not answered; never inferred
    work_authorization_countries: list[str] = Field(default_factory=list)  # explicitly user-provided only
    search_keywords: list[str] = Field(default_factory=list)
    excluded_companies: list[str] = Field(default_factory=list)

    # Automation
    search_frequency: Literal["off", "hourly", "every_6_hours", "daily"] = "daily"
    minimum_match_score: float = 70
    application_mode: ApplicationMode = "DISCOVERY_ONLY"
    auto_apply: bool = False  # must be explicitly enabled; also requires AUTHORIZED_AUTO_APPLY mode
    auto_apply_minimum_score: float = 85
    daily_application_limit: int = 5
    require_user_approval_for: list[str] = Field(
        default_factory=lambda: ["SALARY", "VISA", "WORK_AUTHORIZATION", "DEMOGRAPHIC", "CUSTOM"]
    )
    notify_email: bool = False
    notify_in_app: bool = True

    @field_validator("minimum_match_score", "auto_apply_minimum_score")
    @classmethod
    def _score_range(cls, v: float) -> float:
        if not 0 <= v <= 100:
            raise ValueError("score must be between 0 and 100")
        return v

    @field_validator("daily_application_limit")
    @classmethod
    def _limit(cls, v: int) -> int:
        if not 0 <= v <= 50:
            raise ValueError("daily_application_limit must be between 0 and 50")
        return v
