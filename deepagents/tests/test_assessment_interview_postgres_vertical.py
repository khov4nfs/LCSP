from __future__ import annotations

import os
from typing import Annotated, Any, TypedDict
from uuid import uuid4

import pytest
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from orchestration.context import LCSPRunContext
from tools.common.capabilities.assessment.investigation.engineering_rule import (
    managed_targeted_investigator as managed,
)
from tools.common.capabilities.workflow.recovery.post_guard_continuation import (
    PostGuardContinuationStore,
)


CHECKPOINT_URL = os.environ.get("LCSP_TEST_CHECKPOINT_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not CHECKPOINT_URL,
    reason="real Postgres checkpoint integration requires LCSP_TEST_CHECKPOINT_DATABASE_URL",
)

ARTIFACT_PINS = {
    "technicalEvidenceReportId": "ter-postgres-1",
    "repositorySnapshotId": "snapshot-postgres-1",
    "legalRuleCatalogVersionId": "catalog-postgres-1",
    "legalCorpusVersionId": "corpus-postgres-1",
}


class _DurableState(TypedDict, total=False):
    messages: Annotated[list[Any], add_messages]
    structured_response: dict[str, Any]


class _PinnedApi:
    def get_active_legal_rule_catalog(self):
        return {"versionId": ARTIFACT_PINS["legalRuleCatalogVersionId"], "rules": []}

    def get_active_legal_corpus(self):
        return {"versionId": ARTIFACT_PINS["legalCorpusVersionId"]}

    def get_accepted_technical_evidence_report(self, report_id: str):
        assert report_id == ARTIFACT_PINS["technicalEvidenceReportId"]
        return {
            "id": report_id,
            "snapshot_id": ARTIFACT_PINS["repositorySnapshotId"],
            "user_id": "customer-postgres-1",
            "evidence_payload": {"evidence_graph": _program_graph()},
        }


