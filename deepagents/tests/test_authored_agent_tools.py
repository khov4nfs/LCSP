from __future__ import annotations

from unittest.mock import Mock

from tools.common.search_program_graph import code as search_program_graph_code


def test_search_program_graph_posts_direct_agentic_tool_contract(monkeypatch) -> None:
    response = Mock(status_code=200)
    response.json.return_value = {"ok": True, "data": {"nodes": []}}
    post = Mock(return_value=response)
    monkeypatch.setenv("NESTJS_API_BASE_URL", "http://api.test/")
    monkeypatch.setenv("WORKER_API_KEY", "worker-key")
    monkeypatch.setattr(search_program_graph_code.httpx, "post", post)

    result = search_program_graph_code.search_program_graph.invoke(
        {
            "assessment_id": "assessment-1",
            "user_id": "user-1",
            "workflow_run_id": "run-1",
            "correlation_id": "correlation-1",
            "artifact_versions": {"technicalEvidenceReportId": "report-1"},
            "input": {"subjectRef": "symbol:1"},
        }
    )

    assert result == {"nodes": []}
    _, kwargs = post.call_args
    assert kwargs["headers"] == {
        "X-Worker-Api-Key": "worker-key",
        "X-Correlation-Id": "correlation-1",
    }
    assert kwargs["json"] == {
        "tool_name": "search_evidence",
        "request_id": kwargs["json"]["request_id"],
        "assessment_id": "assessment-1",
        "workflow_run_id": "run-1",
        "user_id": "user-1",
        "artifact_versions": {"technicalEvidenceReportId": "report-1"},
        "scope": {},
        "budget": {
            "maxItems": 50,
            "maxDepth": 5,
            "maxBytes": 262144,
            "maxDurationMs": 30000,
        },
        "input": {"subjectRef": "symbol:1"},
        "correlationId": "correlation-1",
    }
