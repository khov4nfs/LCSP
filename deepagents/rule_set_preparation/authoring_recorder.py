"""Make every rejected tool call observable, including the ones the framework refuses before any tool body runs.

The existing rejection ledger owns observable, repairable Preparation tool failures:

1. Name the tool call being executed (``CURRENT_TOOL_CALL_ID``) so a rejection envelope can cite the exact call.
2. Record framework-level refusals as LCSP rejections. A call to an unknown tool, or one whose arguments are not valid JSON, never
   reaches ``claim_tools.invoke`` and used to leave no trace at all. They now flow through the same ledger path as every other
   rejection, so they carry an envelope, appear in the durable event stream, feed the working-set digest, and are subject to the
   same stagnation rule.
3. Return native argument errors as that bounded rejection while retaining the failed ToolMessage status.

Placed innermost in the middleware list, so it sees the raw model response and raw tool result before any governance layer can
raise on them.
"""
from __future__ import annotations

import difflib
import json
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from rule_set_preparation.authoring_state import MARKER
from rule_set_preparation.authoring_rejections import (
    CURRENT_TOOL_CALL_ID, SOURCE_FRAMEWORK_ERROR, SOURCE_UNKNOWN_TOOL, SOURCE_UNPARSEABLE, TOOL_SCHEMA,
    args_fingerprint,
)


