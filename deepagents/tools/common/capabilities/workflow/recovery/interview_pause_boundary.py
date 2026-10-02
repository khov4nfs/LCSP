"""Boundary for a customer-requested pause of the active Interview turn."""

from __future__ import annotations

from typing import Any

from tools.common.capabilities.agent_runtime.agent_server_client import (
    interrupt_agent_runtime_run,
)
from tools.common.capabilities.agent_runtime.boundary import AgentBoundaryBase


INTERVIEW_PAUSE_COMMAND = "command.assessment-interview.pause-agent.v1"
# Which boundary's active run to interrupt: the same one that actually processes
# an Interview turn (tools/common/capabilities/workflow/recovery/interview_boundary.py
# :: AssessmentInterviewResumeBoundary), not this pause command's own dispatch.
# Kept as a literal (not imported) to avoid a circular import; agent_server_client.py
# holds the matching short-circuit that keeps this from queuing behind the run it
# targets.
INTERRUPTED_BOUNDARY_NAME = "assessment_interview_resume_requested"
# The same stop also covers the per-rule Repository Analyst engineering assessment.
INTERRUPTED_BOUNDARY_NAMES = (
    INTERRUPTED_BOUNDARY_NAME,
    "engineering_assessment_requested",
)


class AssessmentInterviewPauseBoundary(AgentBoundaryBase):
    """Cooperatively interrupt the assessment's active agent run, if any.

    That is the Interview turn or the per-rule Repository Analyst engineering
    assessment; both run on the assessment's one LangGraph thread.

    In production this command is short-circuited inside
    ``agent_server_client.dispatch_agent_runtime_event`` before an Agent Server
    run is ever created for it — creating one would enqueue behind (not
    interrupt) the very turn this command exists to stop. ``handle`` still does
    the right thing directly, so this boundary stays correct if it is ever
    invoked the normal way.
    """

    boundary_source = "assessment.interview-pause-requested"
    source_event = INTERVIEW_PAUSE_COMMAND
    requires_rbac = False

    def handle(self, message: dict[str, Any], correlationId: str) -> None:
        for boundary_name in INTERRUPTED_BOUNDARY_NAMES:
            interrupt_agent_runtime_run(boundary_name, message, correlationId)


__all__ = [
    "INTERRUPTED_BOUNDARY_NAME",
    "INTERRUPTED_BOUNDARY_NAMES",
    "INTERVIEW_PAUSE_COMMAND",
    "AssessmentInterviewPauseBoundary",
]
