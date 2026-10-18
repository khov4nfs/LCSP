"""Revisioned Agent-authored claim discovery. No source-prose interpretation occurs here."""
from __future__ import annotations

import hashlib
import json
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
READ_TOOLS = frozenset({"get_claim_inventory", "get_rule_authoring_context", "get_rule_authoring_status", "get_semantic_closure", "get_source_support", "get_review_progress", "get_next_review_unit", "inspect_semantic_reference_binding"})
# Frozen-inventory gaps only Claim Discovery can close: the same tool path closes them in either discovery mode.
READINESS_CODES = frozenset({"APPLICABILITY_AUTHORITY_MISSING", "OPERATIVE_CLAIM_MISSING"})
RELATION_KINDS = {"DEFINITION", "SCOPE", "QUALIFIER", "EXCEPTION", "CROSS_REFERENCE", "CONDITION", "INCORPORATES", "TEMPORALLY_LIMITS"}
RELATION_KINDS.update({"CONDITION_OF", "QUALIFIES", "EXCEPTION_TO", "TEMPORALLY_APPLIES_TO", "DEFINED_BY", "PRESERVES", "EVIDENCE_SLICE_OF", "CONTEXT_FOR"})
REQUIREMENT_KINDS = {"CONDITION": "SCOPE", "INCORPORATES": "CROSS_REFERENCE", "TEMPORALLY_LIMITS": "QUALIFIER", "CONDITION_OF": "SCOPE", "QUALIFIES": "QUALIFIER", "EXCEPTION_TO": "EXCEPTION", "TEMPORALLY_APPLIES_TO": "QUALIFIER", "DEFINED_BY": "DEFINITION", "PRESERVES": "CROSS_REFERENCE", "EVIDENCE_SLICE_OF": "CROSS_REFERENCE", "CONTEXT_FOR": "CROSS_REFERENCE"}
SCHEMA = json.loads(Path(__file__).with_name("packet-schema.json").read_text())["properties"]["packet"]
CLAIM_SCHEMA = SCHEMA["properties"]["semanticGraph"]["properties"]["claims"]["items"]


# Repair instruction used when the rejecting site names none: stable per code, never per occurrence.
DEFAULT_REPAIR = {"CLAIM_REQUIREMENT_MISMATCH": "ROLE_MISMATCH", "OPERATIVE_PROPOSITION_REQUIRED": "OPERATIVE_REQUIRED",
                  "APPLICABILITY_SCOPE_MISSING": "APPLICABILITY_REQUIRED", "ORPHAN_ASSESSMENT_RULE": "UNKNOWN_REQUIREMENT"}


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def identity_key(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).lower().split())


def claim_id(run_id: str, revision: int, nodes: list[str], key: str) -> str:
    return fingerprint({"preparationRunId": run_id, "revision": revision, "sourceNodeIds": sorted(nodes), "identityKey": identity_key(key)})


def normalized_graph(graph: dict) -> dict:
    return {**deepcopy(graph),
            **({"semanticAudits": sorted(graph["semanticAudits"], key=lambda r: r["sourceNodeId"])} if "semanticAudits" in graph else {}),
            "claims": sorted([{**c, "sourceNodeIds": sorted(c["sourceNodeIds"])} for c in graph["claims"]], key=lambda c: c["claimId"]),
            "relations": sorted(graph["relations"], key=lambda r: r["relationId"]),
            "sourceAccounting": sorted([{**r, "claimIds": sorted(r["claimIds"])} for r in graph["sourceAccounting"]], key=lambda r: r["sourceNodeId"]),
            "referenceAccounting": sorted([{**r, "relationIds": sorted(r["relationIds"])} for r in graph["referenceAccounting"]], key=lambda r: r["referenceId"])}


def grouped_gaps(result: dict, claims: dict | None = None) -> dict:
    groups: dict[str, dict] = {}
    for failure in result.get("failures", []):
        group = groups.setdefault(failure["code"], {"count": 0, "examples": []})
        group["count"] += 1
        if len(group["examples"]) < 6:
            example = {k: failure[k] for k in ("ref", "detail", "referenceId", "sourceNodeId", "targetNodeId", "suppliedFromClaimId", "suppliedToClaimId", "sourceClaimIds", "targetClaimIds", "requiredAction", "expectedRole", "suppliedField", "expectedField", "candidateCount", "candidates", "layer", "fieldPaths", "repair", "suppliedClaimId", "actualRole", "expected") if k in failure}
            ref = failure.get("ref")
            claim = (claims or {}).get(ref.removeprefix("claim:")) if isinstance(ref, str) else None
            if claim:
                example.update(claimType=claim["claimType"], sourceNodeIds=claim["sourceNodeIds"][:3], sourceNodeCount=len(claim["sourceNodeIds"]))
            group["examples"].append(example)
    return {"outcome": result.get("outcome", "FAILED"), "gaps": groups,
            **{k: result[k] for k in ("phase", "revision", "fingerprint", "coverage", "NO_PROGRESS", "requiredAction", "guidance", "expectedClaimIds", "missingClaimIds", "pendingCount", "nextReviewUnitIds", "progress", "semanticAuditVerdict") if k in result}}


