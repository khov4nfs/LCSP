"""Cooperative Stop at a native graph boundary, persisted by the Root checkpointer."""
from __future__ import annotations

from typing import Any
from langchain.agents.middleware import AgentMiddleware
from langgraph.types import interrupt


class RootRuntimeControl(AgentMiddleware):
    def __init__(self, client: Any, execution_id: str) -> None:
        self.client = client
        self.execution_id = execution_id

    def before_model(self, state, runtime):
        control = self.client.root_control()
        if control and control["targetRunId"] == self.execution_id and control["state"] == "STOP_REQUESTED":
            interrupt({"controlRequestId": control["requestId"], "targetExecutionId": self.execution_id})
        return None
