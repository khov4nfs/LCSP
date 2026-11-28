"""WP8 Phase B & C Rehearsal: Comprehensive Provider Calling Paths Admission Verification.

Rehearses all 5 real provider invocation paths:
1. Sync Model Call (UsageMeteringMiddleware.wrap_model_call)
2. Async Model Call (UsageMeteringMiddleware.awrap_model_call)
3. Provider Retry Path (ModelRetryMiddleware + UsageMeteringMiddleware)
4. Provider Fallback Path (ProviderFallbackMiddleware + UsageMeteringMiddleware)
5. Localization Path (transform_response_text & atransform_response_text / ResponseLocalizationMiddleware)

Invariants verified across all 5 paths:
- 100% of physical model calls MUST acquire server-issued admission (request) and CAS transition to IN_FLIGHT (consume) before bytes reach external providers.
- Strict sequential order: request_admission -> consume_admission -> provider_dispatched.
- Fail-closed boundary: If admission (e.g. HTTP 402) or CAS consume (HTTP 422) fails, exactly ZERO provider calls occur.
- Attempt-level isolation: Each retry or fallback attempt requests fresh admission with incremented attemptOrdinal and distinct admissionRequestId.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from typing import Any
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from tools.common.capabilities.platform.api_client import WorkerCallbackError
from middleware.usage_metering import UsageMeteringMiddleware
from middleware.model_governance import ModelRetryMiddleware
from middleware.provider_fallback import ProviderFallbackMiddleware
from orchestration import localization
from orchestration.localization import (
    ResponseLocalizationConfig,
    transform_response_text,
    atransform_response_text,
)
from conftest import use_model_routes


REHEARSAL_MODEL_ROUTES = {
    "routes": {
        "primary": {
            "provider": "anthropic",
            "protocol": "anthropic",
            "model": "claude-sonnet-4-6",
            "options": {"context_window_tokens": 200000, "max_output_tokens": 8192},
        },
        "fallback": {
            "provider": "google_genai",
            "protocol": "google_genai",
            "model": "gemini-3.5-flash-lite",
            "options": {"context_window_tokens": 1000000, "max_output_tokens": 8192},
        },
        "response-transform": {
            "provider": "anthropic",
            "protocol": "anthropic",
            "model": "claude-haiku-4-5",
            "options": {"context_window_tokens": 200000, "max_output_tokens": 4096},
        },
    },
    "roles": {
        "default": "primary",
        "response-transform": "response-transform",
    },
    "fallbacks": {
        "primary": ["fallback"],
    },
}


@pytest.fixture(autouse=True)
def _setup_routes(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "offline-anthropic-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "offline-google-key")
    use_model_routes(monkeypatch, REHEARSAL_MODEL_ROUTES)


class RehearsalModelRequest:
    def __init__(self, provider="anthropic", model_name="claude-sonnet-4-6", **kwargs):
        self.model = SimpleNamespace(
            provider=provider,
            protocol="google_genai" if provider == "google_genai" else "anthropic",
            model_name=model_name,
            options={"max_output_tokens": 4096},
        )
        self.messages = [HumanMessage(content="Hello rehearsal test")]
        self.tools = []
        self.run_id = kwargs.get("run_id", "run-rehearsal-1")
        self.logical_operation_id = kwargs.get("logical_operation_id", "op-rehearsal-1")
        self.execution_lease_token = kwargs.get("execution_lease_token", "lease-rehearsal-1")
        self.assessment_id = kwargs.get("assessment_id", "asm-rehearsal-1")
        for k, v in kwargs.items():
            setattr(self, k, v)

    def override(self, **kwargs):
        new_model = kwargs.get("model", self.model)
        provider = getattr(new_model, "provider", "anthropic")
        model_name = getattr(new_model, "model_name", "claude-sonnet-4-6")
        req = RehearsalModelRequest(
            provider=provider,
            model_name=model_name,
            run_id=self.run_id,
            logical_operation_id=self.logical_operation_id,
            execution_lease_token=self.execution_lease_token,
            assessment_id=self.assessment_id,
        )
        req.model = new_model
        return req


def _valid_model_request(provider="anthropic", model_name="claude-sonnet-4-6"):
    return RehearsalModelRequest(provider=provider, model_name=model_name)


def _mock_response(text="answer"):
    return SimpleNamespace(
        content=text,
        usage_metadata={
            "input_tokens": 50,
            "output_tokens": 100,
            "total_tokens": 150,
            "input_token_details": {"cache_read": 0},
        },
        response_metadata={"id": "resp-rehearsal-1"},
    )


class MockWorkerApiClient:
    """Mock WorkerApiClient tracking the exact chronological order of admission and consume events."""

    def __init__(self, timeline: list[str] | None = None):
        self.timeline = timeline if timeline is not None else []
        self.admission_requests: list[dict[str, Any]] = []
        self.consume_requests: list[dict[str, Any]] = []
        self.should_fail_admission = False
        self.admission_fail_status = 402
        self.admission_fail_code = "BILLING_PAYMENT_REQUIRED"
        self.fail_admission_on_attempt: int | None = None
        self.should_fail_consume = False
        self.consume_fail_status = 422
        self.consume_fail_code = "BILLING_ADMISSION_CAPABILITY_MISMATCH"
        self.fail_consume_on_attempt: int | None = None

    def request_invocation_admission(self, payload: dict) -> dict:
        self.timeline.append("request_admission")
        self.admission_requests.append(dict(payload))
        attempt = len(self.admission_requests)
        if self.should_fail_admission or (self.fail_admission_on_attempt == attempt):
            raise WorkerCallbackError(
                f"{self.admission_fail_code}: payment required",
                status_code=self.admission_fail_status,
                error_code=self.admission_fail_code,
            )
        now = datetime.now(timezone.utc)
        admitted_at = now.isoformat().replace("+00:00", "Z")
        expires_at = (now + timedelta(seconds=300)).isoformat().replace("+00:00", "Z")
        return {
            "admissionId": f"adm-rehearsal-{attempt}",
            "invocationId": f"inv-rehearsal-{attempt}",
            "admissionRequestId": payload.get("admissionRequestId", f"req-{attempt}"),
            "fundingPrincipal": "CUSTOMER_WALLET",
            "state": "ADMITTED",
            "rolloutMode": "ADMISSION_REQUIRED",
            "debitMode": "OFF",
            "resolvedProvider": payload.get("requestedProvider", "anthropic"),
            "resolvedModel": payload.get("requestedModel", "claude-sonnet-4-6"),
            "maximumExposureMicrocredits": "5000000",
            "capabilityToken": f"cap-token-{attempt}-" + "a" * 32,
            "admittedAt": admitted_at,
            "expiresAt": expires_at,
        }

    def consume_invocation_admission(self, payload: dict) -> dict:
        self.timeline.append("consume_admission")
        self.consume_requests.append(dict(payload))
        attempt = len(self.consume_requests)
        if self.should_fail_consume or (self.fail_consume_on_attempt == attempt):
            raise WorkerCallbackError(
                f"{self.consume_fail_code}: consume CAS failed",
                status_code=self.consume_fail_status,
                error_code=self.consume_fail_code,
            )
        return {
            "admissionId": payload["admissionId"],
            "invocationId": payload["invocationId"],
            "state": "IN_FLIGHT",
            "consumedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }


# =========================================================================
# PATH 1: SYNC MODEL CALL REHEARSAL
# =========================================================================

def test_rehearsal_path_1_sync_model_call(monkeypatch):
    """Path 1: Sync model invocation MUST execute: request_admission -> consume_admission (CAS) -> provider_dispatched."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    def mock_provider(req):
        timeline.append("provider_dispatched")
        return _mock_response("sync success")

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()
    res = middleware.wrap_model_call(req, mock_provider)

    assert res.content == "sync success"
    assert timeline == ["request_admission", "consume_admission", "provider_dispatched"]
    assert len(mock_client.admission_requests) == 1
    assert len(mock_client.consume_requests) == 1
    assert mock_client.admission_requests[0]["attemptOrdinal"] == 1
    assert mock_client.admission_requests[0]["requestedProvider"] == "anthropic"


