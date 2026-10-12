"""Drive the production Preparation graph through canonical credential/provider governance."""

import json
import sys
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

from middleware import token_fallback, usage_metering
from middleware.usage_metering import AgentRunState, activate_agent_run_state
from rule_set_preparation.runner import MODEL_ERROR, run_rule_set_preparation
from test_rule_set_preparation_agent import FakeApi, RUN_ID, _call, _packet


class AllowanceExhausted(Exception):
    status_code = 429
    body = {"error": {"type": "insufficient_quota", "code": "allowance_exhausted"}}


@pytest.mark.parametrize(
    ("successful_slot", "expected"),
    [
        (("apx", 1), [("apx", 0), ("apx", 1)]),
        (("google_genai", 0), [("apx", 0), ("apx", 1), ("apx", 2), ("google_genai", 0)]),
        (("inception", 1), [("apx", 0), ("apx", 1), ("apx", 2), ("google_genai", 0),
                            ("google_genai", 1), ("inception", 0), ("inception", 1)]),
        (None, [("apx", 0), ("apx", 1), ("apx", 2), ("google_genai", 0),
                ("google_genai", 1), ("inception", 0), ("inception", 1)]),
        (("apx", 0), [("apx", 0)]),
    ],
    ids=["A-apx-rotation", "B-apx-exhausted", "C-inception", "D-terminal-exhaustion", "E-primary-success"],
)
def test_preparation_uses_credential_pools_before_provider_fallback(
    monkeypatch, tmp_path, successful_slot, expected,
):
    monkeypatch.setenv("LCSP_MODEL_ROUTES_FILE", str(Path(__file__).parents[1] / "config/model_routes.yaml"))
    pools = {provider: tuple(f"fixture-{provider}-{i}" for i in range(count))
             for provider, count in [("apx", 3), ("google_genai", 2), ("inception", 2)]}
    for provider, env in [("apx", "APX_API_KEY"), ("google_genai", "GOOGLE_API_KEY"),
                          ("inception", "INCEPTION_API_KEY")]:
        monkeypatch.setenv(env, ",".join(pools[provider]))
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()
    waits = []
    monkeypatch.setattr(token_fallback, "_sleep", waits.append)
    events, attempts, settled = [], [], []
    monkeypatch.setattr(usage_metering, "publish_agent_stream_event",
                        lambda event, **kwargs: events.append((event, kwargs["data"])))

    def generate(model, messages, **kwargs):
        provider = token_fallback.model_provider(model)
        secret = model.google_api_key if provider == "google_genai" else model.openai_api_key
        slot = pools[provider].index(secret.get_secret_value())
        attempts.append((provider, slot))
        if (provider, slot) != successful_slot:
            raise AllowanceExhausted("insufficient_quota: allowance_exhausted")
        message = (_call("submit_compliance_rule_set", {"packet": _packet()}, "submit-once")
                   if not any(getattr(m, "name", None) == "submit_compliance_rule_set" for m in messages)
                   else AIMessage(content="DONE"))
        message.usage_metadata = {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}
        return ChatResult(generations=[ChatGeneration(message=message)])

    monkeypatch.setattr(ChatOpenAI, "_generate", generate)
    monkeypatch.setattr(ChatGoogleGenerativeAI, "_generate", generate)
    api = FakeApi()
    state = AgentRunState(run_id=RUN_ID, agent_role="rule-set-preparation")
    # Observe the canonical usage port without assigning Preparation usage to a customer assessment.
    monkeypatch.setattr(state, "record", lambda response, model, invocation_id, **kwargs:
                        settled.append((usage_metering.provider_identity(model), invocation_id,
                                        usage_metering.extract_provider_usage(response, model))))
    try:
        with activate_agent_run_state(state):
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
        assert api.names() == ["claim", "submit"]
        assert len(starts) == len(completed) == len(settled) == 2
        assert failed == []
        assert starts[0]["model_step_id"] == completed[0]["model_step_id"]
        assert completed[0]["provider_attempts"] == len(expected)
        assert len({invocation for _, invocation, _ in settled}) == 2
        assert all(identity[0] == successful_slot[0].upper() and usage["totalTokens"] == "5"
                   for identity, _, usage in settled)
    else:
        assert result["state"] == "FAILED" and result["failureReason"] == MODEL_ERROR
        assert result["error"] == {"type": "TerminalCredentialError",
                                   "message": "All configured LLM provider routes exhausted; task stopped"}
        assert api.names() == ["claim", "fail"]
        assert len(starts) == len(failed) == 1
        assert failed[0]["provider_attempts"] == len(expected)
        assert completed == settled == []


def test_offline_preparation_cli_remains_provider_free(monkeypatch, tmp_path, capsys):
    from vertical import scripted_preparation

    for name in ("APX_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "INCEPTION_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    seed = tmp_path / "seed.json"
    seed.write_text(json.dumps({"hashes": {}, "packet": _packet()}))
    api = FakeApi()
    monkeypatch.setattr(scripted_preparation, "WorkerApiClient", lambda *args: api)
    monkeypatch.setattr(sys, "argv", ["scripted_preparation.py", "http://fixture.invalid",
                                     "fixture-worker", RUN_ID, str(seed), "valid"])

    assert scripted_preparation.main() == 0
    assert json.loads(capsys.readouterr().out.splitlines()[-1])["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "submit"]
