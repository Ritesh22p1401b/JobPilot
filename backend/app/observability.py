"""Prometheus metrics (exposed at /metrics)."""

from prometheus_client import Counter, Histogram

AGENT_RUNS = Counter("jobpilot_agent_runs_total", "Agent runs", ["agent", "status"])
AGENT_LATENCY = Histogram("jobpilot_agent_latency_seconds", "Agent latency", ["agent"])
JOBS_DISCOVERED = Counter("jobpilot_jobs_discovered_total", "Raw jobs discovered", ["provider"])
JOBS_DEDUPLICATED = Counter("jobpilot_jobs_deduplicated_total", "Duplicate jobs detected", ["kind"])
JOBS_MATCHED = Counter("jobpilot_jobs_matched_total", "Job matches computed")
PROVIDER_ERRORS = Counter("jobpilot_provider_errors_total", "Provider failures", ["provider"])
APPLICATIONS_PREPARED = Counter("jobpilot_applications_prepared_total", "Applications prepared")
APPLICATIONS_SUBMITTED = Counter("jobpilot_applications_submitted_total", "Applications submitted", ["method"])
HTTP_LATENCY = Histogram("jobpilot_http_request_seconds", "HTTP request latency", ["method", "route", "status"])
