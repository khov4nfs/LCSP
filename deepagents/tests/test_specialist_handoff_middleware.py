from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from langchain.messages import ToolMessage
from langgraph.types import Command

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
                "origin": "STATIC_ANALYSIS",
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
                "limitations": [],
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


def test_task_middleware_rejects_invalid_investigator_graph_ref() -> None:
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
    handler = MagicMock(
        return_value=Command(
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
    )

    with pytest.raises(RuntimeError, match="evidence-claim"):
        _validate_lcsp_specialist_task_handoff(request, handler)


def test_task_middleware_loads_program_graph_from_env_backed_api_client(
    monkeypatch,
) -> None:
    class FakeApiClient:
        def __init__(self, base_url: str, api_key: str) -> None:
            self.base_url = base_url
            self.api_key = api_key

        def get_accepted_technical_evidence_report(self, report_id: str) -> dict:
            assert report_id == "ter-1"
            return {"evidence_payload": {"evidence_graph": _program_graph()}}

    monkeypatch.setenv("NESTJS_API_BASE_URL", "https://api.internal")
    monkeypatch.setenv("WORKER_API_KEY", "worker-key")
    monkeypatch.setattr(
        specialist_handoff_validation,
        "WorkerApiClient",
        FakeApiClient,
    )
    request = FakeRequest(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="user-1",
            workflow_run_id="workflow-1",
            artifact_versions={"technicalEvidenceReportId": "ter-1"},
            engineering_rule_ids=("ENG-1",),
        )
    )
    handler = MagicMock(
        return_value=Command(
            update={
                "messages": [
                    ToolMessage(
                        content=json.dumps(_investigator_handoff()),
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
        )
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
