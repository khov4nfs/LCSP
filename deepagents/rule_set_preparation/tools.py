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
from orchestration.agent_stream import DURABLE, SEMANTIC_SCHEMA_VERSION, publish_agent_stream_event
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.platform.logging import get_logger

from rule_set_preparation.legal_source_files import refute_source_block
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.claim_inventory import (
    AUTHORING, AUTHORING_DRAFT_KEYS, ClaimInventory, COMPLETION, RULE_VALIDATION, SUBMISSION_READY, grouped_gaps,
)
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

    def claim_inventory_operation(self, run_id: str, action: str, revision: int, **fields: Any) -> dict:
        """Business purpose: Define the worker API boundary for versioned claim-inventory lifecycle operations.

        Business rules:
        - Calls carry the preparation run ID, inventory revision, action and action-specific fields; the remote API owns authorization and persistence.

        Execution flow:
        1. Accept a run-scoped inventory action request.
        2. Return the API's structured result mapping.

        Failure cases:
        - API errors are surfaced by the implementation as its governed failure contract.

        Side effects:
        - Implementations invoke a remote claim-inventory operation that may read or persist durable lifecycle state.
        """
        ...

    def source_review_operation(self, run_id: str, revision: int, action: str, **fields: Any) -> dict:
        """Business purpose: Define the worker API boundary for INIT, LOAD, PROGRESS, COMPLETE and REOPEN source-review actions.

        Business rules:
        - Calls are pinned to the preparation run and inventory revision; the API validates source/frontier revisions and ownership.

        Execution flow:
        1. Accept the run ID, inventory revision, action and action fields.
        2. Return the API's structured review result.

        Failure cases:
        - Stale, unauthorized or incomplete review operations are returned through the API failure contract.

        Side effects:
        - Implementations invoke a remote source-review operation that may load or persist durable frontier state.
        """
        ...

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
    frontier_enabled: bool = True
    discovery_only: bool = False
    direct_draft: bool = False
    direct_state: Any = None
    target_date: str | None = None
    authored_claim_ids: set[str] = field(default_factory=set)
    inventory: ClaimInventory | None = None
    authoring: Any = None
    mutation_lock: Any = field(default_factory=threading.RLock, repr=False)
    model_turn: int | None = None
    # Ordering for authoring telemetry: never infer order from wall-clock time. event_sequence is monotonic per run; draft_revision
    # advances exactly when the authored Requirement/AssessmentRule candidates change.
    event_sequence: int = 0
    draft_revision: int = 0
    draft_fp: str | None = None
    rejection_log: list[dict[str, Any]] = field(default_factory=list)
    submission: dict[str, Any] | None = None
    validation_calls: int = 0
    last_validation: dict[str, Any] | None = None
    validated_packet: dict[str, Any] | None = None
    source_blocked: dict[str, str] | None = None
    # The API accepted the terminal no-operative-obligations conclusion (INV-C2): nothing further is authored or submitted.
    concluded: dict[str, Any] | None = None
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
        """Business purpose: Assemble the current Rule Set candidate packet with the correct source and claim-inventory provenance.

        Business rules:
        - Draft sections exclude graph-owned fields; a live source graph supplies its base metadata, while an initialized/frozen inventory supersedes that graph with its authoritative graph and frozen binding.

        Execution flow:
        1. Copy non-graph draft sections into packet lists.
        2. Add the pinned graph projection when a source graph exists.
        3. Replace it with the current inventory graph and then frozen graph/binding when those authorities are available.
        4. Return the packet.

        Failure cases:
        - Invalid draft structures propagate; absent source/inventory state is represented by the sections that are actually available.

        Side effects:
        - None: constructs an in-memory validation/submission packet.
        """
        packet = {key: list(items.values()) for key, items in self.draft.items() if key not in GRAPH_SECTIONS}
        if self.source_graph is not None:
            packet["semanticGraph"] = {"contractVersion": "LEGAL_GRAPH_V3", **self.source_graph.base(),
                                       **{field: list(self.draft[key].values()) for key, field in GRAPH_SECTIONS.items()}}
        if self.inventory is not None:
            packet["semanticGraph"] = self.inventory.graph()
        if self.inventory is not None and self.inventory.frozen is not None:
            packet["semanticGraph"] = deepcopy(self.inventory.frozen)
            packet["claimInventory"] = self.inventory.binding()
        return packet

    def draft_counts(self) -> dict[str, int]:
        """Business purpose: Return counts of the current drafted sections without exposing candidate content.

        Business rules:
        - Graph sections are counted only when a source graph exists or the section contains draft rows.

        Execution flow:
        1. Iterate draft sections.
        2. Count included items and return counts by section.

        Failure cases:
        - Malformed section mappings fail visibly rather than reporting fabricated counts.

        Side effects:
        - None: read-only count projection.
        """
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


