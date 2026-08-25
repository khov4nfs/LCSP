"""Bind canonical Agentic tool entrypoints to the runtime registry."""

from __future__ import annotations

from tools.common.capabilities.platform.api_client import WorkerApiClient

from .dispatcher import AgenticToolDispatcher
from ..governance.registry import AgenticToolRegistry
from ..entrypoints.tool_entrypoints import AgenticToolExecutionContext


def bind_runtime_handlers(
    registry: AgenticToolRegistry,
    *,
    api_client: WorkerApiClient,
    user_id: str,
    organization_id: str,
) -> None:
    """Bind every model-callable tool through the single runtime dispatcher.

    Production bindings are resolved from the canonical binding table in
    ``dispatcher.py``. Each binding points to a real public function whose name
    exactly matches the canonical ``tool_name``.
    """
    dispatcher = AgenticToolDispatcher(
        AgenticToolExecutionContext(
            api_client=api_client,
            user_id=user_id,
            organization_id=organization_id,
        )
    )

    for tool_name in registry.model_callable_names():
        registry.register_handler(tool_name, dispatcher.bound_handler(tool_name))
