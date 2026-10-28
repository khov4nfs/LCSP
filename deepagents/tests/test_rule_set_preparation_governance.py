
from test_rule_set_preparation_agent import _legacy_packet_unit_tools  # noqa: F401 - isolated packet-layer fixture
"""Drive the production Preparation graph through canonical credential/provider governance."""


import json
import sys
from pathlib import Path

import pytest
import yaml
from conftest import use_model_routes
from deepagents.backends import StateBackend
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from middleware import token_fallback, usage_metering
from middleware.model_governance import governed_summarization_middleware
from middleware.usage_metering import AgentRunState, activate_agent_run_state
from model_policy import resolve_agent_model
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream, publish_agent_stream_event
from rule_set_preparation.runner import MODEL_ERROR, run_rule_set_preparation
from test_rule_set_preparation_agent import RUN_ID, FakeApi, _call, _packet


class AllowanceExhausted(Exception):
    status_code = 429
    body = {"error": {"type": "insufficient_quota", "code": "allowance_exhausted"}}


def configured_fallback_chain(monkeypatch):
    config = yaml.safe_load((Path(__file__).parents[1] / "config/model_routes.yaml").read_text())
    config['roles']['rule-set-preparation'] = 'primary'
    config['roles']['claim-author'] = 'primary'
    use_model_routes(monkeypatch, config)


