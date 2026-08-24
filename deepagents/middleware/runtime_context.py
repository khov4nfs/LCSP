"""Inject non-sensitive LCSP runtime identifiers into model context."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from langchain.agents.middleware import ModelRequest, ModelResponse, wrap_model_call
from langchain.messages import SystemMessage

from orchestration.context import LCSPRunContext, bounded_context_lines


@wrap_model_call
def inject_lcsp_runtime_context(
    request: ModelRequest,
    handler: Callable[[ModelRequest], ModelResponse],
) -> ModelResponse:
    """Append immutable pipeline identifiers without copying governed evidence into prompts."""
    context = request.runtime.context
    if context is not None and not isinstance(context, LCSPRunContext):
        # Managed runtimes may deserialize dataclass-shaped context as a mapping.
        if isinstance(context, dict):
            context = LCSPRunContext(**context)
        else:
            context = None

    lines = bounded_context_lines(context)
    if not lines:
        return handler(request)

    context_block = (
        "LCSP runtime context (immutable identifiers; not evidence):\n"
        + "\n".join(f"- {line}" for line in lines)
        + "\nUse these identifiers when delegating and calling governed tools. "
        "Do not alter them or treat them as proof of compliance."
    )
    new_content: list[Any] = list(request.system_message.content_blocks)
    new_content.append({"type": "text", "text": context_block})
    return handler(
        request.override(system_message=SystemMessage(content=new_content))
    )
