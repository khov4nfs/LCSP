"""Provider-free tests of the production Legal Preparation agent wiring."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import AIMessage, ToolMessage

from legal_preparation.agent import _without_general_purpose_subagent, create_legal_preparation_agent
from legal_preparation.corpus_files import INDEX_PATH, materialize_corpus
from legal_preparation.runner import (
    CORPUS_UNAVAILABLE,
    MODEL_ERROR,
    NO_SUBMISSION,
    run_legal_preparation,
)
from legal_preparation.tools import LegalPreparationContext, build_portfolio_tools
from test_legal_preparation_native_isolation_preparation import LegalPreparationScriptedModel

RUN_ID = "11111111-1111-4111-8111-111111111111"
CORPUS_ID = "22222222-2222-4222-8222-222222222222"
DOC = "SYNTHETIC-NOTICE-INSTRUMENT"


@pytest.fixture(autouse=True)
def _fast_model_retry_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the retry behavior under test but not its real exponential sleeps."""
    import legal_preparation.agent as agent_module

    monkeypatch.setattr(agent_module, "MODEL_RETRY_INITIAL_DELAY_SECONDS", 0.0)
    monkeypatch.setattr(agent_module, "MODEL_RETRY_MAX_DELAY_SECONDS", 0.0)


def _sha(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def _bundle() -> dict[str, Any]:
    chunks = [
        ("art-1::cl-1", "Records must be retained for five years."),
        ("art-2::cl-1", "Retention does not apply to anonymised records."),
    ]
    return {
        "preparationRunId": RUN_ID,
        "executionState": "RUNNING",
        "legalCorpusVersionId": CORPUS_ID,
        "corpusVersion": "SYNTHETIC-CORPUS-V1",
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
                        "hierarchy": {"path": locator.split("::")},
                    }
                    for locator, text in chunks
                ],
            }
        ],
    }


def _ref(locator: str, text: str) -> dict[str, str]:
    return {"documentId": DOC, "locator": locator, "contentSha256": _sha(text)}


