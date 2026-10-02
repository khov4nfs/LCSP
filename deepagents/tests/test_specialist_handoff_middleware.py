from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from langchain.messages import ToolMessage
from langgraph.types import Command

from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_LIMITATION_CODES,
)
from middleware import specialist_handoff_validation
from middleware.specialist_handoff_validation import (
    _validate_lcsp_specialist_task_handoff,
)
from orchestration.context import LCSPRunContext


class FakeRequest:
    def __init__(self, *, context, metadata=None, tool_call=None):
        self.runtime = SimpleNamespace(
            context=context,
            config={"metadata": dict(metadata or {})},
        )
        self.tool_call = tool_call or {
            "name": "task",
            "id": "call-1",
            "args": {
                "subagent_type": "investigator",
                "description": "Investigate one pinned rule.",
            },
        }

    def override(self, **kwargs):
        return FakeRequest(
            context=self.runtime.context,
            metadata=self.runtime.config.get("metadata"),
            tool_call=kwargs.get("tool_call", self.tool_call),
        )


def _program_graph() -> dict:
    return {
        "graph_id": "graph-1",
        "snapshot_id": "snapshot-1",
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
                "evidence_refs": [],
                "origin": "DEEP_AGENT",
                "resolution_state": "CORROBORATED",
                "support_refs": [],
            }
        ],
        "edges": [],
        "source_anchors": [],
        "evidence_refs": [],
        "graph_hash": "sha256:graph",
    }


def _investigator_handoff(*, graph_ref: str = "node:ai") -> dict:
    return {
        "status": "READY",
        "artifact_versions": {"technicalEvidenceReportId": "ter-1"},
        "claims": [
            {
                "claim_id": "claim-1",
                "engineering_rule_id": "ENG-1",
                "claim_type": "UNRESOLVED_ENGINEERING_FACT",
                "value": None,
                "evidence_refs": [],
                "graph_path_refs": [graph_ref],
                "source_anchor_refs": [],
                "confidence": 0.9,
                "limitations": [
                    ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
                ],
                "criterion": "AI invocation exists",
            }
        ],
        "limitations": [],
        "missing_input": None,
        "next_step": "GATE",
    }


def test_task_middleware_validates_investigator_tool_message_handoff() -> None:
    request = FakeRequest(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="user-1",
            workflow_run_id="workflow-1",
            artifact_versions={"technicalEvidenceReportId": "ter-1"},
            engineering_rule_ids=("ENG-1",),
        ),
        metadata={"program_graph": _program_graph()},
    )
    expected = Command(
        update={
            "messages": [
                ToolMessage(
                    content=json.dumps(_investigator_handoff()),
                    tool_call_id="call-1",
                )
            ]
        }
    )
    handler = MagicMock(return_value=expected)

    result = _validate_lcsp_specialist_task_handoff(request, handler)

    assert result is expected
    handler.assert_called_once_with(request)


def _interview_handoff() -> dict:
    return {
        "expectedContextRevision": 0,
        "mode": "INITIAL_INTERVIEW",
        "outcome": "WAITING_FOR_CUSTOMER",
        "activeQuestion": {
            "id": "question-1",
            "intent": "ASK",
            "control": "FREE_TEXT",
            "prompt": "Who approves this business action?",
            "frontier": {
                "owner": "CUSTOMER",
                "materiality": "MATERIAL",
                "description": "Approval authority",
                "evidenceRefs": [],
            },
        },
    }


def _triage_handoff() -> dict:
    return {
        "status": "READY",
        "triage_execution_id": "triage:1",
        "trigger": "SCHEDULED",
    }


def test_task_middleware_rejects_invalid_investigator_graph_ref() -> None:
    """PlannerResult/InvestigatorResult were intentionally deleted.

    SPECIALIST_RESPONSE_FORMATS is now {interview, triage} only, so the removed
    specialist types fail closed as unknown handoff types.
    """
    from orchestration.result_validation import (
        SpecialistHandoffValidationError,
        validate_specialist_handoff,
    )

    for removed in ("investigator", "planner"):
        with pytest.raises(SpecialistHandoffValidationError, match="unknown"):
            validate_specialist_handoff(removed, {"status": "READY"})

    # The task-boundary middleware no longer validates removed types: an
    # investigator task passes through untouched (no evidence-claim check).
    request = FakeRequest(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="user-1",
            workflow_run_id="workflow-1",
            artifact_versions={"technicalEvidenceReportId": "ter-1"},
            engineering_rule_ids=("ENG-1",),
        ),
        metadata={"program_graph": _program_graph()},
    )
    expected = Command(
        update={
            "messages": [
                ToolMessage(
                    content=json.dumps(
                        _investigator_handoff(graph_ref="node:missing")
                    ),
                    tool_call_id="call-1",
                )
            ]
        }
    )
    handler = MagicMock(return_value=expected)

    assert _validate_lcsp_specialist_task_handoff(request, handler) is expected


