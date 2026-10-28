"""Provider-free tests of the production Rule Set Preparation agent wiring."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

INSTRUCTIONS = "\n".join((Path(__file__).parents[1] / "rule_set_preparation" / name).read_text()
    for name in ("instructions-common.md", "instructions-discovery.md", "instructions-authoring.md"))



from deepagents.backends.filesystem import FilesystemBackend
from langchain_core.messages import AIMessage, ToolMessage
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.usage_metering import AgentRoleMiddleware
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream
import rule_set_preparation.agent as preparation_agent
from rule_set_preparation.agent import (
    PreparationObservationMiddleware,
    _without_general_purpose_subagent,
    create_rule_set_preparation_agent,
)
from rule_set_preparation.legal_source_files import INDEX_PATH, materialize_legal_source
from rule_set_preparation.runner import (
    MODEL_ERROR,
    NO_SUBMISSION,
    SOURCE_VERSION_UNAVAILABLE,
    run_rule_set_preparation,
)
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from legal_graph_fixture import document_graph_for_bundle
from test_rule_set_preparation_native_isolation_preparation import (
    RuleSetPreparationScriptedModel,
)

RUN_ID = "11111111-1111-4111-8111-111111111111"
LEGAL_SOURCE_ID = "22222222-2222-4222-8222-222222222222"
DOC = "SYNTHETIC-NOTICE-INSTRUMENT"


@pytest.fixture(autouse=True)
def _legacy_packet_unit_tools(monkeypatch):
    """Keep pre-inventory packet/provider regressions as unit tests of the retained legacy adapter.

    New production graph/phase wiring is exercised without this adapter in test_claim_inventory_protocol.
    """
    original = preparation_agent.build_rule_set_tools
    def legacy_tools(context):
        graph = context.source_graph
        context.inventory = None
        context.source_graph = None
        try:
            return original(context)
        finally:
            context.source_graph = graph
    monkeypatch.setattr(preparation_agent, "build_rule_set_tools", legacy_tools)
    from langchain_core.messages import SystemMessage
    monkeypatch.setattr(preparation_agent.PreparationPhaseMiddleware, "_request", lambda self, request:
        request.override(system_message=SystemMessage(content=preparation_agent.phase_instructions(self.context))))
    monkeypatch.setattr(preparation_agent, "preparation_filesystem", lambda backend, **kw:
        __import__("rule_set_preparation.agent", fromlist=["FilesystemMiddleware"]).FilesystemMiddleware(
            backend=backend, tools=preparation_agent.READ_ONLY_TOOLS,
            _permissions=[preparation_agent.FilesystemPermission(["read"], ["/legal-source", "/legal-source/**"], mode="allow"),
                preparation_agent.FilesystemPermission(["read", "write"], ["/**"], mode="deny")]))
    from rule_set_preparation.review_frontier import ReviewFrontier
    monkeypatch.setattr(ReviewFrontier, "restore", lambda self, **kw: None)



@pytest.fixture(autouse=True)
def _fast_model_retry_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the retry behavior under test but not its real exponential sleeps."""
    from langchain.agents.middleware import ModelRetryMiddleware
    from middleware import usage_metering
    from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE

    for middleware in MODEL_GOVERNANCE_MIDDLEWARE:
        if isinstance(middleware, ModelRetryMiddleware):
            monkeypatch.setattr(middleware, "initial_delay", 0.0)
            monkeypatch.setattr(middleware, "max_delay", 0.0)
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda model, response=None:
                        None if isinstance(model, RuleSetPreparationScriptedModel)
                        else original(model, response))