def _packet_field_repair(packet: dict, path: str) -> str:
    """Name the Requirement and the call that repairs a rejected packet field; the bare path sent agents to reopen the inventory.

    Business purpose: Turn common Requirement/AssessmentRule packet-field validation failures into a specific legal-candidate repair action.

    Business rules:
    - Advice is specialized only for known assessable-without-rule, invalid Requirement ID and unknown Requirement reference paths; other failures receive general typed-authoring guidance.

    Execution flow:
    1. Match the validator path to a supported packet field pattern.
    2. Read the affected Requirement or AssessmentRule identity from the candidate packet.
    3. Return the exact authoring/removal call that addresses the ownership gap.

    Failure cases:
    - Unrecognized paths or out-of-range item indexes return generic repair guidance instead of guessing an owner.

    Side effects:
    - None: formats repair guidance from the supplied packet.
    """
    match = re.fullmatch(r"packet\.legalRequirements\.(\d+)\.coverage\.state", path)
    rows = packet.get("legalRequirements") or []
    if match and int(match[1]) < len(rows):
        rid = rows[int(match[1])]["legalRequirementId"]
        return (f"Requirement '{rid}' is assessable but no AssessmentRule references it: call author_assessment_rule with legal_requirement_ids ['{rid}'], "
                "or author it again as external (non_repository_duty with a non_assessable_reason). Never reopen the inventory for this.")
    match = re.fullmatch(r"packet\.legalRequirements\.(\d+)\.legalRequirementId", path)
    if match and int(match[1]) < len(packet.get("legalRequirements") or []):
        rid = packet["legalRequirements"][int(match[1])]["legalRequirementId"]
        return (f"Requirement id '{rid}' is not a valid id (ASCII letters, digits and . _ : - only, starting with a letter or digit, at most 128 characters): "
                "remove_rule_candidate for it, then author it again with a valid requirement_key and re-author the AssessmentRules that named it.")
    match = re.fullmatch(r"packet\.assessmentRules\.(\d+)\.legalRequirementIds\.(\d+)", path)
    rules = packet.get("assessmentRules") or []
    if match and int(match[1]) < len(rules) and int(match[2]) < len(rules[int(match[1])]["legalRequirementIds"]):
        rule = rules[int(match[1])]
        return (f"AssessmentRule '{rule['assessmentRuleId']}' lists Requirement '{rule['legalRequirementIds'][int(match[2])]}', which is not a Requirement of this draft "
                "(it was removed or never authored): call author_assessment_rule again with the same assessment_rule_id and existing assessable legal_requirement_ids, "
                "or remove_rule_candidate for the rule. get_rule_authoring_status lists the real ids.")
    return "Repair this candidate field using the typed authoring tool"


