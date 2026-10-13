"""Persistent Root completion is API state, never assistant prose (no live models)."""

import json
from types import SimpleNamespace

import pytest
from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from assessment_root.runner import run_assessment_root
from test_assessment_root_agent import ASSESSMENT, THREAD, FakeClient, RootScriptedModel, _call


class WorkflowClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.lifecycle = "ACTIVE"
        self.decisions = {}
        self.evidence = []

    def context(self):
        value = super().context()
        value["lifecycleState"] = self.lifecycle
        value["evidence"] = self.evidence
        value["coverage"] = [
            {"assessmentRuleId": rule, "assessmentRuleVersion": "v1",
             "resolutionState": "RESOLVED" if rule in self.decisions else "PENDING",
             "currentDecisionId": self.decisions.get(rule),
             "decisionRevision": int(rule in self.decisions)}
            for rule in ("ER-1", "ER-2")
        ]
        return value

    def rule_set(self):
        value = super().rule_set()
        value["assessmentRules"].append({**value["assessmentRules"][0], "assessmentRuleId": "ER-2"})
        return value

    def post_evidence(self, body):
        result = super().post_evidence(body)
        self.evidence.append({**result, "type": "REPOSITORY_SOURCE", "payload": body})
        return result

    def post_decision(self, body):
        result = super().post_decision(body)
        self.decisions[body["decision"]["assessmentRuleId"]] = result["decisionId"]
        return result

    def request_finalization(self):
        assert set(self.decisions) == {"ER-1", "ER-2"}
        self.calls.append(("finalization", None))
        self.lifecycle = "FINALIZING"
        return {"lifecycleState": self.lifecycle, "blockers": []}

    def post_final_report(self, body):
        assert self.lifecycle == "FINALIZING"
        self.calls.append(("final_report", body))
        self.lifecycle = "COMPLETE"
        return {"lifecycleState": self.lifecycle, "artifactId": "server-report"}


def decision(rule):
    refs = [{"type": "ASSESSMENT_EVIDENCE", "id": "66666666-6666-4666-8666-666666666666"}]
    return {"assessment_rule_id": rule, "applicability": "APPLICABLE",
            "rationale": "The duty applies.", "legal_context_ids": ["LR-1"],
            "references": refs, "criteria": [{"criterion_id": "C-1", "outcome": "MET",
            "rationale": "Observed in accepted evidence.", "references": refs}], "compliance": "COMPLIANT"}


@pytest.fixture(autouse=True)
def quiet_model_logs(monkeypatch):
    monkeypatch.setattr("middleware.usage_metering.logger", SimpleNamespace(info=lambda *a, **k: None))


def test_partial_work_and_pseudo_tools_continue_same_graph_until_server_complete(tmp_path):
    (tmp_path / "source.py").write_text("retain = True\n")
    client = WorkflowClient()
    saver = InMemorySaver()
    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "context"),
        _call("cite_repository_source", {"path": "source.py", "start_line": 1, "end_line": 1}, "cite"),
        _call("submit_rule_decision", decision("ER-1"), "first-decision"),
        AIMessage(content='Partial work retained. [[tool_calls]] submit_final_report({})',
                  response_metadata={"finish_reason": "stop"}),
        _call("get_assessment_context", {}, "continued-context"),
        _call("submit_rule_decision", decision("ER-2"), "second-decision"),
        _call("request_finalization", {}, "finalize"),
        _call("submit_final_report", {"summary": "Verified report.", "findings": [{"assessment_rule_id": rule, "summary": "Verified rule."} for rule in ("ER-1", "ER-2")]}, "report"),
        AIMessage(content="Complete."),
    ])
    result = run_assessment_root(client, ASSESSMENT,
        backend_factory=lambda *_: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
        model=model, checkpointer=saver, governance=())
    assert result["state"] == "SUCCEEDED"
    assert client.lifecycle == "COMPLETE"
    assert sum(name == "claim" for name, _ in client.calls) == 1
    assert sum(name == "evidence" for name, _ in client.calls) == 1
    assert sum(name == "decision" for name, _ in client.calls) == 2
    assert sum(name == "finalization" for name, _ in client.calls) == 1
    assert sum(name == "final_report" for name, _ in client.calls) == 1
    assert client.calls[-1] == ("finish", "SUCCEEDED")
    continued = model.prompts[4]
    assert any(isinstance(m, AIMessage) and "[[tool_calls]]" in str(m.content) for m in continued)
    assert any(isinstance(m, ToolMessage) and m.name == "submit_rule_decision" for m in continued)
    context = next(m for m in model.prompts[5] if isinstance(m, ToolMessage) and m.tool_call_id == "continued-context")
    assert json.loads(context.content)["evidence"]
    checkpoints = list(saver.list(None))
    assert {row.config["configurable"]["thread_id"] for row in checkpoints} == {THREAD}