def _sha(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def _bundle() -> dict[str, Any]:
    chunks = [
        ("art-1::cl-1", "Records must be retained for five years."),
        ("art-2::cl-1", "Retention does not apply to anonymised records."),
    ]
    bundle = {
        "preparationRunId": RUN_ID,
        "executionState": "RUNNING",
        "claimInventoryRevision": 1, "claimPhase": "CLAIM_DISCOVERY", "frozenInventory": None,
        "legalSourceVersionId": LEGAL_SOURCE_ID,
        "legalSourceVersion": "SYNTHETIC-LEGAL_SOURCE-V1",
        "documents": [
            {
                "documentId": DOC,
                "title": "Synthetic notice",
                "sourceUrl": "https://example.invalid/notice",
                "sourceSha256": _sha("notice"),
                "sourceEffectStatus": "IN_FORCE",
                "chunks": [
                    {
                        "chunkId": f"chunk-{locator}",
                        "locator": locator,
                        "content": text,
                        "contentSha256": _sha(text),
                        "legalStatus": "IN_FORCE",
                        "legalEffectStatus": "EFFECTIVE",
                        "legalStatusSourceRef": "source-metadata:fixture",
                        "hierarchy": {"path": locator.split("::")},
                    }
                    for locator, text in chunks
                ],
            }
        ],
    }
    bundle["documentGraph"] = document_graph_for_bundle(bundle)
    return bundle


def _ref(locator: str, text: str) -> dict[str, str]:
    return {"documentId": DOC, "locator": locator, "contentSha256": _sha(text)}


def _packet() -> dict[str, Any]:
    retain = "Records must be retained for five years."
    anonymised = "Retention does not apply to anonymised records."
    return {
        "legalRequirements": [
            {
                "legalRequirementId": "LR-RET",
                "title": "Retention",
                "proposition": retain,
                "applicabilityConditions": ["Applies to an operator that keeps records."],
                "qualifiers": [],
                "exceptions": [anonymised],
                "nonRepositoryDuty": False,
                "sourceRefs": [_ref("art-1::cl-1", retain)],
                "coverage": {"state": "COVERED_BY_ASSESSMENT_RULES", "nonAssessableReason": None},
            }
        ],
        "assessmentRules": [
            {
                "assessmentRuleId": "ER-RET",
                "legalRequirementIds": ["LR-RET"],
                "concept": "Retention",
                "legalIntent": "Records are kept five years.",
                "applicabilityGuidance": "Applies to stored records.",
                "criteria": [{"criterionId": "C-1", "statement": "A five year retention period exists."}],
                "investigationGoals": [], "startingNodeTypes": [], "targetNodeTypes": [],
                "edgeStrategies": [], "graphQueries": [], "keywords": [], "commonApis": [],
                "commonLibraries": [], "patterns": [], "requiredEvidence": [],
                "supportingEvidence": [], "negativeEvidence": [], "unresolvedConditions": [],
                "sourceRefs": [_ref("art-1::cl-1", retain)],
            }
        ],
        "contextRelations": [
            {
                "relationId": "REL-1",
                "kind": "EXCEPTION",
                "fromLegalRequirementId": "LR-RET",
                "toLegalRequirementId": None,
                "toSourceRef": _ref("art-2::cl-1", anonymised),
            }
        ],
    }


def _call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


class FakeApi:
    """Records every call; returns what the real API returns for a valid packet."""

    def __init__(self, *, claim_error: Exception | None = None, outcome: str = "PASSED") -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.claim_error = claim_error
        self.outcome = outcome

    def claim_rule_set_preparation(self, run_id: str) -> dict:
        self.calls.append(("claim", (run_id,)))
        if self.claim_error:
            raise self.claim_error
        return _bundle()

    def validate_compliance_rule_set(self, run_id: str, packet: dict) -> dict:
        self.calls.append(("validate", (run_id, packet)))
        return {"outcome": "PASSED", "failures": []}

    def submit_compliance_rule_set(self, run_id: str, key: str, packet: dict) -> dict:
        self.calls.append(("submit", (run_id, key, packet)))
        failed = self.outcome != "PASSED"
        return {
            "preparationRunId": run_id,
            "lifecycleState": "INVALID" if failed else "ACTIVE",
            "validation": {
                "outcome": self.outcome,
                "failures": [{"code": "DUPLICATE_RULE_ID", "ref": "legalRequirement:LR-RET", "detail": None}] if failed else [],
            },
        }

    def fail_rule_set_preparation(self, run_id: str, reason: str) -> dict:
        self.calls.append(("fail", (run_id, reason)))
        return {"preparationRunId": run_id, "executionState": "FAILED"}

    def names(self) -> list[str]:
        return [name for name, _ in self.calls]


def _model(responses: list[AIMessage]) -> RuleSetPreparationScriptedModel:
    return RuleSetPreparationScriptedModel(responses=list(responses))


def _tool_messages(model: RuleSetPreparationScriptedModel) -> dict[str, ToolMessage]:
    found: dict[str, ToolMessage] = {}
    for prompt in model.prompts:
        for message in prompt:
            if isinstance(message, ToolMessage):
                found[message.tool_call_id] = message
    return found


def test_rule_set_tools_expose_required_nested_contract_to_the_provider() -> None:
    from langchain_core.utils.function_calling import convert_to_openai_tool
    from langchain_google_genai import ChatGoogleGenerativeAI

    tools = build_rule_set_tools(RuleSetPreparationContext(RUN_ID, FakeApi()))
    # Binding exercises Gemini's schema conversion without a provider request.
    ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", api_key="fixture").bind_tools(tools)
    for tool in tools:
        schema = convert_to_openai_tool(tool)["function"]["parameters"]
        if tool.name == "report_rule_set_source_blocked":
            assert schema["properties"]["reason"]["enum"] == ["SOURCE_UNREADABLE", "SOURCE_PINS_INCONSISTENT"]
            continue
        if tool.name == "remove_from_packet_draft":
            continue
        if tool.name == "record_preparation_progress":
            assert set(schema["required"]) == {
                "establishedFindings",
                "unresolvedMaterialWork",
                "currentTarget",
                "intendedAction",
                "expectedInformationGain",
            }
            continue
        if tool.name in {"validate_compliance_rule_set", "submit_compliance_rule_set"}:
            # The item contracts are carried once, by the draft tool; the packet argument is optional.
            assert "required" not in schema and schema["properties"]["packet"]["type"] == "object"
            assert "properties" not in schema["properties"]["packet"]
            continue
        # A draft part carries the very same item contracts as a packet, with every section optional.
        assert tool.name == "add_to_packet_draft" and "required" not in schema
        packet = {"properties": schema["properties"]}
        assert "Operative duties, prohibitions or permissions only" in packet["properties"]["legalRequirements"]["description"]
        assert "Source coverage does not require a LegalRequirement for every provision" in packet["properties"]["legalRequirements"]["description"]
        legal = packet["properties"]["legalRequirements"]["items"]
        assert "software record of an action does not establish performance" in legal["properties"]["nonRepositoryDuty"]["description"]
        coverage = legal["properties"]["coverage"]
        assert set(coverage["required"]) == {"state", "nonAssessableReason"}
        assert coverage["type"] == "object"
        assert "oneOf" not in coverage and "anyOf" not in coverage
        assert "NON_ASSESSABLE requires none" in coverage["properties"]["state"]["description"]
        engineering = packet["properties"]["assessmentRules"]["items"]
        assert "never reference a LegalRequirement declared NON_ASSESSABLE" in engineering["properties"]["legalRequirementIds"]["description"]
        assert {"assessmentRuleId", "criteria", "supportingEvidence"} <= set(engineering["required"])
        assert engineering["properties"]["sourceRefs"]["default"] == []
        assert "applicabilityGuidance" not in engineering["required"]
        assert "server derives guidance" in engineering["properties"]["applicabilityGuidance"]["description"]
        assert "legalIntent" not in engineering["required"]
        assert "unresolvedConditions" not in engineering["required"]
        assert "zero-based index" in engineering["properties"]["unresolvedConditionBindings"]["description"]
        assert "directed context dependency" in engineering["properties"]["contextRelationIds"]["description"]
        criterion = engineering["properties"]["criteria"]["items"]
        assert "statement" not in criterion["required"]
        assert "Required for new authoring" in criterion["properties"]["legalRequirementIds"]["description"]
        assert "complete normative statement" in criterion["properties"]["statement"]["description"]
        assert "replacement legal predicate" in criterion["properties"]["investigationFocus"]["description"]
        relation = packet["properties"]["contextRelations"]["items"]
        assert {"toLegalRequirementId", "toSourceRef"} <= set(relation["required"])
        assert "independently operative LegalRequirement only" in relation["properties"]["toLegalRequirementId"]["description"]
        assert "context-only definition" in relation["properties"]["toSourceRef"]["description"]


def test_legal_source_files_carry_exact_citation_headers_and_only_the_pinned_legal_source(tmp_path: Path) -> None:
    from rule_set_preparation.source_graph import PinnedSourceGraph
    bundle = _bundle()
    paths = materialize_legal_source(bundle, tmp_path)
    source = PinnedSourceGraph(bundle['documentGraph'], [c for d in bundle['documents'] for c in d['chunks']])
    assert paths[0] == INDEX_PATH
    for path, ids in source.source_files.items():
        text = (tmp_path / path.lstrip('/')).read_text()
        for nid in ids:
            assert text.count('[' + source.locators[nid] + ']') == 1
            assert source.nodes[nid]['content'] in text
    index = (tmp_path / 'legal-source/INDEX.md').read_text()
    assert DOC in index and 'Immutable file hashes' in index
    assert not (tmp_path / 'legal-source/nodes').exists()


def test_agent_has_only_read_only_legal_source_tools_and_governed_preparation_tools(tmp_path: Path) -> None:
    from test_rule_set_preparation_agent import INSTRUCTIONS

    materialize_legal_source(_bundle(), tmp_path)
    model = _model([
        _call("validate_compliance_rule_set", {"packet": _packet()}, "validate"),
        _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
        AIMessage(content="done"),
    ])
    agent = create_rule_set_preparation_agent(
        context=RuleSetPreparationContext(RUN_ID, FakeApi()), legal_source_root=tmp_path, model=model
    )
    agent.invoke({"messages": [{"role": "user", "content": "go"}]})
    bound = {name for names in model.bound_tool_names for name in names}
    assert {
        "read_file", "ls", "glob", "grep", "validate_compliance_rule_set",
        "submit_compliance_rule_set", "record_preparation_progress", "report_rule_set_source_blocked",
    } <= bound
    forbidden = {"write_file", "edit_file", "execute", "ask_human", "submit_rule_decision"}
    assert bound.isdisjoint(forbidden), bound & forbidden
    assert "task" in bound
    assert preparation_agent.phase_instructions(RuleSetPreparationContext(RUN_ID, FakeApi())) in model.prompts[0][0].content


def test_progress_ledger_advances_for_findings_not_strategy_alone() -> None:
    context = RuleSetPreparationContext(RUN_ID, FakeApi())
    tool = next(tool for tool in build_rule_set_tools(context) if tool.name == "record_preparation_progress")

    first = json.loads(tool.invoke({
        "establishedFindings": ["DOC art-1 states the retention duty"],
        "unresolvedMaterialWork": ["Resolve the linked exception"],
        "currentTarget": "DOC art-2",
        "intendedAction": "read",
        "expectedInformationGain": "Exception scope",
    }))
    strategy_change = json.loads(tool.invoke({
        "establishedFindings": ["DOC art-1 states the retention duty"],
        "unresolvedMaterialWork": ["Resolve the linked exception"],
        "currentTarget": "DOC art-3",
        "intendedAction": "read",
        "expectedInformationGain": "Cross-reference context",
    }))

    assert first["progressRevision"] == 1
    assert strategy_change["progressRevision"] == 1
    assert context.progress_state["currentTarget"] == "DOC art-3"


def test_progress_ledger_accepts_partial_arguments_without_type_error() -> None:
    context = RuleSetPreparationContext(RUN_ID, FakeApi())
    tool = next(tool for tool in build_rule_set_tools(context) if tool.name == "record_preparation_progress")

    # Calling with only establishedFindings must succeed and not raise TypeError
    res = json.loads(tool.invoke({"establishedFindings": ["DOC art-1 retained"]}))
    assert res["progressRevision"] == 1
    assert context.progress_state["establishedFindings"] == ["DOC art-1 retained"]
    assert context.progress_state["currentTarget"] == ""

    # Calling with unexpected extra keyword arguments must also succeed
    res2 = json.loads(tool.invoke({"currentTarget": "DOC art-2", "extraArg": "ignored"}))
    assert res2["progressRevision"] == 1
    assert context.progress_state["currentTarget"] == "DOC art-2"
    assert context.progress_state["establishedFindings"] == ["DOC art-1 retained"]


def test_agent_reads_validates_and_submits_once_with_server_bound_identity(tmp_path: Path) -> None:
    packet = _packet()
    responses = [
        _call("read_file", {"file_path": INDEX_PATH}, "read-index"),
        _call("validate_compliance_rule_set", {"packet": packet}, "validate-1"),
        _call("submit_compliance_rule_set", {"packet": packet}, "submit-1"),
        _call("submit_compliance_rule_set", {"packet": packet}, "submit-2"),
        AIMessage(content="RULE_SET_SUBMITTED"),
    ]
    api, model = FakeApi(), _model(responses)
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)

    assert result["state"] == "SUCCEEDED" and result["failureReason"] is None
    assert api.names() == ["claim", "validate", "submit"], api.names()
    _, (run_id, key, sent) = api.calls[2]
    assert run_id == RUN_ID
    assert key == f"rule-set-preparation-submit-{RUN_ID}"
    assert sent == packet
    messages = _tool_messages(model)
    assert "Pinned legal source 22222222-2222-4222-8222-222222222222" in messages["read-index"].content
    assert len(model.prompts) == 3  # Native graph ends at the first governed submission.