def _model_view(result: dict, context: "RuleSetPreparationContext | None" = None) -> dict:
    """The validation result as the agent sees it: uncovered provisions grouped and bounded.

    Business purpose: Project a validation response into bounded, actionable feedback for the Preparation agent.

    Business rules:
    - Structural/provenance failures remain distinct; uncovered source locators are grouped by document and capped, and stale source hashes may include the authoritative pinned hash.

    Execution flow:
    1. Bound oversized failure lists while retaining gap counts.
    2. Remove individual coverage failures and group their locators into an uncovered-provision summary.
    3. Enrich stale-hash errors from the pinned graph and include current draft labels when present.
    4. Return the model-facing validation view.

    Failure cases:
    - Missing or malformed optional context leaves the original result details intact; it does not convert failed validation into a pass.

    Side effects:
    - None: creates a response projection without changing the validator result or draft.
    """
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
            pins = {(context.source_graph.nodes[nid]["documentId"], context.source_graph.chunks[cid]["locator"]): context.source_graph.chunks[cid]["contentSha256"]
                    for nid, chunk_ids in context.source_graph.chunk_ids.items() for cid in chunk_ids} if context.source_graph else {}
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
    """Business purpose: Create a stable full SHA-256 fingerprint for completion candidates, gate references and progress state.

    Business rules:
    - JSON keys are sorted, compact serialization is used, Unicode is preserved and unsupported values stringify deterministically.

    Execution flow:
    1. Serialize the supplied value with deterministic JSON options.
    2. Encode as UTF-8 with replacement for invalid characters.
    3. Return the hexadecimal SHA-256 digest.

    Failure cases:
    - Serialization failures outside the configured fallback propagate to the caller.

    Side effects:
    - None: pure fingerprint calculation.
    """
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8", errors="replace")).hexdigest()


