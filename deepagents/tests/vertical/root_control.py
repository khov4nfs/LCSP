"""Production Root graph + real API + PostgresSaver Stop/restart/resume; scripted model only."""
from __future__ import annotations
import json
import os
import sys
from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage
from langgraph.checkpoint.postgres import PostgresSaver
from assessment_root.client import AssessmentRuntimeClient
import assessment_root.runner as assessment_root_runner
from assessment_root.runner import run_assessment_root
from vertical.scripted_root import DynamicScriptedModel, _call

base, key, assessment_id, repo_dir, mode = sys.argv[1:6]
from orchestration.runtime_control import active_runtime_run_id, active_runtime_incarnation_id
active_runtime_run_id.set(os.getenv("LCSP_TEST_ROOT_RUNTIME_RUN_ID"))
active_runtime_incarnation_id.set(os.getenv("LCSP_TEST_ROOT_INCARNATION_ID"))
client = AssessmentRuntimeClient(base, key)
steps = [lambda m: _call("get_assessment_context", {}, "context"), lambda m: AIMessage(content="Investigation continues from confirmed server state.")]
model = DynamicScriptedModel(responses=[], steps=steps)
if mode == "pause":
    # Pause requested through the authenticated CUSTOMER endpoint by the Node harness
    # after the claim; no model is allowed to choose pause authority.
    claim = client.claim
    def claimed(assessment_id):
        result = claim(assessment_id)
        import httpx
        response = httpx.post(f"{base}/assessments/{assessment_id}/runtime/stop", headers={"authorization": f"Bearer {os.environ['ASSESSMENT_CUSTOMER_TOKEN']}"}, json={"targetRunId": result["executionId"]})
        assert response.status_code == 201, response.text
        return result
    client.claim = claimed
if mode == "crash":
    client.finish = lambda *args, **kwargs: os._exit(76)
from approved_bundle_fixture import offline_instruction_bundle
with offline_instruction_bundle(), PostgresSaver.from_conn_string(os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]) as saver:
    saver.setup()
    captured = {}
    original_graph_config = assessment_root_runner.agent_graph_config
    def capture_graph_config(config=None):
        value = original_graph_config(config)
        configurable = value.get("configurable", {})
        captured["threadId"] = configurable.get("thread_id")
        captured["checkpointNamespace"] = configurable.get("checkpoint_ns")
        return value
    assessment_root_runner.agent_graph_config = capture_graph_config
    result = run_assessment_root(client, assessment_id, backend_factory=lambda *_: (FilesystemBackend(root_dir=repo_dir, virtual_mode=True), None), model=model, checkpointer=saver, governance=())
    if "threadId" not in captured:
        raise RuntimeError(f"Root did not reach graph configuration: {json.dumps(result)}")
    assert result["threadId"] == captured["threadId"], "Runtime thread differs from configured checkpoint authority"
    checkpoint = saver.get_tuple({"configurable": {"thread_id": captured["threadId"]}})
    assert checkpoint is not None, "Root did not persist a real PostgreSQL checkpoint"
    print(json.dumps({"result": result, "checkpoint": checkpoint.config["configurable"]["checkpoint_id"], "graphConfig": captured, "pid": os.getpid(), "remainingSteps": len(model.steps)}))
