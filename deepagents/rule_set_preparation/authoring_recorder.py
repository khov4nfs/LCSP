"""Make every rejected tool call observable, including the ones the framework refuses before any tool body runs.

Two jobs, neither of which changes what the model or the governance layers see:

1. Name the tool call being executed (``CURRENT_TOOL_CALL_ID``) so a rejection envelope can cite the exact call.
2. Record framework-level refusals as LCSP rejections. A call to an unknown tool, or one whose arguments are not valid JSON, never
   reaches ``claim_tools.invoke`` and used to leave no trace at all. They now flow through the same ledger path as every other
   rejection, so they carry an envelope, appear in the durable event stream, feed the working-set digest, and are subject to the
   same stagnation rule.

Placed innermost in the middleware list, so it sees the raw model response and raw tool result before any governance layer can
raise on them.
"""
from __future__ import annotations

import difflib
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from rule_set_preparation.authoring_state import MARKER
from rule_set_preparation.authoring_rejections import (
    CURRENT_TOOL_CALL_ID, SOURCE_FRAMEWORK_ERROR, SOURCE_UNKNOWN_TOOL, SOURCE_UNPARSEABLE, TOOL_SCHEMA,
)


def _tool_name(tool: Any) -> str | None:
    if isinstance(tool, dict):
        function = tool.get("function") if isinstance(tool.get("function"), dict) else tool
        name = function.get("name")
        return name if isinstance(name, str) else None
    return getattr(tool, "name", None)


class AuthoringToolCallRecorder(AgentMiddleware):
    def __init__(self, context: Any) -> None:
        self.context = context

    # --- the model's tool calls, before anything executes -----------------------------------------------------------
    def _record_response(self, request: Any, response: Any) -> None:
        if self.context.inventory is None:
            return
        known = {name for name in map(_tool_name, getattr(request, "tools", None) or ()) if name}
        messages = response.result if hasattr(response, "result") else [response]
        for message in messages:
            if not isinstance(message, AIMessage):
                continue
            for call in message.tool_calls:
                if known and call["name"] not in known:
                    close = difflib.get_close_matches(call["name"], sorted(known), n=3, cutoff=0.5)
                    self._reject(call["name"], call.get("args") or {}, SOURCE_UNKNOWN_TOOL, call.get("id"), f"Tool {call['name']!r} does not exist"
                                 + (f"; did you mean {', '.join(close)}?" if close else ""), "UNKNOWN_TOOL", ["<tool_name>"])
            for call in message.invalid_tool_calls:
                self._reject(call.get("name") or "UNKNOWN", {"arguments": str(call.get("args") or "")}, SOURCE_UNPARSEABLE, call.get("id"),
                             "The tool-call arguments were not valid JSON, so the call was not executed", "UNPARSEABLE_ARGUMENTS", ["<arguments>"])

    def _refresh_digest(self, request: Any) -> Any:
        """Governance may discard a malformed sample and re-ask the model inside one call, or fall back to another route. The digest
        built before that loop is then stale, so it is rebuilt here, immediately before every model invocation."""
        state = self.context.authoring
        if state is None or not state.active():
            return request
        digest = state.digest()
        messages = list(request.messages)
        if messages and isinstance(messages[-1], HumanMessage) and isinstance(messages[-1].content, str) and messages[-1].content.startswith(MARKER):
            messages.pop()
        state.publish_if_changed(digest)
        return request.override(messages=[*messages, HumanMessage(content=digest)])

    def wrap_model_call(self, request, handler):
        request = self._refresh_digest(request)
        response = handler(request)
        self._record_response(request, response)
        return response

    async def awrap_model_call(self, request, handler):
        request = self._refresh_digest(request)
        response = await handler(request)
        self._record_response(request, response)
        return response

    # --- the tool call itself ---------------------------------------------------------------------------------------
    def _record_result(self, call: dict, result: Any) -> None:
        if not isinstance(result, ToolMessage) or result.status != "error" or self.context.inventory is None:
            return
        content = result.content if isinstance(result.content, str) else str(result.content)
        if "is not a valid tool" in content:
            return  # recorded from the model response, where the call is still unexecuted
        self._reject(call.get("name") or "UNKNOWN", call.get("args") or {}, SOURCE_FRAMEWORK_ERROR, call.get("id"), content[:200], "FRAMEWORK_ERROR", ["<arguments>"])

    def wrap_tool_call(self, request, handler):
        call = getattr(request, "tool_call", None) or {}
        token = CURRENT_TOOL_CALL_ID.set(call.get("id"))
        try:
            result = handler(request)
        finally:
            CURRENT_TOOL_CALL_ID.reset(token)
        self._record_result(call, result)
        return result

    async def awrap_tool_call(self, request, handler):
        call = getattr(request, "tool_call", None) or {}
        token = CURRENT_TOOL_CALL_ID.set(call.get("id"))
        try:
            result = await handler(request)
        finally:
            CURRENT_TOOL_CALL_ID.reset(token)
        self._record_result(call, result)
        return result

    # --- shared ledger path ----------------------------------------------------------------------------------------
    def _reject(self, tool: str, args: dict, source: str, call_id: str | None, detail: str, repair_key: str, field_paths: list[str]) -> None:
        context = self.context
        ledger = context.inventory
        with context.mutation_lock:
            ledger.current_tool, ledger.current_args, ledger.current_call_id = tool, args, call_id
            ledger.current_layer, ledger.current_source, ledger.last_envelope = TOOL_SCHEMA, source, None
            ledger.current_draft_before = context.draft_fp
            try:
                result = ledger.rejected("CLAIM_SCHEMA_INVALID", tool, detail, fieldPaths=field_paths, repairKey=repair_key, requiredAction="get_rule_authoring_status" if context.authoring is not None and context.authoring.active() else None)
                envelope = ledger.last_envelope
            finally:
                ledger.current_tool = ledger.current_args = ledger.current_call_id = ledger.current_layer = ledger.current_source = None
            if context.authoring is not None:
                context.authoring.observe_tool(tool, args, result, call_id=call_id, envelope=envelope)
