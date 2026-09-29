# JobPilot AI

An AI job-search assistant that reads your resume, finds relevant jobs from public job-board APIs, scores each one
against your resume **with traceable evidence**, tailors resumes truthfully, and prepares applications for your review.

- **No scraping.** Jobs come from documented public APIs: Greenhouse and Lever job boards, plus Adzuna if you add
  keys. LinkedIn and Indeed are only offered as search links you open yourself, and you can paste any job you find
  there into JobPilot.
- **Explainable matching.** Every requirement in a job description is classified as required, preferred or
  nice-to-have, and mapped to the resume evidence that supports it, or marked as missing. Related skills are never
  counted as exact matches.
- **Truthful resumes.** Your master resume is never modified. Tailored versions only reorder and rephrase what your
  resume already proves, every claim is verified, and you see a before/after diff.
- **Resume Lab.** ATS parser-compatibility tests run on the generated DOCX/PDF itself: round-trip parsing,
  formatting risks, keyword and requirement coverage, and hallucination checks. No score claims to guarantee an
  interview.
- **You stay in control.** Auto-apply is off by default. Applications are prepared for review, and automatic
  submission is possible only through employer-authorized APIs. Every action is logged.

| Layer | Stack |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind CSS 4, React Query, Zod · dark-first design system, light theme, command palette (Ctrl+K) |
| Backend | FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2 |
| Data | PostgreSQL (durable event queue included, so no Redis needed), Qdrant (vectors) |
| AI | Qwen3-8B via any OpenAI-compatible endpoint (e.g. Ollama on Colab); `BAAI/bge-small-en-v1.5` embeddings run locally |

See [docs/architecture.md](docs/architecture.md) for how it fits together.

---

## Running on Windows (no Docker)

### Prerequisites

| Tool | Notes |
|---|---|
| Python 3.11+ | `python --version` |
| Node.js 20+ | `node --version` |
| PostgreSQL 14+ | Installed as a Windows service. The default connection is `postgres:postgres@127.0.0.1:5432`. |
| Qdrant for Windows | Unzip `qdrant.exe` anywhere. By default the scripts look in `..\qdrant-x86_64-pc-windows-msvc\` next to this repo. Optional: without Qdrant, similarity is computed in-process. |

### 1. One-time setup

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

This creates `backend\.venv`, installs dependencies, and creates `backend\.env` from `.env.example` with a random
`JWT_SECRET`.
It also creates the `jobpilot` database if `psql` is found, runs the Alembic migrations, and installs the frontend
packages.

If your Postgres password isn't `postgres`, edit `DATABASE_URL` in `backend\.env` and re-run the script.

### 2. Start everything

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1          # add -Dev for hot reload
```

It opens three windows:

| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| API + OpenAPI docs | http://127.0.0.1:8000/docs |
| Qdrant dashboard | http://127.0.0.1:6333/dashboard |

The background worker runs inside the API process (`EMBEDDED_WORKER=true`). To run it separately, set
`EMBEDDED_WORKER=false` and start `backend\.venv\Scripts\python -m app.workers.worker`.

<details>
<summary>Manual start (what the script does)</summary>

```powershell
# Qdrant
..\qdrant-x86_64-pc-windows-msvc\qdrant.exe

# API (from backend\)
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Web UI (from frontend\)
npm run build; npm run start        # or: npm run dev
```
</details>

### 3. Connect the LLM (Qwen3-8B on Google Colab)

1. Open [colab/qwen3_colab_server.ipynb](colab/qwen3_colab_server.ipynb) in Colab and choose
   *Runtime → Change runtime type → T4 GPU*.
2. Run all cells. The last setup cell prints an **LLM base URL** (`https://….trycloudflare.com/v1`) and an
   **LLM API key**.
3. Paste both into `backend\.env`:

   ```ini
   LLM_BASE_URL=https://….trycloudflare.com/v1
   LLM_API_KEY=<the key the notebook printed>
   LLM_MODEL=qwen3:8b
   ```

   The API re-reads these three values when the file changes, so there's no restart. Check **Settings → AI model**:
   it says "Using backend/.env" and should show **Connected**; click **Test connection** to round-trip a prompt.

The URL and key change every time the Colab runtime restarts; paste the new ones each time. Alternatively, paste them
on the Settings page. A URL saved there overrides `backend\.env` until you click **Use backend/.env instead**.

**The LLM is optional.** Parsing, matching, scoring, ATS tests and tailoring are all deterministic. Without an LLM you
get rule-based match explanations, cover letters and answers, and bullets are kept as written rather than rephrased.

### 4. Use it

1. Create an account, then upload your resume (PDF, DOCX or TXT) on **Resume**.
2. Set target titles and locations on **Preferences**.
3. Click **Find jobs now** on the Dashboard. Discovery, deduplication and scoring run in the background.
4. Open a job to see the requirement matrix, run an **ATS resume analysis**, create a **tailored resume**, or
   **prepare an application**.

---

## Deploying to a cloud VM (Docker)

Development stays Docker-free on Windows. For production, the repo ships Docker Compose files that run the frontend,
API, worker, PostgreSQL, Qdrant and nginx (HTTPS) on a Linux VM:

