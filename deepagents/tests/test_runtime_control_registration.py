from types import SimpleNamespace

import httpx
import pytest

from orchestration.runtime_control import active_runtime_run_id, hosted_checkpoint_scope
from tools.common.capabilities.agent_runtime import runtime_control


def test_registration_uses_native_identity_and_preserves_original_resume_context(monkeypatch):
    requests = []
    monkeypatch.setattr(runtime_control, "load_config", lambda: SimpleNamespace(
        nestjs_api_base_url="http://test", worker_api_key="test-only",
    ))

    def post(url, *, json, headers, timeout):
        requests.append((url, json, headers))
        return httpx.Response(201, json={
            "ok": True,
            "data": {"state": json["state"], "targetRunId": json["targetRunId"]},
        })

    monkeypatch.setattr(httpx, "post", post)
    context = {
        "assessment_id": "assessment",
        "system_boundary_name": "assessment_interview_resume_requested",
        "system_event": {"original": True},
        "workflow_run_id": "workflow-not-native",
        "correlation_id": "correlation-not-native",
    }
    token = active_runtime_run_id.set("native-first")
    try:
        assert runtime_control.report_runtime_control("thread", "native-first", context, "RUNNING") == {
            "state": "RUNNING", "targetRunId": "native-first",
        }
        runtime_control.report_runtime_control("thread", "native-first", context, "STOPPED",
                                               checkpoint={"checkpoint_id": "saved"})
    finally:
        active_runtime_run_id.reset(token)
    body = requests[0][1]
    assert body["logicalRunId"] == body["targetRunId"] == "native-first"
    assert body["workflowRunId"] == "workflow-not-native"
    assert body["correlationId"] == "correlation-not-native"
    assert body["context"] == {**context, "logical_run_id": "native-first"}
    assert "logical_run_id" not in context
    assert requests[0][2]["x-lcsp-runtime-run-id"] == "native-first"
    assert requests[1][1]["checkpoint"] == {"checkpoint_id": "saved"}


def test_hosted_production_does_not_silently_use_volatile_checkpoints(monkeypatch):
    for key in ("LANGGRAPH_CHECKPOINT_DATABASE_URL", "POSTGRES_URI", "DATABASE_URL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("NODE_ENV", "production")
    with pytest.raises(RuntimeError, match="requires LANGGRAPH_CHECKPOINT_DATABASE_URL"):
        with hosted_checkpoint_scope("thread", "logical"):
            pytest.fail("production must use durable checkpoints")