@pytest.mark.parametrize("lifecycle", ["ACTIVE", "FINALIZING", "COMPLETE"])
def test_runner_requires_authoritative_complete_even_if_graph_returns(monkeypatch, tmp_path, lifecycle):
    client = WorkflowClient()
    calls = []

    class ReturnedGraph:
        def invoke(self, *args, **kwargs):
            calls.append("invoke")
            client.lifecycle = lifecycle
            return {"messages": [AIMessage(content="Assessment complete.")]}

    monkeypatch.setattr("assessment_root.runner.create_assessment_root_agent", lambda **kwargs: ReturnedGraph())
    result = run_assessment_root(client, ASSESSMENT,
        backend_factory=lambda *_: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
        model=RootScriptedModel(responses=[]), governance=())
    assert calls == ["invoke"]
    assert result["state"] == ("SUCCEEDED" if lifecycle == "COMPLETE" else "FAILED")
    if lifecycle != "COMPLETE":
        assert result["errorType"] == "RuntimeError"
        assert ("finish", "SUCCEEDED") not in client.calls


def test_human_blocker_remains_native_interrupted_execution(tmp_path):
    class HumanClient(WorkflowClient):
        def post_human_request(self, body):
            result = super().post_human_request(body)
            self.open_requests = [result["requestId"]]
            return result

    client = HumanClient()
    model = RootScriptedModel(responses=[_call("open_human_request", {
        "assessment_rule_id": "ER-1", "question": "Who owns the operational policy?",
        "unresolved_fact": "Operational policy owner", "decision_impact": ["Determines responsibility"],
        "resolution_attempts": ["Reviewed available repository sources"],
    }, "human")])
    result = run_assessment_root(client, ASSESSMENT,
        backend_factory=lambda *_: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
        model=model, checkpointer=InMemorySaver(), governance=())
    assert result["state"] == "INTERRUPTED"
    assert result["checkpointId"]
    assert len(model.prompts) == 1
    assert ("finish", "SUCCEEDED") not in client.calls


def test_generic_conversational_root_accepts_one_natural_response(monkeypatch):
    import importlib

    model = RootScriptedModel(responses=[AIMessage(content="A conversational answer.")])
    monkeypatch.setattr("model_policy.resolve_agent_model", lambda role: model)
    monkeypatch.setattr("model_policy.effective_model_configs", lambda: [])
    monkeypatch.setattr("tools.mcp.load_optional_mcp_tools", lambda: [])
    monkeypatch.setattr("middleware.model_governance.MODEL_GOVERNANCE_MIDDLEWARE", [])
    root = importlib.import_module("agent")
    monkeypatch.setattr(root, "resolve_agent_model", lambda role: model)
    monkeypatch.setattr(root, "MODEL_GOVERNANCE_MIDDLEWARE", [])
    output = root.create_root_agent().invoke({"messages": [{"role": "user", "content": "Hello"}]})
    assert output["messages"][-1].content == "A conversational answer."
    assert len(model.prompts) == 1
