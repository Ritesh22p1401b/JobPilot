# JobPilot backend image. One image, three roles (chosen by the Compose `command`):
#   API       uvicorn app.main:app              (default CMD)
#   worker    python -m app.workers.worker      (event queue on PostgreSQL + scheduler)
#   migrate   alembic upgrade head              (one-shot, runs before the API starts)
# Build context: ./backend
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Runtime dependencies only (requirements-dev.txt holds pytest/ruff/mypy and is never installed here).
COPY requirements.txt .
RUN pip install -r requirements.txt

RUN useradd --create-home --uid 10001 jobpilot \
    && mkdir -p /data/storage /data/models \
    && chown -R jobpilot:jobpilot /data

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

# User files (resumes, generated documents) and the embedding-model cache live on volumes, never in the image.
ENV STORAGE_DIR=/data/storage \
    FASTEMBED_CACHE_PATH=/data/models

USER jobpilot
EXPOSE 8000

# Only nginx talks to the API, so the forwarded client address it sends is trusted.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
