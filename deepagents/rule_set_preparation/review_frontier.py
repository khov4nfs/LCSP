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
        """Business purpose: Expose the run context owned by this ReviewFrontier's ClaimInventory.

        Business rules:
        - The scheduler and its source-review operations always use the inventory's existing run context.

        Execution flow:
        1. Read `inventory.context` and return it.

        Failure cases:
        - Invalid inventory construction fails through attribute access instead of using another context.

        Side effects:
        - None: read-only property.
        """
        return self.inventory.context

    def request(self, action, **fields):
        """Business purpose: Send one versioned source-review action through the server-governed API and retain its current progress snapshot.

        Business rules:
        - Every request includes this run's operation ID and inventory revision; successful responses alone update frontier snapshot/progress revision.

        Execution flow:
        1. Call the source-review operation with run identity, revision, action and supplied fields.
        2. Normalize per-unit failures into the inventory's flat failure shape.
        3. On success, advance progress revision when the frontier fingerprint changed and retain the response snapshot.
        4. Return the normalized result.

        Failure cases:
        - API failures are returned without advancing the success snapshot; malformed responses propagate as contract errors.

        Side effects:
        - Calls the governed source-review API and may update run-local snapshot and progress revision.
        """
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
        """Reconstruct committed evidence without promoting the active local draft to authority.

        Business purpose: Reconstruct the local claim/reference/frontier projection from committed LOAD records without treating the current local draft as durable authority.

        Business rules:
        - INIT and paged LOAD are authoritative; changed owners replace only their persisted rows, while external dependency fingerprints are retained for relation validation.

        Execution flow:
        1. Skip when already loaded unless force is requested, then initialize the frontier.
        2. Page all LOAD records, replacing owned claims/relations/reference accounting and restoring source dispositions.
        3. Rebuild inventory indexes, backfill legacy relation dependencies and re-project reference accounting.
        4. Record the loaded frontier cursor/fingerprint.

        Failure cases:
        - INIT or any LOAD failure is returned; incomplete restore does not mark the frontier loaded.

        Side effects:
        - Calls source-review API reads and reconstructs local draft, identity, owner and relation state; it does not promote unsaved local rows to durable authority.
        """
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
        """Business purpose: Return the current durable frontier revision/fingerprint binding for validation and submission provenance.

        Business rules:
        - No binding is exposed before a successful frontier snapshot; reviewed fingerprint falls back to the snapshot's state fingerprint for older responses.

        Execution flow:
        1. Return `None` when no snapshot exists.
        2. Project frontier revision, fingerprint and reviewed fingerprint from the snapshot.

        Failure cases:
        - Incomplete snapshot data fails visibly instead of generating replacement provenance.

        Side effects:
        - None: returns a provenance projection.
        """
        if not self.snapshot:
            return None
        return {"revision": self.snapshot["frontierRevision"], "fingerprint": self.snapshot["frontierFingerprint"],
                "reviewedFingerprint": self.snapshot.get("reviewedFrontierFingerprint") or self.snapshot["frontierStateFingerprint"]}

    def failure(self, result):
        # A refused queue operation or an early finalize is not an inventory validation run.
        """Business purpose: Record a refused frontier operation as a discovery-tool rejection and return grouped actionable gaps.

        Business rules:
        - Queue refusals and early-finalize attempts are classified as CLAIM_DISCOVERY_TOOL_REJECTED, not as a Rule inventory validation run.

        Execution flow:
        1. Let ClaimInventory observe the failure in the current phase.
        2. Group its gaps against the current semantic claim set.
        3. Return the grouped result.

        Failure cases:
        - Error normalization/grouping failures propagate; the refusal is not represented as successful source review.

        Side effects:
        - May update inventory rejection/trace state; does not mark any review unit complete.
        """
        result = self.inventory.observe_validation(result, self.inventory.phase, kind="CLAIM_DISCOVERY_TOOL_REJECTED")
        from rule_set_preparation.claim_inventory import grouped_gaps
        return grouped_gaps(result, self.context.draft["semanticClaims"])


    def progress(self):
        """Business purpose: Return current durable source-review progress plus the claim count and required next action.

        Business rules:
        - Progress is refreshed from the persisted frontier; completion is eligible only when the server's progress projection says discovery is complete.

        Execution flow:
        1. Force a restore of durable review records and return grouped failure if it is refused.
        2. Request PROGRESS and group any refusal.
        3. Add local claim count, active unit and discovery/finalization action.
        4. Return the progress view.

        Failure cases:
        - Restore or PROGRESS failures return grouped gaps and never imply completion.

        Side effects:
        - Reads API frontier state and refreshes local projection metadata.
        """
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
        """Business purpose: List semantic claims assigned to one review unit or the currently active source unit.

        Business rules:
        - Ownership is determined by the frontier's claim-owner map; no active unit returns an empty list.

        Execution flow:
        1. Choose the explicit node ID or current active node.
        2. Return draft claims whose recorded owner matches that node.

        Failure cases:
        - Missing active/explicit node returns no claims; inconsistent ownership is not inferred from support text.

        Side effects:
        - None: read-only owned-claim projection.
        """
        target_node = node_id or (self.active["sourceNodeId"] if self.active else None)
        if not target_node:
            return []
        return [c for cid, c in self.context.draft["semanticClaims"].items() if self.claim_owners.get(cid) == target_node]

    def allowed(self, node_ids=None, claim_id=None):
        """Business purpose: Check whether the active review assignment may operate on the supplied source nodes and claim identity.

        Business rules:
        - Work must be within the active batch (or active unit); reference-only source nodes may be inspected outside the batch, but a claim must still belong to an active owner.

        Execution flow:
        1. Derive active unit IDs.
        2. Reject when there is no active unit.
        3. Check source-node scope and claim ownership independently.
        4. Return whether both constraints pass.

        Failure cases:
        - No active assignment or any out-of-scope claim returns false.

        Side effects:
        - None: enforces local assignment scope without mutation.
        """
        active_ids = {u["sourceNodeId"] for u in self.active_batch} if self.active_batch else ({self.active["sourceNodeId"]} if self.active else set())
        if not active_ids:
            return False
        ref_only = bool(node_ids and all(self.context.source_graph.is_reference_only(nid) for nid in node_ids))
        return (not node_ids or ref_only or bool(set(node_ids) & active_ids)) and (not claim_id or self.claim_owners.get(claim_id) in active_ids)

    def adopt(self, node_ids):
        """Use pinned units with INIT authority; file commits never acquire NEXT leases.

        Business purpose: Attach pinned review units to the local active batch using INIT authority for deterministic claim-file commits.

        Business rules:
        - The locally derived review-unit count must match INIT progress; file commits never acquire a NEXT lease.

        Execution flow:
        1. Restore persisted frontier state.
        2. Compare pinned review-unit count with the INIT total.
        3. Select only requested IDs that are actual review units and set active batch/current unit.
        4. Return no refusal when adoption succeeds.

        Failure cases:
        - Restore failure is returned; a count mismatch returns SOURCE_REVIEW_INCOMPLETE without adopting units.

        Side effects:
        - Reads durable frontier state and updates local active-batch ownership.
        """
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
        """Persist the checked files in one COMPLETE request, then reload durable authority.

        Business purpose: Persist a checked source-review batch and then reload the resulting durable frontier authority.

        Business rules:
        - Completion includes the owned claim/relation/reference payload and source/frontier revisions; direct draft also submits its current draft/version in the same operation.
        - API outcomes remain authoritative, and stale direct-draft versions restore the saved authoring draft.

        Execution flow:
        1. Build per-unit payloads from local ownership and dependency state.
        2. Invoke COMPLETE with the pinned frontier revisions and optional direct-draft snapshot.
        3. Synchronize returned draft version or reload stale authoring state.
        4. Project detached-reference guidance, clear active units, force a durable restore and return the result.

        Failure cases:
        - API refusals are grouped with exact failures; failed restore returns a grouped failure rather than preserving a locally assumed completion.

        Side effects:
        - Calls the durable source-review API and updates local draft/frontier versions, assignments and validation guidance.
        """
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
        """The API names one unaccounted reference per refusal; list every one and the allowed ways to account for it.

        Business purpose: Explain how to resolve detached claim relations or unaccounted references reported by a frontier refusal.

        Business rules:
        - Guidance identifies only relations owned by the active unit; each reference must be bound, explicitly non-material with a truthful reason, or retained in a blocked reference-resolution disposition.
        - The author cannot create claims for another unit's source text.

        Execution flow:
        1. Inspect structured failure codes and locate relevant active-unit relation/reference IDs.
        2. Return targeted edit/recommit guidance for detached relations.
        3. Otherwise list all unaccounted references and the allowed binding, non-material or waiting actions.

        Failure cases:
        - Unrelated failures pass through unchanged; absent active ownership does not trigger fabricated reference guidance.

        Side effects:
        - None: returns repair guidance without changing source accounting.
        """
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
        """Business purpose: Reopen one previously reviewed source unit when its source-backed findings have changed.

        Business rules:
        - The request is pinned to the current source/frontier revisions; local state changes only after the API accepts REOPEN.

        Execution flow:
        1. Request REOPEN for the source node with a reason and current frontier provenance.
        2. On success, mark the unit REOPENED, clear its source-accounting projection and rebuild node indexes.
        3. Return success or grouped failure.

        Failure cases:
        - Refused reopen returns the governed grouped gaps without clearing source accounting.

        Side effects:
        - Calls the durable source-review API and may update local review state/indexes.
        """
        result = self.request("REOPEN", sourceNodeId=source_node_id, reason=reason, sourceRevision=self.snapshot["sourceRevision"], frontierRevision=self.snapshot["frontierRevision"])
        if result.get("outcome") == "PASSED":
            self.states[source_node_id] = "REOPENED"
            self.context.draft["sourceAccounting"].pop(source_node_id, None)
            self.inventory.rebuild_node_index()
        return result if result.get("outcome") == "PASSED" else self.failure(result)