def test_pinned_source_listing_is_visible_and_agent_changes_strategy(tmp_path: Path) -> None:
    packet = _packet()
    model = _model([
        _call("ls", {"path": "/legal-source"}, "ls-first"),
        _call("ls", {"path": "/legal-source"}, "ls-repeat"),
        _call("read_file", {"file_path": INDEX_PATH}, "read-index"),
        _call("validate_compliance_rule_set", {"packet": packet}, "validate"),
        _call("submit_compliance_rule_set", {"packet": packet}, "submit"),
    ])
    result = run_rule_set_preparation(FakeApi(), RUN_ID, model=model, work_dir=tmp_path)

    assert result["state"] == "SUCCEEDED"
    messages = _tool_messages(model)
    listing = messages["ls-first"].content
    assert "INDEX.md" in listing and DOC in listing
    assert f'"pinnedLegalSourceVersionId": "{LEGAL_SOURCE_ID}"' in listing
    repeated = messages["ls-repeat"].content
    assert '"previouslyObserved": true' in repeated and '"novelty": "NONE"' in repeated
    assert "Novel information: NONE" in repeated
    assert "Novel information: NONE" in str(model.prompts[2])
    assert f"Pinned legal source {LEGAL_SOURCE_ID}" in messages["read-index"].content


def test_completion_claim_returns_gate_gaps_to_same_agent_then_submits(tmp_path: Path) -> None:
    packet = _packet()
    corrected = _packet()
    corrected["assessmentRules"][0]["legalIntent"] += " Preserve the stated exception."

    class GateApi(FakeApi):
        def validate_compliance_rule_set(self, run_id: str, candidate: dict) -> dict:
            self.calls.append(("validate", (run_id, candidate)))
            if sum(name == "validate" for name, _ in self.calls) == 1:
                return {"outcome": "FAILED", "failures": [{
                    "code": "INTEGRITY_GAP", "ref": "assessmentRule:ER-RET", "detail": "missing source-linked exception"
                }]}
            return {"outcome": "PASSED", "failures": []}

    api = GateApi()
    model = _model([
        _call("submit_compliance_rule_set", {"packet": packet}, "claim-1"),
        _call("validate_compliance_rule_set", {"packet": corrected}, "repair-check"),
        _call("submit_compliance_rule_set", {"packet": corrected}, "claim-2"),
    ])
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)

    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "validate", "submit"]
    rejected = json.loads(_tool_messages(model)["claim-1"].content)
    assert rejected["completionClaim"] == "REJECTED"
    assert rejected["gaps"]["failures"][0]["code"] == "INTEGRITY_GAP"
    assert api.calls[-1][1][-1] == corrected