@dataclass
class ClaimInventory:
    context: Any
    revision: int = 1
    phase: str = DISCOVERY
    identities: dict[str, str] = field(default_factory=dict)
    frozen: dict | None = None
    frozen_fingerprint: str | None = None
    validation_observations: dict[str, dict] = field(default_factory=dict)
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
        return {"contractVersion": "LEGAL_GRAPH_V3", "semanticAudits": sorted(self.context.semantic_audits.values(), key=lambda r: r["sourceNodeId"]), **({"reviewFrontier": self.frontier.binding()} if self.frontier and self.frontier.binding() else {}), **self.context.source_graph.base(),
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
            raise NoProgressDetected("NO_PROGRESS_DETECTED")
        if feedback:
            result = {**result, "NO_PROGRESS": "The same effective phase state and gaps repeated. Resolve a listed gap or reopen explicitly; repeating this ineffective state after this feedback terminates the run."}
        return result

    def rejection_kind(self) -> str:
        if self.current_tool in READ_TOOLS:
            return "CLAIM_INVENTORY_READ_REJECTED"
        return "CLAIM_DISCOVERY_TOOL_REJECTED" if self.phase in {DISCOVERY, INVENTORY_VALIDATION} else "RULE_AUTHORING_TOOL_REJECTED"

    def rejected(self, code: str, ref: str, detail: str, **extra) -> dict:
        """A tool refused its input before any validator ran; the state hash still detects ineffective repetition."""
        action = extra.pop("requiredAction", None) or (
            "update_semantic_claim" if code == "CLAIM_IDENTITY_CONFLICT"
            else "get_next_review_unit" if self.frontier and self.phase in {DISCOVERY, INVENTORY_VALIDATION}
            else "get_claim_inventory")
        layer = extra.pop("layer", None) or self.current_layer or AUTHORING_PRECONDITION
        source = extra.pop("source", None) or self.current_source or SOURCE_BODY
        repair_key = extra.pop("repairKey", None) or DEFAULT_REPAIR.get(code)
        field_paths = list(extra.pop("fieldPaths", None) or ([extra["suppliedField"]] if extra.get("suppliedField") else []))
        failure = {"code": code, "ref": ref, "detail": detail, "layer": layer, **({"fieldPaths": field_paths} if field_paths else {}),
                   **({"repair": REPAIR[repair_key]} if repair_key in REPAIR else {}), **extra}
        result = {"outcome": "FAILED", "phase": self.phase, "revision": self.revision, "failures": [failure], "requiredAction": action}
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
        return grouped_gaps(self.observe_validation(result, self.phase, kind=self.rejection_kind(), envelope=envelope), self.context.draft["semanticClaims"])

    def discovery_allowed(self) -> bool:
        return self.phase == DISCOVERY and self.frozen is None

    def put_claim(self, key: str, nodes: list[str], claim_type: str, statement: str,
                  actor: str | None, action: str | None, relevant: bool, reason: str | None, *, update_id: str | None = None,
                  source_support=None, semantic_authority=None, semantic_frame=None, assessability=None) -> dict:
        if not self.discovery_allowed():
            return self.rejected("CLAIM_INVENTORY_FROZEN", "claimInventory", "Reopen explicitly before changing claims")
        if self.frontier and not self.frontier.allowed(nodes, update_id):
            return self.rejected("SOURCE_REVIEW_INCOMPLETE", "unit", "Call get_next_review_unit and author/update only claims owned by that active unit")
        key, nodes = identity_key(key), sorted(set(nodes))
        from rule_set_preparation.semantic_audit import canonical_support, FRAME_FIELDS
        try:
            support = canonical_support(self.context.source_graph, nodes, source_support)
        except (ValueError, TypeError, KeyError, UnicodeError) as error:
            return self.rejected("SOURCE_SUPPORT_INVALID", "source_support", str(error), requiredAction="register_semantic_claim")
        cid = claim_id(self.context.run_id, self.revision, nodes, key)
        if update_id is not None and (cid != update_id or cid not in self.identities):
            return self.rejected("CLAIM_SCHEMA_INVALID", "claim", "An update preserves identity key and source anchors; register a corrected identity explicitly")
        claim = {"claimId": cid, "legalSourceVersionId": self.context.source_graph.version, "sourceNodeIds": nodes,
                 "sourceSupport": support, "semanticAuthority": semantic_authority, "assessability": assessability,
                 "semanticFrame": {k: semantic_frame.get(k) for k in FRAME_FIELDS} if isinstance(semantic_frame, dict) else None,
                 "claimType": claim_type, "statement": " ".join(unicodedata.normalize("NFC", statement).split()), "operative": {"actor": " ".join(unicodedata.normalize("NFC", actor or "").split()), "modality": claim_type, "action": " ".join(unicodedata.normalize("NFC", action or "").split())} if claim_type in NORMATIVE else None,
                 "state": "RELEVANT" if relevant else "INTENTIONALLY_NON_OPERATIVE", "nonOperativeReason": None if relevant else reason}
        errors = list(Draft7Validator(CLAIM_SCHEMA).iter_errors(claim))
        if not key or len(key) > 128 or errors or any(n not in self.context.source_graph.nodes for n in nodes) or (not relevant and not reason):
            return self.rejected("CLAIM_SCHEMA_INVALID", "claim", "; ".join(".".join(map(str, e.path)) + ": " + e.message[:180] for e in errors[:4]) or "Valid key, source anchors and exclusion reason required")
        existing = self.context.draft["semanticClaims"].get(cid)
        if existing and existing != claim and update_id is None:
            return {**self.rejected("CLAIM_IDENTITY_CONFLICT", cid, "Use update_semantic_claim for an intentional correction; this canonical identity already exists"), "canonicalClaimId":cid,"claim":deepcopy(existing)}
        self.changed(existing, claim)
        self.context.draft["semanticClaims"][cid] = claim
        self.identities[cid] = key
        for node in nodes:
            self.claims_by_node.setdefault(node, set()).add(cid)
            if existing is None and not self.frontier:
                self.context.draft["sourceAccounting"].pop(node, None)
                self.reviewed_nodes.discard(node)
        if self.frontier and cid not in self.frontier.claim_owners:
            self.frontier.claim_owners[cid] = self.frontier.active["sourceNodeId"]
        self.context.authored_claim_ids.add(cid)
        return {"outcome": "PASSED", "phase": self.phase, "inventoryRevision": self.revision, "claim": deepcopy(claim), "identityKey": key, "claimFingerprint": fingerprint(claim)}

    def audit_unit(self, node_id: str, graph=None) -> dict:
        from rule_set_preparation.semantic_audit import audit_input, receipt_current, receipt_passed, attest_receipt, verify_attestation
        value = audit_input(self.context.source_graph, graph or self.graph(), node_id, self.revision)
        receipt = self.context.semantic_audits.get(node_id)
        verified_previous = verify_attestation(receipt, self.context.run_id) if receipt else False
        if not (receipt_current(value, receipt) and verified_previous):
            if self.context.semantic_auditor is None:
                return {"outcome": "FAILED", "failures": [{"code": "SEMANTIC_AUDIT_REQUIRED", "ref": "node:" + node_id, "detail": "Independent governed semantic auditor is required"}]}
            if verified_previous and hasattr(self.context.semantic_auditor, "restore_receipt"):
                self.context.semantic_auditor.restore_receipt(receipt)
            receipt = self.context.semantic_auditor.audit(value)
            receipt = attest_receipt(receipt, self.context.run_id)
            self.context.semantic_audits[node_id] = receipt
            from rule_set_preparation.semantic_audit import publish_audit_receipt
            publish_audit_receipt(receipt, self.phase, self.stamp)
        if receipt_passed(value, receipt):
            return {"outcome": "PASSED", "semanticAudit": receipt}
        gaps = receipt.get("gaps", [])
        failures = [{"code": "SEMANTIC_AUDIT_REQUIRED", "ref": "node:" + node_id, "sourceNodeId": node_id, "detail": g["code"] + ": " + g["detail"]} for g in gaps[:12]]
        failures.extend({"code": "SEMANTIC_AUDIT_REQUIRED", "ref": "claim:" + r["id"], "sourceNodeId": node_id, "detail": r["verdict"] + ": " + ", ".join(r["gapCodes"])} for r in receipt.get("assertions", []) + receipt.get("relations", []) if r["verdict"] != "SUPPORTED" or r["gapCodes"])
        reopen = self.frontier and (not self.frontier.active or self.frontier.active["sourceNodeId"] != node_id)
        return {"outcome": "FAILED", "failures": failures or [{"code": "SEMANTIC_AUDIT_REQUIRED", "ref": "node:" + node_id, "sourceNodeId": node_id, "detail": receipt["verdict"]}],
                "requiredAction": "reopen_source_review" if reopen else "register_semantic_claim" if any(g["code"] == "MISSING_ASSERTION" for g in gaps) else "update_semantic_claim",
                "guidance": "Repair this same source review unit from independent factual gaps. " + ("Explicitly reopen sourceNodeId=" + node_id + " before editing its claims or relations." if reopen else "Add omissions and correct unsupported assertions/relations, then complete this leased unit again."), "semanticAuditVerdict": receipt["verdict"]}

    def validate_inventory(self, finalize: bool) -> dict:
        if self.frozen is not None:
            return {"outcome": "PASSED", "phase": self.phase, **self.binding(), "alreadyFinalized": True}
        if self.frontier:
            status = self.frontier.progress()
            if status.get("outcome") != "PASSED": return status
            if not status["progress"]["discoveryCompleteEligible"]:
                return self.frontier.failure({"outcome": "FAILED", "failures": [{"code": "SOURCE_REVIEW_INCOMPLETE", "ref": "frontier", "detail": "Pending, in-review or blocked units remain"}], "requiredAction": "get_next_review_unit", "progress": status["progress"]})
        self.inventory_validation_calls += 1
        for review in self.graph()["sourceAccounting"]:
            audit = self.audit_unit(review["sourceNodeId"])
            if audit["outcome"] != "PASSED":
                return grouped_gaps(self.observe_validation(audit, DISCOVERY), self.context.draft["semanticClaims"])
        self.transition(INVENTORY_VALIDATION)
        graph = normalized_graph(self.graph())
        errors = list(Draft7Validator(SCHEMA["properties"]["semanticGraph"]).iter_errors(graph))
        if errors:
            result = {"outcome": "FAILED", "failures": [{"code": "CLAIM_SCHEMA_INVALID", "ref": "semanticGraph." + ".".join(map(str, error.path)), "detail": error.message[:200]} for error in errors[:20]]}
        else:
            if self.frontier:
                recorded = self.context.api.claim_inventory_operation(self.context.run_id, "RECORD_SEMANTIC_AUDITS", self.revision, graph=graph, identities=self.identities)
                if recorded.get("outcome") != "PASSED":
                    self.transition(DISCOVERY)
                    return grouped_gaps(self.observe_validation(recorded, DISCOVERY))
            result = self.context.api.claim_inventory_operation(self.context.run_id, "FINALIZE" if finalize else "VALIDATE", self.revision,
                                                                graph=graph, identities=self.identities)
        codes = {f.get("code") for f in result.get("failures", [])}
        if "SEMANTIC_CLOSURE_INVALID" in codes:
            result = {**result, "requiredAction": "reopen_source_review" if self.frontier else "link_semantic_claims",
                      "guidance": "Repair the listed typed target/closure gaps in their owning source review units. Every relevant assertion must be accounted for by a verified operative closure; a globally role-compatible claim cannot substitute for a supported relationship."}
        if READINESS_CODES & codes:
            result = {**result, "requiredAction": "reopen_source_review" if self.frontier else "register_semantic_claim",
                      "guidance": "The inventory cannot support any Rule Set. " + (
                          "No relevant duty, prohibition or permission exists: reopen the unit that states one and register it with its actor and action. "
                          if "OPERATIVE_CLAIM_MISSING" in codes else
                          "In the review unit that owns the duty's addressee, trigger or scope, register a source-grounded SCOPE or CONDITION claim (reopen that unit first), "
                          "complete it, then finalize again. A duty's actor, a DEFINITION or a CONTEXT claim never substitutes for it.")}
        result = self.observe_validation({"phase": self.phase, "revision": self.revision, **result}, INVENTORY_VALIDATION)
        if result.get("outcome") == "PASSED" and finalize:
            expected = fingerprint({"revision": self.revision, "graph": graph})
            if result["fingerprint"] != expected:
                raise ValueError("Frozen inventory fingerprint differs from canonical graph")
            self.frozen, self.frozen_fingerprint = deepcopy(graph), expected
            self.transition(READY)
        else:
            self.transition(DISCOVERY)
        return grouped_gaps(result, self.context.draft["semanticClaims"])

    def begin_authoring(self) -> dict:
        if self.context.discovery_only: return self.rejected("CLAIM_PHASE_INVALID", "diagnostic", "Discovery-only sessions stop at CLAIM_INVENTORY_READY")
        if self.frozen and self.frozen.get("contractVersion") != "LEGAL_GRAPH_V3":
            return self.rejected("SEMANTIC_AUDIT_REQUIRED", "claimInventory", "Historical inventories remain read-only; reopen for source support and independent semantic audit", requiredAction="reopen_semantic_claim_inventory")
        if self.phase == READY:
            result = self.context.api.claim_inventory_operation(self.context.run_id, "AUTHOR_RULES", self.revision)
            if result.get("outcome") != "PASSED":
                return result
            self.transition(AUTHORING)
        if self.phase not in {AUTHORING, RULE_VALIDATION, SUBMISSION_READY}:
            return self.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Finalize discovery before Rule authoring")
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
        self.context.semantic_audits.clear()
        self.transition(DISCOVERY)
        return {**result, "remappedClaims": list(remap.items())[:20], "remappedClaimCount": len(remap)}