```bash
cp .env.example .env    # set POSTGRES_PASSWORD, JWT_SECRET, DOMAIN, PUBLIC_URL, LLM_*
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

See [docs/deployment.md](docs/deployment.md) for VM sizing, HTTPS, updates, backups and troubleshooting.

---

## Configuration

All settings are environment variables, read from `backend\.env` (a repo-root `.env` is also read; `backend\.env` wins
where both set a value, and real environment variables win over both). See [.env.example](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/jobpilot` | PostgreSQL connection |
| `JWT_SECRET` | generated by `setup.ps1` | Signs login tokens. Required when `APP_ENV=production`; development falls back to an insecure default. |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | empty, empty, `qwen3:8b` | OpenAI-compatible LLM (the Colab tunnel). Re-read from the file when it changes, without a restart. A URL saved in Settings overrides them (development only). |
| `LLM_PROVIDER` | `qwen` | Which model answers: `qwen` (the `LLM_*` endpoint) or `gemini`. Also switchable in Settings → AI model; re-read from the file without a restart. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_REASONING_EFFORT` | empty, `gemini-3.8-flash`, `low` | Google Gemini through its OpenAI-compatible endpoint. The key stays on the server. |
| `LLM_PROVIDER` | `qwen` | Which model answers: `qwen` (the `LLM_*` endpoint) or `gemini`. Also switchable in Settings → AI model; re-read from the file without a restart. |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_REASONING_EFFORT` | empty, `gemini-3.8-flash`, `low` | Google Gemini through its OpenAI-compatible endpoint. The key stays on the server. |
| `EMBEDDING_BACKEND` | `fastembed` | `fastembed` (local ONNX model, downloaded once) or `hash` (tests) |
| `QDRANT_URL` | `http://127.0.0.1:6333` | Use `127.0.0.1`, not `localhost`: on Windows, `localhost` tries IPv6 first and adds about 270 ms per call. |
| `GREENHOUSE_BOARDS`, `LEVER_SITES` | a curated list | Company slugs to query. Also editable in Settings → Job sources. |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | empty | Free keys from developer.adzuna.com enable Adzuna search. |
| `GREENHOUSE_BOARD_API_KEYS`, `LEVER_POSTING_API_KEYS` | `{}` | **Employer-issued** keys only. They enable authorized API submission for that employer. |
| `EMBEDDED_WORKER` | `true` | Run the background worker inside the API process |
| `SMTP_*` | empty | Optional email notifications |

The frontend has one setting: `BACKEND_URL` in `frontend/.env.local` (default `http://127.0.0.1:8000`). The browser
talks only to Next.js, which proxies `/api/v1/*` to the backend, so no backend URL or key reaches the client.

---

## Testing

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check.ps1              # ruff, mypy, pytest, tsc, eslint, next build
powershell -ExecutionPolicy Bypass -File scripts\check.ps1 -Postgres    # also run backend tests on PostgreSQL
powershell -ExecutionPolicy Bypass -File scripts\check.ps1 -Contract    # also run the live UI contract check
```

- **Backend:** 114 pytest cases on SQLite by default. For PostgreSQL, set `TEST_DATABASE_URL`; the `-Postgres` flag
  uses the `jobpilot_test` database. They cover parsing (including golden PDF layouts), JD analysis, evidence and
  matching, dedup, the ATS test suite, DOCX/PDF round-trips, truthfulness (no invented skills, metrics or claims), LLM
  output handling, providers (mocked HTTP), the event bus and an end-to-end pipeline.
- **Frontend contract check:** `node --no-warnings scripts/contract-check.mts` in `frontend/` drives the real API through the Next.js proxy. It
  covers register, upload, search, import, analyze, tailor, compare, prepare, approve, submit and profile edit, and
  validates every response with the same Zod schemas the UI uses. It runs a real job search, so it takes a few
  minutes.

---

## Project layout

```text
backend/
  app/
    agents/            one agent per event (resume, discovery, normalization, matching, job analyst,
                       resume optimizer/test/evaluator, application); every run is recorded in agent_runs
    api/               FastAPI routers (/api/v1/...)
    application_providers/   authorized submission (Greenhouse/Lever, employer keys only)
    events/ workers/   PostgreSQL-backed event bus + worker/scheduler
    providers/         job sources (Greenhouse, Lever, Adzuna) behind one interface
    services/          deterministic core: parsers, skill ontology, evidence, matcher, ATS tests,
                       resume generation, claim verification, LLM client + versioned prompts
  alembic/             migrations
  tests/
frontend/src/
  app/                 / (landing) /login /signup /onboarding, and the workspace:
                       /dashboard /matches /jobs /jobs/[id] /jobs/[id]/resume-analysis /saved /companies
                       /applications (+ [id], agent, interviews, follow-ups) /resume /ats /resume-lab
                       (+ new, [id], [id]/test, [id]/compare, compare) /cover-letters /analytics /skills
                       /market /profile /preferences /settings
  components/          ui/ (design system), layout/ (shell, sidebar, command palette), jobs/, ats/,
                       applications/, resume/, ai/, auth/
  lib/                 API client, Zod schemas, hooks, friendly errors, theme
colab/                 Qwen3-8B server notebook
scripts/               setup / start / check (PowerShell)
docker/ nginx/         production images and reverse proxy; compose*.yaml at the repo root
docs/                  architecture, agents, API, security
```

## Known limitations

- **Job coverage depends on the configured boards.** Greenhouse and Lever expose only the companies you list; add
  company slugs in Settings. Adzuna broadens coverage once you add free API keys.
- **First match after a new resume is slow.** Scoring a few hundred jobs takes about 1–2 minutes on CPU. It runs in
  the background, and later runs only rescore jobs whose inputs changed.
- **The LLM endpoint setting is global.** In Settings it applies to every account on the instance, and it is disabled
  when `APP_ENV=production` (use environment variables there). JobPilot is designed as a single-user local app.
- **The rate limiter is in-memory,** so it is per process. Put a shared limiter in front if you run several API
  processes.