def _tool_name(tool: Any) -> str | None:
    """Business purpose: Read a tool name from either a framework tool descriptor or a model-call JSON object.

    Business rules:
    - Only string names are accepted; JSON function descriptors may nest the name under `function`.

    Execution flow:
    1. Inspect the descriptor shape.
    2. Return its string name or `None` when no supported name is present.

    Failure cases:
    - Unrecognized shapes and non-string names return `None` rather than inventing an identity.

    Side effects:
    - None: reads the supplied descriptor without mutation or external calls.
    """
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
        """Business purpose: Record model-emitted unknown or unparsable tool calls before any tool body can run.

        Business rules:
        - Rejection recording applies after ClaimInventory is initialized and compares model calls with the request's known tool set; this guard does not require a frozen inventory.
        - Invalid JSON arguments and unknown tool names are recorded through the shared repair ledger with bounded diagnostics.

        Execution flow:
        1. Collect known tool names and normalize the model response into messages.
        2. Inspect each AI tool call for unknown names and each invalid tool call for JSON parse failure.
        3. Record each rejected call with its ID, repair key and relevant field path.

        Failure cases:
        - Calls are ignored before inventory setup or when the response contains no AI tool call; the tool body is never invoked for these failures.

        Side effects:
        - Updates the authoring rejection ledger and durable event state through `_reject`; it does not mutate the Rule draft.
        """
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
        built before that loop is then stale, so it is rebuilt here, immediately before every model invocation.

        Business purpose: Give each model invocation the current authoring working-set digest, including after provider retries or governance re-asks.

        Business rules:
        - Only active frozen-inventory authoring receives the digest; an existing trailing digest marker is replaced to avoid accumulating stale copies.

        Execution flow:
        1. Leave the request unchanged when authoring is inactive.
        2. Build the current digest, remove its prior trailing marker if present, and publish changed state.
        3. Return the request with one current digest message appended.

        Failure cases:
        - Digest generation/publication errors propagate to the model-call lifecycle rather than sending stale state as current.

        Side effects:
        - May publish durable authoring-context telemetry and returns an overridden in-memory request.
        """
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
        """Business purpose: Refresh authoring state and capture synchronous model tool-call rejections around one model invocation.

        Business rules:
        - The same request with the refreshed digest is used for both the handler and response recording.

        Execution flow:
        1. Replace stale digest context when authoring is active.
        2. Invoke the synchronous model handler once.
        3. Record unknown and unparsable tool calls in the returned response and return it.

        Failure cases:
        - Model and ledger failures propagate; this wrapper does not fabricate a successful tool call.

        Side effects:
        - May update rejection state and durable authoring telemetry; does not change legal candidates.
        """
        request = self._refresh_digest(request)
        response = handler(request)
        self._record_response(request, response)
        return response

    async def awrap_model_call(self, request, handler):
        """Business purpose: Refresh authoring state and capture asynchronous model tool-call rejections around one model invocation.

        Business rules:
        - The asynchronous path uses the same digest and rejection policy as the synchronous path.

        Execution flow:
        1. Replace stale digest context when authoring is active.
        2. Await the model handler once.
        3. Record unknown and unparsable tool calls in the returned response and return it.

        Failure cases:
        - Model and ledger failures propagate; invalid calls remain rejected rather than being treated as executed.

        Side effects:
        - May update rejection state and durable authoring telemetry; does not change legal candidates.
        """
        request = self._refresh_digest(request)
        response = await handler(request)
        self._record_response(request, response)
        return response

    # --- the tool call itself ---------------------------------------------------------------------------------------
    def _record_result(self, call: dict, result: Any) -> Any:
        """Business purpose: Turn framework-level failed tool results into visible, repairable Preparation rejections.

        Business rules:
        - Only error ToolMessages with an active inventory are considered; unknown-tool errors already captured from the model response are not duplicated.
        - Native argument validation feedback is wrapped in the rejection envelope while the ToolMessage retains its error status.

        Execution flow:
        1. Return unrelated and successful results unchanged.
        2. Extract bounded error text and ignore an already-recorded unknown-tool refusal.
        3. Record the failure through `_reject`; wrap native validation text in the returned ToolMessage when applicable.

        Failure cases:
        - Unsupported result shapes pass through; rejection-ledger failures propagate rather than conceal the refusal.

        Side effects:
        - Adds an authoring rejection event and updates run-local working-set bookkeeping; it does not persist candidate mutations.
        """
        if not isinstance(result, ToolMessage) or result.status != "error" or self.context.inventory is None:
            return result
        content = result.content if isinstance(result.content, str) else str(result.content)
        if "is not a valid tool" in content:
            return result  # recorded from the model response, where the call is still unexecuted
        rejected = self._reject(call.get("name") or "UNKNOWN", call.get("args") or {}, SOURCE_FRAMEWORK_ERROR, call.get("id"), content[:600], "FRAMEWORK_ERROR", ["<arguments>"])
        if content.startswith("Error invoking tool '"):
            # Native argument rejection is repairable Preparation feedback, not a structured-output contract failure.
            return result.model_copy(update={"content": json.dumps(rejected, ensure_ascii=False)})
        return result

    def wrap_tool_call(self, request, handler):
        """Business purpose: Associate a synchronous tool rejection with the exact model tool-call ID while the call executes.

        Business rules:
        - The call ID is scoped with a ContextVar and is reset even when the handler raises.

        Execution flow:
        1. Read the current call and set its ID in the scoped context.
        2. Invoke the handler once and always reset the context token.
        3. Record any returned framework error and return the resulting ToolMessage.

        Failure cases:
        - Handler exceptions propagate after the call ID is reset; rejection-recording failures also propagate.

        Side effects:
        - Executes the existing tool and may append a durable failure record; it introduces no alternate mutation path.
        """
        call = getattr(request, "tool_call", None) or {}
        token = CURRENT_TOOL_CALL_ID.set(call.get("id"))
        try:
            result = handler(request)
        finally:
            CURRENT_TOOL_CALL_ID.reset(token)
        return self._record_result(call, result)

    async def awrap_tool_call(self, request, handler):
        """Business purpose: Associate an asynchronous tool rejection with the exact model tool-call ID while the call executes.

        Business rules:
        - The call ID is scoped with a ContextVar and is reset even when the awaited handler raises.

        Execution flow:
        1. Read the current call and set its ID in the scoped context.
        2. Await the handler once and always reset the context token.
        3. Record any returned framework error and return the resulting ToolMessage.

        Failure cases:
        - Handler exceptions propagate after the call ID is reset; they are not converted to tool success.

        Side effects:
        - Executes the existing tool and may append a durable failure record; it introduces no alternate mutation path.
        """
        call = getattr(request, "tool_call", None) or {}
        token = CURRENT_TOOL_CALL_ID.set(call.get("id"))
        try:
            result = await handler(request)
        finally:
            CURRENT_TOOL_CALL_ID.reset(token)
        return self._record_result(call, result)

    # --- shared ledger path ----------------------------------------------------------------------------------------
    def _reject(self, tool: str, args: dict, source: str, call_id: str | None, detail: str, repair_key: str, field_paths: list[str]) -> dict:
        """Business purpose: Record one rejected authoring call with enough bounded evidence for correction and audit.

        Business rules:
        - The mutation lock protects the active call fields and ledger rejection; file tools use argument fingerprints as distinct repair targets.
        - Rejection details retain the existing TOOL_SCHEMA layer and source classification, and the draft fingerprint is captured before rejection.

        Execution flow:
        1. Bind call identity, arguments, rejection layer/source and draft fingerprint under the mutation lock.
        2. Ask the inventory ledger to create the rejection envelope and required-action guidance.
        3. Clear temporary call fields and notify the authoring working set of the result.
        4. Return the ledger rejection.

        Failure cases:
        - Inactive/missing inventory is not silently accepted; ledger or telemetry errors propagate after temporary fields are cleared.

        Side effects:
        - Mutates rejection/event sequencing state and may publish durable progress; the candidate draft remains unchanged.
        """
        context = self.context
        ledger = context.inventory
        with context.mutation_lock:
            ledger.current_tool, ledger.current_args, ledger.current_call_id = tool, args, call_id
            ledger.current_layer, ledger.current_source, ledger.last_envelope = TOOL_SCHEMA, source, None
            ledger.current_draft_before = context.draft_fp
            try:
                # Different native paths/edits are different repair attempts, even before any claim is committed.
                ref = f"{tool}:{args_fingerprint(args)}" if tool in {"ls", "grep", "read_file", "write_file", "edit_file"} else tool
                result = ledger.rejected("CLAIM_SCHEMA_INVALID", ref, detail, fieldPaths=field_paths, repairKey=repair_key, requiredAction="get_rule_authoring_status" if context.authoring is not None and context.authoring.active() else None)
                envelope = ledger.last_envelope
            finally:
                ledger.current_tool = ledger.current_args = ledger.current_call_id = ledger.current_layer = ledger.current_source = None
            if context.authoring is not None:
                context.authoring.observe_tool(tool, args, result, call_id=call_id, envelope=envelope)
            return result
