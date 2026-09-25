"""Before/after diff between resume versions, and regression comparison between two versions."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.resume import ResumeContent

ChangeType = Literal["ADDED", "REMOVED", "REWRITTEN", "REORDERED"]


class Change(BaseModel):
    type: ChangeType
    section: str
    source_id: str | None = None
    original: str | None = None
    new: str | None = None
    evidence_source: str | None = None
    verified: bool | None = None
    detail: str | None = None


class DiffResult(BaseModel):
    changes: list[Change] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    unsupported_additions: int = 0


def _bullets(content: ResumeContent) -> dict[tuple[str, int], tuple[str, str, int]]:
    out = {}
    for e in content.experience:
        for pos, b in enumerate(e.bullets):
            out[(e.source_id, b.source_index if b.source_index is not None else -pos - 1)] = ("experience", b.text, pos)
    for p in content.projects:
        for pos, b in enumerate(p.bullets):
            out[(p.source_id, b.source_index if b.source_index is not None else -pos - 1)] = ("projects", b.text, pos)
    return out


def diff_contents(before: ResumeContent, after: ResumeContent, verified_claims: dict[str, bool] | None = None) -> DiffResult:
    changes: list[Change] = []
    if (before.summary or "") != (after.summary or ""):
        kind: ChangeType = "ADDED" if not before.summary else "REMOVED" if not after.summary else "REWRITTEN"
        changes.append(Change(type=kind, section="summary", original=before.summary, new=after.summary,
                              evidence_source="verified profile facts",
                              verified=(verified_claims or {}).get(after.summary or "", None)))
    b_sk = [s for items in before.skills.values() for s in items]
    a_sk = [s for items in after.skills.values() for s in items]
    for s in a_sk:
        if s not in b_sk:
            changes.append(Change(type="ADDED", section="skills", new=s, verified=False, detail="Skill not in master resume"))
    for s in b_sk:
        if s not in a_sk:
            changes.append(Change(type="REMOVED", section="skills", original=s))
    if [s for s in b_sk if s in a_sk] != [s for s in a_sk if s in b_sk] or list(before.skills) != list(after.skills):
        changes.append(Change(type="REORDERED", section="skills", detail="Job-relevant skills moved higher: "
                              + ", ".join(a_sk[:6])))
    if before.section_order != after.section_order:
        changes.append(Change(type="REORDERED", section="sections", original=" > ".join(before.section_order),
                              new=" > ".join(after.section_order)))
    bb, ab = _bullets(before), _bullets(after)
    for key, (section, text, pos) in ab.items():
        if key not in bb:
            changes.append(Change(type="ADDED", section=section, source_id=key[0], new=text, verified=False,
                                  detail="Bullet has no source in the previous version"))
            continue
        _, old_text, old_pos = bb[key]
        if old_text != text:
            changes.append(Change(type="REWRITTEN", section=section, source_id=key[0], original=old_text, new=text,
                                  evidence_source=f"{key[0]} bullet #{key[1] + 1}",
                                  verified=(verified_claims or {}).get(text, None)))
        elif old_pos != pos:
            changes.append(Change(type="REORDERED", section=section, source_id=key[0], new=text,
                                  detail=f"Moved from position {old_pos + 1} to {pos + 1}"))
    for key, (section, text, _) in bb.items():
        if key not in ab:
            changes.append(Change(type="REMOVED", section=section, source_id=key[0], original=text))
    bp = [p.source_id for p in before.projects]
    ap = [p.source_id for p in after.projects]
    if [p for p in bp if p in ap] != [p for p in ap if p in bp]:
        names = {p.source_id: p.name for p in after.projects}
        changes.append(Change(type="REORDERED", section="projects", detail="Project order: " + " > ".join(names[p] for p in ap)))
    counts: dict[str, int] = {}
    for c in changes:
        counts[c.type] = counts.get(c.type, 0) + 1
    unsupported = sum(1 for c in changes if c.type == "ADDED" and c.verified is False)
    return DiffResult(changes=changes, counts=counts, unsupported_additions=unsupported)


def regression_summary(old_content: ResumeContent, new_content: ResumeContent, old_scores: dict, new_scores: dict) -> dict:
    old_sk = {s for items in old_content.skills.values() for s in items}
    new_sk = {s for items in new_content.skills.values() for s in items}
    d = diff_contents(old_content, new_content)
    score_deltas = {}
    warnings = []
    for k in ("quality_index", "parser_score", "round_trip_score", "keyword_score", "requirement_score",
              "evidence_score", "formatting_score"):
        o, n = old_scores.get(k), new_scores.get(k)
        if o is not None and n is not None:
            score_deltas[k] = {"old": o, "new": n, "delta": round(n - o, 1)}
            if k in ("parser_score", "round_trip_score") and n < o - 3:
                warnings.append(f"{k.replace('_', ' ')} dropped from {o} to {n}.")
    return {
        "skills_lost": sorted(old_sk - new_sk),
        "skills_added": sorted(new_sk - old_sk),
        "bullets_changed": d.counts.get("REWRITTEN", 0),
        "bullets_added": sum(1 for c in d.changes if c.type == "ADDED" and c.section in ("experience", "projects")),
        "bullets_removed": sum(1 for c in d.changes if c.type == "REMOVED" and c.section in ("experience", "projects")),
        "score_deltas": score_deltas,
        "warnings": warnings,
    }
