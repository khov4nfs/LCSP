"""Client for the deterministic, transactionally persisted source review scheduler."""
from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class ReviewFrontier:
    inventory: object
    operation_id: str = field(default_factory=lambda: str(uuid4()))
    snapshot: dict = field(default_factory=dict)
    active: dict | None = None
    active_batch: list[dict] = field(default_factory=list)
    claim_owners: dict[str, str] = field(default_factory=dict)
    relation_owners: dict[str, str] = field(default_factory=dict)
    relation_dependencies: dict[str, dict[str, str]] = field(default_factory=dict)
    invalidated_relations: dict[str, dict] = field(default_factory=dict)
    loaded: bool = False
    loaded_through: str | None = None
    loaded_fingerprint: str | None = None
    states: dict[str, str] = field(default_factory=dict)

    @property
    def context(self):
        return self.inventory.context

    def request(self, action, **fields):
        result = self.context.api.source_review_operation(self.context.run_id, self.inventory.revision, action,
            operationId=self.operation_id, **fields)
        if result.get("failures"):
            # COMPLETE reports per-unit refusals; the inventory's error contract is flat.
            result = {**result, "failures": [failure for row in result["failures"]
                for failure in ([row] if "code" in row else [
                    {**f, "sourceNodeId": row.get("sourceNodeId", f.get("sourceNodeId"))}
                    for f in row.get("failure", row).get("failures", [])])]}
        if result.get("outcome") == "PASSED":
            if self.snapshot.get("frontierStateFingerprint") != result.get("frontierStateFingerprint"):
                self.context.progress_revision += 1
            self.snapshot = {k: result[k] for k in ("outcome", "sourceRevision", "frontierRevision", "frontierFingerprint", "frontierStateFingerprint", "reviewedFrontierFingerprint", "progress") if k in result}
        return result

    def restore(self, force=False):
        """Reconstruct committed evidence without promoting the active local draft to authority."""
        if self.loaded and not force:
            return None
        result=self.request("INIT")
        if result.get("outcome") != "PASSED": return result
        draft = self.context.draft
        offset=0
        through = None
        legacy_relations = set()
        while True:
            result=self.request("LOAD",offset=offset,limit=20,
                **({"updatedSince": self.loaded_through} if self.loaded_through else {}),
                **({"updatedThrough": through} if through else {}))
            if result.get("outcome") != "PASSED": return result
            through = result.get("loadedThrough")
            for item in result["records"]:
                node_id=item["sourceNodeId"]
                self.states[node_id] = item["state"]
                payload=item["payload"]
                # A changed owner replaces only its persisted rows; deletions/reopens cannot leave stale authority.
                for cid in [cid for cid, owner in self.claim_owners.items() if owner == node_id]:
                    draft["semanticClaims"].pop(cid, None)
                    self.inventory.identities.pop(cid, None)
                    self.claim_owners.pop(cid, None)
                for rid in [rid for rid, owner in self.relation_owners.items() if owner == node_id]:
                    draft["claimRelations"].pop(rid, None)
                    self.invalidated_relations.pop(rid, None)
                    self.relation_dependencies.pop(rid, None)
                    self.relation_owners.pop(rid, None)
                draft["sourceAccounting"].pop(node_id, None)
                for rid in item.get("referenceIds", []):
                    draft["referenceAccounting"].pop(rid, None)
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
        self.loaded_through = through
        self.loaded_fingerprint = result.get("frontierStateFingerprint")
        return None

    def binding(self):
        if not self.snapshot:
            return None
        return {"revision": self.snapshot["frontierRevision"], "fingerprint": self.snapshot["frontierFingerprint"],
                "reviewedFingerprint": self.snapshot.get("reviewedFrontierFingerprint") or self.snapshot["frontierStateFingerprint"]}

    def failure(self, result):
        # A refused queue operation or an early finalize is not an inventory validation run.
        result = self.inventory.observe_validation(result, self.inventory.phase, kind="CLAIM_DISCOVERY_TOOL_REJECTED")
        from rule_set_preparation.claim_inventory import grouped_gaps
        return grouped_gaps(result, self.context.draft["semanticClaims"])


    def progress(self):
        restored=self.restore(force=True)
        if restored: return self.failure(restored)
        result = self.request("PROGRESS")
        if result.get("outcome") != "PASSED":
            return self.failure(result)
        result["claims"] = len(self.inventory.identities)
        result["activeSourceNodeId"] = self.active["sourceNodeId"] if self.active else None
        result["requiredAction"] = "finalize_semantic_claim_inventory" if result["progress"]["discoveryCompleteEligible"] else "discovery_status"
        return result

    def owned_claims(self, node_id=None):
        target_node = node_id or (self.active["sourceNodeId"] if self.active else None)
        if not target_node:
            return []
        return [c for cid, c in self.context.draft["semanticClaims"].items() if self.claim_owners.get(cid) == target_node]

    def allowed(self, node_ids=None, claim_id=None):
        active_ids = {u["sourceNodeId"] for u in self.active_batch} if self.active_batch else ({self.active["sourceNodeId"]} if self.active else set())
        if not active_ids:
            return False
        ref_only = bool(node_ids and all(self.context.source_graph.is_reference_only(nid) for nid in node_ids))
        return (not node_ids or ref_only or bool(set(node_ids) & active_ids)) and (not claim_id or self.claim_owners.get(claim_id) in active_ids)

    def adopt(self, node_ids):
        """Use pinned units with INIT authority; file commits never acquire NEXT leases."""
        refused = self.restore()
        if refused:
            return refused
        source = self.context.source_graph
        review_ids = source.review_node_ids()
        if len(review_ids) != self.snapshot["progress"]["total"]:
            return {"outcome": "FAILED", "failures": [{"code": "SOURCE_REVIEW_INCOMPLETE", "ref": "frontier", "detail": "Pinned review-unit derivation differs from INIT; no units adopted"}]}
        self.active_batch = [{"sourceNodeId": nid, "structuralPath": source.nodes[nid]["structuralPath"],
            "node": source.nodes[nid], "referenceIds": [rid for rid, owner in source.reference_owners().items() if owner == nid]}
            for nid in node_ids if nid in review_ids]
        self.active = self.active_batch[0] if self.active_batch else None
        return None

    def complete_batch(self, units):
        """Persist the checked files in one COMPLETE request, then reload durable authority."""
        batch = []
        for row in units:
            nid = row["source_node_id"]
            owned = self.owned_claims(nid)
            relations = [r for rid, r in self.context.draft["claimRelations"].items() if self.relation_owners.get(rid) == nid]
            invalid = [rid for rid in self.invalidated_relations if self.relation_owners.get(rid) == nid]
            payload = {"claims": owned, "identities": {c["claimId"]: self.inventory.identities[c["claimId"]] for c in owned},
                "relations": relations + [self.invalidated_relations[rid] for rid in invalid],
                "referenceAccounting": [r for rid, r in self.context.draft["referenceAccounting"].items() if self.context.source_graph.reference_owners().get(rid) == nid],
                "dependencyFingerprints": {cid: value for r in relations for cid, value in self.relation_dependencies.get(r["relationId"], {}).items() if self.claim_owners.get(cid) != nid}}
            if invalid:
                payload["invalidatedRelationIds"] = invalid
            batch.append({"sourceNodeId": nid, "disposition": row["disposition"], "claimIds": row["claim_ids"], "payload": payload,
                **({"reason": row["reason"]} if row.get("reason") else {}), **({"referenceIds": row["reference_ids"]} if row.get("reference_ids") else {})})
        fields = {}
        if self.context.direct_draft:
            from copy import deepcopy
            from rule_set_preparation.claim_inventory import AUTHORING_DRAFT_KEYS, fingerprint
            fields = {"draft": deepcopy({key: self.context.draft[key] for key in AUTHORING_DRAFT_KEYS}), "draftVersion": self.inventory.draft_version}
        result = self.request("COMPLETE", batch=batch, sourceRevision=self.snapshot["sourceRevision"], frontierRevision=self.snapshot["frontierRevision"], **fields)
        if self.context.direct_draft and result.get("outcome") == "PASSED":
            self.inventory.draft_version = result["draftVersion"]
            self.inventory.saved_draft_fingerprint = fingerprint(fields["draft"])
            self.context.draft_revision = result["draftVersion"]
        elif self.context.direct_draft and any(f.get("code") in ("STALE_AUTHORING_DRAFT", "CLAIM_INVENTORY_DRAFT_STALE") for f in result.get("failures", [])):
            self.inventory.restore_authoring_draft(force=True)
        units_by_id = {u["sourceNodeId"]: u for u in self.active_batch}
        detached, guidance = [], []
        for failure in result.get("failures", []):
            self.active = units_by_id.get(failure.get("sourceNodeId"))
            projected = self.reference_guidance({**result, "failures": [failure]}, None)
            detached.extend(projected.get("detachedRelations", []))
            if projected.get("guidance"):
                guidance.append(projected["guidance"])
        if detached:
            result["detachedRelations"] = list({r["relationId"]: r for r in detached}.values())
        if guidance:
            result.update(guidance=" ".join(dict.fromkeys(guidance)), requiredAction="edit_file")
        self.active, self.active_batch = None, []
        restored = self.restore(force=True)
        if restored:
            return self.failure(restored)
        return result if result.get("outcome") == "PASSED" else {**self.failure(result), "failures": result.get("failures", [])}

    def reference_guidance(self, result, listed):
        """The API names one unaccounted reference per refusal; list every one and the allowed ways to account for it."""
        active = (self.active or {}).get("sourceNodeId")
        relations = self.context.draft["claimRelations"]
        detached = {}
        for f in result.get("failures", []):
            ref = str(f.get("ref", ""))
            # A reference-bound relation is refused by its claimRelation: id; an unreferenced link only by its uncommitted endpoint claim.
            if f.get("code") == "SEMANTIC_DEPENDENCY_DETACHED" and ref.startswith("claimRelation:"):
                rows = [(ref[len("claimRelation:"):], f.get("suppliedToClaimId"), f.get("suppliedToClaimId") in (f.get("targetClaimIds") or []))]
            elif f.get("code") == "TARGET_CLAIMS_NOT_AVAILABLE":
                rows = [(rid, ref, False) for rid, r in relations.items() if ref in (r["fromClaimId"], r["toClaimId"])]
            else:
                continue
            for rid, target, committed in rows:
                if self.relation_owners.get(rid) == active:
                    detached[rid] = {"relationId": rid, "referenceId": (relations.get(rid) or {}).get("referenceId", f.get("referenceId")),
                                     "ownerSourceNodeId": active, "targetClaimId": target, "targetClaimCommitted": committed}
        if detached:
            return {**result, "requiredAction": "commit_claims", "detachedRelations": list(detached.values()), "guidance": (
                "Relation(s) " + ", ".join(detached) + " of this unit bind a claim that is no longer a committed target (its unit was reopened or changed). "
                "Correct the relation in its claim file, then commit it again; re-create the binding once the target is republished.")}
        if not any(f.get("code") == "SOURCE_REVIEW_REFERENCE_BLOCKED" for f in result.get("failures", [])) or not self.active:
            return result
        accounted = self.context.draft["referenceAccounting"]
        pending = [rid for rid in self.active["referenceIds"] if rid not in accounted and rid not in set(listed or [])]
        if not pending and not listed:
            return {**result, "guidance": "This unit has no unaccounted reference to wait on. A yield without reference_ids is accepted only while a reopened unit owns a relation "
                    "that touches this unit's claims; otherwise complete it with CLAIMS_AUTHORED or NO_RELEVANT_SEMANTIC_CLAIMS."}
        return {**result, "unaccountedReferenceIds": pending, "guidance": (
            "Every explicit reference of this unit must be accounted before it completes. For each: bind the relation in the claim file when a target claim exists, "
            "a non-material decision with a truthful reason, or, when the target unit is not reviewed yet, commit this file with disposition "
            "REQUIRES_REFERENCE_RESOLUTION and reference_ids containing ALL of: " + ", ".join(sorted({*pending, *(listed or [])})) +
            ". The runtime then schedules the target units and resurfaces this one. Do not author claims for another unit's text from here.")}


    def reopen(self, source_node_id, reason):
        result = self.request("REOPEN", sourceNodeId=source_node_id, reason=reason, sourceRevision=self.snapshot["sourceRevision"], frontierRevision=self.snapshot["frontierRevision"])
        if result.get("outcome") == "PASSED":
            self.states[source_node_id] = "REOPENED"
            self.context.draft["sourceAccounting"].pop(source_node_id, None)
            self.inventory.rebuild_node_index()
        return result if result.get("outcome") == "PASSED" else self.failure(result)
