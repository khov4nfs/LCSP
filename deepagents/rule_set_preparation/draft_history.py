"""Keep the model's history flat while it authors the packet in parts.

The draft lives in the run context, not in the conversation: once a part has been added, the model only
needs to know that its labels exist. Hundreds of ``add_to_packet_draft`` rounds (each re-sent to the
provider on every later call) otherwise outgrow the model's context window and its per-minute token
limit long before the source is covered.
"""

from __future__ import annotations

from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from rule_set_preparation.tools import ITEM_ID_KEYS, RuleSetPreparationContext

ADD_TOOL = "add_to_packet_draft"
INCREMENTAL_TOOLS = frozenset({
    "register_semantic_claim", "update_semantic_claim", "remove_semantic_claim", "link_semantic_claims",
    "remove_semantic_relation", "review_source_node", "review_source_reference", "author_legal_requirement",
    "author_assessment_rule", "remove_rule_candidate", "get_claim_inventory",
})
CHECK_TOOLS = frozenset({"validate_compliance_rule_set", "remove_from_packet_draft",
                         "validate_semantic_claim_inventory"})
KEEP_RECENT_ADDS = 3
KEEP_RECENT_CHECKS = 2
_GIST_KEYS = ("title", "concept", "kind")


def _gists(call_args: dict[str, Any]) -> dict[str, dict[str, str]]:
    found: dict[str, dict[str, str]] = {}
    for section, id_key in ITEM_ID_KEYS.items():
        for item in call_args.get(section) or ():
            if isinstance(item, dict) and item.get(id_key):
                found.setdefault(section, {})[str(item[id_key])] = next(
                    (str(item[key])[:50] for key in _GIST_KEYS if item.get(key)), ""
                )
    return found


def _kind(message: Any) -> str | None:
    """'add', 'check' for a message made only of draft-bookkeeping calls, otherwise None."""
    if not isinstance(message, AIMessage) or not message.tool_calls:
        return None
    names = {call["name"] for call in message.tool_calls}
    if not names <= CHECK_TOOLS | INCREMENTAL_TOOLS | {ADD_TOOL}:
        return None
    return "add" if ADD_TOOL in names or names & INCREMENTAL_TOOLS else "check"


def compact_draft_history(
    messages: list[Any], keep_adds: int = KEEP_RECENT_ADDS, keep_checks: int = KEEP_RECENT_CHECKS
) -> list[Any]:
    """Drop old draft-bookkeeping rounds (the call and its result) and list their item labels once."""
    kinds = {i: _kind(m) for i, m in enumerate(messages)}
    adds = [i for i, k in kinds.items() if k == "add"]
    checks = [i for i, k in kinds.items() if k == "check"]
    dropped = set(adds[:-keep_adds] if keep_adds else adds) | set(checks[:-keep_checks] if keep_checks else checks)
    if not dropped:
        return messages

    dropped_call_ids = {call["id"] for i in dropped for call in messages[i].tool_calls}
    labels: dict[str, dict[str, str]] = {}
    for i in sorted(dropped):
        for call in messages[i].tool_calls:
            if call["name"] == ADD_TOOL:
                for section, items in _gists(call["args"]).items():
                    labels.setdefault(section, {}).update(items)
    lines = [
        f"{section}: " + "; ".join(f"{label} ({gist})" if gist else label for label, gist in items.items())
        for section, items in labels.items()
    ]
    summary = HumanMessage(content=(
        "Draft parts you already added (stored in the draft; do not resend them, resend an item only to "
        "correct it):\n" + "\n".join(lines)
    )) if lines else HumanMessage(content=(
        "Earlier incremental claim/review/Rule operations remain stored in the run context. "
        "Use get_claim_inventory with STATUS, CLAIMS, RELATIONS, REQUIREMENTS, UNREVIEWED_SOURCE_NODES "
        "or UNACCOUNTED_CLAIMS and pagination to recover exact current IDs and revision. "
        "Do not recreate claims from forgotten tool history. Frozen inventory changes require explicit reopening."
    ))

    compacted: list[Any] = []
    for i, message in enumerate(messages):
        if i in dropped or (isinstance(message, ToolMessage) and message.tool_call_id in dropped_call_ids):
            if summary is not None and i == min(dropped):
                compacted.append(summary)
            continue
        compacted.append(message)
    return compacted


class DraftHistoryMiddleware(AgentMiddleware):
    """Applied to every model request; the stored draft and the full message state are untouched."""

    def __init__(self, context: RuleSetPreparationContext):
        self.context = context

    def wrap_model_call(self, request, handler):
        self.context.model_turn = (self.context.model_turn or 0) + 1
        return handler(request.override(messages=compact_draft_history(list(request.messages))))

    async def awrap_model_call(self, request, handler):
        self.context.model_turn = (self.context.model_turn or 0) + 1
        return await handler(request.override(messages=compact_draft_history(list(request.messages))))
