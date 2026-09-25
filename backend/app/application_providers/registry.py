from __future__ import annotations

from app.application_providers.base import ApplicationProvider
from app.application_providers.greenhouse import GreenhouseApplicationProvider
from app.application_providers.lever import LeverApplicationProvider

_overrides: dict[str, ApplicationProvider] = {}


def get_application_provider(source: str) -> ApplicationProvider | None:
    if source in _overrides:
        return _overrides[source]
    if source == "greenhouse":
        return GreenhouseApplicationProvider()
    if source == "lever":
        return LeverApplicationProvider()
    return None  # e.g. Adzuna, LinkedIn, Indeed: assisted application only


def set_application_provider(source: str, provider: ApplicationProvider | None) -> None:
    if provider is None:
        _overrides.pop(source, None)
    else:
        _overrides[source] = provider
