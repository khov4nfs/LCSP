"""Governed preparation tools. Run identity and idempotency are server-bound."""

from __future__ import annotations

import json
import hashlib
import re
import threading
from functools import wraps
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Protocol
from uuid import uuid4

from langchain_core.tools import tool

from middleware.failure_policy import NoProgressDetected
from orchestration.agent_stream import DURABLE, publish_agent_stream_event
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.platform.logging import get_logger

from rule_set_preparation.legal_source_files import read_pins, refute_source_block
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.claim_inventory import ClaimInventory, AUTHORING, RULE_VALIDATION, SUBMISSION_READY, COMPLETION, grouped_gaps
from rule_set_preparation.claim_tools import build_claim_tools

logger = get_logger(__name__)

SUBMISSION_IDEMPOTENCY_PREFIX = "rule-set-preparation-submit-"
RULE_SET_INPUT_SCHEMA = json.loads(Path(__file__).with_name("packet-schema.json").read_text())
# Packet sections and the label that identifies one item in each; the draft upserts by that label.
ITEM_ID_KEYS = {
    "legalRequirements": "legalRequirementId",
    "assessmentRules": "assessmentRuleId",
    "contextRelations": "relationId",
    "semanticClaims": "claimId",
    "claimRelations": "relationId",
    "sourceAccounting": "sourceNodeId",
    "referenceAccounting": "referenceId",
}
GRAPH_SECTIONS = {"semanticClaims": "claims", "claimRelations": "relations",
                  "sourceAccounting": "sourceAccounting", "referenceAccounting": "referenceAccounting"}
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
    "properties": {key: (_PACKET_PROPERTIES["semanticGraph"]["properties"][GRAPH_SECTIONS[key]]
                         if key in GRAPH_SECTIONS else _PACKET_PROPERTIES[key]) for key in ITEM_ID_KEYS},
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
PREPARATION_PROGRESS_SCHEMA = {
    "type": "object",
    "properties": {
        "establishedFindings": {"type": "array", "items": {"type": "string"}},
        "unresolvedMaterialWork": {"type": "array", "items": {"type": "string"}},
        "currentTarget": {"type": "string"},
        "intendedAction": {"type": "string"},
        "expectedInformationGain": {"type": "string"},
    },
    "required": [
        "establishedFindings", "unresolvedMaterialWork", "currentTarget",
        "intendedAction", "expectedInformationGain",
    ],
    "additionalProperties": False,
}


class RuleSetApi(Protocol):
    """The slice of the worker API client the agent tools use."""

    def claim_inventory_operation(self, run_id: str, action: str, revision: int, **fields: Any) -> dict: ...

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
    source_graph: PinnedSourceGraph | None = None
    authored_claim_ids: set[str] = field(default_factory=set)
    inventory: ClaimInventory | None = None
    mutation_lock: Any = field(default_factory=threading.RLock, repr=False)
    model_turn: int | None = None
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
    completion_submission_ordinal: int = 0
    last_completion_state_fingerprint: str | None = None
    completion_feedback_state_fingerprint: str | None = None
    pinned_source_version_id: str | None = None
    progress_state: dict[str, Any] = field(default_factory=lambda: {
        "establishedFindings": [],
        "unresolvedMaterialWork": [],
        "currentTarget": "",
        "intendedAction": "",
        "expectedInformationGain": "",
    })
    observations: dict[str, dict[str, Any]] = field(default_factory=dict)
    observation_lock: Any = field(default_factory=threading.Lock, repr=False)
    # Per-call record of the governed tools (no packet content): what was validated/submitted
    # and which mechanical failure codes came back. Lets a failed run be diagnosed.
    trace: list[dict[str, Any]] = field(default_factory=list)

    def draft_packet(self) -> dict[str, Any]:
        packet = {key: list(items.values()) for key, items in self.draft.items() if key not in GRAPH_SECTIONS}
        if self.source_graph is not None:
            packet["semanticGraph"] = {"contractVersion": "LEGAL_GRAPH_V2", **self.source_graph.base(),
                                       **{field: list(self.draft[key].values()) for key, field in GRAPH_SECTIONS.items()}}
        if self.inventory is not None and self.inventory.frozen is not None:
            packet["semanticGraph"] = deepcopy(self.inventory.frozen)
            packet["claimInventory"] = self.inventory.binding()
        return packet

    def draft_counts(self) -> dict[str, int]:
        return {key: len(items) for key, items in self.draft.items() if key not in GRAPH_SECTIONS or self.source_graph is not None or items}

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
    if len(failures) > UNCOVERED_LISTED and any(f.get("code") in {"INCOMPLETE_STRUCTURAL_ACCOUNTING", "UNACCOUNTED_SEMANTIC_CLAIM"} for f in failures):
        counts: dict[str, int] = {}
        for failure in failures:
            counts[failure["code"]] = counts.get(failure["code"], 0) + 1
        view = {**result, "failures": failures[:UNCOVERED_LISTED], "gapCounts": counts, "omittedFailureCount": len(failures) - UNCOVERED_LISTED}
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
                "how": "Read each exact leaf in the pinned source. Preserve its actor/modality/action "
                       "in operativePropositions with exact sourceRefs, or attach its actual context "
                       "through a typed relation on an operative requirement. Citation attachment "
                       "or an ancestor citation alone does not discharge coverage. Validate the repaired draft.",
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


