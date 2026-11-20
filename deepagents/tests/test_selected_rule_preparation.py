"""Provider-free native graph proof for selected Preparation execution and instruction refresh."""
import asyncio
import json
from types import SimpleNamespace

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

import instruction_source_inventory
import runtime_instruction_bundle as instructions
from rule_set_preparation import selected_rule
from tools.common.capabilities.platform.api_client import (
    SELECTED_RULE_INVALID_CALLBACK,
    SELECTED_RULE_INVALID_RESULT,
    WorkerCallbackError,
)
from tools.common.capabilities.platform.correlation import get_correlationId

pytestmark = pytest.mark.production_instruction_bundle


class SelectedFixtureModel(BaseChatModel):
    calls: list = Field(default_factory=list)

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
        self.reject_output = None
        self.validations = []
        self.draft_rejections = []

    def validate_selected_rule_output(self, run_id, output):
        self.validations.append((run_id, output))
        if self.draft_rejections:
            raise self.draft_rejections.pop(0)
        return {"valid": True}

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
        if self.reject_output and state == "SUCCEEDED":
            raise self.reject_output
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
    source = tmp_path / "instructions/vi"
    source.mkdir(parents=True)
    (source / "preparation-selected.md").write_text("Hướng dẫn gốc", encoding="utf-8")
    (tmp_path / "instructions/inventory.json").write_text(json.dumps({
        "schemaVersion": "LCSP_EN_RUNTIME_BUNDLE_V1",
        "bundleId": "test-live-instructions",
        "requiredSourceIds": ["preparation.selected"],
        "entries": [{
            "sourceId": "preparation.selected",
            "vietnameseSourcePath": "instructions/vi/preparation-selected.md",
            "englishCandidatePath": "instructions/candidates/r1/preparation.selected.txt",
        }],
    }), encoding="utf-8")
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
    assert "fingerprint" not in api.receipts[0][1]
    assert "bundleFingerprint" not in api.receipts[0][1]
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
    assert api.receipts[0][1]["content"] != api.receipts[1][1]["content"]
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


@pytest.mark.parametrize("status,code", [(422, SELECTED_RULE_INVALID_RESULT), (400, SELECTED_RULE_INVALID_CALLBACK)])
def test_rejected_result_settles_item_failure_without_a_second_model_call(runtime_assets, status, code):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    api.reject_output = WorkerCallbackError("invalid output", status_code=status, error_code=code)
    assert selected_rule.run_selected_rule_preparation(api, "rejected-result", model=model)["state"] == "FAILED"
    assert len(model.calls) == 1
    assert [entry[1] for entry in api.completions] == ["SUCCEEDED", "FAILED"]
    assert api.completions[-1][2:] == (None, "SELECTED_RULE_PREPARATION_FAILED")


@pytest.mark.parametrize("status,code", [(None, None), (503, None), (409, None), (400, None), (422, None)])
def test_unconfirmed_completion_never_rewrites_success_or_reruns_the_model(runtime_assets, status, code):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    api.reject_output = WorkerCallbackError("unconfirmed callback", status_code=status, error_code=code)
    with pytest.raises(WorkerCallbackError) as raised:
        selected_rule.run_selected_rule_preparation(api, "uncertain-callback", model=model)
    assert raised.value is api.reject_output
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
    previous_correlation = get_correlationId()

    def run(api, run_id):
        calls.append((api, run_id, get_correlationId()))
        return {"state": "SUCCEEDED"}

    monkeypatch.setattr(selected_rule, "run_selected_rule_preparation", run)
    config = SimpleNamespace(nestjs_api_base_url="http://api.invalid", worker_api_key="fixture")
    boundary = RuleSetPreparationBoundary(config, api_client="selected-api", runner=lambda *_: pytest.fail("unselected whole-source work must not run"))
    result = boundary.handle({"preparationRunId": "selected-run", "preparationRuleResultId": "selected-result"}, "correlation")
    assert result["state"] == "SUCCEEDED"
    assert calls == [("selected-api", "selected-run", "correlation")]
    assert get_correlationId() == previous_correlation


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
    assert "cause_types=OverloadedError" in caplog.text
    assert "secret-provider-body" not in caplog.text
    assert "secret-wrapper-message" not in caplog.text


