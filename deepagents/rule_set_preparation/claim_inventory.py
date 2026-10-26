"""Revisioned Agent-authored claim discovery. No source-prose interpretation occurs here."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator
from middleware.failure_policy import NoProgressDetected
from rule_set_preparation.authoring_rejections import AUTHORING_PRECONDITION, REPAIR, SOURCE_BODY, build_envelope, draft_fingerprint
from orchestration.agent_stream import DURABLE, SEMANTIC_SCHEMA_VERSION, publish_agent_stream_event

DISCOVERY = "CLAIM_DISCOVERY"
INVENTORY_VALIDATION = "CLAIM_INVENTORY_VALIDATION"
READY = "CLAIM_INVENTORY_READY"
AUTHORING = "RULE_AUTHORING"
RULE_VALIDATION = "RULE_VALIDATION"
SUBMISSION_READY = "SUBMISSION_READY"
COMPLETION = "COMPLETION"
# Mirrors packages/contracts CLAIM_INVENTORY_ACTIONS / RULE_SET_PREPARATION_FAILURE_REASONS.
CONCLUDE_ACTION = "CONCLUDE_NO_OPERATIVE_OBLIGATIONS"
NO_OPERATIVE_OBLIGATIONS = "NO_OPERATIVE_OBLIGATIONS"
AUTHORING_DRAFT_KEYS = ("legalRequirements", "assessmentRules", "contextRelations")
GRAPH_SECTIONS = {"semanticClaims": "claims", "claimRelations": "relations",
                  "sourceAccounting": "sourceAccounting", "referenceAccounting": "referenceAccounting"}
NORMATIVE = {"DUTY", "PROHIBITION", "PERMISSION"}
ROLE_FIELDS = {"APPLICABILITY_CONDITION": "applicabilityConditions", "QUALIFIER": "qualifiers",
               "EXCEPTION": "exceptions", "CONTEXT": "semanticContext", "DEFINITION": "semanticContext"}
CLAIM_ROLES = {**{k: "OPERATIVE_PROPOSITION" for k in NORMATIVE}, "CONDITION": "APPLICABILITY_CONDITION",
               "SCOPE": "APPLICABILITY_CONDITION", "QUALIFIER": "QUALIFIER", "TEMPORAL_RULE": "QUALIFIER",
               "TRANSITION_RULE": "QUALIFIER", "EXCEPTION": "EXCEPTION", "DEFINITION": "DEFINITION",
               "CONTEXT": "CONTEXT", "CROSS_REFERENCE": "CONTEXT"}
# Inspection tools never change state; a malformed call is a rejected READ, not a validation of anything.
READ_TOOLS = frozenset({"get_applicable_legal_state", "get_claim_inventory", "get_rule_authoring_context", "get_rule_authoring_status", "get_semantic_closure"})
# Frozen-inventory gaps only Claim Discovery can close: the same tool path closes them in either discovery mode.
READINESS_CODES = frozenset({"APPLICABILITY_AUTHORITY_MISSING", "OPERATIVE_CLAIM_MISSING"})
CONCLUDE_TOOL = "conclude_no_operative_obligations"
RELATION_KINDS = {"DEFINITION", "SCOPE", "QUALIFIER", "EXCEPTION", "CROSS_REFERENCE", "CONDITION", "INCORPORATES", "TEMPORALLY_LIMITS"}
RELATION_KINDS.update({"CONDITION_OF", "QUALIFIES", "EXCEPTION_TO", "TEMPORALLY_APPLIES_TO", "DEFINED_BY", "PRESERVES", "EVIDENCE_SLICE_OF", "CONTEXT_FOR"})
REQUIREMENT_KINDS = {"CONDITION": "SCOPE", "INCORPORATES": "CROSS_REFERENCE", "TEMPORALLY_LIMITS": "QUALIFIER", "CONDITION_OF": "SCOPE", "QUALIFIES": "QUALIFIER", "EXCEPTION_TO": "EXCEPTION", "TEMPORALLY_APPLIES_TO": "QUALIFIER", "DEFINED_BY": "DEFINITION", "PRESERVES": "CROSS_REFERENCE", "EVIDENCE_SLICE_OF": "CROSS_REFERENCE", "CONTEXT_FOR": "CROSS_REFERENCE"}
SCHEMA = json.loads(Path(__file__).with_name("packet-schema.json").read_text())["properties"]["packet"]
CLAIM_SCHEMA = SCHEMA["properties"]["semanticGraph"]["properties"]["claims"]["items"]


# Repair instruction used when the rejecting site names none: stable per code, never per occurrence.
DEFAULT_REPAIR = {"CLAIM_REQUIREMENT_MISMATCH": "ROLE_MISMATCH", "OPERATIVE_PROPOSITION_REQUIRED": "OPERATIVE_REQUIRED",
                  "APPLICABILITY_SCOPE_MISSING": "APPLICABILITY_REQUIRED", "ORPHAN_ASSESSMENT_RULE": "UNKNOWN_REQUIREMENT"}


FRAME_FIELDS = ['object', 'beneficiary', 'trigger', 'scope', 'qualifier', 'exception', 'temporalApplicability', 'repositoryObservableAspect', 'externalFulfillmentAspect']


def text_sha(value):
    return hashlib.sha256(value.encode()).hexdigest()

def utf16_slice(content: str, start: int, end: int) -> str:
    """AST offsets use JavaScript's UTF-16 coordinates; reject half-surrogate boundaries."""
    encoded = content.encode("utf-16-le")
    if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, int) or not isinstance(end, int) or start < 0 or end <= start or end * 2 > len(encoded):
        raise ValueError("Invalid source support offsets")
    return encoded[start * 2:end * 2].decode("utf-16-le")