@pytest.mark.parametrize("batch_size", [1, 10])
def test_agent_ignoring_no_progress_feedback_fails_only_after_feedback(tmp_path: Path, batch_size: int) -> None:
    from middleware.failure_policy import NoProgressDetected
    context = RuleSetPreparationContext(RUN_ID, FakeApi(), pinned_source_version_id=LEGAL_SOURCE_ID)
    context.inventory = SimpleNamespace(frozen={'claims': []})
    middleware = PreparationObservationMiddleware(context)
    feedback = []
    for turn in range(4):
        decision = AIMessage(content='', id=f'turn-{turn}', tool_calls=[{'name': 'ls', 'args': {'path': '/legal-source'}, 'id': f'{turn}-{i}'} for i in range(batch_size)])
        for i in range(batch_size):
            request = SimpleNamespace(tool_call=decision.tool_calls[i], state={'messages': [decision]})
            if turn == 3:
                with pytest.raises(NoProgressDetected):
                    middleware.wrap_tool_call(request, lambda _: ToolMessage(content='INDEX.md', tool_call_id=f'{turn}-{i}'))
                break
            feedback.append(middleware.wrap_tool_call(request, lambda _: ToolMessage(content='INDEX.md', tool_call_id=f'{turn}-{i}')).content)
    assert 'NO_PROGRESS' in feedback[-1]


def test_novelty_allows_changed_observations_and_state_advancement() -> None:
    from rule_set_preparation.agent import PreparationObservationMiddleware

    context = RuleSetPreparationContext(RUN_ID, FakeApi(), pinned_source_version_id=LEGAL_SOURCE_ID)
    context.inventory = SimpleNamespace(frozen={"claims": []})
    middleware = PreparationObservationMiddleware(context)

    def observe(name: str, path: str, output: str, call_id: str) -> str:
        request = SimpleNamespace(tool_call={"name": name, "args": {"path": path}})
        result = middleware.wrap_tool_call(
            request, lambda _: ToolMessage(content=output, tool_call_id=call_id)
        )
        return result.content

    first = observe("ls", "/legal-source", "child-a/", "1")
    other_path = observe("ls", "/legal-source/child-a", "a.md", "2")
    changed_result = observe("ls", "/legal-source/child-a", "a.md\nb.md", "3")
    assert '"novelty": "NEW"' in first
    assert '"novelty": "NEW"' in other_path
    assert '"novelty": "CHANGED"' in changed_result

    context.progress_revision += 1
    after_progress = observe("ls", "/legal-source/child-a", "a.md\nb.md", "4")
    assert '"progressStateAdvanced": true' in after_progress
    assert '"NO_PROGRESS"' not in after_progress


def test_managed_agent_serializes_gemini_nullable_tools_without_rewriting_packet(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from conftest import use_model_routes
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_google_genai import ChatGoogleGenerativeAI

    use_model_routes(monkeypatch, {"routes": {"primary": {"provider": "google_genai", "model": "gemini-3.5-flash-lite"}},
                                   "roles": {"default": "primary"}})

    packet = _packet()
    responses = [
        _call("validate_compliance_rule_set", {"packet": packet}, "validate"),
        _call("submit_compliance_rule_set", {"packet": packet}, "submit"),
        AIMessage(content="DONE"),
    ]
    calls = []

    def generate(model, messages, stop=None, run_manager=None, **kwargs):
        prepared = model._prepare_request(messages, stop=stop, **kwargs)
        declarations = [d for t in prepared["config"].tools for d in t.function_declarations or []]
        rule_set = next(d for d in declarations if d.name == "add_to_packet_draft")
        reason = rule_set.parameters.properties["legalRequirements"].items.properties["coverage"].properties["nonAssessableReason"]
        assert any(branch.type.value == "NULL" for branch in reason.any_of or [])
        calls.append(prepared)
        return ChatResult(generations=[ChatGeneration(message=responses[len(calls) - 1])])

    monkeypatch.setattr(ChatGoogleGenerativeAI, "_generate", generate)
    model = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", api_key="fixture")
    api = FakeApi()
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED"
    assert len(calls) == 2
    assert api.names() == ["claim", "validate", "submit"]
    assert api.calls[1][1][-1] == api.calls[2][1][-1] == packet


def test_invalid_submission_finishes_the_run_as_failed_without_retry_authority(tmp_path: Path) -> None:
    packet = _packet()
    model = _model([
        _call("validate_compliance_rule_set", {"packet": packet}, "v"),
        _call("submit_compliance_rule_set", {"packet": packet}, "s"), AIMessage(content="stop"),
    ])
    api = FakeApi(outcome="FAILED")
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "FAILED"
    assert result["failureReason"] == "RULE_SET_VALIDATION_FAILED"
    assert "fail" not in api.names()  # the submit transaction already recorded FAILED


@pytest.mark.parametrize("scenario", ["uncovered", "non-assessable", "missing-array"])
def test_packet_graph_400_feedback_reaches_model_and_can_be_corrected(tmp_path: Path, scenario: str) -> None:
    import copy
    from unittest.mock import patch

    import httpx
    from tools.common.capabilities.platform.api_client import WorkerApiClient

    corrected = _packet()
    invalid = copy.deepcopy(corrected)
    if scenario == "missing-array":
        del invalid["assessmentRules"][0]["investigationGoals"]
        field = "packet.assessmentRules.0.investigationGoals"
        requirement = "packet.assessmentRules.0.investigationGoals requires array"
    elif scenario == "non-assessable":
        invalid["legalRequirements"][0]["coverage"] = {"state": "NON_ASSESSABLE", "nonAssessableReason": "Declared external duty"}
        field = "packet.assessmentRules.0.legalRequirementIds.0"
        requirement = "Referenced LegalRequirement declares NON_ASSESSABLE, remove this AssessmentRule coverage or correct the LegalRequirement coverage declaration"
    else:
        invalid["assessmentRules"] = []
        field = "packet.legalRequirements.0.coverage.state"
        requirement = "COVERED_BY_ASSESSMENT_RULES requires at least one AssessmentRule legalRequirementIds reference to this LegalRequirement"

    client = WorkerApiClient(base_url="http://testserver", api_key="fixture-key")

    class FeedbackApi(FakeApi):
        def validate_compliance_rule_set(self, run_id: str, packet: dict) -> dict:
            self.calls.append(("validate", (run_id, packet)))
            return client.validate_compliance_rule_set(run_id, packet)

    api = FeedbackApi()
    model = _model([
        _call("validate_compliance_rule_set", {"packet": invalid}, "invalid"),
        _call("validate_compliance_rule_set", {"packet": corrected}, "corrected"),
        _call("submit_compliance_rule_set", {"packet": corrected}, "submit"),
        AIMessage(content="DONE"),
    ])
    responses = [
        httpx.Response(400, json={"ok": False, "problem": {
            "status": 400, "code": "COMPLIANCE_RULE_SET_SUBMIT_REQUEST_INVALID",
            "meta": {"issues": field, "requirements": requirement, "input": "PRIVATE_PACKET_VALUE"},
        }}),
        httpx.Response(200, json={"ok": True, "data": {"outcome": "PASSED", "failures": []}}),
    ]
    with patch("tools.common.capabilities.platform.api_client.httpx.post", side_effect=responses) as post:
        result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert post.call_count == 2  # the 400 is not retried as a transport failure
    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "validate", "submit"]
    feedback = json.loads(_tool_messages(model)["invalid"].content)["error"]
    assert f"Invalid fields: {field} Requirements: {requirement}" in feedback
    assert len(feedback) < 1100 and "PRIVATE_PACKET_VALUE" not in feedback
    assert api.calls[-1][1][-1] == corrected


