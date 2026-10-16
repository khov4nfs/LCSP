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
RELATION_KINDS = {"DEFINITION", "SCOPE", "QUALIFIER", "EXCEPTION", "CROSS_REFERENCE", "CONDITION", "INCORPORATES", "TEMPORALLY_LIMITS"}
REQUIREMENT_KINDS = {"CONDITION": "SCOPE", "INCORPORATES": "CROSS_REFERENCE", "TEMPORALLY_LIMITS": "QUALIFIER"}
SCHEMA = json.loads(Path(__file__).with_name("packet-schema.json").read_text())["properties"]["packet"]
CLAIM_SCHEMA = SCHEMA["properties"]["semanticGraph"]["properties"]["claims"]["items"]


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


def grouped_gaps(result: dict, claims: dict | None = None) -> dict:
    groups: dict[str, dict] = {}
    for failure in result.get("failures", []):
        group = groups.setdefault(failure["code"], {"count": 0, "examples": []})
        group["count"] += 1
        if len(group["examples"]) < 6:
            example = {k: failure[k] for k in ("ref", "detail") if k in failure}
            ref = failure.get("ref")
            claim = (claims or {}).get(ref.removeprefix("claim:")) if isinstance(ref, str) else None
            if claim:
                example.update(claimType=claim["claimType"], sourceNodeIds=claim["sourceNodeIds"][:3], sourceNodeCount=len(claim["sourceNodeIds"]))
            group["examples"].append(example)
    return {"outcome": result.get("outcome", "FAILED"), "gaps": groups,
            **{k: result[k] for k in ("phase", "revision", "fingerprint", "coverage", "NO_PROGRESS") if k in result}}


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
    required_nodes: set[str] = field(init=False)
    reviewed_nodes: set[str] = field(default_factory=set)

    def __post_init__(self):
        self.required_nodes = {nid for nid, node in self.context.source_graph.nodes.items() if node["content"].strip()}

    def progress(self, tool_name: str):
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
            "activity_kind": "CLAIM_INVENTORY_PROGRESS", "tool_name": tool_name, "phase": self.phase,
            "inventory_revision": self.revision, "inventory_fingerprint": self.frozen_fingerprint,
            "source_nodes_reviewed": len(self.reviewed_nodes), "source_nodes_remaining": len(self.required_nodes) - len(self.reviewed_nodes),
            "claim_count": len(self.identities), "claim_relation_count": len(self.context.draft["claimRelations"]),
            "requirement_count": len(self.context.draft["legalRequirements"]), "assessment_rule_count": len(self.context.draft["assessmentRules"])})

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
        return {"contractVersion": "LEGAL_GRAPH_V2", **self.context.source_graph.base(),
                **{v: list(self.context.draft[k].values()) for k, v in GRAPH_SECTIONS.items()}}

    def binding(self) -> dict:
        return {"revision": self.revision, "fingerprint": self.frozen_fingerprint}

    def transition(self, phase: str):
        previous = self.phase
        self.phase = phase
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
            "durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": "CLAIM_PHASE_TRANSITION", "previous_phase": previous, "phase": phase,
            "inventory_revision": self.revision, "inventory_fingerprint": self.frozen_fingerprint})

    def state_fingerprints(self, packet: dict | None = None) -> dict:
        graph = normalized_graph(self.graph())
        packet = packet if packet is not None else self.context.draft_packet()
        requirements = sorted(packet.get("legalRequirements", []), key=lambda r: r.get("legalRequirementId", ""))
        accounting = {"bindings": [{"id": r.get("legalRequirementId"), "bindings": r.get("claimBindings", [])} for r in requirements],
                      "sourceAccounting": graph["sourceAccounting"], "referenceAccounting": graph["referenceAccounting"]}
        return {"candidate_fingerprint": fingerprint(packet), "claim_inventory_fingerprint": fingerprint({"revision": self.revision, "graph": graph}),
                "requirement_fingerprint": fingerprint(requirements), "accounting_fingerprint": fingerprint(accounting)}

    def observe_validation(self, result: dict, phase: str, packet: dict | None = None) -> dict:
        identities = self.state_fingerprints(packet)
        gaps = sorted({(f.get("code"), f.get("ref")) for f in result.get("failures", [])})
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
        for review in effective["semanticGraph"]["sourceAccounting"]:
            review["nonSemanticReason"] = bool(review.get("nonSemanticReason"))
        for review in effective["semanticGraph"]["referenceAccounting"]:
            review["nonMaterialReason"] = bool(review.get("nonMaterialReason"))
        for claim in effective["semanticGraph"]["claims"]:
            claim["nonOperativeReason"] = bool(claim.get("nonOperativeReason"))
        state_hash = fingerprint({"effective": effective, "phase": phase, "sourceRevision": source_revision, "revision": self.revision, "gaps": gap_hash})
        previous = self.validation_observations.get(state_hash)
        failed = result.get("outcome") != "PASSED"
        feedback = failed and previous is not None
        turn = self.context.model_turn
        terminal = feedback and previous["feedback"] and (turn is None or previous["feedback_turn"] is None or turn > previous["feedback_turn"])
        self.validation_observations[state_hash] = {"feedback": feedback, "feedback_turn": previous["feedback_turn"] if previous and previous["feedback"] else turn}
        data = {"durability": DURABLE, "schema_version": SEMANTIC_SCHEMA_VERSION, "activity_kind": "CLAIM_PHASE_VALIDATION", "phase": phase, "inventory_revision": self.revision,
                **identities, "effective_state_fingerprint": state_hash, "gap_fingerprint": gap_hash,
                "gap_counts": {k: v["count"] for k, v in grouped_gaps(result)["gaps"].items()},
                "outcome": result.get("outcome"), "claim_count": len(self.identities), "claim_relation_count": len(self.context.draft["claimRelations"]), "coverage": result.get("coverage"),
                "inventory_validation_attempt": self.inventory_validation_calls, "rule_validation_attempt": self.context.validation_calls}
        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data=data)
        self.context.trace.append(data)
        if terminal:
            publish_agent_stream_event("CUSTOM_PROGRESS", status="FAILED", data={**data, "activity_kind": "NO_PROGRESS_DETECTED"})
            raise NoProgressDetected("NO_PROGRESS_DETECTED")
        if feedback:
            result = {**result, "NO_PROGRESS": "The same effective phase state and gaps repeated. Resolve a listed gap or reopen explicitly; repeating this ineffective state after this feedback terminates the run."}
        return result

    def rejected(self, code: str, ref: str, detail: str) -> dict:
        result = {"outcome": "FAILED", "phase": self.phase, "revision": self.revision, "failures": [{"code": code, "ref": ref, "detail": detail}]}
        return grouped_gaps(self.observe_validation(result, INVENTORY_VALIDATION if self.phase == DISCOVERY else RULE_VALIDATION), self.context.draft["semanticClaims"])

    def discovery_allowed(self) -> bool:
        return self.phase == DISCOVERY and self.frozen is None

    def put_claim(self, key: str, nodes: list[str], claim_type: str, statement: str,
                  actor: str | None, action: str | None, relevant: bool, reason: str | None, *, update_id: str | None = None) -> dict:
        if not self.discovery_allowed():
            return self.rejected("CLAIM_INVENTORY_FROZEN", "claimInventory", "Reopen explicitly before changing claims")
        key, nodes = identity_key(key), sorted(set(nodes))
        cid = claim_id(self.context.run_id, self.revision, nodes, key)
        if update_id is not None and (cid != update_id or cid not in self.identities):
            return self.rejected("CLAIM_SCHEMA_INVALID", "claim", "An update preserves identity key and source anchors; register a corrected identity explicitly")
        claim = {"claimId": cid, "legalSourceVersionId": self.context.source_graph.version, "sourceNodeIds": nodes,
                 "claimType": claim_type, "statement": statement.strip(), "operative": {"actor": (actor or "").strip(), "modality": claim_type, "action": (action or "").strip()} if claim_type in NORMATIVE else None,
                 "state": "RELEVANT" if relevant else "INTENTIONALLY_NON_OPERATIVE", "nonOperativeReason": None if relevant else reason}
        errors = list(Draft7Validator(CLAIM_SCHEMA).iter_errors(claim))
        if not key or len(key) > 128 or errors or any(n not in self.context.source_graph.nodes for n in nodes) or (not relevant and not reason):
            return self.rejected("CLAIM_SCHEMA_INVALID", "claim", "; ".join(".".join(map(str, e.path)) + ": " + e.message[:180] for e in errors[:4]) or "Valid key, source anchors and exclusion reason required")
        existing = self.context.draft["semanticClaims"].get(cid)
        if existing and existing != claim and update_id is None:
            return self.rejected("CLAIM_IDENTITY_CONFLICT", cid, "Use update_semantic_claim for an existing identity")
        self.changed(existing, claim)
        self.context.draft["semanticClaims"][cid] = claim
        self.identities[cid] = key
        for node in nodes:
            self.claims_by_node.setdefault(node, set()).add(cid)
            if existing is None:
                self.context.draft["sourceAccounting"].pop(node, None)
                self.reviewed_nodes.discard(node)
        self.context.authored_claim_ids.add(cid)
        return {"outcome": "PASSED", "phase": self.phase, "inventoryRevision": self.revision, "claim": deepcopy(claim), "identityKey": key, "claimFingerprint": fingerprint(claim)}

    def validate_inventory(self, finalize: bool) -> dict:
        if self.frozen is not None:
            return {"outcome": "PASSED", "phase": self.phase, **self.binding(), "alreadyFinalized": True}
        self.inventory_validation_calls += 1
        self.transition(INVENTORY_VALIDATION)
        graph = normalized_graph(self.graph())
        errors = list(Draft7Validator(SCHEMA["properties"]["semanticGraph"]).iter_errors(graph))
        if errors:
            result = {"outcome": "FAILED", "failures": [{"code": "CLAIM_SCHEMA_INVALID", "ref": "semanticGraph." + ".".join(map(str, error.path)), "detail": error.message[:200]} for error in errors[:20]]}
        else:
            result = self.context.api.claim_inventory_operation(self.context.run_id, "FINALIZE" if finalize else "VALIDATE", self.revision,
                                                                graph=graph, identities=self.identities)
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
        if self.phase == READY:
            result = self.context.api.claim_inventory_operation(self.context.run_id, "AUTHOR_RULES", self.revision)
            if result.get("outcome") != "PASSED":
                return result
            self.transition(AUTHORING)
        if self.phase not in {AUTHORING, RULE_VALIDATION, SUBMISSION_READY}:
            return self.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Finalize discovery before Rule authoring")
        return {"outcome": "PASSED", "phase": self.phase, **self.binding()}

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
        self.rebuild_node_index()
        self.context.authored_claim_ids = set(remap.values())
        self.context.validated_packet = self.context.last_validation = None
        self.frozen = self.frozen_fingerprint = None
        self.transition(DISCOVERY)
        return {**result, "remappedClaims": list(remap.items())[:20], "remappedClaimCount": len(remap)}
