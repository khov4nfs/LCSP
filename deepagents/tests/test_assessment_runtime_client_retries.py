"""Transport replay safety for the governed Assessment Root API; all HTTP is intercepted."""

from __future__ import annotations

import httpx
import pytest

from assessment_root.client import AssessmentApiError, AssessmentRuntimeClient


@pytest.fixture
def runtime_client():
    client = AssessmentRuntimeClient("https://assessment.invalid", "offline-worker-key", timeout=0.1)
    client.assessment_id = "assessment"
    client.lease_token = "offline-lease"
    return client


def _transient_failure(kind):
    if kind == "timeout":
        raise httpx.ReadTimeout("response lost after dispatch")
    if kind == "network":
        raise httpx.ConnectError("offline connection failure")
    return httpx.Response(
        int(kind),
        json={"ok": False, "problem": {"code": "TRANSIENT_TEST_FAILURE", "meta": {"reason": "offline"}}},
    )


@pytest.mark.parametrize("failure", ["503", "429", "timeout", "network"])
def test_context_read_retries_transient_failures_without_mutating_state(runtime_client, monkeypatch, failure):
    calls, delays = [], []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if len(calls) == 1:
            return _transient_failure(failure)
        return httpx.Response(200, json={"ok": True, "data": {"caseRevision": 7}})

    monkeypatch.setattr("assessment_root.client.httpx.request", request)
    monkeypatch.setattr("assessment_root.client.time.sleep", delays.append)

    assert runtime_client.context() == {"caseRevision": 7}
    assert len(calls) == 2
    assert delays == [1.0]
    assert all(method == "GET" and url.endswith("/context") for method, url, _ in calls)
    assert all(kwargs["headers"]["x-assessment-lease"] == "offline-lease" for _, _, kwargs in calls)
    assert runtime_client.lease_token == "offline-lease"


@pytest.mark.parametrize("failure", ["503", "429", "timeout", "network"])
def test_transient_read_failure_stops_at_three_attempts(runtime_client, monkeypatch, failure):
    calls, delays = [], []

    def request(method, url, **kwargs):
        calls.append(method)
        return _transient_failure(failure)

    monkeypatch.setattr("assessment_root.client.httpx.request", request)
    monkeypatch.setattr("assessment_root.client.time.sleep", delays.append)
    error = httpx.ReadTimeout if failure == "timeout" else httpx.ConnectError if failure == "network" else AssessmentApiError

    with pytest.raises(error) as raised:
        runtime_client.context()

    assert calls == ["GET", "GET", "GET"]
    assert delays == [1.0, 2.0]
    if isinstance(raised.value, AssessmentApiError):
        assert raised.value.code == "TRANSIENT_TEST_FAILURE"
        assert raised.value.meta == {"reason": "offline"}


def test_nonretryable_read_problem_preserves_server_rejection(runtime_client, monkeypatch):
    calls, delays = [], []

    def request(method, url, **kwargs):
        calls.append(method)
        return httpx.Response(
            409, json={"ok": False, "problem": {"code": "ASSESSMENT_CASE_REVISION_STALE", "meta": {"revision": 8}}},
        )

    monkeypatch.setattr("assessment_root.client.httpx.request", request)
    monkeypatch.setattr("assessment_root.client.time.sleep", delays.append)

    with pytest.raises(AssessmentApiError) as raised:
        runtime_client.context()

    assert raised.value.code == "ASSESSMENT_CASE_REVISION_STALE"
    assert raised.value.meta == {"revision": 8}
    assert calls == ["GET"]
    assert not delays


@pytest.mark.parametrize("operation", ["claim", "finish", "post_evidence"])
@pytest.mark.parametrize("failure", ["503", "429", "timeout"])
def test_ambiguous_mutation_response_never_replays_a_committed_write(
    runtime_client, monkeypatch, operation, failure,
):
    committed, delays = [], []

    def request(method, url, **kwargs):
        # The server may commit before the response is lost or an intermediary returns an error.
        committed.append((method, url, kwargs["json"]))
        return _transient_failure(failure)

    monkeypatch.setattr("assessment_root.client.httpx.request", request)
    monkeypatch.setattr("assessment_root.client.time.sleep", delays.append)
    error = httpx.ReadTimeout if failure == "timeout" else AssessmentApiError

    with pytest.raises(error):
        if operation == "claim":
            runtime_client.claim("assessment")
        elif operation == "finish":
            runtime_client.finish("FAILED", checkpoint_id="checkpoint")
        else:
            runtime_client.post_evidence({"idempotencyKey": "fixed-evidence-key", "payload": {"path": "src/app.py"}})

    assert len(committed) == 1
    assert committed[0][0] == "POST"
    assert not delays
    # Failure does not fabricate acknowledgement or clear a lease that the API has not acknowledged.
    assert runtime_client.lease_token == "offline-lease"
