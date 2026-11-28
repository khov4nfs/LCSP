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


class GovernedSelectedFixtureModel(BaseChatModel):
    calls: list = Field(default_factory=list)
    provider: str = "anthropic"
    protocol: str = "anthropic"
    model_name: str = "claude-sonnet-4-6"
    profile: dict[str, int] = {"max_output_tokens": 4096, "context_window_tokens": 1000000}

    @property
    def _llm_type(self):
        return "governed-selected-fixture"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.calls.append(messages)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="", tool_calls=[{
            "name": "SelectedPreparationRuleResult", "id": "fixture-result",
            "args": {"analysis": "Governed fixture result", "legalRequirements": [], "assessmentRules": []},
        }]))])


class GovernedSelectedFixtureApi(SelectedFixtureApi):
    def __init__(self, *, admission_error: Exception | None = None):
        super().__init__()
        self.admissions: list[dict] = []
        self.consumes: list[dict] = []
        self.admission_error = admission_error

    def request_invocation_admission(self, payload: dict) -> dict:
        self.admissions.append(payload)
        if self.admission_error:
            raise self.admission_error
        return {
            "admissionId": "adm-selected-001",
            "invocationId": "inv-selected-001",
            "capabilityToken": "cap-selected-001",
            "state": "ADMITTED",
        }

    def consume_invocation_admission(self, payload: dict) -> dict:
        self.consumes.append(payload)
        return {"consumed": True}


@pytest.fixture
def governed_runtime_assets(runtime_assets, tmp_path, monkeypatch):
    """Reuse complete instruction assets while preserving real model governance."""
    from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
    from middleware.usage_metering import UsageMeteringMiddleware
    from tests.conftest import use_model_routes
    use_model_routes(
        monkeypatch,
        {
            "routes": {
                "primary": {
                    "provider": "anthropic",
                    "protocol": "anthropic",
                    "model": "claude-sonnet-4-6",
                    "options": {"context_window_tokens": 1000000, "max_output_tokens": 4096},
                },
            },
            "roles": {"default": "primary", "rule-set-preparation": "primary"},
        },
    )
    # Why: The governed fixture needs the same inventory and source files as the
    # ordinary fixture; changing ROOT to an empty directory fails before admission.
    # The metering middleware caches its recovery store, so a fresh instance must
    # accompany each test's own SQLite path while all governance layers stay active.
    governed_middleware = (*MODEL_GOVERNANCE_MIDDLEWARE[:-1], UsageMeteringMiddleware())
    monkeypatch.setattr(selected_rule, "MODEL_GOVERNANCE_MIDDLEWARE", governed_middleware)
    # Each physical admission needs its own durable recovery database so reused
    # fixture IDs cannot collide across otherwise independent tests.
    monkeypatch.setenv("WORKER_RECOVERY_DB_PATH", str(tmp_path / "worker_recovery.db"))
    runtime_assets.write_text("Governed instruction snapshot", encoding="utf-8")
    instructions.clear_runtime_bundle_cache()
    yield runtime_assets
    instructions.clear_runtime_bundle_cache()


def test_selected_rule_fails_closed_zero_provider_calls_when_admission_denied(governed_runtime_assets, caplog):
    """Proves RED/Fail-closed: when server admission fails (402/409/403), zero provider calls occur."""
    api = GovernedSelectedFixtureApi(
        admission_error=WorkerCallbackError("concurrency limit exceeded", status_code=409)
    )
    model = GovernedSelectedFixtureModel()
    result = selected_rule.run_selected_rule_preparation(api, "run-denied-01", model=model)
    assert result["state"] == "FAILED"
    assert len(model.calls) == 0, "Provider model must NEVER be called when admission fails"
    assert len(api.admissions) == 1, "Admission must be requested before provider dispatch"
    assert api.admissions[0]["preparationRunId"] == "run-denied-01"
    assert len(api.consumes) == 0, "Consume CAS must not run when admission request failed"


