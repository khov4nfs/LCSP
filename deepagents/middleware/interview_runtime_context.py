"""Project only Interview-safe runtime identifiers into the specialist prompt."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain.messages import SystemMessage

from orchestration.context import LCSPRunContext


def _project_interview_runtime_context(request: ModelRequest) -> ModelRequest:
    """Expose assessment correlation and provenance pins, never workflow internals."""
    context = request.runtime.context
    if isinstance(context, dict):
        context = LCSPRunContext(**context)
    if not isinstance(context, LCSPRunContext):
        return request

    lines: list[str] = []
    if context.assessment_id:
        lines.append(f"assessment_id={context.assessment_id}")
    for key in (
        "technicalEvidenceReportId",
        "repositorySnapshotId",
        "sourceVersion",
        "pgeVersion",
        "guidanceVersion",
    ):
        value = context.artifact_versions.get(key)
        if value:
            lines.append(f"{key}={value}")
    if not lines:
        return request

    content = list(request.system_message.content_blocks)
    content.append(
        {
            "type": "text",
            "text": (
                "Interview runtime context (immutable, not evidence):\n- "
                + "\n- ".join(lines)
                + "\nNever request or infer checkpoint, continuation, EngineeringRule, "
                "or legal-rule identifiers."
            ),
        }
    )
    return request.override(system_message=SystemMessage(content=content))


class _InterviewRuntimeContextMiddleware(AgentMiddleware):
    name = "inject_interview_runtime_context"

    def wrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(_project_interview_runtime_context(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(_project_interview_runtime_context(request))


inject_interview_runtime_context = _InterviewRuntimeContextMiddleware()


__all__ = ["inject_interview_runtime_context"]
