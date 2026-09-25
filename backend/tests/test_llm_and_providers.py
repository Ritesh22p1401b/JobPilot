from __future__ import annotations

import json

import httpx
import pytest
import respx
from pydantic import BaseModel

from app.application_providers.base import ApplicationPackage
from app.application_providers.greenhouse import GreenhouseApplicationProvider
from app.application_providers.lever import LeverApplicationProvider
from app.config import get_settings
from app.providers.adzuna import AdzunaProvider
from app.providers.base import location_matches, title_matches
from app.providers.greenhouse import GreenhouseProvider
from app.providers.http import ProviderError, ProviderHttp
from app.providers.lever import LeverProvider
from app.services import llm as llm_mod
from app.services.prompts import JD_REQUIREMENT_EXTRACTOR

# ------------------------------------------------------------------------------------------ LLM


def test_base_url_normalisation():
    assert llm_mod.normalize_base_url("https://abc.trycloudflare.com") == "https://abc.trycloudflare.com/v1"
    assert llm_mod.normalize_base_url("https://abc.ngrok-free.app/v1/") == "https://abc.ngrok-free.app/v1"
    assert llm_mod.normalize_base_url("abc.ngrok.app/v1/chat/completions") == "https://abc.ngrok.app/v1"


def test_extract_json_handles_qwen_thinking_and_fences():
    raw = '<think>Let me reason about the job...</think>\n```json\n{"a": [1, 2,], "b": "x}y"}\n```'
    assert llm_mod.extract_json(raw) == {"a": [1, 2], "b": "x}y"}
    with pytest.raises(llm_mod.LLMOutputError):
        llm_mod.extract_json("no json here")


class _Reqs(BaseModel):
    requirements: list[dict]


def _completion(content: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}


@respx.mock
async def test_llm_structured_with_repair_and_no_think(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_base_url", "https://colab.example.com")
    monkeypatch.setattr(llm_mod, "_load_override", _no_override)
    route = respx.post("https://colab.example.com/v1/chat/completions").mock(side_effect=[
        httpx.Response(200, json=_completion("<think>hmm</think> not json at all")),
        httpx.Response(200, json=_completion('{"requirements": [{"requirement": "Python", "category": "REQUIRED_SKILL"}]}')),
    ])
    client = llm_mod.LLMClient()
    out, meta = await client.structured(JD_REQUIREMENT_EXTRACTOR, _Reqs, title="x", description="y")
    assert out.requirements[0]["requirement"] == "Python"
    assert meta["repaired"] and meta["prompt_version"] == "jd_requirement_extractor:v1"
    first_body = json.loads(route.calls[0].request.content)
    assert first_body["messages"][-1]["content"].endswith("/no_think")
    assert route.calls[0].request.headers["ngrok-skip-browser-warning"] == "true"


@respx.mock
async def test_llm_retries_transient_and_drops_unsupported_json_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "llm_base_url", "https://colab.example.com/v1")
    monkeypatch.setattr(llm_mod, "_load_override", _no_override)
    monkeypatch.setattr(llm_mod.asyncio, "sleep", _fast_sleep)
    route = respx.post("https://colab.example.com/v1/chat/completions").mock(side_effect=[
        httpx.Response(502), httpx.Response(400, json={"error": "response_format not supported"}),
        httpx.Response(200, json=_completion('{"ok": true}')),
    ])
    content, _ = await llm_mod.LLMClient().chat([{"role": "user", "content": "hi"}])
    assert json.loads(content) == {"ok": True}
    assert "response_format" not in json.loads(route.calls[2].request.content)


async def test_llm_unconfigured(monkeypatch):
    monkeypatch.setattr(llm_mod, "_load_override", _no_override)
    client = llm_mod.LLMClient()
    assert not await client.is_enabled()
    with pytest.raises(llm_mod.LLMUnavailable):
        await client.chat([{"role": "user", "content": "x"}])


async def _no_override():
    return None


async def _fast_sleep(_s):
    return None


# ------------------------------------------------------------------------------------ providers


def test_title_and_location_filters():
    assert title_matches("AI Engineer", "Senior AI Engineer, Platform")
    assert title_matches("Backend Developer", "Backend Engineer")
    assert title_matches("ML Engineer", "Machine Learning Engineer")
    assert not title_matches("AI Engineer", "Account Executive")
    assert location_matches("Bangalore", "Bengaluru, Karnataka, India")
    assert location_matches("Pune", "Remote - India")
    assert not location_matches("Pune", "London")


@respx.mock
async def test_greenhouse_provider_filters_and_isolates_board_failures():
    respx.get("https://boards-api.greenhouse.io/v1/boards/acme").mock(return_value=httpx.Response(200, json={"name": "Acme"}))
    respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs").mock(return_value=httpx.Response(200, json={"jobs": [
        {"id": 1, "title": "AI Engineer", "location": {"name": "Bengaluru"}, "absolute_url": "https://gh/acme/1",
         "content": "&lt;p&gt;Python&lt;/p&gt;", "updated_at": "2026-09-01T10:00:00Z"},
        {"id": 2, "title": "Account Executive", "location": {"name": "Bengaluru"}, "absolute_url": "https://gh/acme/2"},
    ]}))
    respx.get("https://boards-api.greenhouse.io/v1/boards/broken").mock(return_value=httpx.Response(404))
    respx.get("https://boards-api.greenhouse.io/v1/boards/broken/jobs").mock(return_value=httpx.Response(404))
    p = GreenhouseProvider(["acme", "broken"], http=ProviderHttp("greenhouse", min_interval=0, max_retries=0))
    jobs = await p.search("AI Engineer")
    assert [j.external_id for j in jobs] == ["acme:1"]
    assert jobs[0].company == "Acme" and jobs[0].url == "https://gh/acme/1" and jobs[0].posted_at is not None
    assert p.errors and "broken" in p.errors[0]


