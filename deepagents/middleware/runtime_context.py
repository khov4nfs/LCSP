"""Inject non-sensitive LCSP runtime identifiers into model context."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain.messages import SystemMessage

from orchestration.context import LCSPRunContext, bounded_context_lines


def _project_lcsp_runtime_context(request: ModelRequest) -> ModelRequest:
    """Append immutable pipeline identifiers without copying governed evidence into prompts."""
    context = request.runtime.context
    if context is not None and not isinstance(context, LCSPRunContext):
        if isinstance(context, dict):
            context = LCSPRunContext(**context)
        else:
            context = None

    lines = bounded_context_lines(context)
    if not lines:
        return request

    # Idempotency is shared by initial investigations, exact resumes and legal
    # preparation. It is not a routing discriminator. Boundaries/root dispatch own
    # the task instruction; this shared middleware only appends immutable metadata.
    context_block = (
        "LCSP runtime context (immutable identifiers; not evidence):\n"
        + "\n".join(f"- {line}" for line in lines)
        + "\nUse these identifiers when delegating and calling governed tools. "
        "Do not alter them or treat them as proof of compliance."
    )
    new_content: list[Any] = list(request.system_message.content_blocks)
    new_content.append({"type": "text", "text": context_block})
    return request.override(system_message=SystemMessage(content=new_content))


class _RuntimeContextMiddleware(AgentMiddleware):
    name = "inject_lcsp_runtime_context"

    def wrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(_project_lcsp_runtime_context(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(_project_lcsp_runtime_context(request))


inject_lcsp_runtime_context = _RuntimeContextMiddleware()