class RepairingFixtureModel(SelectedFixtureModel):
    """Returns an invalid draft first and a corrected draft once the rejection feedback arrives."""

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.calls.append(messages)
        repaired = any("rejected by structural validation" in str(getattr(m, "content", "")) for m in messages)
        analysis = "corrected" if repaired else "draft"
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="", tool_calls=[{
            "name": "SelectedPreparationRuleResult", "id": f"fixture-{analysis}",
            "args": {"analysis": analysis, "legalRequirements": [], "assessmentRules": []},
        }]))])


def _rejection(paths=("output.legalRequirements.0.legalRequirementId",)):
    return WorkerCallbackError("invalid output", status_code=422, error_code=SELECTED_RULE_INVALID_RESULT, issue_paths=tuple(paths))


def test_structurally_invalid_draft_is_repaired_once_before_settlement(runtime_assets):
    api, model = SelectedFixtureApi(), RepairingFixtureModel()
    api.draft_rejections = [_rejection()]
    assert selected_rule.run_selected_rule_preparation(api, "repairable", model=model)["state"] == "SUCCEEDED"
    assert len(model.calls) == 2
    feedback = model.calls[1][-1].content
    assert "output.legalRequirements.0.legalRequirementId" in feedback
    assert "selected-canonical-rule:" in feedback
    assert "applicabilityMode is UNCONDITIONAL" in feedback
    assert "requires an empty condition list and source support" in feedback
    # Only the corrected draft is persisted; the invalid draft never settles as FAILED.
    assert [(entry[1], entry[2]["analysis"]) for entry in api.completions] == [("SUCCEEDED", "corrected")]


def test_valid_draft_costs_no_extra_model_call(runtime_assets):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    assert selected_rule.run_selected_rule_preparation(api, "valid-draft", model=model)["state"] == "SUCCEEDED"
    assert len(model.calls) == 1 and len(api.validations) == 1


def test_repair_is_bounded_and_final_rejection_still_fails_the_item(runtime_assets):
    api, model = SelectedFixtureApi(), RepairingFixtureModel()
    api.draft_rejections = [_rejection(), _rejection()]
    api.reject_output = WorkerCallbackError("invalid output", status_code=422, error_code=SELECTED_RULE_INVALID_RESULT)
    assert selected_rule.run_selected_rule_preparation(api, "still-invalid", model=model)["state"] == "FAILED"
    assert len(model.calls) == 2
    assert [entry[1] for entry in api.completions] == ["SUCCEEDED", "FAILED"]


def test_inconclusive_dry_run_settles_without_repair(runtime_assets):
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    api.draft_rejections = [WorkerCallbackError("unavailable", status_code=503)]
    assert selected_rule.run_selected_rule_preparation(api, "dry-run-down", model=model)["state"] == "SUCCEEDED"
    assert len(model.calls) == 1


def test_repair_can_be_disabled(runtime_assets, monkeypatch):
    monkeypatch.setenv("LCSP_SELECTED_RULE_MAX_REPAIRS", "0")
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    api.draft_rejections = [_rejection()]
    selected_rule.run_selected_rule_preparation(api, "no-repair", model=model)
    assert len(model.calls) == 1 and not api.validations


def test_no_repair_when_too_little_deadline_remains(runtime_assets, monkeypatch):
    monkeypatch.setattr(selected_rule, "llm_provider_timeout_seconds", lambda: 5)
    api, model = SelectedFixtureApi(), SelectedFixtureModel()
    api.draft_rejections = [_rejection()]
    selected_rule.run_selected_rule_preparation(api, "short-deadline", model=model)
    assert len(model.calls) == 1
