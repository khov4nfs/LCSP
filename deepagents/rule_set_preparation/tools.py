"""Governed preparation tools. Run identity and idempotency are server-bound."""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

from langchain_core.tools import tool

from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.platform.logging import get_logger

from rule_set_preparation.legal_source_files import read_pins, refute_source_block

logger = get_logger(__name__)

SUBMISSION_IDEMPOTENCY_PREFIX = "rule-set-preparation-submit-"
RULE_SET_INPUT_SCHEMA = json.loads(Path(__file__).with_name("packet-schema.json").read_text())
# Packet sections and the label that identifies one item in each; the draft upserts by that label.
ITEM_ID_KEYS = {
    "legalRequirements": "legalRequirementId",
    "assessmentRules": "assessmentRuleId",
    "contextRelations": "relationId",
}
_PACKET_PROPERTIES = RULE_SET_INPUT_SCHEMA["properties"]["packet"]["properties"]
# validate/submit take a complete packet or nothing (nothing = the draft / the validated draft). The
# item contracts are carried once, by add_to_packet_draft; repeating the ~8k-token packet schema on both
# tools made every model call 15k tokens larger, which a pool of per-minute token limits could not sustain.
OPTIONAL_PACKET_INPUT_SCHEMA = {
    "title": RULE_SET_INPUT_SCHEMA["title"],
    "type": "object",
    "properties": {"packet": {
        "type": "object",
        "description": "Optional complete packet {legalRequirements, assessmentRules, contextRelations} in "
                       "the same item contracts as add_to_packet_draft. Omit it to use the draft.",
    }},
}
DRAFT_PART_SCHEMA = {
    "type": "object",
    "properties": {key: _PACKET_PROPERTIES[key] for key in ITEM_ID_KEYS},
    "additionalProperties": False,
}
DRAFT_REMOVAL_SCHEMA = {
    "type": "object",
    "properties": {
        name: {"type": "array", "items": {"type": "string"}}
        for name in ("legalRequirementIds", "assessmentRuleIds", "relationIds")
    },
    "additionalProperties": False,
}


class RuleSetApi(Protocol):
    """The slice of the worker API client the agent tools use."""

    def validate_compliance_rule_set(self, preparation_run_id: str, packet: dict) -> dict: ...

    def submit_compliance_rule_set(
        self, preparation_run_id: str, idempotency_key: str, packet: dict
    ) -> dict: ...


@dataclass
class RuleSetPreparationContext:
    """Per-run state. The agent never supplies the run id or the idempotency key."""

    run_id: str
    api: RuleSetApi
    # Materialized pinned source; a source-blocking claim is checked against it when set.
    source_root: Path | None = None
    submission: dict[str, Any] | None = None
    validation_calls: int = 0
    last_validation: dict[str, Any] | None = None
    validated_packet: dict[str, Any] | None = None
    source_blocked: dict[str, str] | None = None
    errors: list[str] = field(default_factory=list)
    # The packet being authored in parts: section -> item label -> item, in insertion order.
    draft: dict[str, dict[str, dict[str, Any]]] = field(
        default_factory=lambda: {key: {} for key in ITEM_ID_KEYS}
    )
    # (section, label) of the items the latest validation failures name: the only ones that may be removed.
    removable: set[tuple[str, str]] = field(default_factory=set)
    # add_to_packet_draft calls since the last validation: past a few, the result asks for one.
    adds_since_validation: int = 0
    progress_revision: int = 0
    # Per-call record of the governed tools (no packet content): what was validated/submitted
    # and which mechanical failure codes came back. Lets a failed run be diagnosed.
    trace: list[dict[str, Any]] = field(default_factory=list)

    def draft_packet(self) -> dict[str, list[dict[str, Any]]]:
        return {key: list(items.values()) for key, items in self.draft.items()}

    def draft_counts(self) -> dict[str, int]:
        return {key: len(items) for key, items in self.draft.items()}

    @property
    def idempotency_key(self) -> str:
        return f"{SUBMISSION_IDEMPOTENCY_PREFIX}{self.run_id}"


def _as_packet(packet: Any) -> dict:
    if isinstance(packet, str):
        packet = json.loads(packet)
    if not isinstance(packet, dict):
        raise ValueError("packet must be a JSON object with legalRequirements, assessmentRules and contextRelations")
    return packet


COVERAGE_FAILURE = "INCOMPLETE_SOURCE_COVERAGE"


UNCOVERED_LISTED = 60
VALIDATE_AFTER_ADDS = 4
_FAILURE_OWNER_SECTIONS = {
    "legalRequirement": "legalRequirements",
    "assessmentRule": "assessmentRules",
    "relation": "contextRelations",
}