# =========================================================================
# PATH 2: ASYNC MODEL CALL REHEARSAL
# =========================================================================

@pytest.mark.asyncio
async def test_rehearsal_path_2_async_model_call(monkeypatch):
    """Path 2: Async model invocation MUST execute: request_admission -> consume_admission (CAS) -> provider_dispatched."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    async def mock_async_provider(req):
        timeline.append("provider_dispatched")
        return _mock_response("async success")

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()
    res = await middleware.awrap_model_call(req, mock_async_provider)

    assert res.content == "async success"
    assert timeline == ["request_admission", "consume_admission", "provider_dispatched"]
    assert len(mock_client.admission_requests) == 1
    assert len(mock_client.consume_requests) == 1
    assert mock_client.admission_requests[0]["attemptOrdinal"] == 1


# =========================================================================
# PATH 3: RETRY PATH REHEARSAL
# =========================================================================

def test_rehearsal_path_3_provider_retry(monkeypatch):
    """Path 3: Provider retry MUST issue fresh admission and CAS consume per physical attempt."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    attempt_count = 0

    monkeypatch.setattr(
        "middleware.provider_fallback.fallback_model",
        lambda cfg: SimpleNamespace(
            provider=cfg.provider,
            protocol=cfg.protocol,
            model_name=cfg.model,
            options=cfg.options,
        ),
    )

    def mock_provider(req):
        nonlocal attempt_count
        attempt_count += 1
        timeline.append(f"provider_dispatched_attempt_{attempt_count}")
        if attempt_count == 1:
            err = Exception("Transient provider 500")
            err.status_code = 500
            raise err
        return _mock_response("retry success")

    retry_middleware = ModelRetryMiddleware(max_retries=2)
    metering_middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    res = retry_middleware.wrap_model_call(
        req,
        lambda r: metering_middleware.wrap_model_call(r, mock_provider),
    )

    assert res.content == "retry success"
    assert timeline == [
        "request_admission",
        "consume_admission",
        "provider_dispatched_attempt_1",
        "request_admission",
        "consume_admission",
        "provider_dispatched_attempt_2",
    ]
    assert len(mock_client.admission_requests) == 2
    assert len(mock_client.consume_requests) == 2
    assert mock_client.admission_requests[0]["attemptOrdinal"] == 1
    assert mock_client.admission_requests[1]["attemptOrdinal"] == 2
    assert (
        mock_client.admission_requests[0]["admissionRequestId"]
        != mock_client.admission_requests[1]["admissionRequestId"]
    )


