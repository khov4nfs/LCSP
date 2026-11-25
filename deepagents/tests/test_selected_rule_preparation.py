"""Provider-free native graph proof for selected Preparation execution and instruction refresh."""
import asyncio
import json
from hashlib import sha256
from types import SimpleNamespace

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

import instruction_source_inventory
import runtime_instruction_bundle as instructions
from rule_set_preparation import selected_rule
from tools.common.capabilities.platform.api_client import WorkerCallbackError

pytestmark = pytest.mark.production_instruction_bundle


class SelectedFixtureModel(BaseChatModel):
    calls: list = Field(default_factory=list)
    profile: dict[str, int] = {"max_output_tokens": 65536}

    @property
    def _llm_type(self):
        return "selected-preparation-provider-free-fixture"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.calls.append(messages)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="", tool_calls=[{
            "name": "SelectedPreparationRuleResult", "id": "fixture-result",
            "args": {"analysis": "Fixture result for only the selected canonical rule", "legalRequirements": [], "assessmentRules": []},
        }]))])


class SelectedFixtureApi:
    def __init__(self):
        self.claims = []
        self.receipts = []
        self.completions = []
        self.duplicate = False
        self.reject_output = False
        self.ambiguous = False

    def claim_selected_rule_preparation(self, run_id):
        self.claims.append(run_id)
        if self.duplicate:
            raise WorkerCallbackError("duplicate claim", status_code=409)
        return {"preparationRunId": run_id, "resultId": f"result-{run_id}", "revision": 2,
                "input": {"ruleId": "selected-canonical-rule", "title": "Only the selected fixture rule", "citations": []}}

    def record_selected_rule_instructions(self, run_id, receipt):
        self.receipts.append((run_id, receipt))
        return {"recorded": True}

    def complete_selected_rule_preparation(self, run_id, state, output, failure_code):
        self.completions.append((run_id, state, output, failure_code))
        if self.ambiguous:
            raise WorkerCallbackError("ambiguous callback", status_code=503)
        if self.reject_output and state == "SUCCEEDED":
            raise WorkerCallbackError("invalid output", status_code=422)
        return {"resultId": f"result-{run_id}"}


@pytest.fixture
def runtime_assets(tmp_path, monkeypatch):
    monkeypatch.setattr(instruction_source_inventory, "ROOT", tmp_path)
    monkeypatch.setattr(selected_rule, "MODEL_GOVERNANCE_MIDDLEWARE", [])
    monkeypatch.setattr(selected_rule, "publish_agent_stream_event", lambda *args, **kwargs: None)
    candidate = tmp_path / "instructions/candidates/r1"
    candidate.mkdir(parents=True)
    asset = candidate / "preparation.selected.txt"
    asset.write_text("Instruction snapshot one", encoding="utf-8")
    instructions.clear_runtime_bundle_cache()
    yield asset
    instructions.clear_runtime_bundle_cache()


def test_native_selected_graph_refreshes_instruction_cache_and_processes_only_one_rule(runtime_assets):
    old_process_view = instructions.production_runtime_bundle()
    runtime_assets.write_text("Instruction snapshot two", encoding="utf-8")
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    result = selected_rule.run_selected_rule_preparation(api, "run-selected", model=model)
    assert result == {"state": "SUCCEEDED", "resultId": "result-run-selected"}
    assert api.claims == ["run-selected"]
    assert len(model.calls) == 1
    assert [message.content for message in model.calls[0] if isinstance(message, SystemMessage)] == ["Instruction snapshot two"]
    assert "selected-canonical-rule" in model.calls[0][-1].content
    assert api.receipts[0][1]["fingerprint"] == sha256(b"Instruction snapshot two").hexdigest()
    assert api.receipts[0][1]["content"] == "Instruction snapshot two"
    assert api.completions[0][0:2] == ("run-selected", "SUCCEEDED")
    # Fresh selected snapshots do not replace another invocation's process-cached view.
    assert instructions.production_runtime_bundle() is old_process_view
    assert old_process_view.instruction("preparation.selected") == "Instruction snapshot one"


def test_each_regeneration_picks_up_new_instruction_bytes(runtime_assets):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    selected_rule.run_selected_rule_preparation(api, "run-one", model=model)
    runtime_assets.write_text("Changed instruction for regeneration", encoding="utf-8")
    selected_rule.run_selected_rule_preparation(api, "run-two", model=model)
    assert len(model.calls) == 2
    assert api.receipts[0][1]["fingerprint"] != api.receipts[1][1]["fingerprint"]
    assert api.receipts[0][1]["revision"] != api.receipts[1][1]["revision"]


def test_duplicate_delivery_never_constructs_or_invokes_another_model(runtime_assets):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    api.duplicate = True
    assert selected_rule.run_selected_rule_preparation(api, "already-claimed", model=model) == {"state": "ALREADY_CLAIMED"}
    assert not model.calls and not api.receipts and not api.completions


