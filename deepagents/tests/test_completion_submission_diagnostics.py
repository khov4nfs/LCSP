from __future__ import annotations

import json

import pytest

from middleware.failure_policy import NoProgressDetected
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools


class _GateApi:
    def validate_compliance_rule_set(self, run_id: str, packet: dict) -> dict:
        if packet.get("revision") == 2:
            return {"outcome": "PASSED", "failures": []}
        return {"outcome": "FAILED", "failures": [
            {"code": "STALE_SOURCE_HASH", "ref": "locator:private-source-ref", "detail": "private legal text"},
            {"code": "INTEGRITY_GAP", "ref": "assessmentRule:ER-1", "detail": "private packet data"},
        ]}

    def submit_compliance_rule_set(self, run_id: str, key: str, packet: dict) -> dict:
        return {"validation": {"outcome": "PASSED"}, "id": "candidate-1"}


def _submission_tool(context: RuleSetPreparationContext):
    return next(tool for tool in build_rule_set_tools(context) if tool.name == "submit_compliance_rule_set")


def _session(events: list[dict]) -> AgentStreamSession:
    return AgentStreamSession(
        assessment_id=None, run_id="run-1", correlation_id="corr-1",
        boundary_name="preparation", boundary_type="PREPARATION", emit_payload=events.append,
    )


def test_repeated_gate_submission_emits_safe_progress_and_same_agent_feedback():
    context = RuleSetPreparationContext("run-1", _GateApi())
    submit = _submission_tool(context)
    packet = {"revision": 1, "legalRequirement": "sensitive legal content"}
    events: list[dict] = []
    with activate_agent_stream(_session(events)):
        first = json.loads(submit.invoke({"packet": packet}))
        second = json.loads(submit.invoke({"packet": packet}))

    assert first["completionClaim"] == second["completionClaim"] == "REJECTED"
    assert "NO_PROGRESS" not in first and "NO_PROGRESS" in second
    records = [event["data"] for event in events if (event.get("data") or {}).get("activity_kind") == "COMPLETION_SUBMISSION"]
    assert [record["submission_ordinal"] for record in records] == [1, 2]
    assert records[0]["candidate_fingerprint"] == records[1]["candidate_fingerprint"]
    assert records[0]["gap_fingerprint"] == records[1]["gap_fingerprint"]
    assert records[0]["structural_gap_codes"] == ["INTEGRITY_GAP"]
    assert records[0]["provenance_gap_codes"] == ["STALE_SOURCE_HASH"]
    serialized = json.dumps(events)
    assert "sensitive legal content" not in serialized
    assert "private legal text" not in serialized
    assert "private packet data" not in serialized


def test_repeated_unchanged_state_after_feedback_is_no_progress_detected():
    context = RuleSetPreparationContext("run-1", _GateApi())
    submit = _submission_tool(context)
    packet = {"revision": 1}
    with activate_agent_stream(_session([])):
        submit.invoke({"packet": packet})
        assert "NO_PROGRESS" in json.loads(submit.invoke({"packet": packet}))
        with pytest.raises(NoProgressDetected, match="NO_PROGRESS_DETECTED"):
            submit.invoke({"packet": packet})


def test_changed_candidate_can_continue_and_be_accepted_after_feedback():
    context = RuleSetPreparationContext("run-1", _GateApi())
    submit = _submission_tool(context)
    events: list[dict] = []
    with activate_agent_stream(_session(events)):
        submit.invoke({"packet": {"revision": 1}})
        assert "NO_PROGRESS" in json.loads(submit.invoke({"packet": {"revision": 1}}))
        accepted = json.loads(submit.invoke({"packet": {"revision": 2}}))
    assert accepted["validation"]["outcome"] == "PASSED"
    records = [event["data"] for event in events if (event.get("data") or {}).get("activity_kind") == "COMPLETION_SUBMISSION"]
    assert records[-1]["accepted"] is True
    assert records[0]["candidate_fingerprint"] == records[1]["candidate_fingerprint"]
    assert records[1]["candidate_fingerprint"] != records[2]["candidate_fingerprint"]