# =========================================================================
# PATH 4: FALLBACK PATH REHEARSAL
# =========================================================================

def test_rehearsal_path_4_provider_fallback(monkeypatch):
    """Path 4: Provider fallback MUST request admission for the fallback provider/model before dispatch."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    attempt_count = 0

    monkeypatch.setattr(
        "middleware.provider_fallback.fallback_model",
        lambda cfg: SimpleNamespace(
            provider=cfg.provider,
            protocol=cfg.protocol,
            model_name=cfg.model,
            options=cfg.options,
        ),
    )

    def mock_provider(req):
        nonlocal attempt_count
        attempt_count += 1
        provider_name = req.model.provider
        timeline.append(f"provider_dispatched_{provider_name}")
        if provider_name == "anthropic":
            # Primary model fails with fallback-eligible error
            err = Exception("Rate limit 429")
            err.status_code = 429
            raise err
        return _mock_response(f"fallback success from {provider_name}")

    fallback_middleware = ProviderFallbackMiddleware()
    metering_middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    res = fallback_middleware.wrap_model_call(
        req,
        lambda r: metering_middleware.wrap_model_call(r, mock_provider),
    )

    assert "fallback success" in res.content
    assert timeline == [
        "request_admission",
        "consume_admission",
        "provider_dispatched_anthropic",
        "request_admission",
        "consume_admission",
        "provider_dispatched_google_genai",
    ]
    assert len(mock_client.admission_requests) == 2
    assert mock_client.admission_requests[0]["requestedProvider"] == "anthropic"
    assert mock_client.admission_requests[1]["requestedProvider"] == "google_genai"


# =========================================================================
# PATH 5: LOCALIZATION PATH REHEARSAL
# =========================================================================

def test_rehearsal_path_5_localization_sync_and_async(monkeypatch):
    """Path 5: Localization sync & async calls MUST route through governed runnable and acquire admission."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    # Active run state context required for execution context verification
    from middleware.usage_metering import (
        AgentRunState,
        activate_agent_run_state,
        activate_agent_role,
        activate_model_step,
        activate_model_operation,
    )
    from tools.common.capabilities.platform.api_client import WorkerApiClient

    api_client = WorkerApiClient("http://127.0.0.1:3000", "test-key")
    state = AgentRunState(
        run_id="run-loc-1",
        agent_role="response-transform",
        assessment_id="asm-loc-1",
    )
    state.execution_lease_token = "lease-loc-1"
    state.api_client = mock_client

    config = ResponseLocalizationConfig(
        enabled=True,
        role="response-transform",
        timeout_seconds=5.0,
        max_output_tokens=2048,
    )

    # Mock the underlying provider execution with matching route identity
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.outputs import ChatResult, ChatGeneration

    class MockProviderModel(BaseChatModel):
        provider: str = "anthropic"
        protocol: str = "anthropic"
        model_name: str = "claude-haiku-4-5"
        options: dict[str, Any] = {
            "context_window_tokens": 200000,
            "max_output_tokens": 4096,
        }

        def _generate(self, messages, **kwargs):
            timeline.append("provider_dispatched_localization")
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="Báo cáo tuân thủ."))])

        @property
        def _llm_type(self):
            return "anthropic"

    MockProviderModel.model_rebuild()
    raw_provider_model = MockProviderModel()
    monkeypatch.setattr("model_policy.resolve_agent_model", lambda role: raw_provider_model)

    # Localization execution
    with activate_agent_run_state(state):
        with activate_model_step() as step_id:
            # Sync localization
            result, telemetry = transform_response_text(
                "Compliance report.",
                "vi",
                config=config,
            )

    assert timeline == [
        "request_admission",
        "consume_admission",
        "provider_dispatched_localization",
    ]
    assert mock_client.admission_requests[0]["agentRole"] == "response-transform"
    assert mock_client.admission_requests[0]["operationType"] == "RESPONSE_TRANSFORM"
    assert telemetry["status"] == "APPLIED"