@pytest.mark.parametrize(
    ("successful_slot", "expected"),
    [
        (("miraiapi", 1), [("miraiapi", 0), ("miraiapi", 1)]),
        (("inception", 0), [("miraiapi", 0), ("miraiapi", 1), ("inception", 0)]),
        (("google_genai", 1), [("miraiapi", 0), ("miraiapi", 1), ("inception", 0),
                              ("inception", 1), ("google_genai", 0), ("google_genai", 1)]),
        (("apx", 1), [("miraiapi", 0), ("miraiapi", 1), ("inception", 0), ("inception", 1),
                      ("google_genai", 0), ("google_genai", 1), ("apx", 0), ("apx", 1)]),
        (None, [("miraiapi", 0), ("miraiapi", 1), ("inception", 0), ("inception", 1),
                ("google_genai", 0), ("google_genai", 1), ("apx", 0), ("apx", 1), ("apx", 2)]),
        (("miraiapi", 0), [("miraiapi", 0)]),
    ],
    ids=["A-miraiapi-rotation", "B-miraiapi-exhausted", "C-gemini", "F-apx-last", "D-terminal-exhaustion", "E-primary-success"],
)
def test_preparation_uses_credential_pools_before_provider_fallback(
    monkeypatch, tmp_path, successful_slot, expected,
):
    configured_fallback_chain(monkeypatch)
    pools = {provider: tuple(f"fixture-{provider}-{i}" for i in range(count))
             for provider, count in [("apx", 3), ("google_genai", 2), ("inception", 2), ("miraiapi", 2)]}
    for provider, env in [("apx", "APX_API_KEY"), ("google_genai", "GOOGLE_API_KEY"),
                          ("inception", "INCEPTION_API_KEY"), ("miraiapi", "MIRAI_API_KEY")]:
        monkeypatch.setenv(env, ",".join(pools[provider]))
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()
    waits = []
    monkeypatch.setattr(token_fallback, "_sleep", waits.append)
    events, attempts, settled = [], [], []
    def record_event(event, **kwargs):
        events.append((event, kwargs["data"]))
        publish_agent_stream_event(event, **kwargs)

    monkeypatch.setattr(usage_metering, "publish_agent_stream_event", record_event)

    def generate(model, messages, **kwargs):
        provider = token_fallback.model_provider(model)
        if provider == "google_genai":
            secret = model.google_api_key
        elif isinstance(model, ChatAnthropic):
            secret = model.anthropic_api_key
        else:
            secret = model.openai_api_key
        slot = pools[provider].index(secret.get_secret_value())
        attempts.append((provider, slot))
        if (provider, slot) != successful_slot:
            raise AllowanceExhausted("insufficient_quota: allowance_exhausted")
        tool_results = {getattr(m, "name", None) for m in messages}
        if "validate_compliance_rule_set" not in tool_results:
            message = _call("validate_compliance_rule_set", {"packet": _packet()}, "validate")
        elif "submit_compliance_rule_set" not in tool_results:
            message = _call("submit_compliance_rule_set", {"packet": _packet()}, "submit-once")
        else:
            message = AIMessage(content="DONE")
        message.usage_metadata = {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}
        return ChatResult(generations=[ChatGeneration(message=message)])

    def stream(model, messages, stop=None, run_manager=None, **kwargs):
        # The production routes stream: replay the scripted answer as one chunk.
        message = generate(model, messages, **kwargs).generations[0].message
        yield ChatGenerationChunk(message=AIMessageChunk(
            content=message.content, usage_metadata=message.usage_metadata,
            tool_call_chunks=[{"name": call["name"], "args": json.dumps(call["args"]), "id": call["id"],
                               "index": index, "type": "tool_call_chunk"}
                              for index, call in enumerate(message.tool_calls)],
        ))

    for client in (ChatOpenAI, ChatGoogleGenerativeAI, ChatAnthropic):
        monkeypatch.setattr(client, "_generate", generate)
        monkeypatch.setattr(client, "_stream", stream)
    api = FakeApi()
    state = AgentRunState(run_id=RUN_ID, agent_role="rule-set-preparation")
    stream = AgentStreamSession(
        assessment_id=None,
        run_id=RUN_ID,
        correlation_id="provider-fallback-test",
        boundary_name="rule_set_preparation",
        emit_payload=lambda _: None,
        boundary_type="PREPARATION",
        boundary_id=RUN_ID,
        preparation_run_id=RUN_ID,
    )
    # Observe the canonical usage port without assigning Preparation usage to a customer assessment.
    monkeypatch.setattr(state, "record", lambda response, model, invocation_id, **kwargs:
                        settled.append((usage_metering.provider_identity(model), invocation_id,
                                        usage_metering.extract_provider_usage(response, model))))
    try:
        with activate_agent_stream(stream), activate_agent_run_state(state):
            result = run_rule_set_preparation(api, RUN_ID, work_dir=tmp_path)
    finally:
        token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
        token_fallback._RATE_LIMITED_UNTIL.clear()

    assert waits == []  # Monthly allowance exhaustion cannot recover after a short cooldown.
    assert attempts == expected + ([successful_slot] if successful_slot else [])
    starts = [data for event, data in events if event == "MODEL_CALL_STARTED"]
    completed = [data for event, data in events if event == "MODEL_CALL_COMPLETED"]
    failed = [data for event, data in events if event == "MODEL_CALL_FAILED"]
    if successful_slot:
        assert result["state"] == "SUCCEEDED"
        assert api.names() == ["claim", "validate", "submit"]
        assert len(starts) == len(completed) == len(settled) == 2
        assert failed == []
        assert starts[0]["model_step_id"] == completed[0]["model_step_id"]
        assert completed[0]["provider_attempts"] == len(expected)
        assert len({invocation for _, invocation, _ in settled}) == 2
        assert all(identity[0] == successful_slot[0].upper() and usage["totalTokens"] == "5"
                   for identity, _, usage in settled)
    else:
        assert result["state"] == "FAILED" and result["failureReason"] == MODEL_ERROR
        assert result["error"] == {"type": "TerminalCredentialError", "stage": "AGENT_GRAPH"}
        assert api.names() == ["claim", "fail"]
        assert len(starts) == len(failed) == 1
        assert failed[0]["provider_attempts"] == len(expected)
        assert completed == settled == []