def test_task_middleware_loads_program_graph_from_env_backed_api_client(
    monkeypatch,
) -> None:
    """Retargeted: the task boundary no longer loads a program graph.

    Only interview/triage return typed handoffs (validated via
    validate_specialist_handoff); the Repository Analyst persists through the
    governed submit_rule_assessment tool. This covers the current env-backed
    api-client loading plus capability loading (Codebase Memory graph tools,
    subject repository guard, submit_rule_assessment).
    """
    from tools.common.capabilities.platform.api_client import WorkerApiClient
    from tools.common.capabilities.platform.config import load_config

    monkeypatch.setenv("NESTJS_API_BASE_URL", "https://api.internal")
    monkeypatch.setenv("WORKER_API_KEY", "worker-key")

    config = load_config()
    assert config.nestjs_api_base_url == "https://api.internal"
    assert config.worker_api_key == "worker-key"
    client = WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)
    assert client._base_url == "https://api.internal"

    monkeypatch.setattr(
        WorkerApiClient,
        "_get_with_retry",
        lambda self, path, params=None: {
            "evidence_payload": {"evidence_graph": _program_graph()}
        },
    )
    report = client.get_accepted_technical_evidence_report("ter-1")
    assert report["evidence_payload"]["evidence_graph"]["graph_id"] == "graph-1"

    # Capability loading for the current layout.
    from tools.common.codebase_memory_graph import CODEBASE_MEMORY_GRAPH_TOOLS
    from tools.common.capabilities.platform import subject_repository_tools
    from tools.common.submit_rule_assessment import submit_rule_assessment

    assert len(CODEBASE_MEMORY_GRAPH_TOOLS) == 5
    assert subject_repository_tools.SUBJECT_REPOSITORY_ROOT == "/workspace/repository"
    assert submit_rule_assessment.name == "submit_rule_assessment"

    # End-to-end: a valid interview handoff still passes the task boundary.
    request = FakeRequest(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="user-1",
            workflow_run_id="workflow-1",
            artifact_versions={"technicalEvidenceReportId": "ter-1"},
            engineering_rule_ids=("ENG-1",),
        ),
        tool_call={
            "name": "task",
            "id": "call-1",
            "args": {
                "subagent_type": "interview",
                "description": "Run initial interview.",
            },
        },
    )
    handler = MagicMock(
        return_value=Command(
            update={
                "messages": [
                    ToolMessage(
                        content=json.dumps(_interview_handoff()),
                        tool_call_id="call-1",
                    )
                ]
            }
        )
    )

    result = _validate_lcsp_specialist_task_handoff(request, handler)

    assert isinstance(result, Command)


def test_task_middleware_requires_json_structured_subagent_handoff() -> None:
    request = FakeRequest(
        context=LCSPRunContext(
            artifact_versions={"technicalEvidenceReportId": "ter-1"},
            engineering_rule_ids=("ENG-1",),
        ),
        tool_call={
            "name": "task",
            "id": "call-1",
            "args": {
                "subagent_type": "interview",
                "description": "Run initial interview.",
            },
        },
    )
    handler = MagicMock(
        return_value=Command(
            update={
                "messages": [
                    ToolMessage(content="plain text", tool_call_id="call-1")
                ]
            }
        )
    )

    with pytest.raises(RuntimeError, match="not valid JSON"):
        _validate_lcsp_specialist_task_handoff(request, handler)

    # A valid triage handoff passes the same boundary.
    triage_request = request.override(
        tool_call={
            "name": "task",
            "id": "call-1",
            "args": {
                "subagent_type": "triage",
                "description": "Run legal triage.",
            },
        }
    )
    triage_handler = MagicMock(
        return_value=Command(
            update={
                "messages": [
                    ToolMessage(
                        content=json.dumps(_triage_handoff()),
                        tool_call_id="call-1",
                    )
                ]
            }
        )
    )

    assert isinstance(
        _validate_lcsp_specialist_task_handoff(triage_request, triage_handler),
        Command,
    )
