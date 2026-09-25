"""Exceptions that should not be retried by the worker (bad input rather than transient failure)."""

from app.services.text_extraction import ExtractionError

NON_RETRYABLE: tuple[type[Exception], ...] = (ExtractionError, ValueError, KeyError, PermissionError)
