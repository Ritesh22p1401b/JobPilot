"""Versioned prompt registry. Never change a prompt in place — bump its version."""

from __future__ import annotations

from dataclasses import dataclass

RULES = """Rules you must follow:
- Use only the facts provided in the input. Do not invent candidate information.
- Do not invent job requirements, company facts, metrics, dates, employers, skills or achievements.
- Distinguish required from preferred qualifications exactly as given.
- If information is unavailable, return null or "unknown".
- Return a single valid JSON object that matches the requested schema, with no extra text."""


@dataclass(frozen=True)
class PromptSpec:
    name: str
    version: int
    system: str
    user: str
    temperature: float = 0.1
    max_tokens: int = 1200
    created_at: str = "2026-09-25"

    @property
    def id(self) -> str:
        return f"{self.name}:v{self.version}"

    def render(self, **variables: str) -> list[dict[str, str]]:
        return [{"role": "system", "content": self.system}, {"role": "user", "content": self.user.format(**variables)}]


JD_REQUIREMENT_EXTRACTOR = PromptSpec(
    name="jd_requirement_extractor",
    version=1,
    system="You extract explicit requirements from job descriptions.\n" + RULES,
    user="""Job title: {title}

Job description:
<<<
{description}
>>>

Extract requirements that are explicitly written in the description. For each, copy the exact sentence
or phrase it came from into "source_span" (verbatim, max 200 chars).
Categories: REQUIRED_SKILL, PREFERRED_SKILL, NICE_TO_HAVE, REQUIRED_EXPERIENCE, PREFERRED_EXPERIENCE,
EDUCATION, CERTIFICATION, LANGUAGE, WORK_AUTHORIZATION, OTHER.
Only use REQUIRED_* when the text marks it as required/must/minimum or lists it under requirements.
Use short canonical names for skills (e.g. "Kubernetes", "PostgreSQL").

Schema: {{"requirements": [{{"requirement": str, "category": str, "source_span": str}}]}}""",
    max_tokens=1500,
)

JOB_MATCH_EXPLAINER = PromptSpec(
    name="job_match_explainer",
    version=1,
    system="You explain an already-computed job match to a candidate. You never change scores or statuses.\n" + RULES,
    user="""Job: {title} at {company}
Computed match (authoritative, do not alter): {match_json}
Requirement evidence matrix (authoritative): {matrix_json}

Write a concise explanation for the candidate grounded only in the data above.
Schema: {{"match_summary": str, "recommendation_reason": str, "experience_alignment": str,
"application_strategy": [str]}}
- match_summary: 1-2 sentences.
- application_strategy: up to 4 concrete, truthful suggestions (e.g. which verified project to emphasise).
  Never suggest claiming a skill the matrix marks MISSING or RELATED.""",
    max_tokens=700,
)

RESUME_BULLET_REWRITER = PromptSpec(
    name="resume_bullet_rewriter",
    version=1,
    system="You rewrite resume bullet points to be clearer and more relevant, without adding facts.\n" + RULES,
    user="""Target role: {title}
Relevant terms from the job (use a term ONLY if the original bullet already supports it): {terms}

Original bullets (index: text):
{bullets}

Rewrite each bullet so it starts with a strong action verb and surfaces the relevant technology already
present in it. Keep every number exactly as written; add no numbers, tools, employers or outcomes that are
not in the original bullet. If a bullet cannot be improved truthfully, return it unchanged.
Schema: {{"rewrites": [{{"index": int, "text": str}}]}}""",
    temperature=0.2,
)

RESUME_SUMMARY_WRITER = PromptSpec(
    name="resume_summary_writer",
    version=1,
    system="You write a short professional resume summary from verified facts only.\n" + RULES,
    user="""Target role: {title}
Verified facts (JSON): {facts_json}

Write a 2-3 sentence summary (max 60 words) using only these facts. No metrics unless present in the facts.
Do not claim years of experience beyond "years_experience". Write in resume style without first-person pronouns.
Schema: {{"summary": str}}""",
    temperature=0.2,
    max_tokens=300,
)

COVER_LETTER_WRITER = PromptSpec(
    name="cover_letter_writer",
    version=1,
    system="You write concise, specific cover letters from verified facts only.\n" + RULES,
    user="""Job: {title} at {company}
Job requirements the candidate verifiably meets (with evidence): {matched_json}
Candidate facts (verified): {facts_json}
Company facts available: {company_facts}

Write a cover letter of 3-4 short paragraphs (max 280 words total). Address it to "Hiring Team".
Do not state any company fact that is not in "Company facts available". Do not invent metrics,
achievements or a hiring manager's name. Do not claim skills outside the verified facts.
Schema: {{"paragraphs": [str]}}""",
    temperature=0.3,
    max_tokens=900,
)

APPLICATION_ANSWER_DRAFTER = PromptSpec(
    name="application_answer_drafter",
    version=1,
    system="You draft answers to job application questions using only verified candidate facts.\n" + RULES,
    user="""Question: {question}
Job: {title} at {company}
Verified candidate facts: {facts_json}

If the facts do not contain what is needed to answer truthfully, return {{"answer": null, "used_facts": []}}.
Otherwise draft a concise answer (max 120 words).
Schema: {{"answer": str | null, "used_facts": [str]}}""",
    temperature=0.2,
    max_tokens=400,
)

ALL_PROMPTS = [JD_REQUIREMENT_EXTRACTOR, JOB_MATCH_EXPLAINER, RESUME_BULLET_REWRITER, RESUME_SUMMARY_WRITER,
               COVER_LETTER_WRITER, APPLICATION_ANSWER_DRAFTER]
