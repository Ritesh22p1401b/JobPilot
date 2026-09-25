"""Resume Quality Index — a product metric, explicitly NOT a probability of ATS acceptance or hiring."""

from __future__ import annotations

from app.services.ats.profiles import ATSProfile


def quality_index(components: dict[str, float | None], ats: ATSProfile) -> tuple[float, dict[str, float]]:
    """Weighted mean of available components; weights of unavailable components are redistributed."""
    weights = {k: w for k, w in ats.scoring_weights.items() if components.get(k) is not None}
    total_w = sum(weights.values())
    if not total_w:
        return 0.0, {}
    effective = {k: round(w / total_w, 4) for k, w in weights.items()}
    score = sum(components[k] * w for k, w in effective.items())  # type: ignore[operator]
    return round(score, 1), effective


def assessment_label(score: float, critical_failures: list[str]) -> str:
    if critical_failures:
        return "NEEDS_REVIEW"
    if score >= 85:
        return "STRONG"
    if score >= 70:
        return "GOOD"
    if score >= 55:
        return "FAIR"
    return "WEAK"
