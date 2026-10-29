"""Native tool/checkpoint regressions for the six captured false-positive packets.

Provider-free scripted responses verify the mechanism, not live-model legal judgment.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from assessment_root.agent import create_assessment_root_agent
from test_assessment_root_agent import (
    FakeClient, RootScriptedModel, THREAD, PINS, _call, _run, _tools,
)

FIXTURE = json.loads((Path(__file__).parents[2] / "tests/fixtures/assessment-root/operational-applicability.json").read_text())
CASES = FIXTURE["historicalCases"]
HUMAN = "12345678-1234-4234-8234-123456789abc"


def test_live_probe_trace_exports_rejection_codes_without_private_tool_content(tmp_path):
    from langchain_core.messages import ToolMessage
    from vertical.operational_applicability_probe import ProbeTrace

    path = tmp_path / "tool-outcomes.jsonl"
    trace = ProbeTrace(path)
    trace.on_tool_start({"name":"submit_rule_decision"}, "private model input", run_id="one")
    trace.on_tool_end(ToolMessage(content=json.dumps({"ok":False,"code":"REJECTED",
                      "failures":["CASE_REVISION_STALE"],"private":"do not export"}), tool_call_id="call"), run_id="one")
    row = json.loads(path.read_text())
    assert row["tool"] == "submit_rule_decision" and row["code"] == "REJECTED"
    assert row["failures"] == ["CASE_REVISION_STALE"]
    assert set(row) == {"at", "tool", "ok", "code", "failures"}
    assert "private model input" not in path.read_text() and "do not export" not in path.read_text()


class OperativeClient(FakeClient):
    def __init__(self, row):
        super().__init__()
        self.row = row
        self.statement = FIXTURE["benchmarkContext"]
        self.case_revision = 7
        self.human_result = None
        self.rule_set_override = {
            "ruleSetVersionId": PINS["ruleSetVersionId"],
            "legalRequirements": [{k: row[k] for k in ["legalRequirementId", "operativePropositions", "applicabilityConditions", "qualifiers", "exceptions"]}],
            "assessmentRules": [{
                "assessmentRuleId": row["assessmentRuleId"], "assessmentRuleVersion": "v1",
                "legalRequirementIds": [row["legalRequirementId"]], "criteria": row["criteria"],
            }], "contextRelations": [],
        }

    def context(self):
        out = super().context()
        out["coverage"][0].update(assessmentRuleId=self.row["assessmentRuleId"])
        out["facts"] = [{"factId": HUMAN, "caseRevision": self.case_revision, "kind": "FACT", "state": "ACCEPTED",
                         "authority": "HUMAN_PROVIDED", "statement": self.statement, "evidenceIds": []}]
        return out

    def post_human_request(self, body):
        if self.human_result is not None:
            return self.human_result
        result = super().post_human_request(body)
        self.human_result = result
        self.open_requests = [result["requestId"]]
        return result


@pytest.mark.parametrize("row", CASES, ids=lambda r: r["assessmentRuleId"])
def test_unconditional_duties_expose_real_operative_scope_and_allow_native_resolution(tmp_path, row):
    client = OperativeClient(row)
    run = _run(tmp_path, client)
    output = json.loads(_tools(run)["get_assessment_rule"].invoke({"assessment_rule_id": row["assessmentRuleId"]}))
    scopes = [e for e in output["applicabilityElements"] if e["kind"] == "OPERATIVE_SCOPE"]
    assert len(scopes) == len(row["operativePropositions"])
    for index, scope in enumerate(scopes):
        assert scope["index"] == index
        assert row["operativePropositions"][index]["actor"] in scope["text"]
        assert row["operativePropositions"][index]["action"] in scope["text"]
        assert scope["sourceRefs"] == row["operativePropositions"][index]["sourceRefs"]

    question = {"assessment_rule_id": row["assessmentRuleId"],
                "condition_ref": {"legal_requirement_id": row["legalRequirementId"], "kind": "OPERATIVE_SCOPE", "index": 0},
                "question": "Who determines the purposes and means of actual data processing, and where is the service actually operated?",
                "unresolved_fact": "Actual operator, activity and deployment scope", "decision_impact": ["Actor/activity scope cannot be inferred from capability"],
                "resolution_attempts": ["Inspected accepted benchmark facts; actual operator and deployment are unverified"]}
    reference = {"type": "CONFIRMED_FACT", "id": HUMAN}
    decision = {"assessment_rule_id": row["assessmentRuleId"], "applicability": "APPLICABLE",
                "legal_context_ids": [row["legalRequirementId"]], "references": [reference],
                "rationale": "Synthetic positive control: explicit trustworthy operator/deployment facts establish scope.",
                "compliance": "NON_COMPLIANT", "criteria": [{"criterion_id": c["criterionId"], "outcome": "NOT_MET",
                "rationale": "Synthetic confirmed unmet criterion.", "references": [reference]} for c in row["criteria"]],
                "applicability_basis": [{"legal_requirement_id": row["legalRequirementId"], "kind": "OPERATIVE_SCOPE", "index": i,
                "finding": "ESTABLISHED", "rationale": "Confirmed operator determines processing purposes and means within the pinned legal scope.",
                "references": [reference]} for i in range(len(scopes))]}
    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "ctx"),
        _call("get_assessment_rule", {"assessment_rule_id": row["assessmentRuleId"]}, "rule"),
        _call("open_human_request", question, "human"),
        _call("get_assessment_context", {}, "restored-context"),
        _call("submit_rule_decision", decision, "positive-decision"),
        _call("request_finalization", {}, "finalize"),
        _call("submit_final_report", {"summary": "Synthetic contract control.", "findings": [{"assessment_rule_id": row["assessmentRuleId"], "summary": "Confirmed positive control scope."}]}, "report"),
    ])
    saver = InMemorySaver()
    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[], checkpointer=saver)
    config = {"configurable": {"thread_id": THREAD}}
    paused = graph.invoke({"messages": [{"role": "user", "content": "Investigate the pinned rule."}]}, config, durability="sync")
    assert paused["__interrupt__"]
    stopped = graph.get_state(config).config["configurable"]["checkpoint_id"]
    assert not any(name in ["decision", "final_report"] for name, _ in client.calls)
    assert "Bears on this condition" in [body for name, body in client.calls if name == "human"][0]["decisionImpact"][-1]
    # A trustworthy positive fixture supplies actual operation facts; no historical benchmark is modified.
    client.statement = "A confirmed Vietnamese operator decides purposes and means and directly processes real adult customer data in its live Vietnam service; the specified safeguard is absent."
    client.case_revision = 8
    client.open_requests = []
    graph.invoke(Command(resume={paused["__interrupt__"][0].id: {"resolved": True}}), config, durability="sync")
    accepted = [body["decision"] for name, body in client.calls if name == "decision"]
    assert len(accepted) == 1 and accepted[0]["caseRevision"] == 8
    assert all(b["finding"] == "ESTABLISHED" and b["references"][0]["factId"] == HUMAN for b in accepted[0]["applicabilityBasis"])
    assert client.lifecycle_state == "COMPLETE"
    assert any(s.config["configurable"]["checkpoint_id"] == stopped for s in graph.get_state_history(config))
