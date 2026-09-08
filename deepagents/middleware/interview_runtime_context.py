"""Project only Interview-safe runtime identifiers into the specialist prompt."""

from __future__ import annotations

from collections.abc import Callable

from langchain.agents.middleware import ModelRequest, ModelResponse, wrap_model_call
from langchain.messages import SystemMessage

from orchestration.context import LCSPRunContext


@wrap_model_call
def inject_interview_runtime_context(
    request: ModelRequest,
    handler: Callable[[ModelRequest], ModelResponse],
) -> ModelResponse:
    """Expose assessment correlation and provenance pins, never workflow internals."""
    context = request.runtime.context
    if isinstance(context, dict):
        context = LCSPRunContext(**context)
    if not isinstance(context, LCSPRunContext):
        return handler(request)

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
        return handler(request)

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
    return handler(request.override(system_message=SystemMessage(content=content)))


__all__ = ["inject_interview_runtime_context"]