def test_no_submission_is_recorded_as_failed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from rule_set_preparation import runner

    real = runner.materialize_legal_source

    def materialize_then_lose_a_chunk(bundle: dict[str, Any], root: Path) -> list[str]:
        paths = real(bundle, root)
        (root / f"legal-source/{DOC}/dieu-1.md").unlink()  # The pinned Article really becomes unreadable.
        return paths

    monkeypatch.setattr(runner, "materialize_legal_source", materialize_then_lose_a_chunk)
    blocked = {"reason": "SOURCE_UNREADABLE", "path": "/legal-source/SYNTHETIC-NOTICE-INSTRUMENT/dieu-1.md"}
    model = _model([_call("report_rule_set_source_blocked", blocked, "blocked")])
    api = FakeApi()
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "FAILED" and result["submission"] is None
    assert result["failureReason"] == NO_SUBMISSION
    assert result["trace"] == [{"tool": "source_blocked", **blocked}]
    assert api.calls[-1] == ("fail", (RUN_ID, NO_SUBMISSION))


def _source_block_tool(tmp_path: Path) -> tuple[Any, RuleSetPreparationContext, list[str]]:
    paths = materialize_legal_source(_bundle(), tmp_path)
    context = RuleSetPreparationContext(run_id=RUN_ID, api=FakeApi(), source_root=tmp_path)
    tool = next(t for t in build_rule_set_tools(context) if t.name == "report_rule_set_source_blocked")
    return tool, context, paths


@pytest.mark.parametrize("reason", ["SOURCE_UNREADABLE", "SOURCE_PINS_INCONSISTENT"])
def test_source_block_claim_on_an_intact_pinned_source_is_refuted(tmp_path: Path, reason: str) -> None:
    """Production run ea411318: a model gave up after failed validation with SOURCE_UNREADABLE on a readable INDEX."""
    tool, context, paths = _source_block_tool(tmp_path)
    for path in (INDEX_PATH, paths[1]):
        result = json.loads(tool.invoke({"reason": reason, "path": path}))
        assert "Source-blocking refused" in result["error"] and "sourceBlocked" not in result
    assert context.source_blocked is None
    assert [t["outcome"] for t in context.trace] == ["REFUTED", "REFUTED"]


def test_source_block_claim_for_a_path_the_index_does_not_pin_is_refuted(tmp_path: Path) -> None:
    tool, context, _ = _source_block_tool(tmp_path)
    result = json.loads(tool.invoke({"reason": "SOURCE_UNREADABLE", "path": "/legal-source/other/missing.md"}))
    assert "not listed" in result["error"] and context.source_blocked is None


def test_source_block_claim_is_honored_when_the_pinned_source_is_really_broken(tmp_path: Path) -> None:
    tool, context, paths = _source_block_tool(tmp_path)
    (tmp_path / paths[2].lstrip("/")).write_text("documentId: other\nlocator: x\ncontentSha256: sha256:0\n---\nbody\n")
    claim = {"reason": "SOURCE_PINS_INCONSISTENT", "path": paths[2]}
    assert json.loads(tool.invoke(claim)) == {"sourceBlocked": claim}
    assert context.source_blocked == claim

    tool, context, paths = _source_block_tool(tmp_path / "unreadable")
    (tmp_path / "unreadable" / paths[1].lstrip("/")).unlink()
    claim = {"reason": "SOURCE_UNREADABLE", "path": paths[1]}
    assert json.loads(tool.invoke(claim)) == {"sourceBlocked": claim}

    tool, context, _ = _source_block_tool(tmp_path / "no-index")
    (tmp_path / "no-index" / INDEX_PATH.lstrip("/")).unlink()
    assert json.loads(tool.invoke({"reason": "SOURCE_UNREADABLE", "path": INDEX_PATH})) == {"sourceBlocked": {"reason": "SOURCE_UNREADABLE", "path": INDEX_PATH}}


def test_refuted_source_block_does_not_end_the_run_and_the_packet_is_still_submitted(tmp_path: Path) -> None:
    packet = _packet()
    model = _model([
        _call("validate_compliance_rule_set", {"packet": packet}, "validate"),
        _call("report_rule_set_source_blocked", {"reason": "SOURCE_UNREADABLE", "path": INDEX_PATH}, "blocked"),
        _call("submit_compliance_rule_set", {"packet": packet}, "submit"),
        AIMessage(content="DONE"),
    ])
    api = FakeApi()
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED" and result["failureReason"] is None
    assert api.names() == ["claim", "validate", "submit"]
    assert "Source-blocking refused" in json.loads(_tool_messages(model)["blocked"].content)["error"]


def test_incomplete_source_extraction_fails_before_model_invocation(tmp_path: Path, monkeypatch) -> None:
    """A missing PDF text layer blocks the real Producer, without fabricating claims."""
    import rule_set_preparation.runner as runner

    class PartiallyExtractedApi(FakeApi):
        def claim_rule_set_preparation(self, run_id: str) -> dict:
            bundle = super().claim_rule_set_preparation(run_id)
            bundle["documentGraph"]["extractionGaps"] = [
                {"documentId": DOC, "page": 2, "kind": "NO_TEXT_LAYER"},
            ]
            return bundle

    monkeypatch.setattr(
        runner, "create_rule_set_preparation_agent",
        lambda **kwargs: pytest.fail("incomplete legal source must not invoke Producer"),
    )
    monkeypatch.setattr(
        runner, "publish_agent_stream_event", lambda *args, **kwargs: None,
    )
    api = PartiallyExtractedApi()
    result = runner.run_rule_set_preparation(api, RUN_ID, work_dir=tmp_path)
    assert result["failureReason"] == SOURCE_VERSION_UNAVAILABLE
    assert result["error"] == {
        "type": "SourceExtractionIncomplete", "stage": "SOURCE_MATERIALIZATION",
        "extractionGapCount": 1,
    }
    assert api.names() == ["claim", "fail"]
    assert api.calls[-1] == ("fail", (RUN_ID, SOURCE_VERSION_UNAVAILABLE))