@respx.mock
async def test_lever_provider():
    respx.get("https://api.lever.co/v0/postings/meesho").mock(return_value=httpx.Response(200, json=[
        {"id": "abc", "text": "Machine Learning Engineer", "categories": {"location": "Bangalore", "commitment": "Full-time"},
         "hostedUrl": "https://jobs.lever.co/meesho/abc", "applyUrl": "https://jobs.lever.co/meesho/abc/apply",
         "createdAt": 1756700000000, "descriptionPlain": "Build ML systems.", "workplaceType": "hybrid",
         "lists": [{"text": "Requirements", "content": "<li>Python</li><li>PyTorch</li>"}]},
    ]))
    p = LeverProvider(["meesho"], http=ProviderHttp("lever", min_interval=0, max_retries=0))
    jobs = await p.search("ML Engineer")
    assert len(jobs) == 1 and jobs[0].employment_type == "Full-time"
    assert "<li>PyTorch</li>" in jobs[0].description and jobs[0].application_url.endswith("/apply")


@respx.mock
async def test_adzuna_provider_does_not_present_predicted_salary_as_fact():
    route = respx.get("https://api.adzuna.com/v1/api/jobs/in/search/1").mock(return_value=httpx.Response(200, json={"results": [
        {"id": "42", "title": "AI Engineer", "company": {"display_name": "FinCo"}, "location": {"display_name": "Pune"},
         "description": "Python, RAG ...", "redirect_url": "https://adzuna/42", "created": "2026-09-20T00:00:00Z",
         "salary_min": 900000, "salary_max": 1400000, "salary_is_predicted": "1", "contract_time": "full_time"},
    ]}))
    p = AdzunaProvider("id", "key", "in", http=ProviderHttp("adzuna", min_interval=0, max_retries=0))
    jobs = await p.search("AI Engineer", "Pune")
    assert jobs[0].salary_min is None and jobs[0].raw["predicted_salary_min"] == 900000
    assert jobs[0].currency == "INR" and jobs[0].description_truncated
    params = dict(route.calls[0].request.url.params)
    assert params["what"] == "AI Engineer" and params["where"] == "Pune" and params["app_key"] == "key"
    with pytest.raises(ValueError):
        AdzunaProvider("", "", "in")


@respx.mock
async def test_http_retries_on_429_then_raises(monkeypatch):
    import app.providers.http as http_mod

    monkeypatch.setattr(http_mod.asyncio, "sleep", _fast_sleep)
    route = respx.get("https://api.example.com/x").mock(side_effect=[
        httpx.Response(429, headers={"Retry-After": "1"}), httpx.Response(200, json={"ok": 1})])
    h = ProviderHttp("t", min_interval=0, max_retries=2)
    assert await h.get_json("https://api.example.com/x") == {"ok": 1}
    assert route.call_count == 2
    respx.get("https://api.example.com/y").mock(return_value=httpx.Response(503))
    with pytest.raises(ProviderError):
        await h.get_json("https://api.example.com/y")


# -------------------------------------------------------------------- authorized submission


def _package(**kw) -> ApplicationPackage:
    base = dict(first_name="Ritesh", last_name="Pandey", email="r@example.com", phone="+91 1", resume_filename="r.docx",
                resume_bytes=b"PK..", cover_letter="Dear Hiring Team", answers={})
    base.update(kw)
    return ApplicationPackage(**base)


@respx.mock
async def test_greenhouse_submission_requires_authorization_and_required_answers():
    unauthorized = GreenhouseApplicationProvider(keys={})
    assert not unauthorized.is_authorized("acme:1")
    res = await unauthorized.submit_application("acme:1", _package())
    assert not res.ok

    gh = GreenhouseApplicationProvider(keys={"acme": "employer-key"})
    respx.get("https://boards-api.greenhouse.io/v1/boards/acme/jobs/1").mock(return_value=httpx.Response(200, json={
        "questions": [{"label": "First Name", "required": True, "fields": [{"name": "first_name"}]},
                      {"label": "Resume", "required": True, "fields": [{"name": "resume"}]},
                      {"label": "Why us?", "required": True, "fields": [{"name": "question_123"}]}]}))
    v = await gh.validate_application("acme:1", _package())
    assert not v.ok and v.missing_required == ["Why us?"]
    v2 = await gh.validate_application("acme:1", _package(answers={"question_123": "Because..."}))
    assert v2.ok
    post = respx.post("https://boards-api.greenhouse.io/v1/boards/acme/jobs/1").mock(
        return_value=httpx.Response(200, json={"id": 987}))
    res = await gh.submit_application("acme:1", _package(answers={"question_123": "Because..."}))
    assert res.ok and res.reference == "987"
    assert post.calls[0].request.headers["authorization"].startswith("Basic ")


@respx.mock
async def test_lever_submission():
    lv = LeverApplicationProvider(keys={"meesho": "k"})
    route = respx.post("https://api.lever.co/v0/postings/meesho/abc").mock(
        return_value=httpx.Response(200, json={"applicationId": "app-1"}))
    res = await lv.submit_application("meesho:abc", _package(urls={"LinkedIn": "https://linkedin.com/in/x"}))
    assert res.ok and res.reference == "app-1"
    assert route.calls[0].request.url.params["key"] == "k"
    assert not LeverApplicationProvider(keys={}).is_authorized("meesho:abc")
