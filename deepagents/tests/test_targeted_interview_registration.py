from __future__ import annotations

from middleware.specialist_handoff_validation import _persist_targeted_interview_need
from orchestration.context import LCSPRunContext


class RecordingApi:
    def __init__(self) -> None:
        self.calls = []

    def post_interview_targeted_need(self, assessment_id, payload):
        self.calls.append((assessment_id, payload))
        return {"outcome": "WAITING_FOR_CUSTOMER"}


def test_investigator_needs_input_persists_trusted_target_before_root() -> None:
    api = RecordingApi()
    context = LCSPRunContext(
        assessment_id="assessment-1",
        user_id="user-1",
        workflow_run_id="workflow-1",
        checkpoint_id="checkpoint-7",
        engineering_rule_ids=("ENG-1", "ENG-2"),
        artifact_versions={
            "technicalEvidenceReportId": "ter-1",
            "repositorySnapshotId": "snapshot-1",
        },
    )
    _persist_targeted_interview_need(
        subagent_type="investigator",
        payload={
            "status": "NEEDS_INPUT",
            "business_context_need": {
                "need_id": "need-1",
                "business_context_need": "Who approves this action?",
                "resolution_criteria": ["decision_authority"],
            },
            "artifact_versions": dict(context.artifact_versions),
        },
        context=context,
        metadata={"api_client": api},
        execution_id="task-call-investigator-17",
    )

    assert len(api.calls) == 1
    assessment_id, payload = api.calls[0]
    assert assessment_id == "assessment-1"
    assert payload["actorId"] == "user-1"
    assert payload["investigatorExecutionId"] == "task-call-investigator-17"
    assert payload["workflowRunId"] == "workflow-1"
    assert payload["checkpointId"] == "checkpoint-7"
    assert payload["affectedRuleIds"] == ["ENG-1", "ENG-2"]
    assert (
        payload["originatingInvestigationReference"]
        == "investigator:task-call-investigator-17:need-1"
    )
    assert payload["artifactVersions"] == context.artifact_versions


def test_non_investigator_or_ready_handoff_does_not_register_target() -> None:
    api = RecordingApi()
    context = LCSPRunContext(assessment_id="assessment-1", user_id="user-1")
    _persist_targeted_interview_need(
        subagent_type="planner",
        payload={"status": "NEEDS_INPUT"},
        context=context,
        metadata={"api_client": api},
    )
    _persist_targeted_interview_need(
        subagent_type="investigator",
        payload={"status": "READY"},
        context=context,
        metadata={"api_client": api},
    )
    assert api.calls == []
