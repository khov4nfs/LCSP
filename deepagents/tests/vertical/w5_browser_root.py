"""Provider-free browser plumbing fixture on real Root graph/API/PostgresSaver."""
from __future__ import annotations
import json
import os
import sys
import time
from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage
from langgraph.checkpoint.postgres import PostgresSaver
from assessment_root.client import AssessmentRuntimeClient
from assessment_root.runner import run_assessment_root
from vertical.scripted_root import DynamicScriptedModel, full_script, _call

base, key, assessment_id, repo_dir, mode = sys.argv[1:6]
client = AssessmentRuntimeClient(base, key)
captured = {}
if mode == "complete":
    steps = full_script(captured)[:-1]
    steps += [lambda m: _call("request_finalization", {}, "w5-finalize"), lambda m: _call("submit_final_report", {"summary": "Accepted findings and confirmed facts complete this assessment.", "findings": [{"engineering_rule_id": rule, "summary": "This finding follows its accepted decision and cited evidence.", "recommendations": []} for rule in ["ER-DEF", "ER-RET", "ER-XREF"]]}, "w5-report"), lambda m: AIMessage(content="The immutable final report is persisted.")]
else:
    def await_customer_stop(messages):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            control = client.root_control()
            if control and control["state"] == "STOP_REQUESTED":
                return _call("get_assessment_context", {}, "w5-state")
            time.sleep(0.2)
        raise RuntimeError("browser did not request Stop within the fixture deadline")
    steps = [await_customer_stop if mode == "hold" else lambda m: _call("get_assessment_context", {}, "w5-resume"), lambda m: AIMessage(content="Same-thread investigation resumed.")]
model = DynamicScriptedModel(responses=[], steps=steps)
with PostgresSaver.from_conn_string(os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]) as saver:
    saver.setup()
    result = run_assessment_root(client, assessment_id, backend_factory=lambda *_: (FilesystemBackend(root_dir=repo_dir, virtual_mode=True), None), model=model, checkpointer=saver, governance=())
    print(json.dumps({"result": result, "captured": captured, "remainingSteps": len(model.steps)}))