def test_selected_rule_governed_admission_succeeds_with_server_context(governed_runtime_assets):
    """Proves G-06: Selected rule preparation dispatches provider call ONLY after server admission & consume."""
    api = GovernedSelectedFixtureApi()
    model = GovernedSelectedFixtureModel()
    result = selected_rule.run_selected_rule_preparation(api, "run-success-01", model=model)
    assert result["state"] == "SUCCEEDED"
    assert len(api.admissions) == 1, "Must request server admission"
    assert api.admissions[0]["preparationRunId"] == "run-success-01"
    assert api.admissions[0]["agentRole"] == "rule-set-preparation"
    assert len(api.consumes) == 1, "Must commit capability token to IN_FLIGHT via CAS"
    assert api.consumes[0]["admissionId"] == "adm-selected-001"
    assert api.consumes[0]["invocationId"] == "inv-selected-001"
    assert len(model.calls) == 1, "Provider model called exactly once after CAS consume"
    assert api.completions[0][0:2] == ("run-success-01", "SUCCEEDED")


def test_selected_rule_boundary_e2e_governed_admission_and_completion(governed_runtime_assets, monkeypatch):
    """Proves G-06 End-to-End: RuleSetPreparationBoundary.handle() -> run_selected_rule_preparation() -> admission -> consume -> completion."""
    from types import SimpleNamespace
    from rule_set_preparation.boundary import RuleSetPreparationBoundary

    api = GovernedSelectedFixtureApi()
    model = GovernedSelectedFixtureModel()
    monkeypatch.setattr(selected_rule, "resolve_agent_model", lambda role: model)

    config = SimpleNamespace(nestjs_api_base_url="http://api.test", worker_api_key="key")
    boundary = RuleSetPreparationBoundary(
        config,
        api_client=api,
        runner=lambda *_: pytest.fail("Must not run whole-source runner"),
    )

    message = {
        "preparationRunId": "run-bnd-01",
        "preparationRuleResultId": "res-bnd-01",
    }
    result = boundary.handle(message, "corr-bnd-01")

    assert result["state"] == "SUCCEEDED"
    assert result["resultId"] == "result-run-bnd-01"

    # Step 1: Claim initiated by boundary
    assert api.claims == ["run-bnd-01"]
    # Step 2: Instructions recorded
    assert len(api.receipts) == 1
    assert api.receipts[0][0] == "run-bnd-01"
    # Step 3: Admission requested BEFORE provider dispatch
    assert len(api.admissions) == 1
    assert api.admissions[0]["preparationRunId"] == "run-bnd-01"
    assert api.admissions[0]["agentRole"] == "rule-set-preparation"
    # Step 4: CAS Consume committed BEFORE model generates output
    assert len(api.consumes) == 1
    assert api.consumes[0]["admissionId"] == "adm-selected-001"
    # Step 5: Model executed exactly once
    assert len(model.calls) == 1
    # Step 6: Completion persisted to API
    assert len(api.completions) == 1
    assert api.completions[0][0:2] == ("run-bnd-01", "SUCCEEDED")


def test_selected_rule_boundary_fails_closed_zero_provider_calls_on_admission_error(
    governed_runtime_assets, monkeypatch
):
    """Proves G-06 Fail-Closed: Boundary halts before model call when server admission is denied."""
    from types import SimpleNamespace
    from rule_set_preparation.boundary import RuleSetPreparationBoundary

    api = GovernedSelectedFixtureApi(
        admission_error=WorkerCallbackError("concurrency limit exceeded", status_code=409)
    )
    model = GovernedSelectedFixtureModel()
    monkeypatch.setattr(selected_rule, "resolve_agent_model", lambda role: model)

    config = SimpleNamespace(nestjs_api_base_url="http://api.test", worker_api_key="key")
    boundary = RuleSetPreparationBoundary(
        config,
        api_client=api,
        runner=lambda *_: pytest.fail("Must not run whole-source runner"),
    )

    message = {
        "preparationRunId": "run-bnd-denied",
        "preparationRuleResultId": "res-bnd-denied",
    }
    result = boundary.handle(message, "corr-bnd-denied")

    assert result["state"] == "FAILED"
    assert len(model.calls) == 0, "Provider model must NEVER be called when admission fails"
    assert len(api.admissions) == 1
    assert api.admissions[0]["preparationRunId"] == "run-bnd-denied"
    assert len(api.consumes) == 0, "Consume CAS must not run when admission failed"
    assert len(api.completions) == 1
    assert api.completions[0][0:2] == ("run-bnd-denied", "FAILED")
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
