# API

Base path: `/api/v1`. Interactive docs (OpenAPI) are at `http://127.0.0.1:8000/docs`.

All endpoints except `/auth/register`, `/auth/login` and `/health*` require `Authorization: Bearer <token>`.
Endpoints that need a candidate profile return **409** until a resume has been uploaded. Long-running work returns
**202** with a `task`; poll `GET /tasks/{id}`, which includes its follow-up `children`.

Errors look like `{"detail": "message"}`, or a list of field errors for validation failures (422). Rate limits per
client IP: auth 20/min, uploads 20/min, agent-triggering endpoints 30/min (429 when exceeded).

## Auth

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/auth/register` | `{email, password (8–128)}` | `{access_token, token_type, user}` |
| POST | `/auth/login` | `{email, password}` | same |
| GET | `/auth/me` | | `{id, email, has_profile, candidate_id}` |

## Resume and Resume Lab

| Method | Path | Notes |
|---|---|---|
| POST | `/resume/upload` | multipart `file` (PDF/DOCX/TXT, max 5 MB). Creates a new MASTER version. |
| GET | `/resume` | Master version, file info + layout flags, parsed profile, warnings, text preview |
| POST | `/resume/reparse` | Re-parse the current file |
| GET | `/resume/templates` | Resume templates and ATS profiles |
| GET | `/resume/versions?job_id=` | All versions (newest first) |
| GET | `/resume/{id}` | Version content, changes, claims (with `verified`), text preview |
| GET | `/resume/{id}/versions` | Lineage (parents) and children |
| GET | `/resume/{id}/download?format=docx\|pdf\|txt\|json\|original` | File download |
| POST | `/resume/analyze`, `/resume/test` | `{resume_version_id?, job_id?, ats_profile}`: full ATS report (Quality Index, tests, requirement matrix, keywords, issues, recommendations, disclaimer) |
| POST | `/resume/tailor` | `{job_id, template?, label?, use_llm}` → 202 task |
| POST | `/resume/compare` | `{version_ids (2–4), job_id?}`: side-by-side measurable metrics + diffs |
| GET | `/resume/{id}/score` | Stored scores + last report |
| GET | `/resume/{id}/test-results` | Latest test results |
| GET | `/resume/{id}/diff?against=` | Diff vs parent (or `against`) + regression summary |
| POST | `/resume/{id}/approve` | `{notes?}`. 409 if any claim is unverified. |
| POST | `/resume/{id}/reject` | `{notes?}` |

## Profile and preferences

| Method | Path | Notes |
|---|---|---|
| GET | `/profile` | Structured profile + parse warnings |
| PATCH | `/profile` | Partial update (contact, summary, skills, experience, education, projects, certifications, target_roles, languages). Creates a new MASTER version, returns a regression summary, and re-scores jobs. |
| GET / PUT | `/preferences` | Search, work-authorization and automation settings. `auto_apply` is forced off unless `application_mode = AUTHORIZED_AUTO_APPLY`. |

## Jobs and matches

| Method | Path | Notes |
|---|---|---|
| GET | `/jobs` | Query: `q, location, company, skill, employment_type, seniority, posted_within_days, min_salary, source, min_score, remote, saved, include_filtered, include_dismissed, sort=score\|recent\|salary, page, page_size (≤100)`. Each job includes its top `skills`. |
| GET | `/jobs/{id}` | Job + description + match + JD analysis + requirement matrix + LinkedIn/Indeed search links |
| POST | `/jobs/search` | `{queries?, locations?}` → 202 task + destination links |
| POST | `/jobs/import` | `{title, company, url, description, location?}`: a job you found yourself (nothing is fetched) |
| POST | `/jobs/{id}/save?saved=` | Also creates a SAVED application |
| POST | `/jobs/{id}/dismiss?dismissed=` | |
| GET | `/matches?min_score=&limit=` | Passing matches, best first |
| GET | `/matches/{id}` | |
| POST | `/matches/{id}/explain` | LLM explanation on demand (503 if the LLM is unavailable) |

## Applications

| Method | Path | Notes |
|---|---|---|
| GET | `/applications` | All applications (each with its job and match) + the status list |
| GET | `/applications/{id}` | Including the event log (audit trail) |
| POST | `/applications/{job_id}/save` | |
| POST | `/applications/{job_id}/prepare` | 202 task: tailored resume, cover letter, draft answers |
| POST | `/applications/{job_id}/approve` | `{answers: {question: answer\|null}, approve_resume, cover_letter?, notes?}` |
| POST | `/applications/{job_id}/submit` | Requires READY status. Authorized API if the employer issued a key; otherwise returns the employer URL (assisted). |
| PATCH | `/applications/{id}` | `{status?, notes?}`. Manual statuses: SAVED, READY, APPLIED, ASSESSMENT, INTERVIEW, OFFER, REJECTED, WITHDRAWN. |

## Agents and tasks

| Method | Path | Notes |
|---|---|---|
| POST | `/agents/discover` | 202 task |
| POST | `/agents/match` | 202 task (re-score all jobs) |
| POST | `/agents/application` | `{job_id}` → 202 task |
| GET | `/tasks?active_only=` | Your recent tasks |
| GET | `/tasks/{id}` | Task + children |
| GET | `/agents/runs?limit=` | Agent run log (≤200) |

## System

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/health/ready` | Database, Qdrant, LLM and embedding status |
| GET | `/dashboard` | Counts, master resume, automation settings |
| GET | `/notifications?unread_only=` | + unread count |
| POST | `/notifications/read-all`, `/notifications/{id}/read` | |
| GET | `/sources` | Job sources (every one reports `scraped: false`) |
| PUT | `/sources/{name}` | `{enabled?, boards? (greenhouse), sites? (lever), country? (adzuna)}` |
| GET / PUT | `/system/llm` | Runtime LLM endpoint `{base_url, model, api_key?}`. The key is write-only. PUT is disabled in production. |
| POST | `/system/llm/test` | Round-trips a JSON prompt |
| GET | `/metrics` | Prometheus metrics (served at the root, not under `/api/v1`) |

## Insights

| Method | Path | Notes |
|---|---|---|
| GET | `/insights` | Aggregates of your own data: `kpis`, the daily `brief` (actionable items with links), application `funnel` with response/interview rates (null until you apply), `resume_performance` per version, `skill_gaps` and `market_skills` (with the number of postings they're based on), `companies`, and `follow_ups` (applied, no activity for 7+ days). Nothing is estimated or generated. |

## Privacy

| Method | Path | Notes |
|---|---|---|
| GET | `/privacy/export` | Everything stored about you, as JSON |
| DELETE | `/privacy/resumes` · `/privacy/applications` · `/privacy/profile` · `/privacy/account` | Permanent |