def _items_named_by(failures: list[dict]) -> set[tuple[str, str]]:
    """(section, label) of every packet item a validation failure points at (`owner:LABEL[|locator:...]`)."""
    named: set[tuple[str, str]] = set()
    for failure in failures:
        owner = str(failure.get("ref") or "").partition("|")[0]
        kind, _, label = owner.partition(":")
        if kind in _FAILURE_OWNER_SECTIONS and label:
            named.add((_FAILURE_OWNER_SECTIONS[kind], label))
    return named


def _model_view(result: dict, context: "RuleSetPreparationContext | None" = None) -> dict:
    """The validation result as the agent sees it: uncovered provisions grouped and bounded."""
    failures = result.get("failures") or []
    uncovered = [f for f in failures if f.get("code") == COVERAGE_FAILURE]
    view = result
    if uncovered:
        by_document: dict[str, list[str]] = {}
        for failure in uncovered[:UNCOVERED_LISTED]:
            document_id, _, locator = str(failure.get("ref", "")).removeprefix("locator:").partition("::")
            by_document.setdefault(document_id, []).append(locator)
        view = {
            **result,
            "failures": [f for f in failures if f.get("code") != COVERAGE_FAILURE],
            "uncoveredProvisions": {
                "count": len(uncovered),
                "listed": min(len(uncovered), UNCOVERED_LISTED),
                "locatorsByDocumentId": by_document,
                "how": "Cite each of these (or an ancestor chunk listed in INDEX.md) in sourceRefs of "
                       "items you add, then validate again; more are listed as these are covered.",
            },
        }
    if context is not None and context.source_root is not None:
        # A mistyped hash is the commonest reason an item is rejected; name the pinned identity so the
        # agent corrects the item (it is the INDEX.md row, not a guess) instead of deleting it.
        stale = [f for f in view.get("failures") or () if f.get("code") == "STALE_SOURCE_HASH"]
        if stale:
            pins = read_pins(context.source_root)
            fixed = []
            for failure in view["failures"]:
                key = str(failure.get("ref", "")).partition("|locator:")[2].partition("::")
                expected = pins.get((key[0], key[2]))
                fixed.append({**failure, "expectedContentSha256": expected}
                             if failure.get("code") == "STALE_SOURCE_HASH" and expected else failure)
            view = {**view, "failures": fixed}
    if context is not None and any(context.draft.values()):
        # After context summarization the draft still exists: say what it holds.
        view = {**view, "draftLabels": {key: list(items) for key, items in context.draft.items()}}
    return view


def _packet_stats(packet: dict) -> dict[str, int]:
    """Sizes of a packet (never its content): what a failed validation was actually shown."""
    refs = {
        (ref.get("documentId"), ref.get("locator"))
        for rows in (packet.get("legalRequirements"), packet.get("assessmentRules"))
        for row in rows or ()
        for ref in row.get("sourceRefs") or ()
    } | {
        (rel["toSourceRef"].get("documentId"), rel["toSourceRef"].get("locator"))
        for rel in packet.get("contextRelations") or ()
        if isinstance(rel.get("toSourceRef"), dict)
    }
    return {
        "legal_requirements": len(packet.get("legalRequirements") or ()),
        "assessment_rules": len(packet.get("assessmentRules") or ()),
        "context_relations": len(packet.get("contextRelations") or ()),
        "distinct_source_refs": len(refs),
        "chars": len(json.dumps(packet, ensure_ascii=False)),
    }


