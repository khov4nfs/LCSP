from __future__ import annotations

from unittest.mock import call, patch

from tools.common.capabilities.workflow.recovery.interview_pause_boundary import (
    INTERRUPTED_BOUNDARY_NAME,
    INTERVIEW_PAUSE_COMMAND,
    AssessmentInterviewPauseBoundary,
)


def test_handle_interrupts_the_interview_and_engineering_assessment_runs() -> None:
    boundary = AssessmentInterviewPauseBoundary(config=object())
    message = {"assessmentId": "assessment-1", "workflowRunId": "workflow-1"}

    with patch(
        "tools.common.capabilities.workflow.recovery.interview_pause_boundary.interrupt_agent_runtime_run"
    ) as interrupt:
        boundary.handle(message, "correlation-1")

    # One customer stop covers whichever the assessment is running.
    assert interrupt.call_args_list == [
        call("assessment_interview_resume_requested", message, "correlation-1"),
        call("engineering_assessment_requested", message, "correlation-1"),
    ]


def test_boundary_source_event_matches_the_published_command() -> None:
    assert (
        AssessmentInterviewPauseBoundary.source_event == INTERVIEW_PAUSE_COMMAND
    )
    assert INTERRUPTED_BOUNDARY_NAME == "assessment_interview_resume_requested"