def canonical_support(source, anchors, supports):
    if not isinstance(supports, list) or not supports:
        raise ValueError("Minimal exact source_support spans are required")
    result = []
    for span in supports:
        if set(span) - {"nodeId", "startOffset", "endOffset", "contentSha256"} or span.get("nodeId") not in anchors:
            raise ValueError("Support must cite a claim's pinned source node")
        node = source.nodes.get(span["nodeId"])
        if not node:
            raise ValueError("Unknown support node")
        text = utf16_slice(node["content"], span.get("startOffset"), span.get("endOffset"))
        if not text.strip():
            raise ValueError("Empty semantic support")
        sha = text_sha(text)
        if span.get("contentSha256", sha) != sha:
            raise ValueError("Source support contentSha256 mismatch")
        result.append({**span, "contentSha256": sha})
    if set(anchors) != {s["nodeId"] for s in result} or len({(s["nodeId"], s["startOffset"], s["endOffset"]) for s in result}) != len(result):
        raise ValueError("Every source anchor needs distinct support")
    return sorted(result, key=lambda s: (s["nodeId"], s["startOffset"], s["endOffset"]))


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def identity_key(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).lower().split())


def claim_id(run_id: str, revision: int, nodes: list[str], key: str) -> str:
    return fingerprint({"preparationRunId": run_id, "revision": revision, "sourceNodeIds": sorted(nodes), "identityKey": identity_key(key)})


def normalized_graph(graph: dict) -> dict:
    return {**deepcopy(graph),
            "claims": sorted([{**c, "sourceNodeIds": sorted(c["sourceNodeIds"])} for c in graph["claims"]], key=lambda c: c["claimId"]),
            "relations": sorted(graph["relations"], key=lambda r: r["relationId"]),
            "sourceAccounting": sorted([{**r, "claimIds": sorted(r["claimIds"])} for r in graph["sourceAccounting"]], key=lambda r: r["sourceNodeId"]),
            "referenceAccounting": sorted([{**r, "relationIds": sorted(r["relationIds"])} for r in graph["referenceAccounting"]], key=lambda r: r["referenceId"])}


def readable_names(identities: dict, relations: dict) -> dict:
    """Claim ids and relation ids as the agent wrote them: file#key, and 'KIND from -> to'."""
    return {**identities, **{rid: f"{r['kind']} {identities.get(r['fromClaimId'], '?')} -> {identities.get(r['toClaimId'], '?')}" for rid, r in relations.items()}}


def grouped_gaps(result: dict, claims: dict | None = None, names: dict | None = None) -> dict:
    """Group failures by code. `names` maps claim ids to their file#key so the agent can edit the claim instead of searching for a hash."""
    readable = lambda text: re.sub(r"[a-f0-9]{64}", lambda m: (names or {}).get(m.group(0), m.group(0)), text) if names and isinstance(text, str) else text
    groups: dict[str, dict] = {}
    for failure in result.get("failures", []):
        group = groups.setdefault(failure["code"], {"count": 0, "examples": []})
        group["count"] += 1
        if len(group["examples"]) < 20:
            example = {k: failure[k] for k in ("ref", "detail", "referenceId", "sourceNodeId", "targetNodeId", "suppliedFromClaimId", "suppliedToClaimId", "sourceClaimIds", "targetClaimIds", "requiredAction", "expectedRole", "suppliedField", "expectedField", "candidateCount", "candidates", "layer", "fieldPaths", "repair", "suppliedClaimId", "actualRole", "expected") if k in failure}
            ref = failure.get("ref")
            claim = (claims or {}).get(ref.removeprefix("claim:")) if isinstance(ref, str) else None
            example.update({k: readable(example[k]) for k in ("ref", "detail") if k in example})
            if claim:
                example.update(claimType=claim["claimType"], sourceNodeIds=claim["sourceNodeIds"][:3], sourceNodeCount=len(claim["sourceNodeIds"]))
            group["examples"].append(example)
    return {"outcome": result.get("outcome", "FAILED"), "gaps": groups,
            **{k: result[k] for k in ("phase", "revision", "fingerprint", "coverage", "NO_PROGRESS", "requiredAction", "guidance", "expectedClaimIds", "missingClaimIds", "pendingCount", "nextReviewUnitIds", "progress", "relationOwners", "detachedRelations") if k in result}}


