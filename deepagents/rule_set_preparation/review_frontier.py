"""Client for the deterministic, transactionally persisted source review scheduler."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class ReviewFrontier:
    inventory: object
    operation_id: str = field(default_factory=lambda: str(uuid4()))
    snapshot: dict = field(default_factory=dict)
    active: dict | None = None
    last_completion: dict | None = None
    claim_owners: dict[str, str] = field(default_factory=dict)
    relation_owners: dict[str, str] = field(default_factory=dict)
    relation_dependencies: dict[str, dict[str, str]] = field(default_factory=dict)
    invalidated_relations: dict[str, dict] = field(default_factory=dict)
    loaded: bool = False

    @property
    def context(self):
        return self.inventory.context

    def request(self, action, **fields):
        result = self.context.api.source_review_operation(self.context.run_id, self.inventory.revision, action,
            operationId=self.operation_id, **fields)
        if result.get("outcome") == "PASSED":
            if self.snapshot.get("frontierStateFingerprint") != result.get("frontierStateFingerprint"):
                self.context.progress_revision += 1
            self.snapshot = {k: v for k, v in result.items() if k not in {"unit", "records", "nextOffset"}}
        return result

    def restore(self, force=False):
        """Reconstruct committed evidence without promoting the active local draft to authority."""
        if self.loaded and not force:
            return None
        result=self.request("INIT")
        if result.get("outcome") != "PASSED": return result
        active = self.active["sourceNodeId"] if self.active else None
        draft = self.context.draft
        draft["semanticClaims"] = {cid: c for cid, c in draft["semanticClaims"].items() if active is not None and self.claim_owners.get(cid) == active}
        self.inventory.identities = {cid: key for cid, key in self.inventory.identities.items() if cid in draft["semanticClaims"]}
        draft["claimRelations"] = {rid: r for rid, r in draft["claimRelations"].items() if active is not None and self.relation_owners.get(rid) == active}
        draft["sourceAccounting"] = {}
        draft["referenceAccounting"] = {rid: r for rid, r in draft["referenceAccounting"].items() if active and rid in self.active["referenceIds"]}
        self.invalidated_relations = {rid: r for rid, r in self.invalidated_relations.items() if active and self.relation_owners.get(rid) == active}
        self.claim_owners = {cid: active for cid in draft["semanticClaims"]}
        self.relation_owners = {rid: active for rid in draft["claimRelations"].keys() | self.invalidated_relations.keys()}
        self.relation_dependencies = {rid: values for rid, values in self.relation_dependencies.items() if rid in draft["claimRelations"]}
        offset=0
        legacy_relations = set()
        while True:
            result=self.request("LOAD",offset=offset,limit=20)
            if result.get("outcome") != "PASSED": return result
            for item in result["records"]:
                node_id=item["sourceNodeId"]
                payload=item["payload"]
                if node_id == active: continue
                for claim in payload["claims"]:
                    self.context.draft["semanticClaims"][claim["claimId"]]=claim
                    self.inventory.identities[claim["claimId"]]=payload["identities"][claim["claimId"]]
                    self.claim_owners[claim["claimId"]]=node_id
                for relation in payload["relations"]:
                    rid = relation["relationId"]
                    self.relation_owners[rid]=node_id
                    if rid in payload.get("invalidatedRelationIds", []):
                        self.invalidated_relations[rid] = relation
                    else:
                        self.context.draft["claimRelations"][rid]=relation
                        self.relation_dependencies[rid] = {cid: value for cid, value in payload.get("dependencyFingerprints", {}).items() if cid in (relation["fromClaimId"], relation["toClaimId"])}
                        if "dependencyFingerprints" not in payload: legacy_relations.add(rid)
                for reference in payload["referenceAccounting"]:
                    self.context.draft["referenceAccounting"][reference["referenceId"]]=reference
                if item["state"] in {"REVIEWED_WITH_CLAIMS","REVIEWED_NO_CLAIMS"}:
                    self.context.draft["sourceAccounting"][node_id]={"sourceNodeId":node_id,"claimIds":item["claimIds"],"nonSemanticReason":None if item["claimIds"] else item["reason"]}
            if result["nextOffset"] is None: break
            offset=result["nextOffset"]
        self.inventory.rebuild_node_index()
        from rule_set_preparation.reference_binding import project_reference_accounting, endpoint_fingerprint
        for rid in legacy_relations:
            relation = draft["claimRelations"][rid]
            self.relation_dependencies[rid] = {cid: endpoint_fingerprint(draft["semanticClaims"][cid])
                for cid in (relation["fromClaimId"], relation["toClaimId"])
                if cid in draft["semanticClaims"] and self.claim_owners[cid] != self.relation_owners[rid]}
        project_reference_accounting(self.context)
        self.loaded=True
        return None

    def binding(self):
        if not self.snapshot:
            return None
        return {"revision": self.snapshot["frontierRevision"], "fingerprint": self.snapshot["frontierFingerprint"],
                "reviewedFingerprint": self.snapshot.get("reviewedFrontierFingerprint") or self.snapshot["frontierStateFingerprint"]}

    def failure(self, result):
        result = self.inventory.observe_validation(result, "CLAIM_INVENTORY_VALIDATION")
        from rule_set_preparation.claim_inventory import grouped_gaps
        return grouped_gaps(result, self.context.draft["semanticClaims"])

    def next(self):
        if not self.inventory.discovery_allowed():
            return self.inventory.rejected("CLAIM_INVENTORY_FROZEN", "frontier", "Discovery is frozen; inspect inventory or reopen explicitly")
        restored=self.restore(force=True)
        if restored: return self.failure(restored)
        result = self.request("NEXT", sourceRevision=self.context.source_graph.graph["materializationId"])
        if result.get("outcome") != "PASSED":
            return self.failure(result)
        unit = result.get("unit")
        if unit:
            same_unit = self.active is not None and self.active["sourceNodeId"] == unit["sourceNodeId"] and not unit.get("leaseReacquired", False)
            if self.active and not same_unit:
                self.active = None
                restored = self.restore(force=True)
                if restored: return self.failure(restored)
            self.active = unit
            node_id = unit["sourceNodeId"]
            self.context.draft["sourceAccounting"].pop(node_id, None)
            payload = {"claims": [], "identities": {}, "relations": [], "referenceAccounting": []} if same_unit else unit["payload"]
            for claim in payload["claims"]:
                self.context.draft["semanticClaims"][claim["claimId"]] = claim
                self.inventory.identities[claim["claimId"]] = payload["identities"][claim["claimId"]]
                self.claim_owners[claim["claimId"]] = node_id
            for relation in payload["relations"]:
                rid = relation["relationId"]
                self.relation_owners[rid] = node_id
                if rid in payload.get("invalidatedRelationIds", []):
                    self.invalidated_relations[rid] = relation
                else:
                    self.context.draft["claimRelations"][rid] = relation
                    if "dependencyFingerprints" in payload:
                        self.relation_dependencies[rid] = {cid: value for cid, value in payload["dependencyFingerprints"].items() if cid in (relation["fromClaimId"], relation["toClaimId"])}
            for review in payload["referenceAccounting"]:
                self.context.draft["referenceAccounting"][review["referenceId"]] = review
            self.inventory.rebuild_node_index()
            from rule_set_preparation.reference_binding import project_reference_accounting
            project_reference_accounting(self.context)
            # The model gets one bounded unit, never the scheduler's global item list.
            result["unit"] = {k: unit[k] for k in ["sourceNodeId", "node", "structuralPath", "ancestors", "references", "moreReferences", "contentLength", "contentTruncated"]}
            result["unit"]["existingClaims"] = self.owned_claims()[:12]
            result["unit"]["existingClaimCount"] = len(self.owned_claims())
            result["unit"]["invalidatedRelations"] = [r for rid, r in self.invalidated_relations.items() if self.relation_owners.get(rid) == node_id][:20]
            result["unit"]["action"] = "Interpret this unit, register its distinct claims, then complete_source_review with a typed disposition. Canonical IDs are collected automatically unless you explicitly supply claim_ids."
        return result

    def progress(self):
        restored=self.restore(force=True)
        if restored: return self.failure(restored)
        result = self.request("PROGRESS")
        if result.get("outcome") != "PASSED":
            return self.failure(result)
        result["claims"] = len(self.inventory.identities)
        result["activeSourceNodeId"] = self.active["sourceNodeId"] if self.active else None
        result["requiredAction"] = "finalize_semantic_claim_inventory" if result["progress"]["discoveryCompleteEligible"] else "get_next_review_unit"
        return result

    def owned_claims(self):
        if not self.active:
            return []
        return [c for cid, c in self.context.draft["semanticClaims"].items() if self.claim_owners.get(cid) == self.active["sourceNodeId"]]

    def allowed(self, node_ids=None, claim_id=None):
        if not self.active:
            return False
        return (not node_ids or self.active["sourceNodeId"] in node_ids) and (not claim_id or self.claim_owners.get(claim_id) == self.active["sourceNodeId"])

    def complete(self, disposition, claim_ids=None, reason=None, reference_ids=None):
        if not self.active:
            previous = self.last_completion
            if previous and disposition == previous["disposition"] and reason == previous.get("reason") and (claim_ids is None or sorted(claim_ids) == previous["claimIds"]):
                return self.request("COMPLETE", **previous)
            return self.inventory.rejected("SOURCE_REVIEW_INCOMPLETE", "unit", "Call get_next_review_unit to acquire bounded work")
        node_id = self.active["sourceNodeId"]
        invalid = [rid for rid in self.invalidated_relations if self.relation_owners.get(rid) == node_id]
        if invalid and disposition != "REQUIRES_REFERENCE_RESOLUTION":
            return {**self.inventory.rejected("SEMANTIC_ENDPOINT_CHANGED", node_id, "Reconsider each invalidated relation: explicitly bind a current endpoint or remove the mistaken relation with a reason"),
                    "invalidatedRelationIds": invalid[:20], "requiredAction": "inspect_semantic_reference_binding"}
        owned = self.owned_claims()
        expected = sorted(c["claimId"] for c in owned)
        claim_ids = expected if claim_ids is None else sorted(claim_ids)
        missing = sorted(set(expected) - set(claim_ids))
        if missing:
            return self.failure({"outcome": "FAILED", "failures": [{"code": "CLAIM_SOURCE_BINDING_INVALID", "ref": node_id,
                "detail": "Review omitted claims already authored in this unit"}], "requiredAction": "complete_source_review",
                "expectedClaimIds": expected, "missingClaimIds": missing})
        references = set(self.active["referenceIds"])
        from rule_set_preparation.reference_binding import valid_binding, project_reference_accounting
        for rid, relation in self.context.draft["claimRelations"].items():
            if self.relation_owners.get(rid) == node_id and relation.get("referenceId") and not valid_binding(self.context.source_graph, self.context.draft["semanticClaims"], relation):
                return {**self.inventory.rejected("SEMANTIC_DEPENDENCY_DETACHED", relation["referenceId"], "Remove this legacy invalid binding and inspect the resolved target before rebinding"),
                        "referenceId": relation["referenceId"], "relationId": rid, "requiredAction": "inspect_semantic_reference_binding"}
        project_reference_accounting(self.context)
        payload = {"claims": owned, "identities": {cid: self.inventory.identities[cid] for cid in expected},
                   "relations": [r for rid, r in self.context.draft["claimRelations"].items() if self.relation_owners.get(rid) == node_id],
                   "referenceAccounting": [r for rid, r in self.context.draft["referenceAccounting"].items() if rid in references]}
        payload["dependencyFingerprints"] = {cid: value for r in payload["relations"] for cid, value in self.relation_dependencies.get(r["relationId"], {}).items()
                                             if self.claim_owners.get(cid) != node_id}
        if invalid:
            payload["relations"].extend(self.invalidated_relations[rid] for rid in invalid)
            payload["invalidatedRelationIds"] = invalid
        arguments = dict(sourceNodeId=node_id, sourceRevision=self.snapshot["sourceRevision"],
            frontierRevision=self.snapshot["frontierRevision"], disposition=disposition, claimIds=claim_ids,
            payload=payload, **({"reason": reason} if reason else {}), **({"referenceIds": reference_ids} if reference_ids else {}))
        result = self.request("COMPLETE", **arguments)
        if result.get("outcome") != "PASSED":
            return self.failure(result)
        if result["state"] != "BLOCKED_REFERENCE":
            self.context.draft["sourceAccounting"][node_id] = {"sourceNodeId": node_id, "claimIds": claim_ids, "nonSemanticReason": None if claim_ids else reason}
        self.last_completion = deepcopy(arguments)
        self.active = None
        restored = self.restore(force=True)
        if restored: return self.failure(restored)
        self.inventory.rebuild_node_index()
        return result

    def expand(self, reference_ids, reason):
        if not self.active:
            return self.inventory.rejected("SOURCE_REVIEW_INCOMPLETE", "unit", "Acquire the referring review unit first")
        result = self.request("EXPAND", sourceNodeId=self.active["sourceNodeId"], sourceRevision=self.snapshot["sourceRevision"],
            frontierRevision=self.snapshot["frontierRevision"], referenceIds=reference_ids, reason=reason)
        return result if result.get("outcome") == "PASSED" else self.failure(result)

    def reopen(self, source_node_id, reason):
        result = self.request("REOPEN", sourceNodeId=source_node_id, reason=reason, sourceRevision=self.snapshot["sourceRevision"], frontierRevision=self.snapshot["frontierRevision"])
        if result.get("outcome") == "PASSED":
            self.context.draft["sourceAccounting"].pop(source_node_id, None)
            self.inventory.rebuild_node_index()
        return result if result.get("outcome") == "PASSED" else self.failure(result)