def test_model_error_and_claim_failure_are_recorded(tmp_path: Path) -> None:
    class ExplodingModel(RuleSetPreparationScriptedModel):
        def _generate(self, messages: list[Any], **kwargs: Any):
            raise RuntimeError("provider unavailable")

    api = FakeApi()
    exploding = ExplodingModel(responses=[])
    stream = AgentStreamSession(
        assessment_id=None,
        run_id=RUN_ID,
        correlation_id="model-error-test",
        boundary_name="rule_set_preparation",
        emit_payload=lambda _: None,
        boundary_type="PREPARATION",
        boundary_id=RUN_ID,
        preparation_run_id=RUN_ID,
    )
    with activate_agent_stream(stream):
        result = run_rule_set_preparation(api, RUN_ID, model=exploding, work_dir=tmp_path)
    assert result["failureReason"] == MODEL_ERROR
    assert api.calls[-1] == ("fail", (RUN_ID, MODEL_ERROR))

    unavailable = FakeApi(claim_error=RuntimeError("409"))
    assert run_rule_set_preparation(unavailable, RUN_ID, model=exploding)["failureReason"] == SOURCE_VERSION_UNAVAILABLE
    assert unavailable.calls[-1] == ("fail", (RUN_ID, SOURCE_VERSION_UNAVAILABLE))


def test_transient_provider_errors_are_retried_but_the_run_still_submits_once(tmp_path: Path) -> None:
    class FlakyModel(RuleSetPreparationScriptedModel):
        failures_left: int = 2

        def _generate(self, messages: list[Any], **kwargs: Any):
            if self.failures_left:
                self.failures_left -= 1
                raise RuntimeError("Error code: 502 - Bad gateway")
            return super()._generate(messages, **kwargs)

    packet = _packet()
    model = FlakyModel(
        responses=[_call("validate_compliance_rule_set", {"packet": packet}, "v"),
                   _call("submit_compliance_rule_set", {"packet": packet}, "s"), AIMessage(content="DONE")]
    )
    api = FakeApi()
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)

    assert model.failures_left == 0  # both transient failures were retried
    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "submit"]  # retries never duplicate a submission


def test_capacity_and_auth_errors_are_not_retried_on_the_same_key() -> None:
    from middleware.failure_policy import retry_model_error

    class StatusError(Exception):
        def __init__(self, status_code: int, message: str) -> None:
            super().__init__(message)
            self.status_code = status_code

    assert not retry_model_error(StatusError(429, "insufficient_quota: allowance_exhausted"))
    assert retry_model_error(StatusError(502, "Bad gateway"))
    assert not retry_model_error(StatusError(401, "invalid api key"))


def test_forbidden_tools_and_paths_outside_the_legal_source_are_unavailable(tmp_path: Path) -> None:
    materialize_legal_source(_bundle(), tmp_path)
    (tmp_path / "secret.txt").write_text("NOT-IN-LEGAL_SOURCE")
    attempts = [
        _call("write_file", {"file_path": "/legal-source/x.md", "content": "MUTATED"}, "write"),
        _call("execute", {"command": "touch /legal-source/y"}, "execute"),
        _call("task", {"description": "research", "subagent_type": "general-purpose"}, "task"),
        _call("read_file", {"file_path": "/secret.txt"}, "outside"),
        _call("validate_compliance_rule_set", {"packet": _packet()}, "validate"),
        _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
        AIMessage(content="done"),
    ]
    model = _model(attempts)
    agent = create_rule_set_preparation_agent(
        context=RuleSetPreparationContext(RUN_ID, FakeApi()), legal_source_root=tmp_path, model=model
    )
    agent.invoke({"messages": [{"role": "user", "content": "go"}]})
    messages = _tool_messages(model)
    for call_id in ("write", "execute"):
        assert "is not a valid tool" in messages[call_id].content, messages[call_id].content
    assert "does not exist" in messages["task"].content
    assert "NOT-IN-LEGAL_SOURCE" not in messages["outside"].content
    assert not (tmp_path / "legal_source" / "x.md").exists() and not (tmp_path / "legal_source" / "y").exists()


def test_the_no_subagent_profile_is_scoped_to_graph_build_time() -> None:
    from deepagents.profiles.harness.harness_profiles import (
        _HARNESS_PROFILES,
        _get_harness_profile,
    )

    from deepagents import HarnessProfile, register_harness_profile

    key = "scoped-test:model"
    register_harness_profile(key, HarnessProfile(system_prompt_suffix="LCSP-DEFAULT"))
    original = _HARNESS_PROFILES[key]
    with _without_general_purpose_subagent(key):
        inside = _get_harness_profile(key)
        assert inside is not None and inside.general_purpose_subagent.enabled is False
        assert inside.system_prompt_suffix == "LCSP-DEFAULT"  # other settings are kept
    assert _HARNESS_PROFILES[key] is original  # exactly restored, not merged
    after = _get_harness_profile(key)
    assert after.general_purpose_subagent is None or after.general_purpose_subagent.enabled is not False

    fresh = "scoped-test:never-registered"
    with _without_general_purpose_subagent(fresh):
        assert fresh in _HARNESS_PROFILES
    assert fresh not in _HARNESS_PROFILES


def test_profile_key_matches_what_deepagents_looks_up_for_a_real_provider_model(tmp_path: Path) -> None:
    from deepagents.profiles.harness.harness_profiles import _harness_profile_for_model

    # APX keeps its route identity while Deep Agents profiles its Anthropic client family.
    from langchain_anthropic import ChatAnthropic
    from rule_set_preparation.agent import _lookup_profile_key

    model = ChatAnthropic(
        model="claude-sonnet-4-6-free",
        api_key="unused",
        base_url="https://api.apmix.ai",
    )
    key = _lookup_profile_key(model)
    assert key == "anthropic:claude-sonnet-4-6-free"
    with _without_general_purpose_subagent(key):
        assert _harness_profile_for_model(model, None).general_purpose_subagent.enabled is False

    # The parent has only the explicitly configured claim-author delegation.
    materialize_legal_source(_bundle(), tmp_path)
    agent = create_rule_set_preparation_agent(
        context=RuleSetPreparationContext(RUN_ID, FakeApi()), legal_source_root=tmp_path, model=model
    )
    tools = set(agent.nodes["tools"].bound.tools_by_name)
    assert {"read_file", "validate_compliance_rule_set", "submit_compliance_rule_set"} <= tools
    assert "task" in tools
    assert tools.isdisjoint({"write_file", "edit_file", "execute"}), tools