def _summary_test_stream() -> AgentStreamSession:
    return AgentStreamSession(
        assessment_id=None,
        run_id=RUN_ID,
        correlation_id="summarization-governance-test",
        boundary_name="rule_set_preparation",
        emit_payload=lambda _: None,
        boundary_type="PREPARATION",
        boundary_id=RUN_ID,
        preparation_run_id=RUN_ID,
    )


def _provider_slot(model, pools):
    provider = token_fallback.model_provider(model)
    if provider == "google_genai":
        secret = model.google_api_key
    elif isinstance(model, ChatAnthropic):
        secret = model.anthropic_api_key
    else:
        secret = model.openai_api_key
    return provider, pools[provider].index(secret.get_secret_value())


@pytest.mark.parametrize("terminal", [False, True], ids=["fallback-success", "terminal-exhaustion"])
def test_framework_summarization_uses_full_model_governance(monkeypatch, terminal):
    configured_fallback_chain(monkeypatch)
    pools = {
        "apx": ("fixture-apx-0", "fixture-apx-1"),
        "google_genai": ("fixture-google-0",),
        "inception": ("fixture-inception-0",),
        "miraiapi": ("fixture-miraiapi-0",),
    }
    for provider, env in [
        ("apx", "APX_API_KEY"),
        ("google_genai", "GOOGLE_API_KEY"),
        ("inception", "INCEPTION_API_KEY"),
        ("miraiapi", "MIRAI_API_KEY"),
    ]:
        monkeypatch.setenv(env, ",".join(pools[provider]))
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()
    monkeypatch.setattr(token_fallback, "_sleep", lambda _seconds: None)

    events, attempts, settled = [], [], []

    def record_event(event, **kwargs):
        events.append((event, kwargs["data"]))
        publish_agent_stream_event(event, **kwargs)

    monkeypatch.setattr(usage_metering, "publish_agent_stream_event", record_event)

    def generate(model, messages, **kwargs):
        provider_slot = _provider_slot(model, pools)
        attempts.append(provider_slot)
        if terminal or provider_slot != ("google_genai", 0):
            raise AllowanceExhausted("insufficient_quota: allowance_exhausted")
        message = AIMessage(
            content="governed summary",
            usage_metadata={"input_tokens": 7, "output_tokens": 3, "total_tokens": 10},
        )
        return ChatResult(generations=[ChatGeneration(message=message)])

    def stream_model(model, messages, stop=None, run_manager=None, **kwargs):
        message = generate(model, messages, **kwargs).generations[0].message
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content=message.content,
                usage_metadata=message.usage_metadata,
            )
        )

    for client in (ChatOpenAI, ChatGoogleGenerativeAI, ChatAnthropic):
        monkeypatch.setattr(client, "_generate", generate)
        monkeypatch.setattr(client, "_stream", stream_model)

    state = AgentRunState(run_id=RUN_ID, agent_role="rule-set-preparation")
    monkeypatch.setattr(
        state,
        "record",
        lambda response, model, invocation_id, **kwargs: settled.append(
            (
                usage_metering.provider_identity(model),
                invocation_id,
                usage_metering.extract_provider_usage(response, model),
            )
        ),
    )
    model = resolve_agent_model("rule-set-preparation")
    middleware = governed_summarization_middleware(
        model, backend=StateBackend(), role="rule-set-preparation"
    )

    try:
        with activate_agent_stream(_summary_test_stream()), activate_agent_run_state(state):
            if terminal:
                with pytest.raises(Exception) as caught:
                    middleware._lc_helper._summary_model.invoke("summarize this")
            else:
                response = middleware._lc_helper._summary_model.invoke("summarize this")
    finally:
        token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
        token_fallback._RATE_LIMITED_UNTIL.clear()

    starts = [data for event, data in events if event == "MODEL_CALL_STARTED"]
    completed = [data for event, data in events if event == "MODEL_CALL_COMPLETED"]
    failed = [data for event, data in events if event == "MODEL_CALL_FAILED"]
    provider_failures = [
        data
        for event, data in events
        if event == "CUSTOM_PROGRESS"
        and data.get("activity_kind") == "MODEL_PROVIDER_ATTEMPT_FAILED"
    ]

    assert len(starts) == 1
    assert starts[0]["operation_type"] == "SUMMARIZATION"
    assert starts[0]["invocation_id"]
    assert provider_failures
    assert all(item["operation_type"] == "SUMMARIZATION" for item in provider_failures)
    assert all(
        item["invocation_id"] == starts[0]["invocation_id"] for item in provider_failures
    )
    assert all(item["http_status"] == 429 for item in provider_failures)
    assert all(item["fallback_eligibility"] is True for item in provider_failures)

    if terminal:
        # The raw APX/Anthropic-style 429 must not be the unclassified graph failure.
        assert type(caught.value).__name__ != "RateLimitError"
        assert completed == settled == []
        assert len(failed) == 1
        assert failed[0]["operation_type"] == "SUMMARIZATION"
        assert failed[0]["invocation_id"] == starts[0]["invocation_id"]
        assert failed[0]["http_status"] in {None, 429}
    else:
        assert response.content == "governed summary"
        assert attempts[:3] == [("miraiapi", 0), ("inception", 0), ("google_genai", 0)]
        assert failed == []
        assert len(completed) == len(settled) == 1
        assert completed[0]["operation_type"] == "SUMMARIZATION"
        assert completed[0]["invocation_id"] == starts[0]["invocation_id"]
        assert settled[0][0] == ("GOOGLE_GENAI", "gemini-3.5-flash-lite")
        assert settled[0][1] == completed[0]["settlement_invocation_id"]
        assert completed[0]["logical_invocation_id"] == starts[0]["invocation_id"]
        assert settled[0][2]["inputTokensIncludingCache"] == "7"
        assert "inputTokens" not in settled[0][2]  # Uncached input requires cache usage.
        assert settled[0][2]["outputTokens"] == "3"
        assert settled[0][2]["totalTokens"] == "10"


