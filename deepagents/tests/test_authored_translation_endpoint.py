"""Private translation candidates must never disguise provider fallback as successful output."""
import hashlib

import pytest
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from tools.common.capabilities.agent_runtime.local_server import authored_translation


@pytest.mark.parametrize("locale,source,content,translated", [
    ("vi", "EN", "Retention period", "Thời hạn lưu giữ"),
    ("en", "VI", "Thời hạn lưu giữ", "Retention period"),
])
def test_authored_candidate_and_provider_failure(monkeypatch, locale, source, content, translated):
    import orchestration.localization as localization

    monkeypatch.setenv("WORKER_API_KEY", "worker-test")
    client = TestClient(Starlette(routes=[Route("/translate", authored_translation, methods=["POST"])]))
    payload = {"content": content, "locale": locale, "originalLanguage": source,
               "originSha256": hashlib.sha256(content.encode("utf-8")).hexdigest()}
    headers = {"x-worker-api-key": "worker-test"}
    calls = []

    async def translated_result(text, target):
        calls.append((text, target))
        return translated, {"status": "APPLIED", "model": "test-model", "fallback_used": False}

    monkeypatch.setattr(localization, "atransform_response_text", translated_result)
    assert client.post("/translate", json=payload).status_code == 403
    assert client.post("/translate", json={**payload, "originSha256": "0" * 64}, headers=headers).status_code == 400
    assert client.post("/translate", json={**payload, "locale": "fr"}, headers=headers).status_code == 400
    assert calls == []
    response = client.post("/translate", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"locale": locale, "originSha256": payload["originSha256"],
                               "content": translated, "engine": "test-model",
                               "engineVersion": "lcsp-authored-adapter-v1"}

    async def failed_result(text, target):
        return text, {"status": "FALLBACK", "fallback_used": True}

    monkeypatch.setattr(localization, "atransform_response_text", failed_result)
    assert client.post("/translate", json=payload, headers=headers).status_code == 503

    async def raised_result(text, target):
        raise TimeoutError("private-provider-details")

    monkeypatch.setattr(localization, "atransform_response_text", raised_result)
    response = client.post("/translate", json=payload, headers=headers)
    assert response.status_code == 503
    assert "private-provider-details" not in response.text
