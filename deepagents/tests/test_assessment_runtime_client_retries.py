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


def test_retry_attempts_reuse_execution_correlation_id(runtime_client, monkeypatch):
    """[RED][ASM-TRACE-01] A transport retry remains part of the same Root trace."""
    correlation_ids = []

    def request(method, url, **kwargs):
        del method, url
        correlation_ids.append(kwargs["headers"]["x-correlation-id"])
        if len(correlation_ids) == 1:
            return _transient_failure("503")
        return httpx.Response(200, json={"ok": True, "data": {"caseRevision": 7}})

    monkeypatch.setattr("assessment_root.client.httpx.request", request)
    monkeypatch.setattr("assessment_root.client.time.sleep", lambda _delay: None)

    runtime_client.context()

    # Retries repeat transport only; they must not create a second distributed trace.
    assert len(correlation_ids) == 2
    assert len(set(correlation_ids)) == 1


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


def test_red_asm_trace_01_reuses_one_correlation_id_for_a_root_workflow(runtime_client, monkeypatch):
    """[RED][ASM-TRACE-01] One leased Root workflow has one end-to-end trace identity."""
    correlation_ids = []

    def request(method, url, **kwargs):
        del method, url
        correlation_ids.append(kwargs["headers"]["x-correlation-id"])
        return httpx.Response(200, json={"ok": True, "data": {"caseRevision": 7}})

    monkeypatch.setattr("assessment_root.client.httpx.request", request)

    # Separate tool calls in one leased execution must remain joinable across
    # NestJS, the Python worker and downstream logs.
    runtime_client.context()
    runtime_client.context()

    assert len(correlation_ids) == 2
    assert len(set(correlation_ids)) == 1


def test_explicit_execution_correlation_is_reused_across_runtime_calls(monkeypatch):
    """The boundary-owned trace identity must reach every governed NestJS call unchanged."""
    client = AssessmentRuntimeClient(
        "https://assessment.invalid",
        "offline-worker-key",
        timeout=0.1,
        correlation_id="root-command-correlation",
    )
    client.assessment_id = "assessment"
    client.lease_token = "offline-lease"
    observed = []

    def request(method, url, **kwargs):
        del method, url
        observed.append(kwargs["headers"]["x-correlation-id"])
        return httpx.Response(200, json={"ok": True, "data": {}})

    monkeypatch.setattr("assessment_root.client.httpx.request", request)

    client.context()
    client.rule_set()
    client.post_evidence({"idempotencyKey": "trace-test", "payload": {}})
    client.heartbeat()

    assert observed == [
        "root-command-correlation",
        "root-command-correlation",
        "root-command-correlation",
        "root-command-correlation",
    ]


@pytest.mark.parametrize(
    "correlation_id",
    ["", "  ", "bad\r\nheader", "bad\x00header", "café", "x" * 257],
)
def test_runtime_client_rejects_malformed_explicit_correlations(correlation_id):
    """[RED] Producer-controlled trace values cannot become malformed HTTP headers."""
    with pytest.raises(ValueError, match="correlation_id"):
        AssessmentRuntimeClient(
            "https://assessment.invalid",
            "offline-worker-key",
            correlation_id=correlation_id,
        )


def test_runtime_client_cannot_claim_a_second_execution(monkeypatch):
    """[RED] An execution-scoped client cannot carry one trace into a later claim."""
    client = AssessmentRuntimeClient("https://assessment.invalid", "offline-worker-key")
    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return httpx.Response(200, json={"ok": True, "data": {"leaseToken": "lease-1"}})

    monkeypatch.setattr("assessment_root.client.httpx.request", request)

    client.claim("assessment-1")
    with pytest.raises(RuntimeError, match="execution-scoped"):
        client.claim("assessment-2")

    assert len(calls) == 1


def test_independent_runtime_clients_receive_distinct_fallback_correlations(monkeypatch):
    """Direct execution clients without an inbound ID still form isolated traces."""
    observed = []

    def request(method, url, **kwargs):
        del method, url
        observed.append(kwargs["headers"]["x-correlation-id"])
        return httpx.Response(200, json={"ok": True, "data": {}})

    monkeypatch.setattr("assessment_root.client.httpx.request", request)
    for _ in range(2):
        client = AssessmentRuntimeClient("https://assessment.invalid", "offline-worker-key")
        client.assessment_id = "assessment"
        client.lease_token = "offline-lease"
        client.context()

    assert len(observed) == 2
    assert observed[0] != observed[1]


def test_api_error_metadata_does_not_surface_worker_or_lease_secrets(runtime_client, monkeypatch):
    """Untrusted problem metadata cannot reflect worker authentication material to callers."""
    worker_secret = "offline-worker-key"
    lease_secret = "offline-lease"

    def request(method, url, **kwargs):
        del method, url, kwargs
        return httpx.Response(
            409,
            json={
                "ok": False,
                "problem": {
                    "code": "ASSESSMENT_REJECTED",
                    "meta": {
                        "revision": 8,
                        "workerApiKey": worker_secret,
                        "leaseToken": lease_secret,
                    },
                },
            },
        )

    monkeypatch.setattr("assessment_root.client.httpx.request", request)

    with pytest.raises(AssessmentApiError) as raised:
        runtime_client.context()

    surfaced = f"{raised.value} {raised.value.meta!r}"
    assert raised.value.meta == {"revision": 8}
    assert worker_secret not in surfaced
    assert lease_secret not in surfaced


def test_api_error_redacts_embedded_and_late_lease_secrets(runtime_client, monkeypatch):
    """[RED] Error filtering uses request credentials even if concurrent settlement clears client state."""
    worker_secret = "offline-worker-key"
    lease_secret = "offline-lease"

    def request(method, url, **kwargs):
        del method, url
        assert kwargs["headers"]["x-assessment-lease"] == lease_secret
        # Simulate finish settling concurrently after this request captured its headers.
        runtime_client.lease_token = None
        return httpx.Response(
            409,
            json={
                "ok": False,
                "problem": {
                    "code": f"REJECTED_{worker_secret}",
                    "meta": {
                        "detail": f"lease={lease_secret}",
                        f"prefix-{worker_secret}-suffix": "reflected-key",
                    },
                },
            },
        )

    monkeypatch.setattr("assessment_root.client.httpx.request", request)

    with pytest.raises(AssessmentApiError) as raised:
        runtime_client.context()

    surfaced = f"{raised.value} {raised.value.meta!r}"
    assert worker_secret not in surfaced
    assert lease_secret not in surfaced


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
