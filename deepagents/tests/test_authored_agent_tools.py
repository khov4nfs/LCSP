from __future__ import annotations

from unittest.mock import Mock
from uuid import uuid4

from tools.common import runtime_envelope
from tools.common.runtime_envelope import (
    dispatch_agentic_tool,
    TrustedAgenticToolRequest,
)


def test_remote_cqrs_tool_posts_direct_agentic_tool_contract(monkeypatch) -> None:
    response = Mock(status_code=200)
    response.json.return_value = {"ok": True, "data": {"gapEvidence": []}}
    post = Mock(return_value=response)
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://api.test/")
    monkeypatch.setenv("WORKER_API_KEY", "worker-key")
    monkeypatch.setattr(runtime_envelope.httpx, "post", post)

    asmt_id = str(uuid4())
    wf_id = str(uuid4())
    req = TrustedAgenticToolRequest(
        assessment_id=asmt_id,
        user_id="user-1",
        workflow_run_id=wf_id,
        correlation_id=str(uuid4()),
        artifact_versions={"gapRowRef": "gap:test-row-1"},
        input={"rowRef": "gap:test-row-1"},
    )
    result = dispatch_agentic_tool("get_gap_evidence_trace", req)
    assert result == {"gapEvidence": []}
    assert post.called
    _, kwargs = post.call_args
    assert kwargs["headers"]["X-Worker-Api-Key"] == "worker-key"
    assert kwargs["json"]["tool_name"] == "get_gap_evidence_trace"