@dataclass
class ClaimInventory:
    context: Any
    revision: int = 1
    phase: str = DISCOVERY
    identities: dict[str, str] = field(default_factory=dict)
    frozen: dict | None = None
    frozen_fingerprint: str | None = None
    # Set once the API accepted the terminal no-operative-obligations conclusion (INV-C2); no Rule authoring follows.
    concluded: dict | None = None
    validation_observations: dict[str, dict] = field(default_factory=dict)
    last_failures: list = field(default_factory=list)
    draft_version: int = 0
    saved_draft_fingerprint: str | None = None
    draft_unsaved: bool = False
    draft_restored: bool = False
    inventory_validation_calls: int = 0
    claims_by_node: dict[str, set[str]] = field(default_factory=dict)
    frontier: Any = field(init=False, default=None)
    required_nodes: set[str] = field(init=False)
    reviewed_nodes: set[str] = field(default_factory=set)
    current_tool: str | None = field(init=False, default=None)
    current_args: Any = field(init=False, default=None)
    current_call_id: str | None = field(init=False, default=None)
    current_layer: str | None = field(init=False, default=None)
    current_source: str | None = field(init=False, default=None)
    current_draft_before: str | None = field(init=False, default=None)
    last_envelope: dict | None = field(init=False, default=None)

    def __post_init__(self):
        if self.context.frontier_enabled:
            from rule_set_preparation.review_frontier import ReviewFrontier
            self.frontier = ReviewFrontier(self)
        self.required_nodes = set() if self.frontier else {nid for nid, node in self.context.source_graph.nodes.items() if node["content"].strip()}

    def progress(self, tool_name: str):
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
            "activity_kind": "CLAIM_INVENTORY_PROGRESS", "tool_name": tool_name, "phase": self.phase,
            "inventory_revision": self.revision, "inventory_fingerprint": self.frozen_fingerprint,
            "source_nodes_reviewed": (self.frontier.snapshot.get("progress", {}).get("reviewedWithClaims", 0) + self.frontier.snapshot.get("progress", {}).get("reviewedNoClaims", 0)) if self.frontier else len(self.reviewed_nodes),
            "source_nodes_remaining": (self.frontier.snapshot.get("progress", {}).get("total", 0) - self.frontier.snapshot.get("progress", {}).get("reviewedWithClaims", 0) - self.frontier.snapshot.get("progress", {}).get("reviewedNoClaims", 0)) if self.frontier else len(self.required_nodes) - len(self.reviewed_nodes),
            "review_frontier": self.frontier.snapshot if self.frontier else None,
            "claim_count": len(self.identities), "claim_relation_count": len(self.context.draft["claimRelations"]),
            "requirement_count": len(self.context.draft["legalRequirements"]), "assessment_rule_count": len(self.context.draft["assessmentRules"]),
            **{k: v for k, v in self.stamp().items() if k not in ("requirement_count", "assessment_rule_count")}})

    def rebuild_node_index(self):
        self.reviewed_nodes = self.required_nodes.intersection(self.context.draft["sourceAccounting"])
        self.claims_by_node = {}
        for claim in self.context.draft["semanticClaims"].values():
            for node in claim["sourceNodeIds"]:
                self.claims_by_node.setdefault(node, set()).add(claim["claimId"])

    def changed(self, previous, current):
        if previous != current:
            self.context.progress_revision += 1
            self.context.validated_packet = self.context.last_validation = None

    def graph(self) -> dict:
        from rule_set_preparation.reference_binding import project_reference_accounting
        project_reference_accounting(self.context)
        return {"contractVersion": "LEGAL_GRAPH_V3", **({"targetDate": self.context.target_date} if self.context.target_date else {}), **({"reviewFrontier": self.frontier.binding()} if self.frontier and self.frontier.binding() else {}), **self.context.source_graph.base(),
                **{v: list(self.context.draft[k].values()) for k, v in GRAPH_SECTIONS.items()}}

    def binding(self) -> dict:
        return {"revision": self.revision, "fingerprint": self.frozen_fingerprint}

    def stamp(self) -> dict:
        """Ordering fields for every authoring observation, so two snapshots are comparable without wall-clock time."""
        context = self.context
        context.event_sequence += 1
        if context.draft_fp is None:
            context.draft_fp = draft_fingerprint(context.draft)
        return {"event_sequence": context.event_sequence, "model_turn": context.model_turn, "draft_revision": context.draft_revision,
                "draft_fingerprint": context.draft_fp, "requirement_count": len(context.draft["legalRequirements"]),
                "assessment_rule_count": len(context.draft["assessmentRules"])}

    def draft_changed(self) -> bool:
        """Call after a Requirement/AssessmentRule candidate was added, replaced or removed."""
        context = self.context
        current = draft_fingerprint(context.draft)
        if current == context.draft_fp:
            return False
        context.draft_fp = current
        context.draft_revision += 1
        return True

    def transition(self, phase: str):
        previous = self.phase
        self.phase = phase
        if phase in (DISCOVERY, INVENTORY_VALIDATION) and getattr(self.context, "authoring", None) is not None:
            self.context.authoring.reset()  # a reopened inventory makes every authoring correction and cursor stale
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
            "durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": "CLAIM_PHASE_TRANSITION", "previous_phase": previous, "phase": phase,
            "inventory_revision": self.revision, "inventory_fingerprint": self.frozen_fingerprint, **self.stamp()})

    def state_fingerprints(self, packet: dict | None = None) -> dict:
        graph = normalized_graph(self.graph())
        packet = packet if packet is not None else self.context.draft_packet()
        requirements = sorted(packet.get("legalRequirements", []), key=lambda r: r.get("legalRequirementId", ""))
        accounting = {"bindings": [{"id": r.get("legalRequirementId"), "bindings": r.get("claimBindings", [])} for r in requirements],
                      "sourceAccounting": graph["sourceAccounting"], "referenceAccounting": graph["referenceAccounting"]}
        return {"node_review_ledger_fingerprint": fingerprint(graph["sourceAccounting"]), "frontier_state_fingerprint": self.frontier.snapshot.get("frontierStateFingerprint") if self.frontier else None, "candidate_fingerprint": fingerprint(packet), "claim_inventory_fingerprint": fingerprint({"revision": self.revision, "graph": graph}),
                "requirement_fingerprint": fingerprint(requirements), "accounting_fingerprint": fingerprint(accounting)}

    def observe_validation(self, result: dict, phase: str, packet: dict | None = None, *, kind: str = "CLAIM_PHASE_VALIDATION", envelope: dict | None = None) -> dict:
        """Record one outcome. Only kind CLAIM_PHASE_VALIDATION is a validator run; tool rejections use their own kind."""
        identities = self.state_fingerprints(packet)
        # Identity of a gap is its code, its reference AND the specific fields at fault: two different missing arguments are two
        # gaps, while one repeated mistake stays one. (A jsonschema "required" error has an empty path, so code+ref alone would
        # merge "missing title" and "missing applicability_claim_ids" into the same stagnation.)
        gaps = sorted({(f.get("code"), f.get("ref"), tuple(f.get("fieldPaths") or ())) for f in result.get("failures", [])}, key=repr)
        gap_hash = fingerprint(gaps)
        source_revision = self.context.source_graph.graph["materializationId"]
        effective = deepcopy(packet if packet is not None else self.context.draft_packet())
        for requirement in effective.get("legalRequirements", []):
            requirement.pop("title", None)
            coverage = requirement.get("coverage", {})
            coverage["nonAssessableReason"] = bool(coverage.get("nonAssessableReason"))
            requirement["claimBindings"] = sorted(requirement.get("claimBindings", []), key=lambda b: (b["claimId"], b["role"], b["index"]))
        for rule in effective.get("assessmentRules", []):
            rule.pop("concept", None)
            for criterion in rule.get("criteria", []):
                criterion.pop("investigationFocus", None)
        for section, key in (("legalRequirements", "legalRequirementId"), ("assessmentRules", "assessmentRuleId"), ("contextRelations", "relationId")):
            effective[section] = sorted(effective.get(section, []), key=lambda row: row[key])
        effective["semanticGraph"] = normalized_graph(effective.get("semanticGraph") or self.graph())
        if effective["semanticGraph"].get("reviewFrontier"):
            # Evidence digests retain exact reason text; convergence uses the effective queue state.
            effective["semanticGraph"]["reviewFrontier"].pop("reviewedFingerprint", None)
        for review in effective["semanticGraph"]["sourceAccounting"]:
            review["nonSemanticReason"] = bool(review.get("nonSemanticReason"))
        for review in effective["semanticGraph"]["referenceAccounting"]:
            review["nonMaterialReason"] = bool(review.get("nonMaterialReason"))
        for claim in effective["semanticGraph"]["claims"]:
            claim["nonOperativeReason"] = bool(claim.get("nonOperativeReason"))
        state_hash = fingerprint({"effective": effective, "phase": phase, "sourceRevision": source_revision, "revision": self.revision, "gaps": gap_hash, "frontier": self.frontier.snapshot.get("frontierStateFingerprint") if self.frontier else None})
        previous = self.validation_observations.get(state_hash)
        failed = result.get("outcome") != "PASSED"
        feedback = failed and previous is not None
        turn = self.context.model_turn
        terminal = feedback and previous["feedback"] and (turn is None or previous["feedback_turn"] is None or turn > previous["feedback_turn"])
        self.validation_observations[state_hash] = {"feedback": feedback, "feedback_turn": previous["feedback_turn"] if previous and previous["feedback"] else turn}
        data = {"durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": kind, "validation_executed": kind == "CLAIM_PHASE_VALIDATION", "phase": phase, "inventory_revision": self.revision,
                **identities, "effective_state_fingerprint": state_hash, "gap_fingerprint": gap_hash,
                "gap_counts": {k: v["count"] for k, v in grouped_gaps(result)["gaps"].items()},
                "outcome": result.get("outcome"), "claim_count": len(self.identities), "claim_relation_count": len(self.context.draft["claimRelations"]), "coverage": result.get("coverage"),
                "inventory_validation_attempt": self.inventory_validation_calls, "rule_validation_attempt": self.context.validation_calls, "review_frontier": self.frontier.snapshot if self.frontier else None,
                **self.stamp(), **({"rejection": envelope} if envelope else {})}
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data=data)
        self.context.trace.append(data)
        if terminal:
            publish_agent_stream_event("CUSTOM_PROGRESS", status="FAILED", data={**data, "activity_kind": "NO_PROGRESS_DETECTED", "trigger_activity_kind": kind})
            raise NoProgressDetected("NO_PROGRESS_DETECTED " + json.dumps({"phase": phase, "tool": self.current_tool,
                "sourceNodeId": (self.frontier.active or {}).get("sourceNodeId") if self.frontier else None,
                "gapCodes": sorted(data["gap_counts"])[:12], "effectiveStateFingerprint": state_hash,
                "gapFingerprint": gap_hash, "requiredAction": result.get("requiredAction")}, separators=(",", ":")))
        if feedback:
            result = {**result, "NO_PROGRESS": "The same effective phase state and gaps repeated. Resolve a listed gap or reopen explicitly; repeating this ineffective state after this feedback terminates the run."}
        return result

    def rejection_kind(self) -> str:
        if self.current_tool in READ_TOOLS:
            return "CLAIM_INVENTORY_READ_REJECTED"
        return "CLAIM_DISCOVERY_TOOL_REJECTED" if self.phase in {DISCOVERY, INVENTORY_VALIDATION} else "RULE_AUTHORING_TOOL_REJECTED"

    def rejected(self, code: str, ref: str, detail: str, **extra) -> dict:
        """A tool refused its input before any validator ran; the state hash still detects ineffective repetition."""
        guidance = extra.pop("guidance", None)
        action = extra.pop("requiredAction", None) or (
            "commit_claims" if code == "CLAIM_IDENTITY_CONFLICT"
            else "commit_claims" if self.frontier and self.phase in {DISCOVERY, INVENTORY_VALIDATION}
            else "get_claim_inventory")
        layer = extra.pop("layer", None) or self.current_layer or AUTHORING_PRECONDITION
        source = extra.pop("source", None) or self.current_source or SOURCE_BODY
        repair_key = extra.pop("repairKey", None) or DEFAULT_REPAIR.get(code)
        field_paths = list(extra.pop("fieldPaths", None) or ([extra["suppliedField"]] if extra.get("suppliedField") else []))
        failure = {"code": code, "ref": ref, "detail": detail, "layer": layer, **({"fieldPaths": field_paths} if field_paths else {}),
                   **({"repair": REPAIR[repair_key]} if repair_key in REPAIR else {}), **extra}
        result = {"outcome": "FAILED", "phase": self.phase, "revision": self.revision, "failures": [failure], "requiredAction": action,
                  **({"guidance": guidance} if guidance else {})}
        context = self.context
        if context.draft_fp is None:
            context.draft_fp = draft_fingerprint(context.draft)
        envelope = build_envelope(
            tool=self.current_tool or "UNKNOWN", layer=layer, source=source, code=code, args=self.current_args if self.current_args is not None else {},
            ref=ref, detail=detail, field_paths=field_paths, required_action=action, repair_key=repair_key or "", inventory=self.binding(),
            draft_before=self.current_draft_before or context.draft_fp, draft_after=draft_fingerprint(context.draft), draft_revision=context.draft_revision,
            sequence=context.event_sequence + 1, model_turn=context.model_turn, phase=self.phase, tool_call_id=self.current_call_id,
            extra={k: extra.get(k) for k in ("suppliedClaimId", "actualRole", "expectedRole", "expectedField", "suppliedField", "candidateCount")})
        self.last_envelope = envelope
        context.rejection_log.append(envelope)
        del context.rejection_log[:-200]
        return grouped_gaps(self.observe_validation(result, self.phase, kind=self.rejection_kind(), envelope=envelope), self.context.draft["semanticClaims"], readable_names(self.identities, self.context.draft["claimRelations"]))

    def discovery_allowed(self) -> bool:
        return self.phase == DISCOVERY and self.frozen is None

    def foreign_claim(self, claim_id: str | None) -> dict | None:
        """Refusal for a claim another review unit owns: names the owner so the Producer can reopen it."""
        owner = self.frontier.claim_owners.get(claim_id) if self.frontier else None
        if not owner:
            return None
        return self.rejected("SOURCE_REVIEW_INCOMPLETE", "unit", "Only the owning claim file may update this claim",
            requiredAction="commit_claims", sourceNodeId=owner,
            guidance="Call commit_claims with source_node_id=" + owner + " and a factual reason. "
                "Complete or reference-block the current unit before commit_claims can schedule the reopened owner. "
                "Correct the owning claim file and commit it.")

    def put_claim(self, key: str, nodes: list[str], claim_type: str, statement: str,
                  actor: str | None, action: str | None, relevant: bool, reason: str | None, *, update_id: str | None = None,
                  source_support=None, semantic_authority=None, semantic_frame=None, assessability=None) -> dict:
        if not self.discovery_allowed():
            return self.rejected("CLAIM_INVENTORY_FROZEN", "claimInventory", "Reopen explicitly before changing claims")
        if self.frontier and not self.frontier.allowed(nodes, update_id):
            foreign = self.foreign_claim(update_id)
            if foreign:
                return foreign
            active = (self.frontier.active or {}).get("sourceNodeId")
            return self.rejected("SOURCE_REVIEW_INCOMPLETE", "unit", "Author only claims anchored on the active review unit",
                requiredAction="commit_claims",
                guidance="Use source_node_ids containing sourceNodeId=" + active if active else "Acquire bounded work with commit_claims first")
        key, nodes = identity_key(key), sorted(set(nodes))

        try:
            support = canonical_support(self.context.source_graph, nodes, source_support)
        except (ValueError, TypeError, KeyError, UnicodeError) as error:
            active = (self.frontier.active or {}).get("sourceNodeId") if self.frontier else None
            foreign = active and str(error).startswith("Support must cite")
            return self.rejected("SOURCE_SUPPORT_INVALID", "source_support", str(error), requiredAction="commit_claims",
                **({"guidance": "Anchor the claim and cite spans only on the active unit (sourceNodeId=" + active + "). Text of other units is reviewed when "
                    "commit_claims schedules them; to leave this unit, account for its references and complete it (REQUIRES_REFERENCE_RESOLUTION defers it)."} if foreign else {}))
        cid = claim_id(self.context.run_id, self.revision, nodes, key)
        if update_id is not None and (cid != update_id or cid not in self.identities):
            return self.rejected("CLAIM_SCHEMA_INVALID", "claim", "An update preserves identity key and source anchors; register a corrected identity explicitly")
        claim = {"claimId": cid, "legalSourceVersionId": self.context.source_graph.version, "sourceNodeIds": nodes,
                 "sourceSupport": support, "semanticAuthority": semantic_authority, "assessability": assessability,
                 "semanticFrame": {k: semantic_frame.get(k) for k in FRAME_FIELDS} if isinstance(semantic_frame, dict) else None,
                 "claimType": claim_type, "statement": " ".join(unicodedata.normalize("NFC", statement).split()), "operative": {"actor": " ".join(unicodedata.normalize("NFC", actor or "").split()), "modality": claim_type, "action": " ".join(unicodedata.normalize("NFC", action or "").split())} if claim_type in NORMATIVE else None,
                 "state": "RELEVANT" if relevant else "INTENTIONALLY_NON_OPERATIVE", "nonOperativeReason": None if relevant else reason}
        if isinstance(semantic_frame, dict) and "legalEffect" in semantic_frame:
            claim["semanticFrame"]["legalEffect"] = deepcopy(semantic_frame["legalEffect"])
        if isinstance(semantic_frame, dict) and "applicabilityMode" in semantic_frame:
            claim["semanticFrame"]["applicabilityMode"] = semantic_frame["applicabilityMode"]
        errors = list(Draft7Validator(CLAIM_SCHEMA).iter_errors(claim))
        if not key or len(key) > 128 or errors or any(n not in self.context.source_graph.nodes for n in nodes) or (not relevant and not reason):
            return self.rejected("CLAIM_SCHEMA_INVALID", "claim", "; ".join(".".join(map(str, e.path)) + ": " + e.message[:180] for e in errors[:4]) or "Valid key, source anchors and exclusion reason required")
        from rule_set_preparation.legal_effect import effect_integrity_error
        effect_error = effect_integrity_error(claim, self.context.source_graph)
        if effect_error:
            return self.rejected("SOURCE_SUPPORT_INVALID", "semantic_frame.legalEffect", effect_error)
        existing = self.context.draft["semanticClaims"].get(cid)
        if existing and existing != claim and update_id is None:
            return {**self.rejected("CLAIM_IDENTITY_CONFLICT", cid, "Use commit_claims for an intentional correction; this canonical identity already exists"), "canonicalClaimId":cid,"claim":deepcopy(existing)}
        self.changed(existing, claim)
        self.context.draft["semanticClaims"][cid] = claim
        self.identities[cid] = key
        for node in nodes:
            self.claims_by_node.setdefault(node, set()).add(cid)
            if existing is None and not self.frontier:
                self.context.draft["sourceAccounting"].pop(node, None)
                self.reviewed_nodes.discard(node)
        if self.frontier and cid not in self.frontier.claim_owners:
            active_ids = {u["sourceNodeId"] for u in (self.frontier.active_batch or ([self.frontier.active] if self.frontier.active else []))}
            current = (self.frontier.active or {}).get("sourceNodeId")
            ref_only = bool(nodes and all(self.context.source_graph.is_reference_only(n) for n in nodes))
            owner = (current if current in nodes else None) or next((n for n in nodes if n in active_ids), None) or (current if ref_only else (nodes[0] if nodes else current))
            if owner:
                self.frontier.claim_owners[cid] = owner
        self.context.authored_claim_ids.add(cid)
        return {"outcome": "PASSED", "phase": self.phase, "inventoryRevision": self.revision, "claim": deepcopy(claim), "identityKey": key, "claimFingerprint": fingerprint(claim)}


    def review_complete(self) -> bool:
        """Every review unit is complete (the API verifies committed coverage before any conclusion)."""
        if self.frontier:
            return bool(self.frontier.snapshot.get("progress", {}).get("discoveryCompleteEligible"))
        return self.required_nodes <= self.reviewed_nodes

    def validate_inventory(self, finalize: bool, conclude: str | None = None) -> dict:
        self.last_failures = []
        if self.frozen is not None:
            return {"outcome": "PASSED", "phase": self.phase, **self.binding(), "alreadyFinalized": True}
        if self.frontier:
            status = self.frontier.progress()
            if status.get("outcome") != "PASSED": return status
            if not status["progress"]["discoveryCompleteEligible"]:
                return self.frontier.failure({"outcome": "FAILED", "failures": [{"code": "SOURCE_REVIEW_INCOMPLETE", "ref": "frontier", "detail": "Pending, in-review or blocked units remain"}], "requiredAction": "discovery_status", "progress": status["progress"]})
        self.inventory_validation_calls += 1
        self.transition(INVENTORY_VALIDATION)
        graph = normalized_graph(self.graph())
        errors = list(Draft7Validator(SCHEMA["properties"]["semanticGraph"]).iter_errors(graph))
        if errors:
            result = {"outcome": "FAILED", "failures": [{"code": "CLAIM_SCHEMA_INVALID", "ref": "semanticGraph." + ".".join(map(str, error.path)), "detail": error.message[:200]} for error in errors[:20]]}
        else:
            result = self.context.api.claim_inventory_operation(self.context.run_id, CONCLUDE_ACTION if conclude else "FINALIZE" if finalize else "VALIDATE", self.revision,
                                                                graph=graph, identities=self.identities, **({"reason": conclude} if conclude else {}))
        self.last_failures = result.get("failures", [])
        codes = {f.get("code") for f in result.get("failures", [])}
        if "SEMANTIC_CLOSURE_INVALID" in codes:
            result = {**result, "requiredAction": "commit_claims",
                      "guidance": "Repair the listed typed target/closure gaps in their owning source review units. Every relevant assertion must be accounted for by a verified operative closure; a globally role-compatible claim cannot substitute for a supported relationship."}
        if READINESS_CODES & codes:
            conclusion = "OPERATIVE_CLAIM_MISSING" in codes and self.review_complete()
            result = {**result, "requiredAction": CONCLUDE_TOOL if conclusion and codes == {"OPERATIVE_CLAIM_MISSING"} else "commit_claims",
                      "guidance": "The inventory cannot support any Rule Set. " + (
                          "Every review unit is complete and no relevant duty, prohibition or permission is registered. "
                          "If a unit actually states one that is not registered, reopen that unit and register it with its actor and action. "
                          "If the source states none, call " + CONCLUDE_TOOL + " with a factual reason once this is the only listed gap: it ends the run with an explicit outcome and creates no Rule Set. "
                          "Never register an obligation the source does not state. "
                          if conclusion else
                          "No relevant duty, prohibition or permission is registered yet while review units remain unfinished: finish the remaining units and register the one a unit states, with its actor and action. "
                          if "OPERATIVE_CLAIM_MISSING" in codes else
                          "In the review unit that owns the duty's addressee, trigger or scope, register a source-grounded SCOPE or CONDITION claim (reopen that unit first), "
                          "complete it, then finalize again. A duty's actor, a DEFINITION or a CONTEXT claim never substitutes for it.")}
        result = self.observe_validation({"phase": self.phase, "revision": self.revision, **result}, INVENTORY_VALIDATION)
        if result.get("outcome") == "PASSED" and conclude:
            expected = fingerprint({"revision": self.revision, "graph": graph})
            if result["fingerprint"] != expected:
                raise ValueError("Concluded inventory fingerprint differs from canonical graph")
            self.concluded = {"revision": self.revision, "fingerprint": expected, "reason": conclude, "failureReason": NO_OPERATIVE_OBLIGATIONS}
            self.context.concluded = deepcopy(self.concluded)
            self.context.progress_revision += 1
            self.transition(COMPLETION)
            return {**grouped_gaps(result, self.context.draft["semanticClaims"], readable_names(self.identities, self.context.draft["claimRelations"])), "failureReason": NO_OPERATIVE_OBLIGATIONS,
                    "guidance": "The committed source states no obligation: the Preparation is concluded and no Rule Set was created. Stop."}
        if result.get("outcome") == "PASSED" and finalize:
            expected = fingerprint({"revision": self.revision, "graph": graph})
            if result["fingerprint"] != expected:
                raise ValueError("Frozen inventory fingerprint differs from canonical graph")
            self.frozen, self.frozen_fingerprint = deepcopy(graph), expected
            self.transition(READY)
        else:
            self.transition(DISCOVERY)
        view = grouped_gaps(result, self.context.draft["semanticClaims"], readable_names(self.identities, self.context.draft["claimRelations"]))
        if self.context.direct_draft and result.get("outcome") != "PASSED":
            view.update(requiredAction="get_rule_set_draft_candidate for the named requirement, then submit_rule_set_draft_candidates", guidance="Repair only the affected candidate; other requirements and source coverage remain saved. No separate claim authoring is needed.")
        return view

    def conclude_no_operative_obligations(self, reason: str) -> dict:
        """INV-C2: end explicitly when the durably complete review found no duty, prohibition or permission.

        Only the API decides: it requires every unit committed, no coverage/reference/integrity gap, and no
        operative-typed claim. Nothing here infers the outcome; a rejection returns the existing gap codes."""
        if self.context.discovery_only:
            return self.rejected("CLAIM_PHASE_INVALID", "diagnostic", "Discovery-only sessions stop at CLAIM_INVENTORY_READY")
        if self.concluded is not None:
            return {"outcome": "PASSED", "phase": self.phase, "revision": self.revision, "fingerprint": self.concluded["fingerprint"], "failureReason": NO_OPERATIVE_OBLIGATIONS, "alreadyConcluded": True}
        if self.frozen is not None:
            return self.rejected("CLAIM_INVENTORY_FROZEN", "claimInventory", "A frozen inventory supports Rule authoring; it cannot conclude without operative obligations", requiredAction="start_rule_authoring")
        if not reason.strip():
            return self.rejected("CLAIM_SCHEMA_INVALID", "reason", "A factual reason naming what the complete review found is required")
        if self.frontier:
            status = self.frontier.progress()
            if status.get("outcome") != "PASSED":
                return status
            if not status["progress"]["discoveryCompleteEligible"]:
                return self.frontier.failure({"outcome": "FAILED", "failures": [{"code": "SOURCE_REVIEW_INCOMPLETE", "ref": "frontier", "detail": "Pending, in-review or blocked units remain; conclude only after every unit is reviewed"}],
                                              "requiredAction": "commit_claims", "progress": status["progress"]})
        return self.validate_inventory(False, conclude=reason.strip())

    def restore_frozen_inventory(self, stored: dict | None) -> None:
        """Recover the API's exact frozen authority, never infer it from completed review counts."""
        if stored is None:
            return
        graph = normalized_graph(stored["graph"])
        expected = fingerprint({"revision": self.revision, "graph": graph})
        if stored["revision"] != self.revision or stored["fingerprint"] != expected:
            raise ValueError("Frozen inventory revision/fingerprint mismatch")
        if graph != normalized_graph(self.graph()) or stored["identities"] != self.identities:
            raise ValueError("Committed source reviews differ from the frozen inventory")
        self.frozen, self.frozen_fingerprint = deepcopy(graph), expected

    def save_authoring_draft(self) -> None:
        """A mutation is acknowledged only after its complete snapshot is durable."""
        with self.context.mutation_lock:
            if not self.frozen:
                return
            draft = deepcopy({key: self.context.draft[key] for key in AUTHORING_DRAFT_KEYS})
            digest = fingerprint(draft)
            if digest == self.saved_draft_fingerprint:
                return
            self.draft_unsaved = True
            result = self.context.api.claim_inventory_operation(self.context.run_id, "SAVE_AUTHORING_DRAFT", self.revision,
                                                               draft=draft, draftVersion=self.draft_version)
            if result.get("outcome") != "PASSED":
                raise RuntimeError("Authoring draft save rejected: " + ",".join(f.get("code", "UNKNOWN") for f in result.get("failures", [])))
            self.draft_version = result["draftVersion"]
            self.saved_draft_fingerprint, self.draft_unsaved = digest, False

    def flush_authoring_draft(self) -> None:
        if self.draft_unsaved:
            self.save_authoring_draft()

    def restore_authoring_draft(self, force: bool = False) -> None:
        """Load this run/revision once, before any authoring mutation, or resync on force=True."""
        if self.draft_restored and not force:
            return
        result = self.context.api.claim_inventory_operation(self.context.run_id, "LOAD_AUTHORING_DRAFT", self.revision)
        if result.get("outcome") != "PASSED":
            raise RuntimeError("Authoring draft load rejected")
        saved = result.get("draft")
        if saved:
            local = {key: self.context.draft[key] for key in AUTHORING_DRAFT_KEYS}
            if not force and any(local.values()) and local != saved:
                raise RuntimeError("Load the durable authoring draft before local edits")
            for key in AUTHORING_DRAFT_KEYS:
                self.context.draft[key] = deepcopy(saved[key])
            self.context.draft_fp = None
        self.draft_version = result["draftVersion"]
        self.context.draft_revision = self.draft_version
        if self.context.direct_draft and isinstance(result.get("validation"), dict):
            self.last_failures = result["validation"].get("failures", [])
        self.saved_draft_fingerprint = fingerprint(saved) if saved is not None else None
        self.draft_restored = True

    def begin_authoring(self) -> dict:
        if self.context.discovery_only: return self.rejected("CLAIM_PHASE_INVALID", "diagnostic", "Discovery-only sessions stop at CLAIM_INVENTORY_READY")
        if self.frozen and self.frozen.get("contractVersion") != "LEGAL_GRAPH_V3":
            return self.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Historical inventories remain read-only; reopen for source support", requiredAction="reopen_semantic_claim_inventory")
        if self.phase == READY:
            result = self.context.api.claim_inventory_operation(self.context.run_id, "AUTHOR_RULES", self.revision)
            if result.get("outcome") != "PASSED":
                return result
            self.transition(AUTHORING)
        if self.phase not in {AUTHORING, RULE_VALIDATION, SUBMISSION_READY}:
            return self.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Finalize discovery before Rule authoring")
        self.restore_authoring_draft()
        roles: dict[str, int] = {}
        from rule_set_preparation.semantic_closure import claim_role
        for claim in (self.frozen or {}).get("claims", []):
            if claim["state"] == "RELEVANT":
                role = claim_role(claim)
                roles[role] = roles.get(role, 0) + 1
        return {"outcome": "PASSED", "phase": self.phase, **self.binding(), "relevantClaimsByAccountingRole": roles}

    def reopen(self, reason: str) -> dict:
        if not self.frozen or not reason.strip():
            return self.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Frozen inventory and a reason are required")
        result = self.context.api.claim_inventory_operation(self.context.run_id, "REOPEN", self.revision, reason=reason)
        if result.get("outcome") != "PASSED":
            return result
        old = deepcopy(self.frozen)
        self.revision = result["revision"]
        self.draft_version, self.saved_draft_fingerprint, self.draft_restored, self.draft_unsaved = 0, None, False, False
        remap = {c["claimId"]: claim_id(self.context.run_id, self.revision, c["sourceNodeIds"], self.identities[c["claimId"]]) for c in old["claims"]}
        self.identities = {remap[cid]: key for cid, key in self.identities.items()}
        self.context.draft = {key: {} for key in self.context.draft}
        for c in old["claims"]:
            c["claimId"] = remap[c["claimId"]]
            self.context.draft["semanticClaims"][c["claimId"]] = c
        relation_remap = {}
        for r in old["relations"]:
            previous = r["relationId"]
            r.update(fromClaimId=remap[r["fromClaimId"]], toClaimId=remap[r["toClaimId"]])
            r["relationId"] = fingerprint({k: v for k, v in r.items() if k != "relationId"})
            relation_remap[previous] = r["relationId"]
            self.context.draft["claimRelations"][r["relationId"]] = r
        for r in old["sourceAccounting"]:
            r["claimIds"] = [remap[cid] for cid in r["claimIds"]]
            self.context.draft["sourceAccounting"][r["sourceNodeId"]] = r
        for r in old["referenceAccounting"]:
            r["relationIds"] = [relation_remap[rid] for rid in r["relationIds"]]
            self.context.draft["referenceAccounting"][r["referenceId"]] = r
        if self.frontier:
            from rule_set_preparation.review_frontier import ReviewFrontier
            previous=self.frontier
            self.frontier=ReviewFrontier(self)
            self.frontier.claim_owners={remap[cid]:owner for cid,owner in previous.claim_owners.items()}
            self.frontier.relation_owners={relation_remap[rid]:owner for rid,owner in previous.relation_owners.items()}
            self.context.draft["sourceAccounting"]={}
        self.rebuild_node_index()
        self.context.authored_claim_ids = set(remap.values())
        self.context.validated_packet = self.context.last_validation = None
        self.frozen = self.frozen_fingerprint = None
        self.transition(DISCOVERY)
        return {**result, "remappedClaims": list(remap.items())[:20], "remappedClaimCount": len(remap)}
