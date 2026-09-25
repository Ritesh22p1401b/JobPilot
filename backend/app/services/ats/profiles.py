"""ATS assessment profiles.

These are *compatibility profiles* capturing documented parser sensitivities (e.g. Greenhouse and
Workday both document problems with tables, columns, headers/footers, text boxes and images).
The weights below are JobPilot's own choices, NOT the vendors' proprietary weights.
"""

from __future__ import annotations

from dataclasses import dataclass, field

DEFAULT_WEIGHTS = {
    "parser_compatibility": 0.20,
    "requirement_coverage": 0.20,
    "evidence_strength": 0.15,
    "keyword_alignment": 0.15,
    "experience_relevance": 0.10,
    "formatting_compatibility": 0.10,
    "round_trip_fidelity": 0.10,
}

# Penalty points per formatting risk (subtracted from 100).
DEFAULT_FORMATTING = {
    "IMAGE_BASED": 60, "TEXT_BOXES": 20, "MULTI_COLUMN": 15, "HEADER_CONTACT": 15, "TABLES": 10, "IMAGES": 10,
    "NONSTANDARD_HEADINGS": 15, "SMALL_FONT": 10, "UNUSUAL_SYMBOLS": 5, "GRAPHICS": 5, "HEADER_FOOTER_TEXT": 2,
    "LOW_DENSITY": 3, "HIGH_DENSITY": 3,
}


@dataclass(frozen=True)
class ATSProfile:
    name: str
    description: str
    parser_rules: dict = field(default_factory=dict)
    formatting_rules: dict = field(default_factory=lambda: dict(DEFAULT_FORMATTING))
    matching_rules: dict = field(default_factory=lambda: {
        "exact_skill_weight": 1.0, "semantic_skill_weight": 0.7, "title_weight": 0.8, "experience_weight": 0.8})
    scoring_weights: dict = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))


PROFILES: dict[str, ATSProfile] = {
    "generic": ATSProfile("generic", "Balanced checks based on common parser failure modes."),
    "greenhouse_style": ATSProfile(
        "greenhouse_style",
        "Stricter on graphics, photos, tables, columns, headers/footers and text boxes (documented parsing risks).",
        formatting_rules={**DEFAULT_FORMATTING, "TABLES": 15, "MULTI_COLUMN": 20, "HEADER_CONTACT": 20, "IMAGES": 15},
        matching_rules={"exact_skill_weight": 1.0, "semantic_skill_weight": 0.8, "title_weight": 0.8, "experience_weight": 0.8},
    ),
    "workday_style": ATSProfile(
        "workday_style",
        "Emphasises clean text extraction and word order; image-based styles are high risk.",
        formatting_rules={**DEFAULT_FORMATTING, "IMAGE_BASED": 80, "IMAGES": 15, "GRAPHICS": 10, "MULTI_COLUMN": 20},
        scoring_weights={**DEFAULT_WEIGHTS, "parser_compatibility": 0.25, "round_trip_fidelity": 0.15,
                         "keyword_alignment": 0.10, "experience_relevance": 0.05},
    ),
    "lever_style": ATSProfile(
        "lever_style",
        "Balanced parsing checks with more weight on requirement coverage and evidence.",
        scoring_weights={**DEFAULT_WEIGHTS, "requirement_coverage": 0.25, "evidence_strength": 0.20,
                         "keyword_alignment": 0.10, "formatting_compatibility": 0.05},
    ),
}


def get_profile(name: str | None, custom: dict | None = None) -> ATSProfile:
    if name == "custom" and custom:
        base = PROFILES["generic"]
        return ATSProfile(
            "custom", "User-defined weights.",
            formatting_rules={**base.formatting_rules, **custom.get("formatting_rules", {})},
            matching_rules={**base.matching_rules, **custom.get("matching_rules", {})},
            scoring_weights={**base.scoring_weights, **custom.get("scoring_weights", {})},
        )
    return PROFILES.get(name or "generic", PROFILES["generic"])
