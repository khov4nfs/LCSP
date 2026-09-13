from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from typing import Any

from langchain.agents.structured_output import StructuredOutputError

from middleware.failure_policy import TerminalSchemaError

from orchestration.context import LCSPRunContext
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
    InvestigationPacket,
)
from tools.common.capabilities.assessment.investigation.engineering_rule import (
    managed_targeted_investigator as managed,
)
from tools.common.capabilities.assessment.investigation.engineering_rule.managed_investigator_execution_store import (
    MANAGED_INVESTIGATOR_EXECUTION_STATUSES,
)
from tools.common.capabilities.workflow.recovery.interview_boundary import (
    AssessmentInterviewResumeBoundary,
)

ARTIFACT_PINS = {
    "technicalEvidenceReportId": "ter-recovery-1",
    "repositorySnapshotId": "snapshot-recovery-1",
    "legalRuleCatalogVersionId": "catalog-recovery-1",
    "legalCorpusVersionId": "corpus-recovery-1",
}


def _program_graph() -> dict[str, Any]:
    return {
        "graph_id": "graph-recovery-1",
        "snapshot_id": ARTIFACT_PINS["repositorySnapshotId"],
        "commit_sha": "abc123",
        "nodes": [
            {
                "node_id": "node:ai",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "responses.create",
                "source": {},
                "attributes": {},
                "semantic_types": [],
                "evidence_refs": ["EV-RECOVERY-1"],
                "origin": "STATIC_ANALYSIS",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "evidence_refs": ["EV-RECOVERY-1"],
        "graph_hash": "sha256:recovery-graph",
    }


def _broken_handoff() -> dict[str, Any]:
    return {
        "status": "READY",
        "artifact_versions": dict(ARTIFACT_PINS),
        "claims": [
            {
                "claim_id": "claim-broken",
                "engineering_rule_id": "ENG-RECOVERY-1",
                "claim_type": "RULE_REQUIREMENT_MET",
                "value": True,
                "evidence_refs": [],
                "graph_path_refs": [],
                "source_anchor_refs": [],
                "confidence": 0.9,
                "limitations": [],
                "criterion": "AI invocation evidence exists",
            }
        ],
        "limitations": [],
        "missing_input": None,
        "business_context_need": None,
        "next_step": "GATE",
    }


def _valid_handoff() -> dict[str, Any]:
    result = _broken_handoff()
    result["claims"][0].update(
        {
            "claim_type": "UNRESOLVED_ENGINEERING_FACT",
            "value": None,
            "evidence_refs": ["EV-RECOVERY-1"],
            "limitations": [
                ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
            ],
        }
    )
    return result


def _context() -> LCSPRunContext:
    return LCSPRunContext(
        assessment_id="assessment-recovery-1",
        user_id="customer-recovery-1",
        workflow_run_id="investigator:exec-recovery-1",
        artifact_versions=dict(ARTIFACT_PINS),
        engineering_rule_ids=("ENG-RECOVERY-1",),
        idempotency_key="resume:exec-recovery-1:2",
    )


class _FakeCheckpointer:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def setup(self) -> None:
        return None


class _FakePostgresSaver:
    @classmethod
    def from_conn_string(cls, _checkpoint_url: str) -> _FakeCheckpointer:
        return _FakeCheckpointer()


def _install_fake_postgres_saver(monkeypatch) -> None:
    postgres = types.ModuleType("langgraph.checkpoint.postgres")
    postgres.PostgresSaver = _FakePostgresSaver
    checkpoint = types.ModuleType("langgraph.checkpoint")
    checkpoint.postgres = postgres
    langgraph = types.ModuleType("langgraph")
    langgraph.checkpoint = checkpoint
    monkeypatch.setitem(sys.modules, "langgraph", langgraph)
    monkeypatch.setitem(sys.modules, "langgraph.checkpoint", checkpoint)
    monkeypatch.setitem(sys.modules, "langgraph.checkpoint.postgres", postgres)


class _FakeStore:
    records: dict[str, SimpleNamespace] = {}
    saves: list[dict[str, Any]] = []

    def __init__(self, _database_url: str) -> None:
        return None

    def get(self, execution_id: str):
        return self.records.get(execution_id)

    def save(self, **kwargs):
        self.saves.append(dict(kwargs))
        record = SimpleNamespace(**kwargs)
        self.records[kwargs["execution_id"]] = record
        return record


class _RetryAgent:
    def __init__(self) -> None:
        self.invoke_calls: list[tuple[dict[str, Any], dict[str, Any]]] = []
        self._checkpoint_id = "checkpoint-broken"
        self._structured_response = _broken_handoff()

    def get_state(self, _config):
        return SimpleNamespace(
            config={"configurable": {"checkpoint_id": self._checkpoint_id}},
            values={"structured_response": self._structured_response},
        )

    def invoke(self, payload, config=None, context=None):
        self.invoke_calls.append((payload, config or {}))
        assert context is not None
        self._checkpoint_id = "checkpoint-repaired"
        self._structured_response = _valid_handoff()
        return {"structured_response": self._structured_response}


class _AlwaysInvalidShapeAgent(_RetryAgent):
    def __init__(self, response: dict[str, Any]) -> None:
        super().__init__()
        self._response = response
        self._checkpoint_id = "checkpoint-invalid-0"

    def invoke(self, payload, config=None, context=None):
        self.invoke_calls.append((payload, config or {}))
        assert context is not None
        self._checkpoint_id = f"checkpoint-invalid-{len(self.invoke_calls)}"
        self._structured_response = self._response
        return {"structured_response": self._structured_response}


class _AlwaysBrokenAgent(_RetryAgent):
    def invoke(self, payload, config=None, context=None):  # pragma: no cover - must not run
        raise AssertionError("threshold recovery must not invoke the model again")


class _InvalidThenValidAgent(_RetryAgent):
    def __init__(self, first_response: Any) -> None:
        super().__init__()
        self._first_response = first_response
        self._checkpoint_id = "checkpoint-initial"

    def invoke(self, payload, config=None, context=None):
        self.invoke_calls.append((payload, config or {}))
        assert context is not None
        if len(self.invoke_calls) == 1:
            if isinstance(self._first_response, BaseException):
                self._checkpoint_id = "checkpoint-invalid-json"
                raise self._first_response
            self._checkpoint_id = "checkpoint-invalid-shape"
            self._structured_response = self._first_response
            return {"structured_response": self._structured_response}
        self._checkpoint_id = "checkpoint-repaired"
        self._structured_response = _valid_handoff()
        return {"structured_response": self._structured_response}


def _seed_store(*, status: str, attempt_count: int) -> None:
    _FakeStore.records = {
        "exec-recovery-1": SimpleNamespace(
            execution_id="exec-recovery-1",
            assessment_id="assessment-recovery-1",
            thread_id="investigator:exec-recovery-1",
            checkpoint_id="checkpoint-original",
            affected_rule_ids=("ENG-RECOVERY-1",),
            artifact_versions=dict(ARTIFACT_PINS),
            status=status,
            attempt_count=attempt_count,
            last_error=None,
        )
    }
    _FakeStore.saves = []


def test_broken_stored_resume_handoff_is_rejected_then_model_retried_once(monkeypatch) -> None:
    _install_fake_postgres_saver(monkeypatch)
    _seed_store(
        status=MANAGED_INVESTIGATOR_EXECUTION_STATUSES["waiting"],
        attempt_count=0,
    )
    agent = _RetryAgent()
    monkeypatch.setattr(managed, "ManagedInvestigatorExecutionStore", _FakeStore)
    monkeypatch.setattr(managed, "_durable_investigator_agent", lambda _checkpointer: agent)

    handoff, checkpoint_id = managed._invoke_managed_investigator(
        checkpoint_url="postgresql://recovery-test",
        thread_id="investigator:exec-recovery-1",
        checkpoint_id="checkpoint-original",
        context=_context(),
        instruction="Resume after targeted Interview.",
        graph=_program_graph(),
        execution_id="exec-recovery-1",
        correlation_id="corr-recovery-1",
    )

    assert checkpoint_id == "checkpoint-repaired"
    assert handoff["status"] == "READY"
    assert len(agent.invoke_calls) == 1
    payload, config = agent.invoke_calls[0]
    assert "failed schema validation" in payload["messages"][0]["content"]
    assert config["configurable"]["checkpoint_id"] == "checkpoint-original"
    assert [save["status"] for save in _FakeStore.saves] == [
        MANAGED_INVESTIGATOR_EXECUTION_STATUSES["rejected"],
        MANAGED_INVESTIGATOR_EXECUTION_STATUSES["ready"],
    ]


def test_rejected_resume_threshold_fails_registry_and_passes_limitation_to_completion(
    monkeypatch,
) -> None:
    _install_fake_postgres_saver(monkeypatch)
    _seed_store(
        status=MANAGED_INVESTIGATOR_EXECUTION_STATUSES["rejected"],
        attempt_count=1,
    )
    agent = _AlwaysBrokenAgent()
    monkeypatch.setattr(managed, "ManagedInvestigatorExecutionStore", _FakeStore)
    monkeypatch.setattr(managed, "_durable_investigator_agent", lambda _checkpointer: agent)

    handoff, checkpoint_id = managed._invoke_managed_investigator(
        checkpoint_url="postgresql://recovery-test",
        thread_id="investigator:exec-recovery-1",
        checkpoint_id="checkpoint-original",
        context=_context(),
        instruction="Resume after targeted Interview.",
        graph=_program_graph(),
        execution_id="exec-recovery-1",
        correlation_id="corr-recovery-2",
    )

    assert checkpoint_id == "checkpoint-original"
    assert handoff["claims"][0]["claim_id"] == "claim:failed:ENG-RECOVERY-1"
    assert handoff["claims"][0]["limitations"] == [
        ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"]
    ]
    assert _FakeStore.saves[-1]["status"] == MANAGED_INVESTIGATOR_EXECUTION_STATUSES[
        "failed"
    ]
    assert _FakeStore.saves[-1]["attempt_count"] == 2

    completion_calls: list[dict[str, Any]] = []
    boundary = AssessmentInterviewResumeBoundary(
        SimpleNamespace(),
        api_client=SimpleNamespace(),
        investigator_resumer=lambda **_kwargs: {
            "executionId": "exec-recovery-1",
            "threadId": "investigator:exec-recovery-1",
            "fromCheckpointId": "checkpoint-original",
            "checkpointId": "checkpoint-original",
            "handoff": handoff,
        },
        investigation_completer=lambda **kwargs: completion_calls.append(kwargs),
    )
    boundary._resume_exact_investigator(
        assessment_id="assessment-recovery-1",
        context_revision=2,
        continuation={
            "investigatorExecutionId": "exec-recovery-1",
            "workflowRunId": "investigator:exec-recovery-1",
            "checkpointId": "checkpoint-original",
        },
        confirmed_context=SimpleNamespace(),
        correlationId="corr-recovery-2",
    )

    assert completion_calls[0]["resumed_handoff"]["claims"][0]["limitations"] == [
        ENGINEERING_LIMITATION_CODES["engineering_investigation_failed"]
    ]


def test_initial_invalid_handoff_is_recorded_and_retried_with_actionable_feedback(
    monkeypatch,
) -> None:
    _install_fake_postgres_saver(monkeypatch)
    _FakeStore.records = {}
    _FakeStore.saves = []
    invalid = _valid_handoff()
    invalid["claims"][0] = {
        "claim_id": "claim-live-shape",
        "engineering_rule_id": "ENG-RECOVERY-1",
        "claim_type": "RULE_REQUIREMENT_MET",
        "value": None,
        "evidence_refs": ["EV-RECOVERY-1"],
        "graph_path_refs": [],
        "source_anchor_refs": [],
        "customer_context_refs": ["statement:wrong-place"],
        "confidence": 0.8,
    }
    agent = _InvalidThenValidAgent(invalid)
    monkeypatch.setattr(managed, "ManagedInvestigatorExecutionStore", _FakeStore)
    monkeypatch.setattr(managed, "_durable_investigator_agent", lambda _checkpointer: agent)

    handoff, checkpoint_id = managed._invoke_managed_investigator(
        checkpoint_url="postgresql://recovery-test",
        thread_id="investigator:exec-recovery-1",
        checkpoint_id=None,
        context=_context(),
        instruction="Initial selected-rule investigation.",
        graph=_program_graph(),
        execution_id="exec-recovery-1",
        correlation_id="corr-recovery-3",
    )

    assert checkpoint_id == "checkpoint-repaired"
    assert handoff["status"] == "READY"
    assert len(agent.invoke_calls) == 2
    retry_prompt = agent.invoke_calls[1][0]["messages"][0]["content"]
    assert "failed schema validation" in retry_prompt
    assert "value" in retry_prompt
    assert [save["status"] for save in _FakeStore.saves] == [
        MANAGED_INVESTIGATOR_EXECUTION_STATUSES["rejected"],
        MANAGED_INVESTIGATOR_EXECUTION_STATUSES["ready"],
    ]
    assert _FakeStore.saves[0]["checkpoint_id"] == "checkpoint-invalid-shape"


def test_initial_malformed_native_json_is_retried_without_accepting_bad_output(
    monkeypatch,
) -> None:
    _install_fake_postgres_saver(monkeypatch)
    _FakeStore.records = {}
    _FakeStore.saves = []
    error = StructuredOutputError(
        "Native structured output expected valid JSON for response_format, parsing "
        "failed Unterminated string starting at line 16 column 202736"
    )
    agent = _InvalidThenValidAgent(error)
    monkeypatch.setattr(managed, "ManagedInvestigatorExecutionStore", _FakeStore)
    monkeypatch.setattr(managed, "_durable_investigator_agent", lambda _checkpointer: agent)

    handoff, checkpoint_id = managed._invoke_managed_investigator(
        checkpoint_url="postgresql://recovery-test",
        thread_id="investigator:exec-recovery-1",
        checkpoint_id=None,
        context=_context(),
        instruction="Initial selected-rule investigation.",
        graph=_program_graph(),
        execution_id="exec-recovery-1",
        correlation_id="corr-recovery-4",
    )

    assert checkpoint_id == "checkpoint-repaired"
    assert handoff["status"] == "READY"
    assert len(agent.invoke_calls) == 2
    assert "Unterminated string" in _FakeStore.saves[0]["last_error"]
    assert "Return only compact valid JSON" in agent.invoke_calls[1][0]["messages"][0]["content"]


def test_initial_terminal_tool_argument_error_is_recorded_and_retried(monkeypatch) -> None:
    _install_fake_postgres_saver(monkeypatch)
    _FakeStore.records = {}
    _FakeStore.saves = []
    error = TerminalSchemaError(
        "Tool argument schema validation failed; automatic repair disabled"
    )
    agent = _InvalidThenValidAgent(error)
    monkeypatch.setattr(managed, "ManagedInvestigatorExecutionStore", _FakeStore)
    monkeypatch.setattr(managed, "_durable_investigator_agent", lambda _checkpointer: agent)

    handoff, checkpoint_id = managed._invoke_managed_investigator(
        checkpoint_url="postgresql://recovery-test",
        thread_id="investigator:exec-recovery-1",
        checkpoint_id=None,
        context=_context(),
        instruction="Initial selected-rule investigation.",
        graph=_program_graph(),
        execution_id="exec-recovery-1",
        correlation_id="corr-recovery-terminal",
    )

    assert checkpoint_id == "checkpoint-repaired"
    assert handoff["status"] == "READY"
    assert len(agent.invoke_calls) == 2
    assert "Tool argument schema validation failed" in _FakeStore.saves[0]["last_error"]
    assert _FakeStore.saves[0]["status"] == MANAGED_INVESTIGATOR_EXECUTION_STATUSES[
        "rejected"
    ]
    assert "Tool argument schema validation failed" in agent.invoke_calls[1][0]["messages"][0][
        "content"
    ]


def test_rejected_threshold_canonicalizes_unprovable_shape_to_unresolved(monkeypatch) -> None:
    _install_fake_postgres_saver(monkeypatch)
    _FakeStore.records = {}
    _FakeStore.saves = []
    invalid = _valid_handoff()
    invalid["claims"][0] = {
        "claim_id": "claim-live-no-refs",
        "engineering_rule_id": "ENG-RECOVERY-1",
        "claim_type": "RULE_REQUIREMENT_MET",
        "value": True,
        "evidence_refs": [],
        "graph_path_refs": [],
        "source_anchor_refs": [],
        "confidence": 0.8,
        "limitations": [],
        "criterion": "AI invocation evidence exists",
    }
    agent = _AlwaysInvalidShapeAgent(invalid)
    monkeypatch.setattr(managed, "ManagedInvestigatorExecutionStore", _FakeStore)
    monkeypatch.setattr(managed, "_durable_investigator_agent", lambda _checkpointer: agent)

    handoff, checkpoint_id = managed._invoke_managed_investigator(
        checkpoint_url="postgresql://recovery-test",
        thread_id="investigator:exec-recovery-1",
        checkpoint_id=None,
        context=_context(),
        instruction="Initial selected-rule investigation.",
        graph=_program_graph(),
        execution_id="exec-recovery-1",
        correlation_id="corr-recovery-fail-closed",
    )

    assert checkpoint_id == "checkpoint-invalid-2"
    assert len(agent.invoke_calls) == 2
    claim = handoff["claims"][0]
    assert claim["claim_type"] == "UNRESOLVED_ENGINEERING_FACT"
    assert claim["value"] is None
    assert claim["confidence"] == 0.0
    assert claim["limitations"] == [
        ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
    ]
    assert [save["status"] for save in _FakeStore.saves] == [
        MANAGED_INVESTIGATOR_EXECUTION_STATUSES["rejected"],
        MANAGED_INVESTIGATOR_EXECUTION_STATUSES["ready"],
    ]


def test_initial_instruction_uses_bounded_packet_index_not_raw_graph_dump() -> None:
    huge_source = "x" * 80_000
    packet = InvestigationPacket(
        engineering_rule_id="ENG-RECOVERY-1",
        concept="AI evidence",
        investigation_goals=("Find bounded graph proof",),
        initial_results=(
            {
                "query": "ai_output_path",
                "phase": "DETERMINISTIC_SELECTED_RULE_TRACE",
                "nodes": [
                    {
                        "node_id": "node:ai",
                        "node_type": "AI_MODEL_INVOCATION",
                        "label": "responses.create",
                        "resolution_state": "CORROBORATED",
                        "attributes": {"source": huge_source},
                        "evidence_refs": ["EV-RECOVERY-1"],
                    }
                ],
                "edges": [
                    {
                        "edge_id": "edge:ai-output",
                        "edge_type": "RECEIVES_FROM_AI",
                        "source_node_id": "node:ai",
                        "target_node_id": "node:output",
                        "attributes": {"source": huge_source},
                        "evidence_refs": ["EV-RECOVERY-1"],
                    }
                ],
                "evidenceRefs": ["EV-RECOVERY-1"],
            },
        ),
        evidence_refs=("EV-RECOVERY-1",),
        required_evidence=("AI output path",),
    )

    instruction = managed._initial_instruction(packet, dict(ARTIFACT_PINS))

    assert len(instruction) < 20_000
    assert huge_source not in instruction
    assert "edge:ai-output" in instruction
    assert "Return only compact valid JSON" in instruction


def test_managed_investigator_returns_unresolved_without_model_when_packet_has_no_citable_refs(
    monkeypatch,
) -> None:
    packet = InvestigationPacket(
        engineering_rule_id="ENG-RECOVERY-NO-REFS",
        concept="No citable proof",
        investigation_goals=("Do not guess",),
        initial_results=(
            {
                "query": "material source hits",
                "phase": "DETERMINISTIC_SELECTED_RULE_TRACE",
                "materialSourceRefs": [],
                "evidenceRefs": [],
                "nodes": [],
                "edges": [],
            },
        ),
        evidence_refs=(),
        supporting_evidence=("Customer data exports are retained",),
    )
    adapter = managed._ManagedInvestigatorAdapter(
        config=SimpleNamespace(),
        api_client=SimpleNamespace(),
    )
    adapter._run = {
        "workflow_run_id": "workflow-no-refs",
        "assessment_id": "assessment-recovery-1",
        "user_id": "customer-recovery-1",
        "correlation_id": "corr-no-refs",
        "checkpoint_url": "postgresql://must-not-be-used",
        "artifact_versions": dict(ARTIFACT_PINS),
    }
    monkeypatch.setattr(
        managed,
        "_invoke_managed_investigator",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("model must not run")),
    )

    claims = adapter.investigate(
        packet=packet,
        graph=_program_graph(),
        workflow_run_id="workflow-no-refs",
        correlation_id="corr-no-refs",
    )

    assert len(claims) == 1
    assert claims[0].claim_type == "UNRESOLVED_ENGINEERING_FACT"
    assert claims[0].value is None
    assert claims[0].evidence_refs == ()
    assert claims[0].limitations == (
        ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],
    )


def test_structured_error_metadata_is_never_empty_for_schema_rejections() -> None:
    error = StructuredOutputError("Tool argument schema validation failed")

    assert managed._structured_error_metadata(error)["exception_type"] == "StructuredOutputError"