_PROVENANCE_GAP_CODES = frozenset({
    "RETRIEVAL_INDEX_NOT_VALID", "UNRESOLVED_SOURCE_REFERENCE", "STALE_SOURCE_HASH",
    "REPEALED_SOURCE_REFERENCE", "NON_CURRENT_SOURCE_REFERENCE",
    "UNDETERMINED_SOURCE_STATUS", "MIXED_SOURCE_VERSION", "SOURCE_STATUS_PROVENANCE_MISSING",
})


def _fingerprint(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8", errors="replace")).hexdigest()


def _completion_gap_projection(gate: dict | None) -> tuple[list[str], list[str], str]:
    structural: set[str] = set()
    provenance: set[str] = set()
    fingerprints: list[tuple[str, str | None]] = []
    failures = gate.get("failures") if isinstance(gate, dict) else None
    for failure in failures or ():
        if not isinstance(failure, dict):
            continue
        code = failure.get("code")
        if not isinstance(code, str) or not re.fullmatch(r"[A-Z0-9_]{1,80}", code):
            continue
        (provenance if code in _PROVENANCE_GAP_CODES else structural).add(code)
        ref = failure.get("ref")
        fingerprints.append((code, _fingerprint(ref) if isinstance(ref, str) else None))
    uncovered = gate.get("uncoveredProvisions") if isinstance(gate, dict) else None
    if isinstance(uncovered, dict) and isinstance(uncovered.get("count"), int) and uncovered["count"] > 0:
        structural.add(COVERAGE_FAILURE)
        locators = uncovered.get("locatorsByDocumentId")
        if isinstance(locators, dict):
            fingerprints.extend(
                (COVERAGE_FAILURE, _fingerprint((doc_id, locator)))
                for doc_id, values in locators.items() if isinstance(doc_id, str) and isinstance(values, list)
                for locator in values if isinstance(locator, str)
            )
    return sorted(structural), sorted(provenance), _fingerprint(sorted(fingerprints))


def _record_completion_submission(
    context: RuleSetPreparationContext, candidate: Any, gate: dict | None, *, accepted: bool,
    gate_rejected: bool,
) -> tuple[bool, bool]:
    structural, provenance, gap_fingerprint = _completion_gap_projection(gate)
    candidate_fingerprint = _fingerprint(candidate) if isinstance(candidate, dict) else None
    feedback = detected = False
    with context.observation_lock:
        context.completion_submission_ordinal += 1
        ordinal = context.completion_submission_ordinal
        state_fingerprint = _fingerprint({
            "candidate": candidate_fingerprint, "gaps": gap_fingerprint,
            "progressRevision": context.progress_revision,
        })
        if gate_rejected and candidate_fingerprint is not None:
            if state_fingerprint == context.last_completion_state_fingerprint:
                if context.completion_feedback_state_fingerprint == state_fingerprint:
                    detected = True
                else:
                    feedback = True
                    context.completion_feedback_state_fingerprint = state_fingerprint
            else:
                context.completion_feedback_state_fingerprint = None
            context.last_completion_state_fingerprint = state_fingerprint
        elif accepted:
            context.last_completion_state_fingerprint = None
            context.completion_feedback_state_fingerprint = None
    publish_agent_stream_event(
        "CUSTOM_PROGRESS", status="COMPLETED" if accepted else "RUNNING",
        data={
            "durability": DURABLE, "activity_kind": "COMPLETION_SUBMISSION",
            "submission_id": str(uuid4()), "submission_ordinal": ordinal,
            "candidate_fingerprint": candidate_fingerprint, "accepted": accepted,
            "structural_gap_codes": structural, "provenance_gap_codes": provenance,
            "gap_fingerprint": gap_fingerprint,
            "completion_gate_outcome": (gate or {}).get("outcome"),
        },
    )
    if detected:
        publish_agent_stream_event("CUSTOM_PROGRESS", status="FAILED", data={
            "durability": DURABLE, "activity_kind": "NO_PROGRESS_DETECTED",
            "source": "COMPLETION_SUBMISSION", "submission_ordinal": ordinal,
            "candidate_fingerprint": candidate_fingerprint, "gap_fingerprint": gap_fingerprint,
        })
    return feedback, detected


def build_rule_set_tools(context: RuleSetPreparationContext) -> list:
    """Bind validation, submission and explicit source-blocking to one run."""

    if context.source_graph is not None and context.inventory is None:
        context.inventory = ClaimInventory(context)

    @tool(args_schema=PREPARATION_PROGRESS_SCHEMA)
    def record_preparation_progress(
        establishedFindings: list[str],
        unresolvedMaterialWork: list[str],
        currentTarget: str,
        intendedAction: str,
        expectedInformationGain: str,
    ) -> str:
        """Record concise source-grounded findings, unresolved work and the next factual investigation action.

        This is an execution-local working ledger, not legal output or chain-of-thought. Do not include
        private reasoning; cite source identifiers/locators when useful.
        """
        progress = {
            "establishedFindings": establishedFindings,
            "unresolvedMaterialWork": unresolvedMaterialWork,
            "currentTarget": currentTarget,
            "intendedAction": intendedAction,
            "expectedInformationGain": expectedInformationGain,
        }
        with context.observation_lock:
            if any(context.progress_state[key] != progress[key] for key in (
                "establishedFindings", "unresolvedMaterialWork"
            )):
                context.progress_revision += 1
            context.progress_state = progress
        return json.dumps({"progressState": progress, "progressRevision": context.progress_revision})

    def run_validation(packet: dict | None = None) -> str:
        if context.source_blocked is not None:
            return json.dumps({"sourceBlocked": context.source_blocked})
        context.validation_calls += 1
        if context.inventory is not None:
            inventory = context.inventory
            if inventory.frozen is None or inventory.phase not in {AUTHORING, RULE_VALIDATION, SUBMISSION_READY}:
                return json.dumps(inventory.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Finalize inventory and start Rule authoring first"))
            inventory.transition(RULE_VALIDATION)
        context.adds_since_validation = 0
        previous_validation = context.last_validation
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
            known = context.authored_claim_ids | set(context.draft["semanticClaims"])
            declared = {claim.get("claimId") for claim in (packet.get("semanticGraph") or {}).get("claims", [])}
            if known - declared:
                result = {"outcome": "FAILED", "failures": [{"code": "UNACCOUNTED_SEMANTIC_CLAIM", "ref": f"claim:{cid}",
                    "detail": "An authored claim cannot disappear from a candidate; explicitly account for or classify it."} for cid in sorted(known - declared)]}
            else:
                context.authored_claim_ids.update(cid for cid in declared if isinstance(cid, str))
                result = context.api.validate_compliance_rule_set(context.run_id, packet)
        except (ValueError, WorkerCallbackError) as error:
            context.errors.append(str(error))
            context.trace.append({"tool": "validate", "error": str(error)[:160]})
            logger.warning("RULE_SET_PREPARATION_VALIDATION_ERROR", run_id=context.run_id,
                           validation_call=context.validation_calls, error=str(error)[:300])
            if context.inventory is None:
                return json.dumps({"error": str(error)})
            if isinstance(error, WorkerCallbackError) and error.status_code != 400:
                raise
            result = {"outcome": "FAILED", "failures": [{"code": "CLAIM_SCHEMA_INVALID", "ref": path, "detail": "Repair this candidate field using the typed authoring tool"}
                      for path in sorted(set(re.findall(r"packet\.[A-Za-z0-9_.]+", str(error))))[:20]] or [{"code": "CLAIM_SCHEMA_INVALID", "ref": "packet", "detail": str(error)[:200]}]}
        if context.inventory is not None:
            result = context.inventory.observe_validation(result, RULE_VALIDATION, packet)
            context.inventory.transition(SUBMISSION_READY if result.get("outcome") == "PASSED" else AUTHORING)
        context.last_validation = result
        if result.get("coverage"):
            publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
                "activity_kind": "SEMANTIC_CLAIM_COVERAGE", "coverage": result["coverage"],
                "gap_categories": sorted({f.get("code") for f in result.get("failures", []) if f.get("code")}),
            })
        if result != previous_validation:
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
        return json.dumps(grouped_gaps(result, context.draft["semanticClaims"]) if context.inventory else _model_view(result, context), ensure_ascii=False)

    @tool(args_schema=DRAFT_PART_SCHEMA)
    def add_to_packet_draft(
        legalRequirements: list | None = None,
        assessmentRules: list | None = None,
        contextRelations: list | None = None,
        semanticClaims: list | None = None,
        claimRelations: list | None = None,
        sourceAccounting: list | None = None,
        referenceAccounting: list | None = None,
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
        if context.inventory is not None:
            return json.dumps(context.inventory.rejected("CLAIM_PHASE_INVALID", "draft", "Use typed claim/review tools during discovery and typed Requirement/AssessmentRule tools after freeze"))
        part = {"legalRequirements": legalRequirements, "assessmentRules": assessmentRules,
                "contextRelations": contextRelations, "semanticClaims": semanticClaims, "claimRelations": claimRelations,
                "sourceAccounting": sourceAccounting, "referenceAccounting": referenceAccounting}
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
            publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
                "activity_kind": "SEMANTIC_CLAIMS_AUTHORED", "semantic_claim_count": len(context.draft["semanticClaims"]),
                "requirement_count": len(context.draft["legalRequirements"]),
            })
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
        if context.inventory is not None and (packet is not None or ignored):
            return json.dumps(context.inventory.rejected("CLAIM_SCHEMA_INVALID", "validate_compliance_rule_set", "No arguments: use typed authoring tools and validate the current frozen-inventory draft"))
        return run_validation(packet)

    @tool(args_schema=OPTIONAL_PACKET_INPUT_SCHEMA)
    def submit_compliance_rule_set(packet: dict | None = None, **ignored: Any) -> str:
        """Claim completion for a packet, run the deterministic integrity gate, then submit once.

        A rejected gate returns its exact mechanical gaps to this same agent for repair. The gate
        checks structure and provenance only; this agent owns legal interpretation and completeness.
        A passing claim is submitted through the canonical atomic activation operation.
        """
        if context.inventory is not None and (packet is not None or ignored):
            return json.dumps(context.inventory.rejected("CLAIM_SCHEMA_INVALID", "submit_compliance_rule_set", "No arguments: explicitly submit the exact validated draft"))
        if context.submission is not None:
            return json.dumps({**context.submission, "alreadySubmitted": True}, ensure_ascii=False)
        if context.source_blocked is not None:
            return json.dumps({"sourceBlocked": context.source_blocked})
        candidate: Any = packet
        gate: dict | None = None
        try:
            if packet is None:
                packet = context.validated_packet or context.draft_packet()
            else:
                packet = _as_packet(packet)
            candidate = packet
            gate = (
                _model_view(context.last_validation, context)
                if packet == context.validated_packet
                and (context.last_validation or {}).get("outcome") == "PASSED"
                else json.loads(run_validation(packet))
            )
            if gate.get("outcome") != "PASSED":
                context.trace.append({"tool": "completion_claim", "outcome": "REJECTED"})
                feedback, detected = _record_completion_submission(
                    context, candidate, gate, accepted=False, gate_rejected=True
                )
                result = {"completionClaim": "REJECTED", "gaps": gate}
                if feedback:
                    result["NO_PROGRESS"] = (
                        "The same candidate, mechanical gate gaps, and preparation progress "
                        "were submitted again. Change the candidate, resolve a listed gap, "
                        "or advance source-backed preparation before submitting again."
                    )
                if detected:
                    raise NoProgressDetected("NO_PROGRESS_DETECTED")
                return json.dumps(result, ensure_ascii=False)
            packet = context.validated_packet
            result = context.api.submit_compliance_rule_set(
                context.run_id, context.idempotency_key, packet
            )
        except (ValueError, WorkerCallbackError) as error:
            context.errors.append(str(error))
            context.trace.append({"tool": "completion_claim", "outcome": "REJECTED"})
            _record_completion_submission(context, candidate, gate, accepted=False, gate_rejected=False)
            return json.dumps({"error": str(error)})
        context.submission = result
        if context.inventory is not None:
            context.inventory.transition(COMPLETION)
        context.progress_revision += 1
        context.trace.append({"tool": "submit", "outcome": (result.get("validation") or {}).get("outcome")})
        _record_completion_submission(context, packet, gate, accepted=True, gate_rejected=False)
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

    common = [
        record_preparation_progress,
        validate_compliance_rule_set,
        submit_compliance_rule_set,
        report_rule_set_source_blocked,
        add_to_packet_draft,
        remove_from_packet_draft,
    ]
    if context.inventory is not None:
        # Runtime authoring is incremental; giant independently mutable packet tools are not exposed.
        validate_compliance_rule_set.description = "Validate current Rule candidates against the frozen inventory revision, returning grouped claim/provenance/fidelity gaps. No arguments or replacement packet. A pass enters SUBMISSION_READY without publishing authority."
        submit_compliance_rule_set.description = "Explicitly submit the exact validated frozen-inventory draft once through the Completion Gate. No arguments or replacement packet."
        validate_compliance_rule_set.args_schema = {"type": "object", "properties": {}, "additionalProperties": False}
        submit_compliance_rule_set.args_schema = {"type": "object", "properties": {}, "additionalProperties": False}
        def serialize(function):
            @wraps(function)
            def invoke(*args, **kwargs):
                with context.mutation_lock:
                    return function(*args, **kwargs)
            return invoke
        for governed in common[:4]:
            governed.func = serialize(governed.func)
        return common[:4] + build_claim_tools(context)
    # Isolated legacy tool unit tests have no source graph. The real runner always supplies one.
    return common
