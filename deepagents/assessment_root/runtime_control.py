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
        return self._pause_if_requested()

    def after_model(self, state, runtime):
        return self._pause_if_requested()

    def _pause_if_requested(self):
        """Business purpose: Honor a server-requested cooperative Stop at a checkpointable Assessment Root boundary.

        Business rules:
        - Only STOP_REQUESTED targeting this execution may interrupt it; another execution's control must not pause this Root.

        Execution flow:
        1. Attempt a heartbeat, fetch the current Root control, and interrupt with the matching request/execution identities when required.

        Failure cases:
        - Heartbeat errors are tolerated locally; control-read errors propagate, and the native interrupt suspends execution durably.

        Side effects:
        - Calls heartbeat/control endpoints and may create a native graph interrupt for checkpoint persistence.
        """
        try:
            self.client.heartbeat()
        except Exception:
            pass
        control = self.client.root_control()
        if control and control["targetRunId"] == self.execution_id and control["state"] == "STOP_REQUESTED":
            interrupt({"controlRequestId": control["requestId"], "targetExecutionId": self.execution_id})
        return None