def _completion_gap_projection(gate: dict | None) -> tuple[list[str], list[str], str]:
    """Business purpose: Separate completion-gate structural gaps from source-provenance gaps and fingerprint the reported locations.

    Business rules:
    - Only stable uppercase gap codes are retained; known source-status/hash/reference codes are provenance gaps, while uncovered provisions count as structural coverage gaps.

    Execution flow:
    1. Read valid failure codes and classify each into structural or provenance sets.
    2. Fingerprint every string reference.
    3. Add coverage gaps and document/locator fingerprints from the uncovered-provision projection.
    4. Return sorted gap-code lists and a fingerprint of all gap identities.

    Failure cases:
    - Malformed gate/failure structures are ignored where their types are unsupported; they cannot create a false pass.

    Side effects:
    - None: builds a deterministic gap projection.
    """
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
    """Business purpose: Record completion attempts and detect an unchanged rejected candidate that makes no preparation progress.

    Business rules:
    - A repeat is detected only for the same candidate, same mechanical gap fingerprint and unchanged progress revision; accepted completion resets repeat state.

    Execution flow:
    1. Project structural/provenance gaps and fingerprint the candidate.
    2. Under the observation lock, advance the attempt ordinal and compare candidate/gap/progress state.
    3. Publish a durable completion-attempt event and, when the same rejected state repeats after feedback, publish NO_PROGRESS_DETECTED.
    4. Return whether feedback is due and whether a no-progress condition was detected.

    Failure cases:
    - Invalid candidate/gate data cannot produce a candidate fingerprint; stream publication errors propagate.

    Side effects:
    - Updates completion counters/fingerprints and publishes durable progress events; it does not accept or mutate the Rule Set candidate.
    """
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
    """Bind validation, submission and explicit source-blocking to one run.

    Business purpose: Bind the governed Preparation validation, submission, progress and source-blocking tools to one run context.

    Business rules:
    - Frozen-inventory runs expose typed claim/Requirement authoring paths and no free-form packet replacement; lifecycle terminal states cannot be mutated.
    - Validation checks mechanical structure/provenance, while substantive legal interpretation and completeness remain with the agent.

    Execution flow:
    1. Initialize ClaimInventory and AuthoringWorkingSet when a pinned source graph requires them.
    2. Construct run-scoped progress, validation, submission, source-blocking and draft tools.
    3. Apply mutation locking and select legacy, discovery, authoring or direct-draft tool sets.
    4. Return only tools supported by the active lifecycle.

    Failure cases:
    - Invalid phase/tool arguments return repairable governed feedback; API/runtime failures propagate through tool policies.

    Side effects:
    - May initialize run-local inventory/authoring state and returns tool objects; tool effects occur only when invoked.
    """

    if context.source_graph is not None and context.inventory is None:
        context.inventory = ClaimInventory(context)
    if context.inventory is not None and context.authoring is None:
        from rule_set_preparation.authoring_state import AuthoringWorkingSet
        context.authoring = AuthoringWorkingSet(context)

    @tool(args_schema=PREPARATION_PROGRESS_SCHEMA)
    def record_preparation_progress(
        establishedFindings: list[str] | None = None,
        unresolvedMaterialWork: list[str] | None = None,
        currentTarget: str | None = None,
        intendedAction: str | None = None,
        expectedInformationGain: str | None = None,
        **kwargs: Any,
    ) -> str:
        """Record concise source-grounded findings, unresolved work and the next factual investigation action.

        This is an execution-local working ledger, not legal output or chain-of-thought. Do not include
        private reasoning; cite source identifiers/locators when useful.

        Business purpose: Maintain a concise execution-local ledger of source-grounded findings, unresolved work and the next factual investigation action.

        Business rules:
        - Omitted fields preserve their current values; this ledger is not legal output or chain-of-thought and must not contain private reasoning.

        Execution flow:
        1. Merge supplied fields with current progress state.
        2. Under the observation lock, increment progress revision when established findings or unresolved work change.
        3. Save the new progress state and return it with its revision.

        Failure cases:
        - Schema-invalid values are rejected by the tool contract; internal state update errors propagate.

        Side effects:
        - Updates only run-local progress state and may advance progress revision.
        """
        progress = {
            "establishedFindings": (
                establishedFindings
                if establishedFindings is not None
                else list(context.progress_state.get("establishedFindings") or [])
            ),
            "unresolvedMaterialWork": (
                unresolvedMaterialWork
                if unresolvedMaterialWork is not None
                else list(context.progress_state.get("unresolvedMaterialWork") or [])
            ),
            "currentTarget": (
                currentTarget
                if currentTarget is not None
                else str(context.progress_state.get("currentTarget") or "")
            ),
            "intendedAction": (
                intendedAction
                if intendedAction is not None
                else str(context.progress_state.get("intendedAction") or "")
            ),
            "expectedInformationGain": (
                expectedInformationGain
                if expectedInformationGain is not None
                else str(context.progress_state.get("expectedInformationGain") or "")
            ),
        }
        with context.observation_lock:
            if any(context.progress_state[key] != progress[key] for key in (
                "establishedFindings", "unresolvedMaterialWork"
            )):
                context.progress_revision += 1
            context.progress_state = progress
        return json.dumps({"progressState": progress, "progressRevision": context.progress_revision})

    def run_validation(packet: dict | None = None) -> str:
        """Business purpose: Run the correct mechanical Rule Set or semantic-inventory validation for the current Preparation lifecycle.

        Business rules:
        - Source-blocked or concluded runs cannot validate; frozen authoring validates only its persisted draft and lifecycle phases, while direct-draft discovery must finalize and freeze inventory before Rule authoring.
        - A passing result records the exact candidate packet; inventory-backed authoring advances to submission readiness, while the legacy no-inventory path retains the validated packet without a phase transition. Validation never decides substantive law.

        Execution flow:
        1. Reject terminal source-blocked/concluded state and prepare direct-draft inventory if required.
        2. Verify authoring phase, restore/flush the current draft, and record a real validator attempt.
        3. Validate the supplied complete packet or current draft through the governed API/claim inventory.
        4. Record validation events, transition phase, update removable items and preserve the exact packet only on pass.
        5. Return grouped/bounded validation feedback.

        Failure cases:
        - Empty draft, wrong lifecycle phase, schema errors, incomplete claim accounting and API refusals remain failures; non-client callback errors propagate.

        Side effects:
        - May persist/flush an authoring draft, transition inventory state and publish validation/coverage events; it does not submit or activate a Rule Set.
        """
        if context.source_blocked is not None:
            return json.dumps({"sourceBlocked": context.source_blocked})
        if context.concluded is not None:
            return json.dumps({"error": "Preparation is already finished.", "concluded": context.concluded["failureReason"]})
        if context.inventory is None:
            context.validation_calls += 1
        else:
            inventory = context.inventory
            if context.direct_draft and inventory.frozen is None:
                from rule_set_preparation.direct_draft import project_context_relations
                project_context_relations(context)
                draft = deepcopy({key: context.draft[key] for key in AUTHORING_DRAFT_KEYS})
                saved_draft = context.api.claim_inventory_operation(context.run_id, "SAVE_AUTHORING_DRAFT", inventory.revision,
                                                      draft=draft, draftVersion=inventory.draft_version)
                if isinstance(saved_draft, dict) and "draftVersion" in saved_draft:
                    inventory.draft_version = saved_draft["draftVersion"]
                result = inventory.validate_inventory(finalize=True)
                if result.get("outcome") != "PASSED":
                    return json.dumps(result, ensure_ascii=False)
                result = inventory.begin_authoring()
                if result.get("outcome") != "PASSED":
                    return json.dumps(result, ensure_ascii=False)
            if inventory.frozen is None or inventory.phase not in {AUTHORING, RULE_VALIDATION, SUBMISSION_READY}:
                return json.dumps(inventory.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Finalize inventory and start Rule authoring first"))
            inventory.restore_authoring_draft()
            inventory.flush_authoring_draft()
            # An attempt exists only once the real Rule Validator is about to run; a refused call is not one.
            context.validation_calls += 1
            inventory.transition(RULE_VALIDATION)
            publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
                "durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": "RULE_VALIDATION_STARTED",
                "rule_validation_attempt": context.validation_calls, "inventory_revision": inventory.revision,
                "claim_inventory_fingerprint": inventory.frozen_fingerprint, **inventory.stamp()})
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
            result = {"outcome": "FAILED", "failures": [{"code": "CLAIM_SCHEMA_INVALID", "ref": path, "detail": _packet_field_repair(packet, path)}
                      for path in sorted(set(re.findall(r"packet\.[A-Za-z0-9_.]+", str(error))))[:20]] or [{"code": "CLAIM_SCHEMA_INVALID", "ref": "packet", "detail": str(error)[:200]}]}
        if context.inventory is not None:
            result = context.inventory.observe_validation(result, RULE_VALIDATION, packet)
            passed = result.get("outcome") == "PASSED"
            publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
                "durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": "RULE_VALIDATION_PASSED" if passed else "RULE_VALIDATION_FAILED",
                "rule_validation_attempt": context.validation_calls, "inventory_revision": context.inventory.revision,
                "gap_counts": {k: v["count"] for k, v in grouped_gaps(result)["gaps"].items()}, **context.inventory.stamp()})
            context.inventory.transition(SUBMISSION_READY if passed else AUTHORING)
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

        Business purpose: Add or replace labeled parts of the legacy Rule Set packet draft before the whole packet is validated.

        Business rules:
        - Terminal runs reject mutation; frozen-inventory runs must use typed authoring tools; every submitted item needs its canonical identity label, and an existing label replaces that item.
        - Any changed draft invalidates previous validation; the tool never interprets or validates legal meaning as part of the add.

        Execution flow:
        1. Reject terminal or frozen-inventory usage.
        2. Verify labels for all supplied packet sections before changing anything.
        3. Add/replace labeled items, advance progress when content changes and clear stale validation.
        4. Return counts and automatically attach a dry-run validation after the configured number of add calls.

        Failure cases:
        - Missing labels reject the entire add; terminal/frozen phases return repair feedback; validation failures remain attached rather than accepting a pass.

        Side effects:
        - Mutates the run-local packet draft, trace and progress revision and may publish progress/validation events.
        """
        if context.submission is not None or context.source_blocked is not None or context.concluded is not None:
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
        failures can be removed; to change any other item send it again with the same label.

        Business purpose: Remove only packet items that the most recent validation failure explicitly identifies as removable.

        Business rules:
        - Terminal runs cannot change; unknown labels and items not named by the latest validation failure are retained and reported.

        Execution flow:
        1. Reject terminal state.
        2. Process requested Requirement, AssessmentRule and relation labels against the current draft and removable allowlist.
        3. Clear stale validation, record removal counts and return unknown/refused labels with repair guidance.

        Failure cases:
        - Labels absent from the draft or not named by the latest validation failure are not deleted; malformed requests are rejected by the declared schema.

        Side effects:
        - Mutates local draft/removable state and validation trace; it does not persist or activate the packet.
        """
        if context.submission is not None or context.source_blocked is not None or context.concluded is not None:
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

        Business purpose: Expose a dry-run validation of the current Rule Set draft or a complete packet in legacy mode.

        Business rules:
        - Frozen-inventory calls accept no packet replacement and validate the current persisted authoring draft; passing a gate does not submit or activate the Rule Set.

        Execution flow:
        1. Reject packet arguments when a frozen inventory owns the draft.
        2. Flush the current authoring draft when applicable.
        3. Run the shared validator and serialize its mechanical findings.

        Failure cases:
        - Wrong phase, malformed packet or failed validation returns explicit repair gaps; no passing result is fabricated.

        Side effects:
        - May flush the current authoring draft and update validation/phase telemetry; no submission or activation occurs.
        """
        if context.inventory is not None and (packet is not None or ignored):
            return json.dumps(context.inventory.rejected("CLAIM_SCHEMA_INVALID", "validate_compliance_rule_set", "No arguments: use typed authoring tools and validate the current frozen-inventory draft"))
        if context.inventory is not None:
            context.inventory.flush_authoring_draft()
        return run_validation(packet)

    @tool(args_schema=OPTIONAL_PACKET_INPUT_SCHEMA)
    def submit_compliance_rule_set(packet: dict | None = None, **ignored: Any) -> str:
        """Claim completion for a packet, run the deterministic integrity gate, then submit once.

        A rejected gate returns its exact mechanical gaps to this same agent for repair. The gate
        checks structure and provenance only; this agent owns legal interpretation and completeness.
        A passing claim is submitted through the canonical atomic activation operation.

        Business purpose: Submit the exact mechanically validated Rule Set candidate once through the canonical governed API.

        Business rules:
        - Frozen-inventory calls accept no replacement packet; only a passing exact candidate may be submitted, and existing submission/source-blocked/concluded states are terminal.
        - The deterministic gate checks structure and provenance; legal interpretation and completeness remain agent responsibilities.

        Execution flow:
        1. Return the existing terminal result when already submitted or blocked/concluded.
        2. Restore/flush the current draft, select the exact validated candidate and run or reuse its validation gate.
        3. Return repair gaps for a failed gate, tracking repeated unchanged completion attempts.
        4. Submit a passing packet with the run's idempotency key, transition inventory and record completion provenance.

        Failure cases:
        - Gate failures remain rejected; callback/value errors are returned as errors; repeated same candidate/gaps/progress raises NoProgressDetected.

        Side effects:
        - Calls the governed submission API and may transition inventory, update run trace/revision and publish durable completion events.
        """
        if context.inventory is not None and (packet is not None or ignored):
            return json.dumps(context.inventory.rejected("CLAIM_SCHEMA_INVALID", "submit_compliance_rule_set", "No arguments: explicitly submit the exact validated draft"))
        if context.submission is not None:
            return json.dumps({**context.submission, "alreadySubmitted": True}, ensure_ascii=False)
        if context.source_blocked is not None:
            return json.dumps({"sourceBlocked": context.source_blocked})
        if context.concluded is not None:
            return json.dumps({"error": "Preparation is already finished.", "concluded": context.concluded["failureReason"]})
        if context.inventory is not None:
            context.inventory.restore_authoring_draft()
            context.inventory.flush_authoring_draft()
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
    def report_rule_set_source_blocked(reason: str = "", path: str = "", **ignored: Any) -> str:
        """End WITHOUT submission only when the pinned source cannot be read or its pins
        are inconsistent. Do not use for unfinished work, ambiguous provisions or validation
        feedback that can be corrected. Name the affected pinned source path and reason.

        Business purpose: End Preparation without submission only when the pinned source cannot be read or its recorded pins are inconsistent.

        Business rules:
        - Reasons and paths are constrained to declared source-blocking cases under `/legal-source`; an intact readable source refutes the claim and requires work to continue.

        Execution flow:
        1. Reject already submitted runs, unsupported reasons and paths outside the pinned source tree.
        2. Verify readability or immutable index hashes when a local source root exists.
        3. Return a refutation when evidence contradicts the block claim; otherwise retain the reported blocker as terminal context.

        Failure cases:
        - Invalid reason/path or a concrete refutation returns repair guidance; a missing/unreadable source index or mismatched hash does not count as a refutation and leaves the blocker report recorded.

        Side effects:
        - A retained blocker updates run-local terminal/progress/trace state and logging; it does not submit, validate or activate a Rule Set.
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
            """Business purpose: Serialize shared Preparation tool mutations.

            Business rules:
            - One run's mutation lock owns candidate changes.
            Execution flow: 1. Wrap the tool. 2. Execute it under the existing lock.
            Failure cases:
            - Malformed arguments return feedback; operational failures propagate.
            Side effects:
            - The wrapped tool retains its own persistence and progress effects.
            """
            @wraps(function)
            def invoke(*args, **kwargs):
                """Business purpose: Keep malformed tool input repairable without hiding runtime failure.

                Business rules:
                - Control-flow and callback failures must reach their failure policy.
                Execution flow: 1. Lock the run. 2. Invoke the tool. 3. Return input-shape feedback.
                Failure cases:
                - Only TypeError, ValueError and KeyError become FAILED feedback.
                Side effects:
                - Invokes the existing governed mutation; creates no alternate state.
                """
                with context.mutation_lock:
                    try:
                        return function(*args, **kwargs)
                    except (TypeError, ValueError, KeyError) as err:
                        return json.dumps({"outcome": "FAILED", "error": f"{type(err).__name__}: {str(err)}"})
            return invoke
        for governed in common[:4]:
            governed.func = serialize(governed.func)
        tools = common[:4] + build_claim_tools(context)
        if context.direct_draft:
            from rule_set_preparation.direct_draft import build_direct_draft_tools
            validate_compliance_rule_set.description = "Validate the persisted Rule Set Draft, exact source support, source coverage, references, legal effects and rule bindings. Returns specific errors. No arguments."
            submit_compliance_rule_set.description = "Activate the exact validated Rule Set Draft through the governed API. Validation must pass first. No arguments."
            return [*common[:4], *[t for t in tools if t.name == "get_applicable_legal_state"], *build_direct_draft_tools(context)]
        from rule_set_preparation.claim_files import build_claim_file_tools
        tools += build_claim_file_tools(context)
        return [t for t in tools if not (context.discovery_only and t.name in {"validate_compliance_rule_set", "submit_compliance_rule_set"})]
    # Isolated legacy tool unit tests have no source graph. The real runner always supplies one.
    return common
