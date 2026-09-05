from __future__ import annotations

import json
import os
from types import SimpleNamespace
from typing import Annotated, Any, TypedDict
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
import psycopg
import pytest
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from psycopg.rows import dict_row

from orchestration.dispatcher import RootSubagentDispatcher
from tools.common.capabilities.assessment.investigation.engineering_rule import (
    managed_targeted_investigator as managed,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.interview_gated_boundary import (
    InterviewGatedEngineeringAssessmentBoundary,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.managed_investigator_execution_store import (
    ManagedInvestigatorExecutionStore,
)
from tools.common.capabilities.assessment.planning.engineering_rule.engineering_rule_planner import (
    EngineeringRulePlanner,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.callback_schemas import ScanCallbackPayload
from tools.common.capabilities.workflow.recovery.interview_boundary import (
    AssessmentInterviewResumeBoundary,
)
from tools.legal.corpus.engineering_rules.contract.models import (
    EngineeringRule,
    GraphQueryTemplate,
    build_legal_reasoning_contract,
)
from tools.legal.corpus.engineering_rules.registry.cache import EngineeringRuleCache
from tools.legal.corpus.engineering_rules.orchestration.service import (
    EngineeringRuleService,
)
from tools.legal.retrieval.legal_basis.chromadb_citation_retriever import (
    ChromaDbCitationRetriever,
)


API_BASE_URL = os.getenv("LCSP_API_BASE_URL")
API_DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("LCSP_API_DATABASE_URL")
CHECKPOINT_URL = os.getenv("LCSP_TEST_CHECKPOINT_DATABASE_URL") or os.getenv(
    "LANGGRAPH_CHECKPOINT_DATABASE_URL"
)
WORKER_KEY = os.getenv("WORKER_API_KEY")

pytestmark = pytest.mark.skipif(
    not API_BASE_URL or not API_DATABASE_URL or not CHECKPOINT_URL or not WORKER_KEY,
    reason="production vertical requires real Nest API, API Postgres and checkpoint Postgres",
)

ASSESSMENT_ID = "assessment-lcsp-278-release"
BLOCKED_ASSESSMENT_ID = "assessment-lcsp-278-blocked"
SCAN_JOB_ID = "scan-lcsp-278-release"
BLOCKED_SCAN_JOB_ID = "scan-lcsp-278-blocked"
SNAPSHOT_ID = "snapshot-lcsp-278-release"
BLOCKED_SNAPSHOT_ID = "snapshot-lcsp-278-blocked"
CORPUS_ID = "corpus-lcsp-278-release"
CATALOG_ID = "catalog-lcsp-278-release"
LEGAL_RULE_ID = "LEGAL-LCSP-278-RELEASE"
ENGINEERING_RULE_ID = "ENG-LCSP-278-RELEASE"
EVIDENCE_REF = "EV-LCSP-278-RELEASE"
NEED_ID = "need-lcsp-278-approval-authority"
BLOCKED_NEED_ID = "need-lcsp-278-blocked-approval-authority"


def _confirmed_context(
    assessment_id: str,
    topic: str,
    statement: str,
    *,
    revision: int,
) -> dict[str, Any]:
    return {
        "assessmentId": assessment_id,
        "contextRevision": revision,
        "authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY",
        "statements": [
            {
                "statementId": f"stmt-{topic}",
                "topic": topic,
                "statement": statement,
                "normalizedValue": statement,
                "scope": {"topic": topic},
                "evidenceRefs": ["evidence:customer:production"],
                "respondentRef": "actor:authenticated-production",
                "createdAt": "2026-09-05T00:00:00Z",
                "source": "CUSTOMER_CONFIRMED",
                "resolutionState": "CONFIRMED",
            }
        ],
        "limitations": ["customer-confirmed current statements only"],
        "sourceVersionRef": SNAPSHOT_ID,
        "pgeVersion": "production-pge:v1",
        "guidanceVersion": "guidance-production-1",
    }


class _DurableState(TypedDict, total=False):
    messages: Annotated[list[Any], add_messages]
    structured_response: dict[str, Any]


class _ScriptedSpecialistFactory:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = list(responses)
        self.invoke_count = 0

    def __call__(self, **_kwargs: Any) -> Any:
        factory = self

        class _Agent:
            def invoke(self, _payload: dict[str, Any], *, config=None, context=None):
                _ = config, context
                if not factory.responses:
                    raise AssertionError("unexpected extra Interview specialist invocation")
                factory.invoke_count += 1
                return {"structured_response": factory.responses.pop(0)}

        return _Agent()


class _RootRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def invoke(self, payload: dict[str, Any], *, config=None):
        self.calls.append({"payload": payload, "config": config or {}})
        return {"messages": []}


def _durable_create_agent_factory(
    run_counter: list[int],
    *,
    snapshot_id: str = SNAPSHOT_ID,
    need_id: str = NEED_ID,
    instructions: list[str] | None = None,
):
    def create_agent(**kwargs: Any):
        checkpointer = kwargs["checkpointer"]
        builder = StateGraph(_DurableState)

        def investigator(state: _DurableState):
            run_counter.append(1)
            if instructions is not None:
                messages = state.get("messages") or []
                if messages:
                    content = getattr(messages[-1], "content", None)
                    if isinstance(content, str):
                        instructions.append(content)
            if len(state.get("messages") or []) <= 1:
                structured = {
                    "status": "NEEDS_INPUT",
                    "artifact_versions": {
                        "technicalEvidenceReportId": kwargs["_lcsp_report_id"],
                        "repositorySnapshotId": snapshot_id,
                        "legalRuleCatalogVersionId": CATALOG_ID,
                        "legalCorpusVersionId": CORPUS_ID,
                    },
                    "claims": [],
                    "limitations": [],
                    "missing_input": "Customer approval authority is required.",
                    "business_context_need": {
                        "need_id": need_id,
                        "business_context_need": (
                            "Who approves the AI recommendation before action?"
                        ),
                        "resolution_criteria": ["decision_authority"],
                    },
                    "next_step": "RESOLVE",
                }
            else:
                structured = {
                    "status": "READY",
                    "artifact_versions": {
                        "technicalEvidenceReportId": kwargs["_lcsp_report_id"],
                        "repositorySnapshotId": snapshot_id,
                        "legalRuleCatalogVersionId": CATALOG_ID,
                        "legalCorpusVersionId": CORPUS_ID,
                    },
                    "claims": [
                        {
                            "claim_id": "claim-lcsp-278-release",
                            "engineering_rule_id": ENGINEERING_RULE_ID,
                            "claim_type": "RULE_REQUIREMENT_MET",
                            "value": True,
                            "evidence_refs": [EVIDENCE_REF],
                            "graph_path_refs": [],
                            "source_anchor_refs": [],
                            "confidence": 0.95,
                            "limitations": [],
                            "criterion": "CONTROL",
                        }
                    ],
                    "limitations": [],
                    "missing_input": None,
                    "business_context_need": None,
                    "next_step": "GATE",
                }
            return {"structured_response": structured}

        builder.add_node("investigator", investigator)
        builder.add_edge(START, "investigator")
        builder.add_edge("investigator", END)
        return builder.compile(checkpointer=checkpointer)

    return create_agent


def test_release_gate_crosses_real_api_outbox_checkpoint_and_callback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    assert API_BASE_URL and API_DATABASE_URL and CHECKPOINT_URL and WORKER_KEY
    os.environ["LEGAL_CHROMA_PATH"] = str(tmp_path / "chroma")

    api = WorkerApiClient(API_BASE_URL, WORKER_KEY)
    report_id = _post_scan_callback(api)
    accepted_event = _outbox_payload(
        "event.technical-evidence.accepted.v1",
        aggregate_id=report_id,
    )
    assert accepted_event["assessmentId"] == ASSESSMENT_ID
    assert accepted_event["evidenceReportId"] == report_id
    assert "source_code" not in json.dumps(accepted_event)

    _seed_engineering_rule_cache(api, report_id)
    config = SimpleNamespace(
        nestjs_api_base_url=API_BASE_URL,
        worker_api_key=WORKER_KEY,
        langgraph_checkpoint_database_url=CHECKPOINT_URL,
    )
    interview_factory = _ScriptedSpecialistFactory(
        [
            {
                "expectedContextRevision": 0,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-lcsp-278-initial",
                    "intent": "ASK",
                    "control": "FREE_TEXT",
                    "prompt": "What is the business purpose of this AI-supported flow?",
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 1,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CONFIRMED",
                "confirmedContext": _confirmed_context(
                    ASSESSMENT_ID,
                    "system_purpose",
                    "AI-assisted recommendation",
                    revision=1,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 1,
                "mode": "TARGETED_INTERVIEW",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-lcsp-278-targeted",
                    "intent": "CLARIFY",
                    "control": "FREE_TEXT",
                    "prompt": "Who must approve the recommendation before action?",
                    "needId": NEED_ID,
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 2,
                "mode": "TARGETED_INTERVIEW",
                "outcome": "WAITING_FOR_CUSTOMER",
                "contextAuthority": "CUSTOMER_STATED",
                "activeQuestion": {
                    "id": "question-lcsp-278-targeted-confirm",
                    "intent": "CLARIFY",
                    "control": "CONFIRM_ADJUST",
                    "prompt": "Please confirm the approval authority before resume.",
                    "priorAnswerSummary": "A human manager must approve before action.",
                    "needId": NEED_ID,
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 3,
                "mode": "TARGETED_INTERVIEW",
                "outcome": "CONTEXT_RESOLVED",
                "contextAuthority": "CUSTOMER_CONFIRMED",
                "confirmedContext": _confirmed_context(
                    ASSESSMENT_ID,
                    "decision_authority",
                    "A human manager must approve before action",
                    revision=3,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
        ]
    )
    dispatcher = RootSubagentDispatcher(agent_factory=interview_factory)
    run_counter: list[int] = []
    investigator_instructions: list[str] = []

    def create_agent_with_report(**kwargs: Any):
        kwargs["_lcsp_report_id"] = report_id
        return _durable_create_agent_factory(
            run_counter,
            instructions=investigator_instructions,
        )(**kwargs)

    monkeypatch.setattr(managed, "create_agent", create_agent_with_report)

    boundary = InterviewGatedEngineeringAssessmentBoundary(
        config,
        api_client=api,
        interview_dispatcher=dispatcher,
    )
    boundary.handle(accepted_event, "corr-lcsp-278-accepted")

    public_initial = _public_interview_state()
    assert public_initial["activeQuestion"]["id"] == "question-lcsp-278-initial"
    assert _classification_count() == 0

    _submit_answer(
        "question-lcsp-278-initial",
        free_text="The system provides recommendations only.",
    )
    initial_resume = _latest_resume_payload()
    initial_resume_boundary = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
    )
    initial_resume_boundary.handle(initial_resume, "corr-lcsp-278-initial-answer")

    ready_state = _thread_state()
    assert ready_state["state"]["outcome"] == "WAITING_FOR_CUSTOMER"
    assert ready_state["private"]["targetedNeed"]["needId"] == NEED_ID
    continuation = ready_state["private"]["targetedContinuation"]
    assert continuation["investigatorExecutionId"]
    assert continuation["checkpointId"]
    assert "checkpointId" not in json.dumps(ready_state["private"]["targetedNeed"])
    assert run_counter == [1]
    assert _classification_count() == 0

    registry_record = ManagedInvestigatorExecutionStore(CHECKPOINT_URL).get(
        continuation["investigatorExecutionId"]
    )
    assert registry_record is not None
    assert registry_record.status == "WAITING"
    assert registry_record.thread_id == continuation["workflowRunId"]
    assert registry_record.checkpoint_id == continuation["checkpointId"]

    targeted_resume = _latest_resume_payload()
    targeted_resume_boundary = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
    )
    targeted_resume_boundary.handle(
        targeted_resume,
        "corr-lcsp-278-targeted-question",
    )
    assert _public_interview_state()["activeQuestion"]["needId"] == NEED_ID
    targeted_resume_boundary.handle(
        targeted_resume,
        "corr-lcsp-278-targeted-question-replay",
    )
    assert interview_factory.invoke_count == 3

    _submit_answer(
        "question-lcsp-278-targeted",
        free_text="A human manager must approve before action.",
    )
    targeted_resume_boundary.handle(
        _latest_resume_payload(),
        "corr-lcsp-278-targeted-confirm",
    )
    assert (
        _public_interview_state()["activeQuestion"]["id"]
        == "question-lcsp-278-targeted-confirm"
    )

    _submit_answer("question-lcsp-278-targeted-confirm", confirmed=True)
    resolved_resume = _latest_resume_payload()
    targeted_resume_boundary.handle(
        resolved_resume,
        "corr-lcsp-278-targeted-resolved",
    )

    assert run_counter == [1, 1]
    assert len(investigator_instructions) == 2
    resumed_instruction = investigator_instructions[-1]
    assert "ConfirmedStructuredBusinessContext(" not in resumed_instruction
    assert '"authority": "CUSTOMER_CONFIRMED_CONFIRMED_ONLY"' in resumed_instruction
    assert '"contextRevision": 3' in resumed_instruction
    assert '"topic": "decision_authority"' in resumed_instruction
    assert '"source": "CUSTOMER_CONFIRMED"' in resumed_instruction
    assert '"resolutionState": "CONFIRMED"' in resumed_instruction
    assert "CUSTOMER_STATED" not in resumed_instruction
    assert "UNCERTAIN" not in resumed_instruction
    assert "CONFLICTED" not in resumed_instruction
    assert "SUPERSEDED" not in resumed_instruction
    result = _classification_result()
    data = result["classificationData"]
    assert result["assessmentId"] == ASSESSMENT_ID
    assert data["technical_evidence_report_id"] == report_id
    assert data["snapshot_id"] == SNAPSHOT_ID
    assert data["summary"]["total"] == 1
    assert data["summary"]["compliant"] == 1
    assert data["planner"]["candidate_count"] == 1
    assert data["planner_decisions"][0]["final_decision"] == "SELECT"

    targeted_resume_boundary.handle(
        resolved_resume,
        "corr-lcsp-278-targeted-resolved-replay",
    )
    assert run_counter == [1, 1]
    assert _classification_count() == 1

    root = _RootRecorder()
    _mutate_snapshot_provenance()
    stale_resume = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
        root_agent=root,
    )
    stale_resume.handle(initial_resume, "corr-lcsp-278-stale-replay")
    assert root.calls
    assert interview_factory.invoke_count == 5
    assert run_counter == [1, 1]


def test_release_gate_blocks_unresolved_targeted_context_without_resume(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    assert API_BASE_URL and API_DATABASE_URL and CHECKPOINT_URL and WORKER_KEY
    os.environ["LEGAL_CHROMA_PATH"] = str(tmp_path / "blocked-chroma")

    api = WorkerApiClient(API_BASE_URL, WORKER_KEY)
    report_id = _post_scan_callback(
        api,
        scan_job_id=BLOCKED_SCAN_JOB_ID,
        snapshot_id=BLOCKED_SNAPSHOT_ID,
    )
    accepted_event = _outbox_payload(
        "event.technical-evidence.accepted.v1",
        aggregate_id=report_id,
    )
    assert accepted_event["assessmentId"] == BLOCKED_ASSESSMENT_ID

    _seed_engineering_rule_cache(api, report_id)
    config = SimpleNamespace(
        nestjs_api_base_url=API_BASE_URL,
        worker_api_key=WORKER_KEY,
        langgraph_checkpoint_database_url=CHECKPOINT_URL,
    )
    interview_factory = _ScriptedSpecialistFactory(
        [
            {
                "expectedContextRevision": 0,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-lcsp-278-blocked-initial",
                    "intent": "ASK",
                    "control": "FREE_TEXT",
                    "prompt": "What is the business purpose of this AI-supported flow?",
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 1,
                "mode": "INITIAL_INTERVIEW",
                "outcome": "CONTEXT_READY",
                "contextAuthority": "CONFIRMED",
                "confirmedContext": _confirmed_context(
                    BLOCKED_ASSESSMENT_ID,
                    "system_purpose",
                    "AI-assisted recommendation",
                    revision=1,
                ),
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 1,
                "mode": "TARGETED_INTERVIEW",
                "outcome": "WAITING_FOR_CUSTOMER",
                "activeQuestion": {
                    "id": "question-lcsp-278-blocked-targeted",
                    "intent": "CLARIFY",
                    "control": "FREE_TEXT",
                    "prompt": "Who must approve the recommendation before action?",
                    "needId": BLOCKED_NEED_ID,
                },
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [],
                "targetedResolution": {},
            },
            {
                "expectedContextRevision": 2,
                "mode": "TARGETED_INTERVIEW",
                "outcome": "BLOCKED_OR_UNRESOLVED",
                "contextAuthority": "CUSTOMER_STATED",
                "confirmedContext": {},
                "flags": [],
                "blockedActions": [
                    "PROVIDE_MORE_CONTEXT",
                    "CHECK_INTERNALLY",
                    "SAVE_AND_EXIT",
                ],
                "targetedResolution": {},
            },
        ]
    )
    dispatcher = RootSubagentDispatcher(agent_factory=interview_factory)
    run_counter: list[int] = []

    def create_agent_with_report(**kwargs: Any):
        kwargs["_lcsp_report_id"] = report_id
        return _durable_create_agent_factory(
            run_counter,
            snapshot_id=BLOCKED_SNAPSHOT_ID,
            need_id=BLOCKED_NEED_ID,
        )(**kwargs)

    monkeypatch.setattr(managed, "create_agent", create_agent_with_report)

    boundary = InterviewGatedEngineeringAssessmentBoundary(
        config,
        api_client=api,
        interview_dispatcher=dispatcher,
    )
    boundary.handle(accepted_event, "corr-lcsp-278-blocked-accepted")
    assert (
        _public_interview_state(BLOCKED_ASSESSMENT_ID)["activeQuestion"]["id"]
        == "question-lcsp-278-blocked-initial"
    )

    _submit_answer(
        "question-lcsp-278-blocked-initial",
        assessment_id=BLOCKED_ASSESSMENT_ID,
        free_text="The system provides recommendations only.",
    )
    resume_boundary = AssessmentInterviewResumeBoundary(
        config,
        api_client=api,
        dispatcher=dispatcher,
    )
    resume_boundary.handle(
        _latest_resume_payload(BLOCKED_ASSESSMENT_ID),
        "corr-lcsp-278-blocked-initial-answer",
    )
    state = _thread_state(BLOCKED_ASSESSMENT_ID)
    continuation = state["private"]["targetedContinuation"]
    assert state["private"]["targetedNeed"]["needId"] == BLOCKED_NEED_ID
    assert run_counter == [1]

    registry_record = ManagedInvestigatorExecutionStore(CHECKPOINT_URL).get(
        continuation["investigatorExecutionId"]
    )
    assert registry_record is not None
    assert registry_record.status == "WAITING"

    resume_boundary.handle(
        _latest_resume_payload(BLOCKED_ASSESSMENT_ID),
        "corr-lcsp-278-blocked-targeted-question",
    )
    assert (
        _public_interview_state(BLOCKED_ASSESSMENT_ID)["activeQuestion"]["needId"]
        == BLOCKED_NEED_ID
    )

    _submit_answer(
        "question-lcsp-278-blocked-targeted",
        assessment_id=BLOCKED_ASSESSMENT_ID,
        free_text="I do not know who approves it yet.",
    )
    resume_boundary.handle(
        _latest_resume_payload(BLOCKED_ASSESSMENT_ID),
        "corr-lcsp-278-blocked-targeted-answer",
    )

    blocked_state = _public_interview_state(BLOCKED_ASSESSMENT_ID)
    assert blocked_state["outcome"] == "BLOCKED_OR_UNRESOLVED"
    assert blocked_state["blockedActions"] == [
        "PROVIDE_MORE_CONTEXT",
        "CHECK_INTERNALLY",
        "SAVE_AND_EXIT",
    ]
    assert blocked_state.get("activeQuestion") is None
    assert run_counter == [1]
    assert interview_factory.invoke_count == 4
    assert _classification_count(BLOCKED_ASSESSMENT_ID) == 0


def _post_scan_callback(
    api: WorkerApiClient,
    *,
    scan_job_id: str = SCAN_JOB_ID,
    snapshot_id: str = SNAPSHOT_ID,
) -> str:
    result = api.post_scan_callback(
        scan_job_id,
        ScanCallbackPayload(
            scan_job_id=scan_job_id,
            status="SUCCESS",
            tools_version={"scanner": "lcsp-278-release"},
            config_hash={"scanner": "sha256:lcsp-278-release"},
            evidence_payload={"evidence_graph": _program_graph(snapshot_id)},
            privacy_flags={
                "containsSourceCode": False,
                "secretsRedacted": True,
                "sourceStrippedFromFindings": True,
            },
            schema_version="1.0.0",
        ),
    )
    assert result.accepted is True
    assert result.evidence_report_id
    return str(result.evidence_report_id)


def _seed_engineering_rule_cache(api: WorkerApiClient, report_id: str) -> None:
    retriever = ChromaDbCitationRetriever()
    cache = EngineeringRuleCache()
    service = EngineeringRuleService(retriever=retriever, cache=cache)
    corpus = api.get_legal_corpus_chunks(CORPUS_ID)
    chunks = [item for item in corpus.get("chunks", []) if isinstance(item, dict)]
    retriever.index_corpus(CORPUS_ID, chunks)
    catalog = api.get_active_legal_rule_catalog()
    legal_rule = next(
        rule
        for rule in catalog.get("rules", [])
        if isinstance(rule, dict) and rule.get("legalRuleId") == LEGAL_RULE_ID
    )
    legal_context, fingerprint = service.resolve_source_identity(
        legal_rule=legal_rule,
        legal_corpus_version_id=CORPUS_ID,
    )
    rule = EngineeringRule(
        engineering_rule_id=ENGINEERING_RULE_ID,
        legal_rule_id=LEGAL_RULE_ID,
        legal_rule_catalog_version_id=CATALOG_ID,
        legal_corpus_version_id=CORPUS_ID,
        concept="approval authority",
        legal_intent={"requires": "human approval authority"},
        investigation_goals=("inspect approval authority",),
        starting_node_types=("AI_MODEL_INVOCATION",),
        target_node_types=("AI_MODEL_INVOCATION",),
        edge_strategies=(),
        graph_queries=(
            GraphQueryTemplate(
                name="approval_authority_ai_invocation",
                start_node_types=("AI_MODEL_INVOCATION",),
            ),
        ),
        keywords=("approval", "authority", "recommendation"),
        required_evidence=("CONTROL",),
        source_chunk_ids=tuple(str(item["id"]) for item in legal_context),
        source_locators=tuple(str(item["locator"]) for item in legal_context),
        legal_reasoning_contract=build_legal_reasoning_contract(
            legal_rule=legal_rule,
            legal_rule_catalog_version_id=CATALOG_ID,
            legal_corpus_version_id=CORPUS_ID,
            legal_context=legal_context,
            required_evidence=("CONTROL",),
            supporting_evidence=(),
            negative_evidence=(),
        ),
        source_fingerprint=fingerprint,
        compiler_model="lcsp-278-release-seed",
        compiler_version="lcsp-278-release-seed",
        prompt_version="lcsp-278-release-seed",
    )
    cache.put(fingerprint, [rule])
    assert isinstance(EngineeringRulePlanner(), EngineeringRulePlanner)


def _program_graph(snapshot_id: str = SNAPSHOT_ID) -> dict[str, Any]:
    return {
        "graph_id": "graph-lcsp-278-release",
        "snapshot_id": snapshot_id,
        "commit_sha": "0123456789abcdef0123456789abcdef01234567",
        "node_count": 1,
        "edge_count": 0,
        "coverage_state": "PARTIAL",
        "coverage_notes": ["dynamic configuration remains bounded but incomplete"],
        "nodes": [
            {
                "node_id": "node:approval-authority-ai",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "approval authority recommendation model invocation",
                "source": {
                    "file_path": "src/recommendation_service.py",
                    "symbol_ref": "build_recommendation",
                    "start_line": 12,
                    "end_line": 24,
                },
                "attributes": {"purpose": "recommendation approval authority"},
                "semantic_types": ["approval_authority", "recommendation"],
                "evidence_refs": [EVIDENCE_REF],
                "origin": "STATIC_ANALYSIS",
                "resolution_state": "OBSERVED",
                "support_refs": [],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "evidence_refs": [EVIDENCE_REF],
        "graph_hash": "sha256:lcsp-278-release",
    }


def _submit_answer(
    question_id: str,
    *,
    assessment_id: str = ASSESSMENT_ID,
    free_text: str | None = None,
    confirmed: bool | None = None,
) -> dict[str, Any]:
    token = _sign_in()
    payload: dict[str, Any] = {"questionId": question_id}
    if free_text is not None:
        payload["freeText"] = free_text
    if confirmed is not None:
        payload["confirmed"] = confirmed
    with httpx.Client(base_url=API_BASE_URL, timeout=30.0) as client:
        response = client.post(
            f"/assessments/{assessment_id}/interview/answers",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
    assert response.status_code == 201, response.text
    return _unwrap(response.json())


def _public_interview_state(assessment_id: str = ASSESSMENT_ID) -> dict[str, Any]:
    token = _sign_in()
    with httpx.Client(base_url=API_BASE_URL, timeout=30.0) as client:
        response = client.get(
            f"/assessments/{assessment_id}/interview",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 200, response.text
    return _unwrap(response.json())


def _sign_in() -> str:
    with httpx.Client(base_url=API_BASE_URL, timeout=30.0) as client:
        response = client.post(
            "/auth/sign-in",
            json={
                "email": "manager@acme.test",
                "password": "CorrectHorseBatteryStaple!",
                "organization_id": "org-1",
            },
        )
    assert response.status_code in {200, 201}, response.text
    token = _unwrap(response.json())["session_token"]
    return str(token)


def _latest_resume_payload(assessment_id: str = ASSESSMENT_ID) -> dict[str, Any]:
    return _outbox_payload(
        "command.assessment-interview.resume-agent.v1",
        aggregate_id=assessment_id,
    )


def _outbox_payload(event_type: str, *, aggregate_id: str) -> dict[str, Any]:
    with _api_connection() as connection:
        row = connection.execute(
            """
            SELECT payload
            FROM "OutboxMessage"
            WHERE "eventType" = %s AND "aggregateId" = %s
            ORDER BY "createdAt" DESC
            LIMIT 1
            """,
            (event_type, aggregate_id),
        ).fetchone()
    assert row is not None, f"missing outbox event {event_type}"
    payload = row["payload"]
    assert isinstance(payload, dict)
    return payload


def _thread_state(assessment_id: str = ASSESSMENT_ID) -> dict[str, Any]:
    with _api_connection() as connection:
        row = connection.execute(
            """
            SELECT "stateJson", "privateContextJson"
            FROM "AssessmentInterviewThread"
            WHERE "assessmentId" = %s
            """,
            (assessment_id,),
        ).fetchone()
    assert row is not None
    private = row["privateContextJson"]
    assert isinstance(private, dict)
    return {"state": row["stateJson"], "private": private}


def _classification_count(assessment_id: str = ASSESSMENT_ID) -> int:
    with _api_connection() as connection:
        row = connection.execute(
            'SELECT COUNT(*) AS count FROM "ClassificationResult" WHERE "assessmentId" = %s',
            (assessment_id,),
        ).fetchone()
    assert row is not None
    return int(row["count"])


def _classification_result() -> dict[str, Any]:
    with _api_connection() as connection:
        row = connection.execute(
            """
            SELECT "assessmentId", "classificationData", "guardrailStatus"
            FROM "ClassificationResult"
            WHERE "assessmentId" = %s
            ORDER BY "createdAt" DESC
            LIMIT 1
            """,
            (ASSESSMENT_ID,),
        ).fetchone()
    assert row is not None
    assert isinstance(row["classificationData"], dict)
    return dict(row)


def _mutate_snapshot_provenance() -> None:
    with _api_connection() as connection:
        connection.execute(
            """
            UPDATE "RepositorySnapshot"
            SET "commitSha" = 'fedcba9876543210fedcba9876543210fedcba98'
            WHERE id = %s
            """,
            (SNAPSHOT_ID,),
        )
        connection.commit()


def _api_connection():
    assert API_DATABASE_URL
    return psycopg.connect(_libpq_url(API_DATABASE_URL), row_factory=dict_row)


def _libpq_url(value: str) -> str:
    parsed = urlsplit(value)
    query = urlencode(
        [(key, item) for key, item in parse_qsl(parsed.query) if key != "schema"]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def _unwrap(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("ok") is True and isinstance(value.get("data"), dict):
        return value["data"]
    return value