def _packet() -> dict[str, Any]:
    retain = "Records must be retained for five years."
    anonymised = "Retention does not apply to anonymised records."
    return {
        "legalRules": [
            {
                "legalRuleId": "LR-RET",
                "title": "Retention",
                "proposition": retain,
                "applicabilityConditions": [],
                "qualifiers": [],
                "exceptions": [anonymised],
                "nonRepositoryDuty": False,
                "sourceRefs": [_ref("art-1::cl-1", retain)],
                "coverage": {"state": "COVERED_BY_ENGINEERING_RULES", "nonAssessableReason": None},
            }
        ],
        "engineeringRules": [
            {
                "engineeringRuleId": "ER-RET",
                "legalRuleIds": ["LR-RET"],
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
                "fromLegalRuleId": "LR-RET",
                "toLegalRuleId": None,
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

    def claim_legal_preparation(self, run_id: str) -> dict:
        self.calls.append(("claim", (run_id,)))
        if self.claim_error:
            raise self.claim_error
        return _bundle()

    def validate_legal_portfolio(self, run_id: str, packet: dict) -> dict:
        self.calls.append(("validate", (run_id, packet)))
        return {"outcome": "PASSED", "failures": []}

    def submit_legal_portfolio(self, run_id: str, key: str, packet: dict) -> dict:
        self.calls.append(("submit", (run_id, key, packet)))
        failed = self.outcome != "PASSED"
        return {
            "preparationRunId": run_id,
            "lifecycleState": "INVALID" if failed else "ACTIVE",
            "validation": {
                "outcome": self.outcome,
                "failures": [{"code": "DUPLICATE_RULE_ID", "ref": "legalRule:LR-RET", "detail": None}] if failed else [],
            },
        }

    def fail_legal_preparation(self, run_id: str, reason: str) -> dict:
        self.calls.append(("fail", (run_id, reason)))
        return {"preparationRunId": run_id, "executionState": "FAILED"}

    def names(self) -> list[str]:
        return [name for name, _ in self.calls]


def _model(responses: list[AIMessage]) -> LegalPreparationScriptedModel:
    return LegalPreparationScriptedModel(responses=list(responses))


def _tool_messages(model: LegalPreparationScriptedModel) -> dict[str, ToolMessage]:
    found: dict[str, ToolMessage] = {}
    for prompt in model.prompts:
        for message in prompt:
            if isinstance(message, ToolMessage):
                found[message.tool_call_id] = message
    return found


def test_portfolio_tools_expose_required_nested_contract_to_the_provider() -> None:
    from langchain_core.utils.function_calling import convert_to_openai_tool
    from langchain_google_genai import ChatGoogleGenerativeAI

    tools = build_portfolio_tools(LegalPreparationContext(RUN_ID, FakeApi()))
    # Binding exercises Gemini's schema conversion without a provider request.
    ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", api_key="fixture").bind_tools(tools)
    for tool in tools:
        schema = convert_to_openai_tool(tool)["function"]["parameters"]
        packet = schema["properties"]["packet"]
        assert set(packet["required"]) == {"legalRules", "engineeringRules", "contextRelations"}
        assert "Operative duties, prohibitions or permissions only" in packet["properties"]["legalRules"]["description"]
        assert "Source coverage does not require a LegalRule for every provision" in packet["properties"]["legalRules"]["description"]
        legal = packet["properties"]["legalRules"]["items"]
        assert "software record of an action does not establish performance" in legal["properties"]["nonRepositoryDuty"]["description"]
        coverage = legal["properties"]["coverage"]
        assert set(coverage["required"]) == {"state", "nonAssessableReason"}
        assert coverage["type"] == "object"
        assert "oneOf" not in coverage and "anyOf" not in coverage
        assert "NON_ASSESSABLE requires none" in coverage["properties"]["state"]["description"]
        engineering = packet["properties"]["engineeringRules"]["items"]
        assert "never reference a LegalRule declared NON_ASSESSABLE" in engineering["properties"]["legalRuleIds"]["description"]
        assert {"engineeringRuleId", "criteria", "applicabilityGuidance", "supportingEvidence", "sourceRefs"} <= set(engineering["required"])
        relation = packet["properties"]["contextRelations"]["items"]
        assert {"toLegalRuleId", "toSourceRef"} <= set(relation["required"])
        assert "independently operative LegalRule only" in relation["properties"]["toLegalRuleId"]["description"]
        assert "context-only definition" in relation["properties"]["toSourceRef"]["description"]


def test_corpus_files_carry_exact_citation_headers_and_only_the_pinned_corpus(tmp_path: Path) -> None:
    paths = materialize_corpus(_bundle(), tmp_path)
    assert paths[0] == INDEX_PATH
    index = (tmp_path / "corpus" / "INDEX.md").read_text()
    chunk_file = next(tmp_path.rglob("art-1__cl-1.md"))
    header = chunk_file.read_text().split("---")[0]
    assert f"documentId: {DOC}" in header
    assert "locator: art-1::cl-1" in header
    assert f"contentSha256: {_sha('Records must be retained for five years.')}" in header
    assert f"| {DOC} | art-2::cl-1 |" in index
    assert {p.name for p in tmp_path.rglob("*") if p.is_file()} == {"INDEX.md", "art-1__cl-1.md", "art-2__cl-1.md"}


def test_agent_has_only_read_only_corpus_tools_and_the_two_portfolio_tools(tmp_path: Path) -> None:
    from legal_preparation.agent import INSTRUCTIONS

    materialize_corpus(_bundle(), tmp_path)
    model = _model([AIMessage(content="done")])
    agent = create_legal_preparation_agent(
        context=LegalPreparationContext(RUN_ID, FakeApi()), corpus_root=tmp_path, model=model
    )
    agent.invoke({"messages": [{"role": "user", "content": "go"}]})
    bound = {name for names in model.bound_tool_names for name in names}
    assert {"read_file", "ls", "glob", "grep", "validate_legal_portfolio", "submit_legal_portfolio"} <= bound
    forbidden = {"write_file", "edit_file", "execute", "task", "ask_human", "submit_rule_decision"}
    assert bound.isdisjoint(forbidden), bound & forbidden
    assert INSTRUCTIONS in model.prompts[0][0].content


def test_agent_reads_validates_and_submits_once_with_server_bound_identity(tmp_path: Path) -> None:
    packet = _packet()
    responses = [
        _call("read_file", {"file_path": INDEX_PATH}, "read-index"),
        _call("validate_legal_portfolio", {"packet": packet}, "validate-1"),
        _call("submit_legal_portfolio", {"packet": packet}, "submit-1"),
        _call("submit_legal_portfolio", {"packet": packet}, "submit-2"),
        AIMessage(content="PORTFOLIO_SUBMITTED"),
    ]
    api, model = FakeApi(), _model(responses)
    result = run_legal_preparation(api, RUN_ID, model=model, work_dir=tmp_path)

    assert result["state"] == "SUCCEEDED" and result["failureReason"] is None
    assert api.names() == ["claim", "validate", "submit"], api.names()  # the 2nd submit never reaches the API
    _, (run_id, key, sent) = api.calls[2]
    assert run_id == RUN_ID
    assert key == f"legal-preparation-submit-{RUN_ID}"
    assert sent == packet
    messages = _tool_messages(model)
    assert "Pinned corpus SYNTHETIC-CORPUS-V1" in messages["read-index"].content
    assert json.loads(messages["submit-2"].content)["alreadySubmitted"] is True


def test_managed_agent_serializes_gemini_nullable_tools_without_rewriting_packet(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from langchain_core.outputs import ChatGeneration, ChatResult
    from langchain_google_genai import ChatGoogleGenerativeAI

    packet = _packet()
    responses = [
        _call("validate_legal_portfolio", {"packet": packet}, "validate"),
        _call("submit_legal_portfolio", {"packet": packet}, "submit"),
        AIMessage(content="DONE"),
    ]
    calls = []

    def generate(model, messages, stop=None, run_manager=None, **kwargs):
        prepared = model._prepare_request(messages, stop=stop, **kwargs)
        declarations = [d for t in prepared["config"].tools for d in t.function_declarations or []]
        portfolio = next(d for d in declarations if d.name == "submit_legal_portfolio")
        reason = portfolio.parameters.properties["packet"].properties["legalRules"].items.properties["coverage"].properties["nonAssessableReason"]
        assert any(branch.type.value == "NULL" for branch in reason.any_of or [])
        calls.append(prepared)
        return ChatResult(generations=[ChatGeneration(message=responses[len(calls) - 1])])

    monkeypatch.setattr(ChatGoogleGenerativeAI, "_generate", generate)
    model = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", api_key="fixture")
    api = FakeApi()
    result = run_legal_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED"
    assert len(calls) == 3
    assert api.names() == ["claim", "validate", "submit"]
    assert api.calls[1][1][-1] == api.calls[2][1][-1] == packet


def test_invalid_submission_finishes_the_run_as_failed_without_retry_authority(tmp_path: Path) -> None:
    packet = _packet()
    model = _model([_call("submit_legal_portfolio", {"packet": packet}, "s"), AIMessage(content="stop")])
    api = FakeApi(outcome="FAILED")
    result = run_legal_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "FAILED"
    assert result["failureReason"] == "PORTFOLIO_VALIDATION_FAILED"
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
        del invalid["engineeringRules"][0]["investigationGoals"]
        field = "packet.engineeringRules.0.investigationGoals"
        requirement = "packet.engineeringRules.0.investigationGoals requires array"
    elif scenario == "non-assessable":
        invalid["legalRules"][0]["coverage"] = {"state": "NON_ASSESSABLE", "nonAssessableReason": "Declared external duty"}
        field = "packet.engineeringRules.0.legalRuleIds.0"
        requirement = "Referenced LegalRule declares NON_ASSESSABLE, remove this EngineeringRule coverage or correct the LegalRule coverage declaration"
    else:
        invalid["engineeringRules"] = []
        field = "packet.legalRules.0.coverage.state"
        requirement = "COVERED_BY_ENGINEERING_RULES requires at least one EngineeringRule legalRuleIds reference to this LegalRule"

    client = WorkerApiClient(base_url="http://testserver", api_key="fixture-key")

    class FeedbackApi(FakeApi):
        def validate_legal_portfolio(self, run_id: str, packet: dict) -> dict:
            self.calls.append(("validate", (run_id, packet)))
            return client.validate_legal_portfolio(run_id, packet)

    api = FeedbackApi()
    model = _model([
        _call("validate_legal_portfolio", {"packet": invalid}, "invalid"),
        _call("validate_legal_portfolio", {"packet": corrected}, "corrected"),
        _call("submit_legal_portfolio", {"packet": corrected}, "submit"),
        AIMessage(content="DONE"),
    ])
    responses = [
        httpx.Response(400, json={"ok": False, "problem": {
            "status": 400, "code": "LEGAL_PORTFOLIO_SUBMIT_REQUEST_INVALID",
            "meta": {"issues": field, "requirements": requirement, "input": "PRIVATE_PACKET_VALUE"},
        }}),
        httpx.Response(200, json={"ok": True, "data": {"outcome": "PASSED", "failures": []}}),
    ]
    with patch("tools.common.capabilities.platform.api_client.httpx.post", side_effect=responses) as post:
        result = run_legal_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert post.call_count == 2  # the 400 is not retried as a transport failure
    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "validate", "submit"]
    feedback = json.loads(_tool_messages(model)["invalid"].content)["error"]
    assert f"Invalid fields: {field} Requirements: {requirement}" in feedback
    assert len(feedback) < 1100 and "PRIVATE_PACKET_VALUE" not in feedback
    assert api.calls[-1][1][-1] == corrected


def test_no_submission_is_recorded_as_failed(tmp_path: Path) -> None:
    model = _model([AIMessage(content="I could not read the corpus.")])
    api = FakeApi()
    result = run_legal_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "FAILED" and result["submission"] is None
    assert result["failureReason"] == NO_SUBMISSION and result["trace"] == []
    assert api.calls[-1] == ("fail", (RUN_ID, NO_SUBMISSION))


def test_model_error_and_claim_failure_are_recorded(tmp_path: Path) -> None:
    class ExplodingModel(LegalPreparationScriptedModel):
        def _generate(self, messages: list[Any], **kwargs: Any):
            raise RuntimeError("provider unavailable")

    api = FakeApi()
    exploding = ExplodingModel(responses=[])
    result = run_legal_preparation(api, RUN_ID, model=exploding, work_dir=tmp_path)
    assert result["failureReason"] == MODEL_ERROR
    assert api.calls[-1] == ("fail", (RUN_ID, MODEL_ERROR))

    unavailable = FakeApi(claim_error=RuntimeError("409"))
    assert run_legal_preparation(unavailable, RUN_ID, model=exploding)["failureReason"] == CORPUS_UNAVAILABLE
    assert unavailable.calls[-1] == ("fail", (RUN_ID, CORPUS_UNAVAILABLE))


def test_transient_provider_errors_are_retried_but_the_run_still_submits_once(tmp_path: Path) -> None:
    class FlakyModel(LegalPreparationScriptedModel):
        failures_left: int = 2

        def _generate(self, messages: list[Any], **kwargs: Any):
            if self.failures_left:
                self.failures_left -= 1
                raise RuntimeError("Error code: 502 - Bad gateway")
            return super()._generate(messages, **kwargs)

    packet = _packet()
    model = FlakyModel(
        responses=[_call("submit_legal_portfolio", {"packet": packet}, "s"), AIMessage(content="DONE")]
    )
    api = FakeApi()
    result = run_legal_preparation(api, RUN_ID, model=model, work_dir=tmp_path)

    assert model.failures_left == 0  # both transient failures were retried
    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "submit"]  # retries never duplicate a submission


def test_rate_limits_are_retried_with_backoff_but_auth_errors_are_not(tmp_path: Path) -> None:
    from legal_preparation.agent import retry_legal_preparation_model_error

    class StatusError(Exception):
        def __init__(self, status_code: int, message: str) -> None:
            super().__init__(message)
            self.status_code = status_code

    assert retry_legal_preparation_model_error(StatusError(429, "Rate limit exceeded. Retry after 1 seconds."))
    assert retry_legal_preparation_model_error(StatusError(502, "Bad gateway"))
    assert not retry_legal_preparation_model_error(StatusError(401, "invalid api key"))


def test_forbidden_tools_and_paths_outside_the_corpus_are_unavailable(tmp_path: Path) -> None:
    materialize_corpus(_bundle(), tmp_path)
    (tmp_path / "secret.txt").write_text("NOT-IN-CORPUS")
    attempts = [
        _call("write_file", {"file_path": "/corpus/x.md", "content": "MUTATED"}, "write"),
        _call("execute", {"command": "touch /corpus/y"}, "execute"),
        _call("task", {"description": "research", "subagent_type": "general-purpose"}, "task"),
        _call("read_file", {"file_path": "/secret.txt"}, "outside"),
        AIMessage(content="done"),
    ]
    model = _model(attempts)
    agent = create_legal_preparation_agent(
        context=LegalPreparationContext(RUN_ID, FakeApi()), corpus_root=tmp_path, model=model
    )
    agent.invoke({"messages": [{"role": "user", "content": "go"}]})
    messages = _tool_messages(model)
    for call_id in ("write", "execute", "task"):
        assert "is not a valid tool" in messages[call_id].content, messages[call_id].content
    assert "NOT-IN-CORPUS" not in messages["outside"].content
    assert not (tmp_path / "corpus" / "x.md").exists() and not (tmp_path / "corpus" / "y").exists()


def test_the_no_subagent_profile_is_scoped_to_graph_build_time() -> None:
    from deepagents import HarnessProfile, register_harness_profile
    from deepagents.profiles.harness.harness_profiles import _HARNESS_PROFILES, _get_harness_profile

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
    from langchain_openai import ChatOpenAI

    from legal_preparation.agent import _lookup_profile_key

    # An OpenAI-compatible route (apx) is looked up as "openai:<model>", not "apx:<model>".
    model = ChatOpenAI(model="GLM-5.3-Flash", api_key="unused", base_url="http://127.0.0.1:9/v1")
    key = _lookup_profile_key(model)
    assert key == "openai:GLM-5.3-Flash"
    with _without_general_purpose_subagent(key):
        assert _harness_profile_for_model(model, None).general_purpose_subagent.enabled is False

    # Building the real graph with that model leaves no task/sub-agent tool in the tool node.
    materialize_corpus(_bundle(), tmp_path)
    agent = create_legal_preparation_agent(
        context=LegalPreparationContext(RUN_ID, FakeApi()), corpus_root=tmp_path, model=model
    )
    tools = set(agent.nodes["tools"].bound.tools_by_name)
    assert {"read_file", "validate_legal_portfolio", "submit_legal_portfolio"} <= tools
    assert tools.isdisjoint({"task", "write_file", "edit_file", "execute"}), tools


def test_instructions_state_the_authority_boundary() -> None:
    from legal_preparation.agent import INSTRUCTIONS

    lowered = " ".join(INSTRUCTIONS.lower().split())
    assert "nobody reviews or" in lowered and "approves your output" in lowered
    assert "nonrepositoryduty" in lowered
    for required in ("definition", "exception", "qualifier", "cross-reference"):
        assert required in lowered
    assert "regular expressions" in lowered
    # context provisions are cited by relations, never promoted to rules or invented duties
    assert "never turn a context provision into a legalrule" in lowered
    assert "a permission never becomes a duty" in lowered
    assert "including its own limiting sentences" in lowered
    for forbidden_tool in ("ask_human", "execute", "task("):
        assert forbidden_tool not in lowered


def test_instructions_require_general_semantic_completeness_before_validation() -> None:
    from legal_preparation.agent import INSTRUCTIONS

    # Prompt wiring/policy guard only; generated legal meaning requires reasoned live review.
    text = " ".join(INSTRUCTIONS.split())
    assert "An EngineeringRule must not be a lossy summary" in text
    assert "every semantic component of **all** linked LegalRules and their relevant context relations" in text
    for component in (
        "actor", "modality", "action", "object", "scope", "conditions",
        "triggering event and its meaning", "timing start and end", "duration", "ordering",
        "qualifiers", "exceptions and exception limitations", "required retained content",
        "content-integrity or preservation requirements", "required associated metadata",
        "cross-reference-derived conditions",
    ):
        assert component in text
    assert "one criterion per sentence is not required" in text
    assert "Keep applicability separate from the behavior required for compliance" in text
    assert "Missing or incorrect implementation does not itself remove an applicable duty" in text
    assert "evidence availability was promoted into a condition" in text
    assert "Do not create one LegalRule per provision or per citation" in text
    assert "A register or log is not performance of the action itself" in text
    assert "do not repair the graph by adding EngineeringRule coverage to context" in text
    assert "Mechanical coverage must never motivate a semantically false link" in text
    assert "attach the exception only to the first duty" in text
    assert "Apply the same target restriction to the LegalRule `exceptions` array" in text
    assert "it must have no EXCEPTION relation to that provision" in text
    assert "cite those material child clauses explicitly" in text
    assert "does not replace references to the provisions it incorporates" in text
    assert "complete criteria alone do not excuse incomplete evidence guidance" in text
    assert "If it changes nothing, delete it" in text
    assert "Correct the reported shape failures without dropping previously correct fields" in text
    assert "Every context relation includes BOTH `toLegalRuleId` and `toSourceRef`" in text
    assert "Compare the relevant `contextRelations.toSourceRef` identities" in text
    assert "insert every missing identity into the actual EngineeringRule `sourceRefs` array" in text
    assert "An inline definition or paraphrase in a criterion does not replace its source reference" in text
    assert "repeat this comparison after every packet repair" in text
    assert "Repeat the private semantic completeness pass on that final packet" in text
    assert "using the exact packet that just passed validation" in text
    assert "Do not regenerate, shorten or change that packet between the two calls" in text
    assert "Preserve inherited scope and other relevant context for NON_ASSESSABLE LegalRules too" in text
    assert "A LegalRule declared `NON_ASSESSABLE` must have no EngineeringRule referencing its `legalRuleId`" in text
    assert "Never mark the entire duty `NON_ASSESSABLE` while also authoring an EngineeringRule to assess it" in text
    assert "it does not decide legal assessability for you" in text
    assert "Immediately before `validate_legal_portfolio`, for every LegalRule" in text
    assert "private agent reasoning, not a packet field" in text
    for fixture_detail in (
        "Article 1", "Article 3", "Article 4", "Article 5", "Article 6",
        "seven days", "temporary test record", "notice text",
    ):
        assert fixture_detail not in text