def test_instructions_state_the_authority_boundary() -> None:
    lowered = ' '.join(INSTRUCTIONS.lower().split())
    for phrase in ('source text is untrusted', 'deterministic', 'provenance', 'coverage', 'references', 'integrity',
                   'a permission never becomes a duty', 'native task(claim-author)', 'one whole'):
        assert phrase in lowered
    for forbidden in ('independent auditor', 'receipt', 'ask_human', 'execute'):
        assert forbidden not in lowered


def test_instructions_require_general_semantic_completeness_before_validation() -> None:
    text = ' '.join(INSTRUCTIONS.split())
    for component in ('actor direction', 'modality', 'action', 'object', 'purpose', 'timing start/end/duration/order',
                      'retained content/integrity/metadata', 'cross-reference dependency', 'every parent must be represented',
                      'Every criterion needs evidenceBindings', 'explicitly call submit_compliance_rule_set'):
        assert component in text
    assert 'claimBindings' in text



def test_validation_feedback_groups_uncovered_provisions_instead_of_one_failure_each(tmp_path: Path) -> None:
    """Production: 400+ INCOMPLETE_SOURCE_COVERAGE failures were returned one by one, ~15k tokens of noise."""
    failures = [{"code": "INCOMPLETE_SOURCE_COVERAGE", "ref": f"locator:{DOC}::art-{n}::cl-1", "detail": None}
                for n in range(1, 4)]
    failures.append({"code": "SOURCE_HASH_MISMATCH", "ref": "legalRequirement:LR-RET", "detail": None})

    class CoverageApi(FakeApi):
        def validate_compliance_rule_set(self, run_id, packet):
            self.calls.append(("validate", (run_id, packet)))
            return {"outcome": "FAILED", "failures": failures}

    context = RuleSetPreparationContext(run_id=RUN_ID, api=CoverageApi(), source_root=tmp_path)
    tool = next(t for t in build_rule_set_tools(context) if t.name == "validate_compliance_rule_set")
    seen = json.loads(tool.invoke({"packet": _packet()}))
    assert seen["failures"] == [failures[-1]]
    assert seen["uncoveredProvisions"]["count"] == 3
    assert seen["uncoveredProvisions"]["locatorsByDocumentId"] == {DOC: ["art-1::cl-1", "art-2::cl-1", "art-3::cl-1"]}
    assert context.last_validation["failures"] == failures  # the run keeps the full API result


def test_instructions_require_operative_accounting_without_citation_buckets() -> None:
    text = ' '.join(INSTRUCTIONS.split())
    for required in ('Every printed locator', 'at least one claim OR in noClaims, never both', 'All relevant claims',
                     'NON_ASSESSABLE never excuses omission', 'commit_claims', 'discoveryCompleteEligible=true'):
        assert required in text



def _draft_tools(api: FakeApi | None = None) -> tuple[RuleSetPreparationContext, dict[str, Any]]:
    context = RuleSetPreparationContext(run_id=RUN_ID, api=api or FakeApi())
    return context, {tool.name: tool for tool in build_rule_set_tools(context)}


def test_a_large_rule_set_is_authored_in_parts_validated_and_submitted_without_resending_it() -> None:
    packet = _packet()
    api = FakeApi()
    context, tools = _draft_tools(api)
    add, validate, submit = (tools[n] for n in
                             ("add_to_packet_draft", "validate_compliance_rule_set", "submit_compliance_rule_set"))

    assert "error" in json.loads(validate.invoke({}))  # an empty draft is not a packet
    first = json.loads(add.invoke({"legalRequirements": packet["legalRequirements"]}))
    assert first["added"]["legalRequirements"] == 1 and first["replaced"] == 0
    add.invoke({"assessmentRules": packet["assessmentRules"], "contextRelations": packet["contextRelations"]})
    assert context.draft_counts() == {"legalRequirements": 1, "assessmentRules": 1, "contextRelations": 1}

    assert json.loads(validate.invoke({}))["outcome"] == "PASSED"
    assert api.calls[-1] == ("validate", (RUN_ID, packet))  # the API sees the complete assembled packet
    assert json.loads(submit.invoke({}))["lifecycleState"] == "ACTIVE"
    assert api.calls[-1] == ("submit", (RUN_ID, f"rule-set-preparation-submit-{RUN_ID}", packet))
    assert context.submission is not None


def test_draft_items_are_replaced_by_label_and_any_edit_revokes_a_pass() -> None:
    packet = _packet()
    context, tools = _draft_tools()
    add, remove = tools["add_to_packet_draft"], tools["remove_from_packet_draft"]
    validate, submit = tools["validate_compliance_rule_set"], tools["submit_compliance_rule_set"]
    add.invoke(packet)
    assert json.loads(validate.invoke({}))["outcome"] == "PASSED"

    corrected = {**packet["legalRequirements"][0], "title": "Retention (corrected)"}
    result = json.loads(add.invoke({"legalRequirements": [corrected]}))
    assert result["replaced"] == 1 and result["draft"]["legalRequirements"] == 1
    assert context.draft["legalRequirements"]["LR-RET"]["title"] == "Retention (corrected)"
    claim = json.loads(submit.invoke({}))
    assert claim["lifecycleState"] == "ACTIVE"  # an edited draft is gated again before submission
    assert context.submission is not None


def test_only_items_named_by_the_latest_validation_failures_can_be_removed() -> None:
    """Production: a model that saw 14 stale hashes deleted all 73 relations, then all 23 requirements."""
    packet = _packet()

    class RelationFailure(FakeApi):
        def validate_compliance_rule_set(self, run_id, packet):
            return {"outcome": "FAILED", "failures": [
                {"code": "STALE_SOURCE_HASH", "ref": f"relation:REL-1|locator:{DOC}::art-2::cl-1", "detail": "x"}]}

    context, tools = _draft_tools(RelationFailure())
    add, remove, validate = (tools[n] for n in
                             ("add_to_packet_draft", "remove_from_packet_draft", "validate_compliance_rule_set"))
    add.invoke(packet)
    refused = json.loads(remove.invoke({"legalRequirementIds": ["LR-RET"], "relationIds": ["REL-1"]}))
    assert refused["refused"] == ["LR-RET", "REL-1"] and "why" in refused  # nothing was validated yet
    assert context.draft_counts() == {"legalRequirements": 1, "assessmentRules": 1, "contextRelations": 1}

    validate.invoke({})
    removed = json.loads(remove.invoke({"legalRequirementIds": ["LR-RET"], "relationIds": ["REL-1", "REL-missing"]}))
    assert removed["removed"] == {"legalRequirements": 0, "assessmentRules": 0, "contextRelations": 1}
    assert removed["refused"] == ["LR-RET"] and removed["unknownLabels"] == ["REL-missing"]
    assert context.draft_counts() == {"legalRequirements": 1, "assessmentRules": 1, "contextRelations": 0}