def test_missing_instruction_fails_only_claimed_item_before_model_work(runtime_assets):
    runtime_assets.unlink()
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    assert selected_rule.run_selected_rule_preparation(api, "missing-instruction", model=model)["state"] == "FAILED"
    assert not model.calls
    assert api.completions[0][0:2] == ("missing-instruction", "FAILED")


def test_rejected_result_settles_item_failure_without_a_second_model_call(runtime_assets):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    api.reject_output = True
    assert selected_rule.run_selected_rule_preparation(api, "rejected-result", model=model)["state"] == "FAILED"
    assert len(model.calls) == 1
    assert [entry[1] for entry in api.completions] == ["SUCCEEDED", "FAILED"]


def test_ambiguous_completion_never_rewrites_success_or_reruns_the_model(runtime_assets):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    api.ambiguous = True
    with pytest.raises(WorkerCallbackError):
        selected_rule.run_selected_rule_preparation(api, "uncertain-callback", model=model)
    assert len(model.calls) == 1
    assert len(api.completions) == 1 and api.completions[0][1] == "SUCCEEDED"


def test_selected_snapshot_is_fixed_for_the_entire_invocation(runtime_assets):
    with instructions.runtime_instruction_snapshot() as pinned:
        first = pinned.instruction("preparation.selected")
        runtime_assets.write_text("Concurrent instruction edit", encoding="utf-8")
        assert instructions.production_runtime_bundle().instruction("preparation.selected") == first
    with instructions.runtime_instruction_snapshot() as new:
        assert new.instruction("preparation.selected") == "Concurrent instruction edit"


def test_invalid_source_claim_stops_before_instruction_load_or_model_work(runtime_assets, monkeypatch):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    monkeypatch.setattr(api, "claim_selected_rule_preparation", lambda run_id: {"refused": True, "resultId": "refused-result", "failureCode": "LEGAL_RULE_SOURCE_INELIGIBLE"})
    result = selected_rule.run_selected_rule_preparation(api, "invalid-source", model=model)
    assert result["state"] == "FAILED"
    assert not model.calls and not api.receipts and not api.completions


def test_existing_boundary_routes_selected_identity_without_running_whole_source(runtime_assets, monkeypatch):
    from types import SimpleNamespace
    from rule_set_preparation.boundary import RuleSetPreparationBoundary

    calls = []
    monkeypatch.setattr(selected_rule, "run_selected_rule_preparation", lambda api, run_id: calls.append((api, run_id)) or {"state": "SUCCEEDED"})
    config = SimpleNamespace(nestjs_api_base_url="http://api.invalid", worker_api_key="fixture")
    boundary = RuleSetPreparationBoundary(config, api_client="selected-api", runner=lambda *_: pytest.fail("unselected whole-source work must not run"))
    result = boundary.handle({"preparationRunId": "selected-run", "preparationRuleResultId": "selected-result"}, "correlation")
    assert result["state"] == "SUCCEEDED"
    assert calls == [("selected-api", "selected-run")]


def test_deadline_cancels_active_stream_and_settles_failure_once(runtime_assets, monkeypatch):
    cancelled = []
    events = []

    async def waiting_stream(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    monkeypatch.setattr(selected_rule, "create_agent", lambda **kwargs: SimpleNamespace(ainvoke=waiting_stream))
    monkeypatch.setattr(selected_rule, "llm_provider_timeout_seconds", lambda: 0.02)
    monkeypatch.setattr(selected_rule, "publish_agent_stream_event", lambda *args, **kwargs: events.append(kwargs))
    api = SelectedFixtureApi()
    result = selected_rule.run_selected_rule_preparation(api, "slow-stream", model=SelectedFixtureModel())
    assert cancelled == [True]
    assert result["state"] == "FAILED"
    assert api.completions == [("slow-stream", "FAILED", None, "SELECTED_RULE_PREPARATION_FAILED")]
    assert events[-1]["data"]["error_type"] == "TimeoutError"


def test_provider_failure_preserves_safe_code_without_logging_body(runtime_assets, monkeypatch, caplog):
    class OverloadedError(Exception):
        body = {"error": {"type": "overloaded_error", "message": "secret-provider-body"}}

    async def overloaded_stream(*args, **kwargs):
        try:
            raise OverloadedError("secret-provider-body")
        except OverloadedError as cause:
            raise RuntimeError("secret-wrapper-message") from cause

    events = []
    monkeypatch.setattr(selected_rule, "create_agent", lambda **kwargs: SimpleNamespace(ainvoke=overloaded_stream))
    monkeypatch.setattr(selected_rule, "publish_agent_stream_event", lambda *args, **kwargs: events.append(kwargs))
    api = SelectedFixtureApi()
    result = selected_rule.run_selected_rule_preparation(api, "overloaded", model=SelectedFixtureModel())
    assert result["state"] == "FAILED"
    assert len(api.completions) == 1
    assert events[-1]["data"]["provider_error_code"] == "overloaded_error"
    assert "overloaded_error" in caplog.text
    assert "secret-provider-body" not in caplog.text
    assert "secret-wrapper-message" not in caplog.text