@pytest.mark.asyncio
async def test_rehearsal_path_5_async_localization(monkeypatch):
    """Path 5 (Async): Async response localization MUST route through governed runnable and acquire admission."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    from middleware.usage_metering import (
        AgentRunState,
        activate_agent_run_state,
        activate_model_step,
    )

    state = AgentRunState(
        run_id="run-loc-async-1",
        agent_role="response-transform",
        assessment_id="asm-loc-async-1",
    )
    state.execution_lease_token = "lease-loc-async-1"
    state.api_client = mock_client

    config = ResponseLocalizationConfig(
        enabled=True,
        role="response-transform",
        timeout_seconds=5.0,
        max_output_tokens=2048,
    )

    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.outputs import ChatResult, ChatGeneration

    class MockProviderModel(BaseChatModel):
        provider: str = "anthropic"
        protocol: str = "anthropic"
        model_name: str = "claude-haiku-4-5"
        options: dict[str, Any] = {
            "context_window_tokens": 200000,
            "max_output_tokens": 4096,
        }

        async def _agenerate(self, messages, **kwargs):
            timeline.append("provider_dispatched_async_localization")
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="Báo cáo tuân thủ bất đồng bộ."))])

        def _generate(self, messages, **kwargs):
            timeline.append("provider_dispatched_sync_localization")
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="Báo cáo tuân thủ."))])

        @property
        def _llm_type(self):
            return "anthropic"

    MockProviderModel.model_rebuild()
    raw_provider_model = MockProviderModel()
    monkeypatch.setattr("model_policy.resolve_agent_model", lambda role: raw_provider_model)

    with activate_agent_run_state(state):
        with activate_model_step() as step_id:
            result, telemetry = await atransform_response_text(
                "Compliance report.",
                "vi",
                config=config,
            )

    assert timeline == [
        "request_admission",
        "consume_admission",
        "provider_dispatched_async_localization",
    ]
    assert mock_client.admission_requests[0]["agentRole"] == "response-transform"
    assert mock_client.admission_requests[0]["operationType"] == "RESPONSE_TRANSFORM"
    assert telemetry["status"] == "APPLIED"


def test_rehearsal_path_5_localization_fail_closed_on_402(monkeypatch):
    """Path 5 (Fail-closed): When localization admission returns HTTP 402, ZERO provider calls occur and safe fallback is returned."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    mock_client.should_fail_admission = True
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    from middleware.usage_metering import (
        AgentRunState,
        activate_agent_run_state,
        activate_model_step,
    )

    state = AgentRunState(
        run_id="run-loc-fail-1",
        agent_role="response-transform",
        assessment_id="asm-loc-fail-1",
    )
    state.execution_lease_token = "lease-loc-fail-1"
    state.api_client = mock_client

    config = ResponseLocalizationConfig(
        enabled=True,
        role="response-transform",
        timeout_seconds=5.0,
        max_output_tokens=2048,
    )

    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.outputs import ChatResult, ChatGeneration

    provider_dispatched = False

    class MockProviderModel(BaseChatModel):
        provider: str = "anthropic"
        protocol: str = "anthropic"
        model_name: str = "claude-haiku-4-5"
        options: dict[str, Any] = {
            "context_window_tokens": 200000,
            "max_output_tokens": 4096,
        }

        def _generate(self, messages, **kwargs):
            nonlocal provider_dispatched
            provider_dispatched = True
            timeline.append("provider_dispatched_localization")
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content="Illegal."))])

        @property
        def _llm_type(self):
            return "anthropic"

    MockProviderModel.model_rebuild()
    raw_provider_model = MockProviderModel()
    monkeypatch.setattr("model_policy.resolve_agent_model", lambda role: raw_provider_model)

    with activate_agent_run_state(state):
        with activate_model_step() as step_id:
            result, telemetry = transform_response_text(
                "Original untranslated text.",
                "vi",
                config=config,
            )

    assert not provider_dispatched
    assert timeline == ["request_admission"]
    assert result == "Original untranslated text."
    assert telemetry["status"] == "FALLBACK"
    assert telemetry["fallback_used"] is True