def test_claim_author_has_governed_summarization_and_role(monkeypatch, tmp_path):
    from rule_set_preparation.agent import claim_author_subagent
    from middleware.agent_run_budget import AgentRunBudgetMiddleware
    from test_claim_files import runtime
    context, _ = runtime(tmp_path)

    monkeypatch.setenv(
        "LCSP_MODEL_ROUTES_FILE",
        str(Path(__file__).parents[1] / "config/model_routes.yaml"),
    )
    monkeypatch.setenv("INCEPTION_API_KEY", "fixture-inception")
    model = resolve_agent_model("rule-set-preparation")
    spec = claim_author_subagent(context, model, StateBackend(), AgentRunBudgetMiddleware())
    middleware = spec["middleware"]

    summary = next(item for item in middleware if item.name == "SummarizationMiddleware")
    role = next(item for item in middleware if isinstance(item, usage_metering.AgentRoleMiddleware))
    assert type(summary._lc_helper._summary_model).__name__ == "_GovernedInternalModelRunnable"
    assert role.agent_role == "claim-author"



def test_offline_preparation_cli_remains_provider_free(monkeypatch, tmp_path, capsys):
    from vertical import scripted_preparation

    for name in ("APX_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "INCEPTION_API_KEY", "MIRAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"hashes": {}, "packet": _packet()}))
    api = FakeApi()
    monkeypatch.setattr(scripted_preparation, "WorkerApiClient", lambda *args: api)
    monkeypatch.setattr(sys, "argv", ["scripted_preparation.py", "http://fixture.invalid",
                                     "fixture-worker", RUN_ID, str(seed), "no-submit"])

    assert scripted_preparation.main() == 0
    result = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert result["state"] == "FAILED" and result["failureReason"] == "NO_SUBMISSION", result
    assert api.names() == ["claim", "fail"]