def build_rule_set_tools(context: RuleSetPreparationContext) -> list:
    """Bind validation, submission and explicit source-blocking to one run."""

    def run_validation(packet: dict | None = None) -> str:
        if context.source_blocked is not None:
            return json.dumps({"sourceBlocked": context.source_blocked})
        context.validation_calls += 1
        context.adds_since_validation = 0
        context.validated_packet = None
        context.last_validation = None
        try:
            from_draft = packet is None
            if from_draft:
                if not any(context.draft.values()):
                    return json.dumps({"error": (
                        "The draft is empty. Add parts with add_to_packet_draft, or pass a complete packet."
                    )})
                packet = context.draft_packet()
            packet = _as_packet(packet)
            result = context.api.validate_compliance_rule_set(context.run_id, packet)
        except (ValueError, WorkerCallbackError) as error:
            context.errors.append(str(error))
            context.trace.append({"tool": "validate", "error": str(error)[:160]})
            logger.warning("RULE_SET_PREPARATION_VALIDATION_ERROR", run_id=context.run_id,
                           validation_call=context.validation_calls, error=str(error)[:300])
            return json.dumps({"error": str(error)})
        context.last_validation = result
        context.progress_revision += 1
        context.removable = _items_named_by(result.get("failures") or [])
        if result.get("outcome") == "PASSED":
            context.validated_packet = deepcopy(packet)
        counts: dict[str, int] = {}
        for failure in result.get("failures") or ():
            counts[failure.get("code", "?")] = counts.get(failure.get("code", "?"), 0) + 1
        context.trace.append({"tool": "validate", "outcome": result.get("outcome"), "failureCodes": counts})
        logger.info("RULE_SET_PREPARATION_VALIDATED", run_id=context.run_id,
                    validation_call=context.validation_calls, outcome=result.get("outcome"),
                    failure_codes=counts, packet=_packet_stats(packet), from_draft=from_draft)
        return json.dumps(_model_view(result, context), ensure_ascii=False)

    @tool(args_schema=DRAFT_PART_SCHEMA)
    def add_to_packet_draft(
        legalRequirements: list | None = None,
        assessmentRules: list | None = None,
        contextRelations: list | None = None,
        **ignored: Any,
    ) -> str:
        """Add one PART of the rule set packet to the draft, so a large source is authored in
        several small calls instead of one huge packet. Each item is identified by its label
        (legalRequirementId, assessmentRuleId, relationId): an item with a label that is already
        in the draft REPLACES it, which is how you correct an item. Nothing is checked here; call
        validate_compliance_rule_set with no arguments to validate the whole draft.
        """
        if context.submission is not None or context.source_blocked is not None:
            return json.dumps({"error": "Preparation is already finished."})
        part = {"legalRequirements": legalRequirements, "assessmentRules": assessmentRules,
                "contextRelations": contextRelations}
        problems = [
            f"{key}[{index}] has no {ITEM_ID_KEYS[key]} label"
            for key, items in part.items()
            for index, item in enumerate(items or ())
            if not isinstance(item, dict) or not isinstance(item.get(ITEM_ID_KEYS[key]), str)
            or not item[ITEM_ID_KEYS[key]].strip()
        ]
        if problems:
            return json.dumps({"error": "Nothing was added. " + "; ".join(problems[:10])})
        added: dict[str, int] = {}
        replaced = 0
        changed = False
        for key, items in part.items():
            added[key] = len(items or ())
            for item in items or ():
                label = item[ITEM_ID_KEYS[key]]
                replaced += label in context.draft[key]
                changed |= context.draft[key].get(label) != item
                context.draft[key][label] = deepcopy(item)
        if changed:
            context.progress_revision += 1
        # Any change to the draft revokes an earlier PASSED: the validated packet no longer exists.
        context.validated_packet = None
        context.last_validation = None
        context.trace.append({"tool": "draft_add", "added": added, "replaced": replaced})
        logger.info("RULE_SET_PREPARATION_DRAFT_ADDED", run_id=context.run_id, added=added,
                    replaced=replaced, draft=context.draft_counts())
        context.adds_since_validation += 1
        result: dict[str, Any] = {"added": added, "replaced": replaced, "draft": context.draft_counts()}
        if replaced and not sum(added.values()) - replaced:
            result["note"] = "Every item already existed; send new items, or a changed item to correct it."
        if context.adds_since_validation >= VALIDATE_AFTER_ADDS:
            # The mechanical dry-run is attached to the reply instead of waiting for the agent to ask.
            result["validation"] = json.loads(run_validation())
        return json.dumps(result)

    @tool(args_schema=DRAFT_REMOVAL_SCHEMA)
    def remove_from_packet_draft(
        legalRequirementIds: list[str] | None = None,
        assessmentRuleIds: list[str] | None = None,
        relationIds: list[str] | None = None,
        **ignored: Any,
    ) -> str:
        """Remove items from the packet draft by label. Only items named by the latest validation
        failures can be removed; to change any other item send it again with the same label."""
        if context.submission is not None or context.source_blocked is not None:
            return json.dumps({"error": "Preparation is already finished."})
        removals = {"legalRequirements": legalRequirementIds, "assessmentRules": assessmentRuleIds,
                    "contextRelations": relationIds}
        removed = {key: 0 for key in removals}
        unknown: list[str] = []
        refused: list[str] = []
        for key, labels in removals.items():
            for label in labels or ():
                if label not in context.draft[key]:
                    unknown.append(label)
                elif (key, label) not in context.removable:
                    refused.append(label)
                else:
                    del context.draft[key][label]
                    context.removable.discard((key, label))
                    removed[key] += 1
        context.validated_packet = None
        context.last_validation = None
        context.trace.append({"tool": "draft_remove", "removed": removed, "refused": len(refused)})
        logger.info("RULE_SET_PREPARATION_DRAFT_REMOVED", run_id=context.run_id, removed=removed,
                    refused=len(refused), unknown=len(unknown), draft=context.draft_counts())
        result: dict[str, Any] = {"removed": removed, "unknownLabels": unknown[:20], "draft": context.draft_counts()}
        if refused:
            result["refused"] = refused[:20]
            result["why"] = ("Only items named by the latest validation failures can be removed. Correct "
                             "any other item by sending it again with the same label.")
        return json.dumps(result)

    @tool(args_schema=OPTIONAL_PACKET_INPUT_SCHEMA)
    def validate_compliance_rule_set(packet: dict | None = None, **ignored: Any) -> str:
        """Dry-run the mechanical integrity validation of a COMPLETE rule set packet.

        Call it with no arguments to validate the draft built with add_to_packet_draft, or pass
        a complete packet. Nothing is persisted. Returns {"outcome": "PASSED"|"FAILED",
        "failures": [...]}; each failure has a code, the packet-local ref it concerns and a short
        detail, and uncovered source provisions are listed under "uncoveredProvisions". Fix every
        failure and validate again before the single submission.
        """
        return run_validation(packet)

    @tool(args_schema=OPTIONAL_PACKET_INPUT_SCHEMA)
    def submit_compliance_rule_set(packet: dict | None = None, **ignored: Any) -> str:
        """Submit the validated rule set packet once. It is validated and, when mechanically
        valid, activated automatically in one atomic step. There is no review or approval.

        Call it with no arguments to submit exactly the draft or packet that last passed
        validate_compliance_rule_set, or pass that exact packet. Any edit after the pass requires
        the semantic self-check and validation again.

        If the result is FAILED the attempted rule_set is NOT activated, the previous ACTIVE
        rule_set stays in place and this run is finished: do not call this tool again.
        """
        if context.submission is not None:
            return json.dumps({**context.submission, "alreadySubmitted": True}, ensure_ascii=False)
        if context.source_blocked is not None:
            return json.dumps({"sourceBlocked": context.source_blocked})
        try:
            packet = context.validated_packet if packet is None else _as_packet(packet)
            if context.validated_packet is None or packet != context.validated_packet:
                context.trace.append({"tool": "submit", "outcome": "VALIDATION_REQUIRED"})
                return json.dumps({"error": "Validate this exact packet until PASSED before submitting."})
            result = context.api.submit_compliance_rule_set(
                context.run_id, context.idempotency_key, packet
            )
        except (ValueError, WorkerCallbackError) as error:
            context.errors.append(str(error))
            context.trace.append({"tool": "submit", "outcome": "ERROR"})
            return json.dumps({"error": str(error)})
        context.submission = result
        context.progress_revision += 1
        context.trace.append({"tool": "submit", "outcome": (result.get("validation") or {}).get("outcome")})
        return json.dumps(result, ensure_ascii=False)

    @tool(args_schema={
        "type": "object",
        "properties": {
            "reason": {"type": "string", "enum": ["SOURCE_UNREADABLE", "SOURCE_PINS_INCONSISTENT"]},
            "path": {"type": "string", "description": "Affected absolute path inside /legal-source."},
        },
        "required": ["reason", "path"],
        "additionalProperties": False,
    })
    def report_rule_set_source_blocked(reason: str, path: str, **ignored: Any) -> str:
        """End WITHOUT submission only when the pinned source cannot be read or its pins
        are inconsistent. Do not use for unfinished work, ambiguous provisions or validation
        feedback that can be corrected. Name the affected pinned source path and reason.
        """
        if context.submission is not None:
            return json.dumps({"alreadySubmitted": True})
        if reason not in ("SOURCE_UNREADABLE", "SOURCE_PINS_INCONSISTENT"):
            return json.dumps({"error": "Only an unreadable pinned source or inconsistent pins can end without submission."})
        if not isinstance(path, str):
            return json.dumps({"error": "source-blocking path must be inside /legal-source"})
        source_path = PurePosixPath(path)
        if not source_path.is_relative_to("/legal-source") or ".." in source_path.parts:
            return json.dumps({"error": "source-blocking path must be inside /legal-source"})
        refutation = (
            refute_source_block(context.source_root, reason, path)
            if context.source_root is not None
            else None
        )
        if refutation is not None:
            # An unverifiable claim must not end the run: it is unfinished work, not a blocked source.
            context.trace.append({"tool": "source_blocked", "outcome": "REFUTED", "reason": reason, "path": path})
            logger.warning("RULE_SET_PREPARATION_SOURCE_BLOCK_REFUTED", run_id=context.run_id,
                           reason=reason, path=path, detail=refutation,
                           validation_calls=context.validation_calls)
            return json.dumps({"error": (
                f"Source-blocking refused: {refutation} The pinned source is intact, so continue the "
                "work: fix every validation failure in the packet, validate again until PASSED, "
                "then submit the exact validated packet."
            )})
        context.source_blocked = {"reason": reason, "path": path}
        context.progress_revision += 1
        context.trace.append({"tool": "source_blocked", **context.source_blocked})
        return json.dumps({"sourceBlocked": context.source_blocked})

    return [
        validate_compliance_rule_set,
        submit_compliance_rule_set,
        report_rule_set_source_blocked,
        add_to_packet_draft,
        remove_from_packet_draft,
    ]
