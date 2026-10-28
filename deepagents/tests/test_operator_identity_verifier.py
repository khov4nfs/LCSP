"""Evidence-integrity checks for the offline live-model acceptance harness."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage, message_to_dict
from langchain_core.outputs import ChatGeneration, LLMResult


@pytest.fixture
def verifier():
    path = Path(__file__).resolve().parents[2] / "scripts/verify_operator_identity_scenarios.py"
    spec = importlib.util.spec_from_file_location("operator_identity_verifier", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_receipts_preserve_full_messages_and_match_interleaved_tool_results(verifier):
    trace = verifier.ScenarioTrace()
    model_id, first_id, second_id = uuid4(), uuid4(), uuid4()
    prompt = HumanMessage(content="Pinned source context " * 100)
    response = AIMessage(
        content="Observed source facts " * 100,
        tool_calls=[{"name": "read_file", "args": {"path": "README.md"}, "id": "read-1"}],
        usage_metadata={"input_tokens": 30, "output_tokens": 5, "total_tokens": 35},
        response_metadata={"model_name": "mercury-3", "id": "provider-response-1"},
    )
    trace.on_chat_model_start({}, [[prompt]], run_id=model_id)
    trace.on_tool_start({"name": "first"}, "first input " * 100, run_id=first_id)
    trace.on_tool_start({"name": "second"}, "second input", run_id=second_id)
    first = ToolMessage(content="First source range " * 100, tool_call_id="read-1")
    second = ToolMessage(content="Second source range", tool_call_id="read-2")
    trace.on_tool_end(first, run_id=first_id)
    trace.on_tool_end(second, run_id=second_id)
    trace.on_llm_end(LLMResult(generations=[[ChatGeneration(message=response)]]), run_id=model_id)

    assert trace.calls[0]["inputMessages"] == [[message_to_dict(prompt)]]
    assert trace.calls[0]["outputMessages"] == [message_to_dict(response)]
    assert trace.tool_calls[0]["input"] == "first input " * 100
    assert trace.tool_calls[0]["output"] == message_to_dict(first)
    assert trace.tool_calls[1]["output"] == message_to_dict(second)
    assert trace.input_tokens + trace.output_tokens == 35
    assert trace.usage_complete is True


def test_errors_are_retained_on_their_own_model_and_tool_runs(verifier):
    trace = verifier.ScenarioTrace()
    model_id, tool_id = uuid4(), uuid4()
    trace.on_chat_model_start({}, [[HumanMessage(content="Investigate")]], run_id=model_id)
    trace.on_tool_start({"name": "read_file"}, "{}", run_id=tool_id)
    trace.on_llm_error(RuntimeError("Generation failed"), run_id=model_id)
    trace.on_tool_error(ValueError("Unknown source range"), run_id=tool_id)

    assert trace.calls[0]["status"] == "ERROR"
    assert trace.calls[0]["error"]["type"] == "RuntimeError"
    assert trace.tool_calls[0]["status"] == "ERROR"
    assert trace.tool_calls[0]["error"]["message"] == "Unknown source range"
    assert trace.usage_complete is False


def test_missing_provider_usage_remains_explicitly_incomplete(verifier):
    trace = verifier.ScenarioTrace()
    model_id = uuid4()
    trace.on_chat_model_start({}, [[HumanMessage(content="Investigate")]], run_id=model_id)
    response = AIMessage(content="No usage retained")
    trace.on_llm_end(LLMResult(generations=[[ChatGeneration(message=response)]]), run_id=model_id)

    assert trace.usage_complete is False
    assert trace.calls[0]["outputMessages"][0]["data"]["usage_metadata"] is None


@pytest.mark.parametrize(("verdict", "exit_code"), [("VERIFIED_PASS", 0), ("FAILED", 1)])
def test_main_returns_scenario_failure_to_the_shell(verifier, monkeypatch, tmp_path, verdict, exit_code):
    result = {
        "verdict": verdict,
        "actualBehavior": {"modelTurnsCount": 1, "toolCallsCount": 1},
        "telemetry": {"totalTokens": 35, "usageComplete": True},
    }
    monkeypatch.setattr(verifier, "_load_llm_env", lambda: None)
    monkeypatch.setattr(verifier, "resolve_agent_model", lambda role: SimpleNamespace(model_name="test"))
    for name in ["run_scenario_a", "run_scenario_b", "run_scenario_c", "run_scenario_d"]:
        monkeypatch.setattr(verifier, name, lambda model: result)
    output = tmp_path / "receipt.json"

    assert verifier.main(output) == exit_code
    assert json.loads(output.read_text())["overallVerdict"] == ("PASS" if exit_code == 0 else "FAIL")


def test_historical_receipt_cannot_be_overwritten_or_trigger_new_inference(verifier, monkeypatch, tmp_path):
    output = tmp_path / "receipt.json"
    output.write_text("Historical model evidence")

    def unexpected_model_resolution(role):
        pytest.fail("Existing receipt must be rejected before resolving a paid model")

    monkeypatch.setattr(verifier, "resolve_agent_model", unexpected_model_resolution)
    with pytest.raises(FileExistsError):
        verifier.main(output)
    assert output.read_text() == "Historical model evidence"


def test_scenario_c_rejects_compliant_summary_with_unmet_fixture_criterion(verifier, monkeypatch, tmp_path):
    client = SimpleNamespace(calls=[])
    run = SimpleNamespace(trace=None)
    fact1 = {"type": "CONFIRMED_FACT", "factId": "c1111111-1111-4111-a111-111111111111"}
    fact2 = {"type": "CONFIRMED_FACT", "factId": "c2222222-2222-4222-a222-222222222222"}
    packet = {"decision": {
        "applicability": "APPLICABLE",
        "compliance": "COMPLIANT",
        "rationale": "Contradictory summary for this fixture",
        "references": [fact1],
        "applicabilityBasis": [{"kind": "APPLICABILITY_CONDITION", "finding": "ESTABLISHED", "references": [fact1]}],
        "criteria": [{"outcome": "NOT_MET", "references": [fact2]}],
    }}

    def invoke(*args, **kwargs):
        client.calls.append(("decision", packet))
        return {}

    monkeypatch.setattr(verifier.tempfile, "mkdtemp", lambda: str(tmp_path))
    monkeypatch.setattr(verifier, "_setup_semantic_test", lambda *args, **kwargs: (client, run))
    monkeypatch.setattr(verifier, "create_assessment_root_agent", lambda **kwargs: SimpleNamespace(invoke=invoke))

    assert verifier.run_scenario_c(object())["verdict"] == "FAILED"