# =========================================================================
# FAIL-CLOSED INTEGRITY CHECKS (ZERO PROVIDER CALLS ON FAILURE)
# =========================================================================

def test_rehearsal_fail_closed_on_402_blocks_provider(monkeypatch):
    """Invariant: When admission returns HTTP 402, exactly ZERO bytes/calls reach the provider."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    mock_client.should_fail_admission = True
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_dispatched = False

    def mock_provider(req):
        nonlocal provider_dispatched
        provider_dispatched = True
        return _mock_response("illegal")

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    with pytest.raises(WorkerCallbackError) as exc_info:
        middleware.wrap_model_call(req, mock_provider)

    assert exc_info.value.status_code == 402
    assert not provider_dispatched
    assert timeline == ["request_admission"]


def test_rehearsal_fail_closed_on_cas_failure_blocks_provider(monkeypatch):
    """Invariant: When CAS consume fails (422), exactly ZERO bytes/calls reach the provider."""
    timeline = []
    mock_client = MockWorkerApiClient(timeline=timeline)
    mock_client.should_fail_consume = True
    monkeypatch.setattr(
        "tools.common.capabilities.platform.api_client.WorkerApiClient",
        lambda *args, **kwargs: mock_client,
    )

    provider_dispatched = False

    def mock_provider(req):
        nonlocal provider_dispatched
        provider_dispatched = True
        return _mock_response("illegal")

    middleware = UsageMeteringMiddleware()
    req = _valid_model_request()

    with pytest.raises(WorkerCallbackError) as exc_info:
        middleware.wrap_model_call(req, mock_provider)

    assert exc_info.value.status_code == 422
    assert not provider_dispatched
    assert timeline == ["request_admission", "consume_admission"]