def _program_graph() -> dict[str, Any]:
    return {
        "graph_id": "graph-postgres-1",
        "snapshot_id": ARTIFACT_PINS["repositorySnapshotId"],
        "commit_sha": "abc123",
        "node_count": 1,
        "edge_count": 0,
        "nodes": [
            {
                "node_id": "node:ai",
                "node_type": "AI_MODEL_INVOCATION",
                "label": "responses.create",
                "source": {},
                "attributes": {},
                "semantic_types": [],
                "evidence_refs": ["EV-POSTGRES-1"],
                "origin": "STATIC_ANALYSIS",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "evidence_refs": ["EV-POSTGRES-1"],
        "graph_hash": "sha256:postgres-graph",
    }


def _deterministic_durable_agent_factory(run_counter: list[int]):
    def factory(checkpointer):
        builder = StateGraph(_DurableState)

        def investigator(state: _DurableState):
            run_counter.append(1)
            message_count = len(state.get("messages") or [])
            if message_count <= 1:
                structured = {
                    "status": "NEEDS_INPUT",
                    "artifact_versions": dict(ARTIFACT_PINS),
                    "claims": [],
                    "limitations": [],
                    "missing_input": "Customer approval authority is required.",
                    "business_context_need": {
                        "need_id": "need-postgres-1",
                        "business_context_need": "Who approves the AI recommendation?",
                        "resolution_criteria": ["decision_authority"],
                    },
                    "next_step": "RESOLVE",
                }
            else:
                structured = {
                    "status": "READY",
                    "artifact_versions": dict(ARTIFACT_PINS),
                    "claims": [
                        {
                            "claim_id": "claim-postgres-1",
                            "engineering_rule_id": "ENG-POSTGRES-1",
                            "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                            "value": None,
                            "evidence_refs": ["EV-POSTGRES-1"],
                            "graph_path_refs": [],
                            "source_anchor_refs": [],
                            "confidence": 0.8,
                            "limitations": [],
                            "criterion": None,
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

    return factory


def test_post_guard_pending_completed_state_survives_store_reconstruction() -> None:
    suffix = uuid4().hex
    assessment_id = f"assessment-postguard-{suffix}"
    first = PostGuardContinuationStore(CHECKPOINT_URL)
    pending = first.begin(
        assessment_id=assessment_id,
        context_revision=7,
        outcome="CONTEXT_RESOLVED",
        payload={"continuation": {"investigatorExecutionId": f"exec-{suffix}"}},
    )
    assert pending.completed is False

    second = PostGuardContinuationStore(CHECKPOINT_URL)
    recovered = second.get(
        assessment_id=assessment_id,
        context_revision=7,
        outcome="CONTEXT_RESOLVED",
    )
    assert recovered is not None
    assert recovered.completed is False
    assert recovered.payload["continuation"]["investigatorExecutionId"] == f"exec-{suffix}"

    second.complete(
        assessment_id=assessment_id,
        context_revision=7,
        outcome="CONTEXT_RESOLVED",
    )
    third = PostGuardContinuationStore(CHECKPOINT_URL)
    completed = third.get(
        assessment_id=assessment_id,
        context_revision=7,
        outcome="CONTEXT_RESOLVED",
    )
    assert completed is not None and completed.completed


def test_exact_investigator_resume_uses_real_postgres_checkpoint_and_is_replay_safe(
    monkeypatch,
) -> None:
    suffix = uuid4().hex
    execution_id = f"exec-postgres-{suffix}"
    thread_id = f"investigator:{execution_id}"
    run_counter: list[int] = []
    monkeypatch.setattr(
        managed,
        "_durable_investigator_agent",
        _deterministic_durable_agent_factory(run_counter),
    )

    context = LCSPRunContext(
        assessment_id=f"assessment-postgres-{suffix}",
        user_id="customer-postgres-1",
        workflow_run_id=thread_id,
        artifact_versions=dict(ARTIFACT_PINS),
        engineering_rule_ids=("ENG-POSTGRES-1",),
        idempotency_key=f"investigator:{execution_id}",
    )
    first_handoff, first_checkpoint = managed._invoke_managed_investigator(
        checkpoint_url=CHECKPOINT_URL,
        thread_id=thread_id,
        checkpoint_id=None,
        context=context,
        instruction="Initial production Investigator turn",
        graph=_program_graph(),
        execution_id=execution_id,
        correlation_id="corr-postgres-initial",
    )
    assert first_handoff["status"] == "NEEDS_INPUT"
    assert len(run_counter) == 1

    targeted_need = {
        "needId": "need-postgres-1",
        "originatingInvestigationReference": (
            f"investigator:{execution_id}:need-postgres-1"
        ),
    }
    reconstructed = managed.reconstruct_managed_investigator_continuation(
        config=type(
            "Config",
            (),
            {"langgraph_checkpoint_database_url": CHECKPOINT_URL},
        )(),
        assessment_id=context.assessment_id,
        targeted_need=targeted_need,
        source_version="snapshot-postgres-1:abc123",
        pge_version="ter-postgres-1:v1",
    )
    assert reconstructed["checkpointId"] == first_checkpoint
    assert reconstructed["artifactVersions"] == ARTIFACT_PINS
    assert reconstructed["affectedRuleIds"] == ["ENG-POSTGRES-1"]

    api = _PinnedApi()
    config = type(
        "Config",
        (),
        {"langgraph_checkpoint_database_url": CHECKPOINT_URL},
    )()
    resumed = managed.resume_managed_investigator(
        config=config,
        api_client=api,
        assessment_id=context.assessment_id,
        context_revision=8,
        continuation=reconstructed,
        confirmed_context={"decision_authority": "human"},
        correlation_id="corr-postgres-resume",
    )
    assert resumed["executionId"] == execution_id
    assert resumed["fromCheckpointId"] == first_checkpoint
    assert resumed["checkpointId"] != first_checkpoint
    assert resumed["handoff"]["status"] == "READY"
    assert len(run_counter) == 2

    # A retry carrying the original continuation checkpoint must reuse the already
    # persisted READY child state instead of running the Investigator again.
    replay = managed.resume_managed_investigator(
        config=config,
        api_client=api,
        assessment_id=context.assessment_id,
        context_revision=8,
        continuation=reconstructed,
        confirmed_context={"decision_authority": "human"},
        correlation_id="corr-postgres-replay",
    )
    assert replay["handoff"]["status"] == "READY"
    assert replay["checkpointId"] == resumed["checkpointId"]
    assert len(run_counter) == 2