def test_draft_items_without_a_label_are_rejected_and_nothing_is_added() -> None:
    packet = _packet()
    context, tools = _draft_tools()
    nameless = {k: v for k, v in packet["legalRequirements"][0].items() if k != "legalRequirementId"}
    result = json.loads(tools["add_to_packet_draft"].invoke(
        {"legalRequirements": [packet["legalRequirements"][0], nameless]}))
    assert "Nothing was added" in result["error"] and "legalRequirements[1]" in result["error"]
    assert context.draft_counts() == {"legalRequirements": 0, "assessmentRules": 0, "contextRelations": 0}


def test_a_packet_assembled_from_the_draft_is_what_an_agent_run_submits(tmp_path: Path) -> None:
    packet = _packet()
    model = _model([
        _call("add_to_packet_draft", {"legalRequirements": packet["legalRequirements"]}, "add-1"),
        _call("add_to_packet_draft", {"assessmentRules": packet["assessmentRules"],
                                      "contextRelations": packet["contextRelations"]}, "add-2"),
        _call("validate_compliance_rule_set", {}, "validate"),
        _call("submit_compliance_rule_set", {}, "submit"),
        AIMessage(content="DONE"),
    ])
    api = FakeApi()
    result = run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "submit"]
    validated = api.calls[1][1][1]
    assert validated == api.calls[2][1][2]
    assert {key: validated[key] for key in packet} == packet
    assert validated["semanticGraph"]["materializationId"] == _bundle()["documentGraph"]["materializationId"]


def test_stale_hash_feedback_names_the_pinned_identity_so_the_item_is_corrected_not_deleted(tmp_path: Path) -> None:
    paths = materialize_legal_source(_bundle(), tmp_path)
    expected = _sha("Records must be retained for five years.")
    failures = [{"code": "STALE_SOURCE_HASH", "ref": f"legalRequirement:LR-RET|locator:{DOC}::art-1::cl-1",
                 "detail": "declared hash does not match the pinned legalSource content"},
                {"code": "STALE_SOURCE_HASH", "ref": f"legalRequirement:LR-X|locator:{DOC}::unknown",
                 "detail": "declared hash does not match the pinned legalSource content"}]

    class StaleApi(FakeApi):
        def validate_compliance_rule_set(self, run_id, packet):
            return {"outcome": "FAILED", "failures": failures}

    context = RuleSetPreparationContext(run_id=RUN_ID, api=StaleApi(), source_root=tmp_path)
    tool = next(t for t in build_rule_set_tools(context) if t.name == "validate_compliance_rule_set")
    from rule_set_preparation.source_graph import PinnedSourceGraph
    bundle = _bundle()
    context.source_graph = PinnedSourceGraph(bundle["documentGraph"], [c for d in bundle["documents"] for c in d["chunks"]])
    seen = json.loads(tool.invoke({"packet": _packet()}))["failures"]
    assert seen[0]["expectedContentSha256"] == expected
    assert "expectedContentSha256" not in seen[1]  # a locator the INDEX does not pin gets no invented hash
    assert paths[0] == INDEX_PATH


def test_an_unknown_tool_argument_is_ignored_instead_of_crashing_the_run() -> None:
    """Production: mercury-2.5 sent `note` to add_to_packet_draft; the TypeError ended the whole preparation."""
    packet = _packet()
    context, tools = _draft_tools()
    result = tools["add_to_packet_draft"].invoke({"legalRequirements": packet["legalRequirements"], "note": "x"})
    assert json.loads(result)["added"]["legalRequirements"] == 1
    assert json.loads(tools["validate_compliance_rule_set"].invoke({"note": "y"}))["outcome"] == "PASSED"
    assert json.loads(tools["submit_compliance_rule_set"].invoke({"comment": "z"}))["lifecycleState"] == "ACTIVE"
    blocked = tools["report_rule_set_source_blocked"].invoke({"reason": "SOURCE_UNREADABLE", "path": INDEX_PATH, "why": "?"})
    assert json.loads(blocked) == {"alreadySubmitted": True}  # answered, not raised


def test_every_few_draft_parts_come_back_with_the_mechanical_validation_attached() -> None:
    """Production: a weak model kept adding items for ten minutes without ever asking for feedback."""
    packet = _packet()
    api = FakeApi()
    context, tools = _draft_tools(api)
    add = tools["add_to_packet_draft"]
    labelled = lambda n: {**packet["legalRequirements"][0], "legalRequirementId": f"LR-{n}"}  # noqa: E731
    replies = [json.loads(add.invoke({"legalRequirements": [labelled(n)]})) for n in range(5)]
    assert ["validation" in reply for reply in replies] == [False, False, False, True, False]
    assert replies[3]["validation"]["outcome"] == "PASSED"
    assert [name for name in api.names() if name == "validate"] == ["validate"]  # one dry-run, on the 4th part
    assert context.validation_calls == 1 and context.adds_since_validation == 1
    repeated = json.loads(add.invoke({"legalRequirements": [labelled(4)]}))
    assert "already existed" in repeated["note"]


def test_instructions_derive_applicability_from_the_source_without_naming_a_legal_ontology() -> None:
    text = ' '.join(INSTRUCTIONS.split())
    for required in ('Applicability must state the actual addressee and source conditions', 'source-defined criteria',
                     'Only SCOPE and CONDITION claims', 'any-of/all-of alternatives', 'Applicability is its own claim'):
        assert required in text
    for source_specific in ('134/2025', '71/2025', 'quoc hoi'):
        assert source_specific not in text.lower()



def test_the_model_facing_packet_schema_explains_what_a_good_applicability_condition_is() -> None:
    import json
    from pathlib import Path

    schema_path = Path(__file__).parent.parent / "rule_set_preparation/packet-schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    requirement = schema["properties"]["packet"]["properties"]["legalRequirements"]["items"]["properties"]
    rule = schema["properties"]["packet"]["properties"]["assessmentRules"]["items"]["properties"]
    assert "unpack those criteria" in requirement["applicabilityConditions"]["description"]
    assert "at least one" in requirement["applicabilityConditions"]["description"]
    assert "facts" in rule["unresolvedConditions"]["description"]
    assert "linked legalrequirementids" in rule["applicabilityGuidance"]["description"].lower()
    assert "APPLICABILITY_BINDING_MISMATCH" in rule["applicabilityGuidance"]["description"]
