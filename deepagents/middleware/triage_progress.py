"""Gate Triage phases on successful tool receipts, never model assertions."""

from __future__ import annotations

import json
from collections.abc import Callable

from langchain.agents.middleware import ModelRequest, ModelResponse, wrap_model_call
from langchain.messages import ToolMessage

GET = "get_legal_rule_triage_work_items"
PERSIST = "persist_legal_rule_triage_result"
FINISH = "finish_legal_rule_triage_execution"


@wrap_model_call
def require_triage_progress(
    request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]
) -> ModelResponse:
    """Withhold finish and structured output until all work is persisted."""
    page = None
    persisted: set[str] = set()
    finished = False
    for message in request.messages:
        if not isinstance(message, ToolMessage) or message.status == "error":
            continue
        try:
            receipt = json.loads(message.content) if isinstance(message.content, str) else None
        except (ValueError, TypeError):
            continue
        if not isinstance(receipt, dict):
            continue
        if message.name == GET and receipt.get("status") == "READY":
            page = receipt
            persisted = set()
        elif message.name == PERSIST and receipt.get("status") == "READY":
            persisted.add(str(receipt.get("legalRuleId")))
        elif message.name == FINISH and receipt.get("status") == "COMPLETE":
            finished = True

    if finished:
        return handler(request.override(tools=[], tool_choice=None))

    allowed = {GET, "maintain_legal_catalog"} if page is None else {GET}
    if page is not None:
        items = page.get("workItems") or []
        if page.get("pendingRuleCount") == 0:
            allowed = {FINISH}
        elif any(str(item.get("legalRuleId")) not in persisted for item in items):
            if any(not item.get("readyForTriage") for item in items):
                raise RuntimeError("Triage source page contains unavailable legal evidence")
            allowed = {PERSIST}
    return handler(request.override(
        tools=[tool for tool in request.tools if getattr(tool, "name", None) in allowed],
        response_format=None,
        tool_choice="any",
    ))
