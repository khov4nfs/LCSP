"""Typed incremental operations over one pinned inventory and its derived Rule candidates."""
from __future__ import annotations

import json
from copy import deepcopy
from jsonschema import Draft7Validator
from langchain_core.tools import StructuredTool

from rule_set_preparation.claim_inventory import (
    AUTHORING, CLAIM_ROLES, CLAIM_SCHEMA, DISCOVERY, GRAPH_SECTIONS, RELATION_KINDS,
    REQUIREMENT_KINDS, ROLE_FIELDS, SCHEMA, ClaimInventory, fingerprint,
)
from rule_set_preparation.reference_binding import valid_binding, side_claims, project_reference_accounting, endpoint_fingerprint

TEXT = {"type": "string", "minLength": 1, "maxLength": 8000}
IDS = {"type": "array", "items": {"type": "string", "minLength": 1}, "maxItems": 128, "uniqueItems": True}


def object_schema(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


def derive_requirement_relations(context):
    """Project the Agent-authored claim relation's existing kind/direction, without interpretation."""
    owners: dict[str, set[str]] = {}
    for requirement in context.draft["legalRequirements"].values():
        for binding in requirement["claimBindings"]:
            owners.setdefault(binding["claimId"], set()).add(requirement["legalRequirementId"])
    relations = {}
    for relation in context.inventory.frozen["relations"]:
        targets = owners.get(relation["toClaimId"], set())
        for origin in sorted(owners.get(relation["fromClaimId"], set())):
            if origin in targets:
                continue
            for target in sorted(targets):
                row = {"kind": REQUIREMENT_KINDS.get(relation["kind"], relation["kind"]),
                       "fromLegalRequirementId": origin, "toLegalRequirementId": target, "toSourceRef": None}
                row["relationId"] = fingerprint(row)
                relations[row["relationId"]] = row
    context.draft["contextRelations"] = relations


def build_claim_tools(context):
    ledger: ClaimInventory = context.inventory

    def source_refs(claim):
        # Canonical provenance is the claim/node binding; retain exact legacy citation aids when available.
        refs = {}
        for node_id in claim["sourceNodeIds"]:
            owner, visited = node_id, set()
            while owner and owner not in visited and not context.source_graph.chunk_ids.get(owner):
                visited.add(owner)
                owner = context.source_graph.nodes[owner]["parentNodeId"]
            for chunk_id in context.source_graph.chunk_ids.get(owner, []):
                chunk = context.source_graph.chunks[chunk_id]
                ref = {key: chunk[key] for key in ("documentId", "locator", "contentSha256")}
                refs[(ref["documentId"], ref["locator"], ref["contentSha256"])] = ref
        return list(refs.values())

    def register(identity_key, claim_type, statement, source_node_ids=None, actor=None, action=None, relevant=True, non_operative_reason=None):
        if source_node_ids is None:
            source_node_ids = [ledger.frontier.active["sourceNodeId"]] if ledger.frontier and ledger.frontier.active else []
        return ledger.put_claim(identity_key, source_node_ids, claim_type, statement, actor, action, relevant, non_operative_reason)

    def update(claim_id, claim_type, statement, actor=None, action=None, relevant=True, non_operative_reason=None):
        claim = context.draft["semanticClaims"][claim_id]
        return ledger.put_claim(ledger.identities[claim_id], claim["sourceNodeIds"], claim_type, statement,
                                actor, action, relevant, non_operative_reason, update_id=claim_id)

    def link(from_claim_id, to_claim_id, kind, reference_id=None):
        if not ledger.discovery_allowed():
            return ledger.rejected("CLAIM_INVENTORY_FROZEN", "claimRelations", "Reopen before changing semantic relations")
        row = {"fromClaimId": from_claim_id, "toClaimId": to_claim_id, "kind": kind, "referenceId": reference_id}
        if reference_id is not None and not valid_binding(context.source_graph, context.draft["semanticClaims"], row):
            return binding_failure(reference_id, from_claim_id, to_claim_id)
        if from_claim_id == to_claim_id or not {from_claim_id, to_claim_id} <= ledger.identities.keys() or kind not in RELATION_KINDS:
            return ledger.rejected("CLAIM_SCHEMA_INVALID", "claimRelations", "Distinct existing claim IDs and a supported kind are required")
        if ledger.frontier and (not ledger.frontier.active or (reference_id is None and not any(ledger.frontier.claim_owners.get(cid) == ledger.frontier.active["sourceNodeId"] for cid in [from_claim_id,to_claim_id]))):
            return ledger.rejected("CLAIM_SOURCE_BINDING_INVALID", "relation", "Link a claim from this active review unit to its related claim")
        if reference_id and ledger.frontier and reference_id not in ledger.frontier.active["referenceIds"]:
            return ledger.rejected("CLAIM_SOURCE_BINDING_INVALID", reference_id, "Bind the reference in its active source review")
        dependencies = {}
        if ledger.frontier:
            foreign = [cid for cid in (from_claim_id, to_claim_id)
                       if ledger.frontier.claim_owners.get(cid) != ledger.frontier.active["sourceNodeId"]]
            if foreign:
                authority = ledger.frontier.request("PROGRESS", claimIds=foreign, sourceRevision=context.source_graph.graph["materializationId"])
                if authority.get("outcome") != "PASSED": return ledger.frontier.failure(authority)
                endpoints = {e["claim"]["claimId"]: e for e in authority["endpoints"]}
                for cid in foreign:
                    if cid not in endpoints:
                        return {**ledger.rejected("TARGET_CLAIMS_NOT_AVAILABLE", cid, "A cross-review endpoint must be a valid committed canonical claim; uncommitted drafts are unavailable"),
                                "targetClaimAvailability": "NOT_AVAILABLE", "requiredAction": "inspect_semantic_reference_binding"}
                    if endpoint_fingerprint(context.draft["semanticClaims"][cid]) != endpoints[cid]["fingerprint"]:
                        return {**ledger.rejected("SEMANTIC_ENDPOINT_CHANGED", cid, "Inspect the changed durable target and reconsider the semantic binding"),
                                "requiredAction": "inspect_semantic_reference_binding"}
                    dependencies[cid] = endpoints[cid]["fingerprint"]
        row["relationId"] = fingerprint(row)
        ledger.changed(context.draft["claimRelations"].get(row["relationId"]), row)
        context.draft["claimRelations"][row["relationId"]] = row
        if ledger.frontier:
            ledger.frontier.relation_owners.setdefault(row["relationId"],ledger.frontier.active["sourceNodeId"])
            ledger.frontier.relation_dependencies[row["relationId"]] = dependencies
            ledger.frontier.invalidated_relations.pop(row["relationId"], None)
        accounting = project_reference_accounting(context)
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, "relation": row,
                **({"referenceAccounting": accounting[reference_id]} if reference_id else {})}

    def binding_failure(reference_id, from_claim_id, to_claim_id):
        ref = context.source_graph.references.get(reference_id, {})
        claims = context.draft["semanticClaims"]
        return {**ledger.rejected("SEMANTIC_DEPENDENCY_DETACHED", reference_id,
                    "Bind distinct claims anchored under the structural source and resolved target, in that direction"),
                "code": "SEMANTIC_DEPENDENCY_DETACHED",
                "referenceId": reference_id, "fromNodeId": ref.get("fromNodeId"), "sourceNodeId": ref.get("fromNodeId"),
                "targetNodeId": ref.get("toNodeId"), "suppliedFromClaimId": from_claim_id, "suppliedToClaimId": to_claim_id,
                "sourceClaimIds": [c["claimId"] for c in side_claims(context.source_graph, claims, ref.get("fromNodeId"))][:20],
                "targetClaimIds": [c["claimId"] for c in side_claims(context.source_graph, claims, ref.get("toNodeId"))][:20],
                "requiredAction": "inspect_semantic_reference_binding"}

    def inspect_binding(reference_id, offset=0, limit=10):
        if ledger.frontier:
            restored = ledger.frontier.restore()
            if restored: return ledger.frontier.failure(restored)
        source = context.source_graph
        ref = source.references.get(reference_id)
        if not ref:
            return binding_failure(reference_id, None, None)
        origin = side_claims(source, context.draft["semanticClaims"], ref["fromNodeId"])
        targets = side_claims(source, context.draft["semanticClaims"], ref["toNodeId"])
        target_review = {"targetReviewComplete": bool(targets), "bindingCanProceed": bool(targets),
                         "targetClaimAvailability": "AVAILABLE" if targets else "NOT_AVAILABLE", "targetReviewState": None, "inScope": True}
        target_count, target_more = len(targets), offset + limit < len(targets)
        if ledger.frontier:
            state = ledger.frontier.request("PROGRESS", referenceIds=[reference_id], offset=offset, limit=limit,
                sourceRevision=source.graph["materializationId"])
            if state.get("outcome") != "PASSED": return ledger.frontier.failure(state)
            target_review = state["referenceTargets"][0]
            targets = [e["claim"] for e in target_review["targetClaims"]]
            target_count, target_more = target_review["targetClaimCount"], target_review["hasMore"]
            for endpoint in target_review["targetClaims"]:
                claim = endpoint["claim"]
                if ledger.frontier.claim_owners.get(claim["claimId"]) != (ledger.frontier.active or {}).get("sourceNodeId"):
                    context.draft["semanticClaims"][claim["claimId"]] = deepcopy(claim)
                    ledger.identities[claim["claimId"]] = endpoint["identityKey"]
                    ledger.frontier.claim_owners[claim["claimId"]] = endpoint["owner"]
        ready = target_review["bindingCanProceed"]
        if ref["resolutionState"] != "RESOLVED":
            action, next_action = "report_rule_set_source_blocked", "Resolve the structural dependency before material binding"
        elif not target_review["inScope"]:
            action, next_action = "expand_review_frontier", "Explicitly expand the target scope before blocking"
        elif not ready and not target_review["targetReviewComplete"]:
            action, next_action = "complete_source_review", "TARGET_CLAIMS_NOT_AVAILABLE: publish this unit's claims with REQUIRES_REFERENCE_RESOLUTION; the runtime schedules target work"
        elif not ready:
            action, next_action = "reopen_source_review", "TARGET_CLAIMS_NOT_AVAILABLE: the target is complete but has no compatible canonical endpoint; explicitly revisit its semantic review if material"
        else:
            action, next_action = "bind_semantic_reference", "Choose the legal dependency among durable candidates; target review completion is independent"
        def bounded(rows, start=offset):
            return [{"claimId": c["claimId"], "claimType": c["claimType"], "sourceNodeIds": c["sourceNodeIds"][:3], "sourceNodeCount": len(c["sourceNodeIds"]), "statement": c["statement"][:512], "statementTruncated": len(c["statement"]) > 512} for c in rows[start:start + limit]]
        def node_info(nid):
            node = source.nodes.get(nid)
            return {k: node[k] for k in ("nodeId", "title", "structuralPath")} if node else None
        return {"outcome": "PASSED", **source.base(), "reference": deepcopy(ref), "resolutionState": ref["resolutionState"],
                "sourceNode": node_info(ref["fromNodeId"]), "targetNode": node_info(ref["toNodeId"]),
                "sourceClaims": bounded(origin), "targetClaims": bounded(targets, 0 if ledger.frontier else offset),
                "sourceClaimCount": len(origin), "targetClaimCount": target_count, "offset": offset,
                "hasMore": target_more or offset + limit < len(origin),
                "relations": ([deepcopy(r) for r in context.draft["claimRelations"].values() if r["referenceId"] == reference_id]
                    + ([{**deepcopy(r), "invalidated": True} for r in ledger.frontier.invalidated_relations.values() if r["referenceId"] == reference_id] if ledger.frontier else []))[:20],
                "referenceAccounting": deepcopy(context.draft["referenceAccounting"].get(reference_id)),
                "targetReviewState": target_review["targetReviewState"], "targetClaimAvailability": target_review["targetClaimAvailability"],
                "targetReviewComplete": target_review["targetReviewComplete"], "bindingCanProceed": ready,
                "targetReviews": target_review.get("targetReviews", [])[:20], "targetReviewCount": len(target_review.get("targetReviews", [])),
                "targetReview": {k: v for k, v in target_review.items() if k not in {"targetClaims", "targetReviews"}},
                "requiredAction": action, "referenceIds": [reference_id] if not ready else [],
                "nextAction": next_action}

    def bind(reference_id, from_claim_id, to_claim_id, kind):
        return link(from_claim_id, to_claim_id, kind, reference_id)

    def remove(claim_id, reason):
        if not ledger.discovery_allowed() or not reason.strip():
            return ledger.rejected("CLAIM_INVENTORY_FROZEN", claim_id, "Remove a mistaken discovery claim only before freeze, with a reason")
        if ledger.frontier and not ledger.frontier.allowed(claim_id=claim_id):
            return ledger.rejected("CLAIM_SOURCE_BINDING_INVALID",claim_id,"Reopen the owning review unit before changing its claim")
        old = context.draft["semanticClaims"].pop(claim_id)
        ledger.changed(old, None)
        del ledger.identities[claim_id]
        context.authored_claim_ids.discard(claim_id)
        for node_id in old["sourceNodeIds"]:
            if not ledger.frontier: context.draft["sourceAccounting"].pop(node_id, None)
            ledger.claims_by_node.get(node_id, set()).discard(claim_id)
            ledger.reviewed_nodes.discard(node_id)
        detached = [rid for rid, r in context.draft["claimRelations"].items() if claim_id in (r["fromClaimId"], r["toClaimId"])
                    and (not ledger.frontier or ledger.frontier.relation_owners.get(rid) == ledger.frontier.active["sourceNodeId"])]
        for rid in detached:
            del context.draft["claimRelations"][rid]
            if ledger.frontier: ledger.frontier.relation_owners.pop(rid, None)
        if ledger.frontier: ledger.frontier.claim_owners.pop(claim_id, None)
        project_reference_accounting(context)
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, "removedClaimId": claim_id, "reason": reason,
                "invalidatedSourceReviews": old["sourceNodeIds"], "removedRelationIds": detached}

    def unlink(relation_id, reason):
        if not ledger.discovery_allowed() or not reason.strip():
            return ledger.rejected("CLAIM_INVENTORY_FROZEN", relation_id, "Correct relations only before freeze, with a reason")
        if ledger.frontier and (not ledger.frontier.active or ledger.frontier.relation_owners.get(relation_id)!=ledger.frontier.active["sourceNodeId"]):
            return {**ledger.rejected("CLAIM_SOURCE_BINDING_INVALID",relation_id,"Reopen the owning review unit before changing its relation"),"requiredAction":"reopen_source_review","sourceNodeId":ledger.frontier.relation_owners.get(relation_id)}
        old = context.draft["claimRelations"].pop(relation_id, None)
        if ledger.frontier: old = old or ledger.frontier.invalidated_relations.pop(relation_id, None)
        if old is None: return ledger.rejected("CLAIM_SCHEMA_INVALID", relation_id, "Inspect the existing relation before removing it")
        ledger.changed(old, None)
        if ledger.frontier: ledger.frontier.relation_owners.pop(relation_id, None)
        project_reference_accounting(context)
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, "removedRelationId": relation_id, "reason": reason}

    def review_node(source_node_id, claim_ids, no_relevant_claim_reason=None):
        if not ledger.discovery_allowed():
            return ledger.rejected("CLAIM_INVENTORY_FROZEN", "sourceAccounting", "Reopen before changing source review")
        expected = ledger.claims_by_node.get(source_node_id, set())
        if source_node_id not in context.source_graph.nodes or set(claim_ids) != expected or len(set(claim_ids)) != len(claim_ids) or (bool(expected) == bool(no_relevant_claim_reason)):
            return ledger.rejected("INCOMPLETE_STRUCTURAL_ACCOUNTING", source_node_id, "Enumerate all registered claims anchored here, or give a reason when there are none")
        row = {"sourceNodeId": source_node_id, "claimIds": sorted(claim_ids), "nonSemanticReason": no_relevant_claim_reason}
        ledger.changed(context.draft["sourceAccounting"].get(source_node_id), row)
        context.draft["sourceAccounting"][source_node_id] = row
        if source_node_id in ledger.required_nodes:
            ledger.reviewed_nodes.add(source_node_id)
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, "review": context.draft["sourceAccounting"][source_node_id]}

    def review_reference(reference_id, material, relation_ids=None, non_material_reason=None):
        if ledger.frontier and (not ledger.frontier.active or reference_id not in ledger.frontier.active["referenceIds"]):
            return ledger.rejected("CLAIM_SOURCE_BINDING_INVALID",reference_id,"Review references attached to the active review unit")
        if not ledger.discovery_allowed():
            return ledger.rejected("CLAIM_INVENTORY_FROZEN", "referenceAccounting", "Reopen before changing reference accounting")
        relations = [r for r in context.draft["claimRelations"].values() if r["referenceId"] == reference_id]
        if reference_id not in context.source_graph.references or (material and (not relations or non_material_reason)) or (not material and (relations or relation_ids or not non_material_reason or not non_material_reason.strip())):
            return ledger.rejected("INCOMPLETE_STRUCTURAL_ACCOUNTING", reference_id, "Bind a material reference atomically; remove its bindings before marking it non-material with a truthful reason")
        if any(not valid_binding(context.source_graph, context.draft["semanticClaims"], r) for r in relations):
            return binding_failure(reference_id, None, None)
        row = {"referenceId": reference_id, "material": material, "relationIds": sorted(r["relationId"] for r in relations), "nonMaterialReason": non_material_reason}
        ledger.changed(context.draft["referenceAccounting"].get(reference_id), row)
        context.draft["referenceAccounting"][reference_id] = row
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, "review": context.draft["referenceAccounting"][reference_id]}

    def non_material(reference_id, reason):
        return review_reference(reference_id, False, non_material_reason=reason)

    def inspect(kind="STATUS", source_node_id=None, claim_id=None, offset=0, limit=10):
        if ledger.frontier and kind in {"STATUS","UNREVIEWED_SOURCE_NODES"}:
            return ledger.frontier.progress()
        if offset < 0 or not 1 <= limit <= 20:
            return {"error": "Use nonnegative offset and limit 1..20"}
        required = [n for n in context.source_graph.nodes.values() if n["content"].strip()]
        reviewed = context.draft["sourceAccounting"]
        bound = {b["claimId"] for r in context.draft["legalRequirements"].values() for b in r.get("claimBindings", [])}
        if kind == "UNREVIEWED_SOURCE_NODES":
            rows = [{"sourceNodeId": n["nodeId"], "structuralPath": n["structuralPath"]} for n in required if n["nodeId"] not in reviewed]
        elif kind == "RELATIONS":
            rows = [r for r in context.draft["claimRelations"].values() if not claim_id or claim_id in (r["fromClaimId"], r["toClaimId"])]
        elif kind == "REQUIREMENTS":
            rows = list(context.draft["legalRequirements"].values())
        else:
            candidates = ([context.draft["semanticClaims"][cid] for cid in sorted(ledger.claims_by_node.get(source_node_id, set()))] if source_node_id else
                          [context.draft["semanticClaims"][claim_id]] if claim_id and claim_id in ledger.identities else
                          [] if claim_id else context.draft["semanticClaims"].values())
            rows = [{"claim": c, "identityKey": ledger.identities[c["claimId"]], "claimFingerprint": fingerprint(c)} for c in candidates
                    if (not claim_id or c["claimId"] == claim_id) and (not source_node_id or source_node_id in c["sourceNodeIds"])
                    and (kind != "UNACCOUNTED_CLAIMS" or (c["state"] == "RELEVANT" and c["claimId"] not in bound))] if kind != "STATUS" else []
        selected, chars = [], 0
        for row in rows[offset:offset + limit]:
            size = len(json.dumps(row, ensure_ascii=False))
            if chars + size > 24000:
                break
            selected.append(row); chars += size
        return {"phase": ledger.phase, "inventoryRevision": ledger.revision, "inventoryFingerprint": ledger.frozen_fingerprint,
                "sourceNodesReviewed": len(reviewed), "sourceNodesRemaining": sum(n["nodeId"] not in reviewed for n in required),
                "claimCount": len(ledger.identities), "relationCount": len(context.draft["claimRelations"]),
                "total": len(rows), "items": deepcopy(selected), "nextOffset": offset + len(selected) if offset + len(selected) < len(rows) else None}

    def requirement(requirement_key, title, operative_claim_ids, applicability_claim_ids, qualifier_claim_ids=None,
                    exception_claim_ids=None, context_claim_ids=None, non_repository_duty=False, non_assessable_reason=None):
        started = ledger.begin_authoring()
        if started.get("outcome") != "PASSED":
            return started
        selections = {"OPERATIVE_PROPOSITION": operative_claim_ids, "APPLICABILITY_CONDITION": applicability_claim_ids,
                      "QUALIFIER": qualifier_claim_ids or [], "EXCEPTION": exception_claim_ids or [], "CONTEXT": context_claim_ids or []}
        row = {"legalRequirementId": requirement_key, "claimInventoryRevision": ledger.revision, "title": title,
               "proposition": "", "operativePropositions": [], "applicabilityConditions": [], "qualifiers": [], "exceptions": [],
               "semanticContext": [], "claimBindings": [], "sourceRefs": [], "nonRepositoryDuty": non_repository_duty,
               "coverage": {"state": "NON_ASSESSABLE" if non_assessable_reason else "COVERED_BY_ASSESSMENT_RULES", "nonAssessableReason": non_assessable_reason}}
        claims = context.draft["semanticClaims"]
        statements = []
        provenance = {}
        for role, ids in selections.items():
            for cid in ids:
                claim = claims[cid]
                actual_role = CLAIM_ROLES[claim["claimType"]]
                if claim["state"] != "RELEVANT" or (actual_role != role and not (role == "CONTEXT" and actual_role == "DEFINITION")):
                    return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", cid, "Choose a relevant frozen claim with the matching accounting role")
                refs = source_refs(claim)
                for ref in refs:
                    provenance[(ref["documentId"], ref["locator"], ref["contentSha256"])] = ref
                if role == "OPERATIVE_PROPOSITION":
                    index = len(row["operativePropositions"])
                    row["operativePropositions"].append({**deepcopy(claim["operative"]), "sourceRefs": refs})
                    statements.append(claim["statement"])
                else:
                    field = ROLE_FIELDS[role]; index = len(row[field]); row[field].append(claim["statement"])
                row["claimBindings"].append({"claimId": cid, "role": actual_role, "index": index})
        row["sourceRefs"] = list(provenance.values())
        row["proposition"] = "\n".join(statements)
        errors = list(Draft7Validator(SCHEMA["properties"]["legalRequirements"]["items"]).iter_errors(row))
        if errors or not operative_claim_ids or (not non_assessable_reason and not applicability_claim_ids):
            return ledger.rejected("CLAIM_SCHEMA_INVALID", requirement_key, "; ".join(e.message[:160] for e in errors[:3]) or "Operative claims and assessable applicability claims are required")
        ledger.changed(context.draft["legalRequirements"].get(requirement_key), row)
        context.draft["legalRequirements"][requirement_key] = row
        context.validated_packet = context.last_validation = None
        derive_requirement_relations(context)
        ledger.transition(AUTHORING)
        return {"outcome": "PASSED", "phase": ledger.phase, "inventoryRevision": ledger.revision, "requirement": deepcopy(row)}

    def assessment(assessment_rule_id, concept, legal_requirement_ids, investigation_focus=None):
        started = ledger.begin_authoring()
        if started.get("outcome") != "PASSED":
            return started
        if not legal_requirement_ids or any(context.draft["legalRequirements"][rid]["coverage"]["state"] != "COVERED_BY_ASSESSMENT_RULES" for rid in legal_requirement_ids):
            return ledger.rejected("ORPHAN_ASSESSMENT_RULE", assessment_rule_id, "Choose existing assessable Requirement IDs")
        criteria = [{"criterionId": "criterion_" + fingerprint({"assessmentRuleId": assessment_rule_id, "legalRequirementIds": sorted(legal_requirement_ids)})[:24], "legalRequirementIds": legal_requirement_ids,
                     **({"investigationFocus": investigation_focus} if investigation_focus else {})}]
        row = {"assessmentRuleId": assessment_rule_id, "concept": concept, "legalRequirementIds": legal_requirement_ids, "criteria": criteria,
               "evidenceBindings": [{"criterionId": c["criterionId"], "kind": "REQUIRED"} for c in criteria],
               "sourceRefs": list({(ref["documentId"], ref["locator"], ref["contentSha256"]): ref for rid in legal_requirement_ids for ref in context.draft["legalRequirements"][rid]["sourceRefs"]}.values()),
               "semanticAuthority": "CLAIM_DERIVED", **{k: [] for k in ["investigationGoals", "startingNodeTypes", "targetNodeTypes", "edgeStrategies", "graphQueries", "keywords", "commonApis", "commonLibraries", "patterns", "requiredEvidence", "supportingEvidence", "negativeEvidence"]}}
        errors = list(Draft7Validator(SCHEMA["properties"]["assessmentRules"]["items"]).iter_errors(row))
        if errors:
            return ledger.rejected("CLAIM_SCHEMA_INVALID", assessment_rule_id, "; ".join(e.message[:160] for e in errors[:3]))
        ledger.changed(context.draft["assessmentRules"].get(assessment_rule_id), row)
        context.draft["assessmentRules"][assessment_rule_id] = row
        context.validated_packet = context.last_validation = None
        ledger.transition(AUTHORING)
        return {"outcome": "PASSED", "phase": ledger.phase, "inventoryRevision": ledger.revision, "assessmentRule": deepcopy(row),
                "authority": "Normative criteria/applicability/evidence are derived by the API from these exact parents. Investigation focus is a non-normative suggestion."}

    def remove_candidate(kind, candidate_id, reason):
        started = ledger.begin_authoring()
        if started.get("outcome") != "PASSED":
            return started
        section = "legalRequirements" if kind == "LEGAL_REQUIREMENT" else "assessmentRules"
        row = context.draft[section].pop(candidate_id)
        ledger.changed(row, None)
        invalidated = []
        if kind == "LEGAL_REQUIREMENT":
            for rule_id, rule in list(context.draft["assessmentRules"].items()):
                if candidate_id in rule["legalRequirementIds"]:
                    invalidated.append(rule_id)
                    del context.draft["assessmentRules"][rule_id]
            derive_requirement_relations(context)
        ledger.transition(AUTHORING)
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, "removedCandidateId": candidate_id,
                "reason": reason, "invalidatedAssessmentRules": invalidated}

    claim_properties = {"claim_type": {"type": "string", "enum": CLAIM_SCHEMA["properties"]["claimType"]["enum"]}, "statement": TEXT,
                        "actor": TEXT, "action": TEXT, "relevant": {"type": "boolean"}, "non_operative_reason": TEXT}
    specs = [
        ("register_semantic_claim", "Register one Agent-interpreted claim with a stable semantic key and pinned source nodes; returns its canonical ID.", register, object_schema({"identity_key": {**TEXT, "maxLength": 128}, "source_node_ids": {**IDS, "minItems": 1}, **claim_properties}, ["identity_key", "source_node_ids", "claim_type", "statement"])),
        ("update_semantic_claim", "Correct an existing claim during discovery, preserving its canonical ID/source anchors. Frozen claims require explicit reopening.", update, object_schema({"claim_id": TEXT, **claim_properties}, ["claim_id", "claim_type", "statement"])),
        ("remove_semantic_claim", "Remove a mistaken claim BEFORE inventory freeze, recording why and invalidating affected source/reference reviews. Never omit a real duty merely to pass coverage.", remove, object_schema({"claim_id": TEXT, "reason": TEXT}, ["claim_id", "reason"])),
        ("link_semantic_claims", "Declare the legal role/direction between claims. Attach a structural reference edge when the dependency relies on it.", link, object_schema({"from_claim_id": TEXT, "to_claim_id": TEXT, "kind": {"type": "string", "enum": sorted(RELATION_KINDS)}, "reference_id": TEXT}, ["from_claim_id", "to_claim_id", "kind"])),
        ("inspect_semantic_reference_binding", "Inspect one structural edge, bounded durable canonical targets, targetClaimAvailability and independent targetReviewComplete. A blocked target can expose usable committed claims. Does not choose legal materiality or a semantic target.", inspect_binding, object_schema({"reference_id": TEXT, "offset": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}}, ["reference_id"])),
        ("bind_semantic_reference", "Atomically bind your legal dependency from the structural source subtree to its resolved target subtree. Runtime generates the relation ID and derives material accounting. Identical bindings are idempotent.", bind, object_schema({"reference_id": TEXT, "from_claim_id": TEXT, "to_claim_id": TEXT, "kind": {"type": "string", "enum": sorted(RELATION_KINDS)}}, ["reference_id", "from_claim_id", "to_claim_id", "kind"])),
        ("mark_reference_non_material", "Declare this active reference non-material with a truthful legal reason. Existing semantic bindings must be removed explicitly first.", non_material, object_schema({"reference_id": TEXT, "reason": TEXT}, ["reference_id", "reason"])),
        ("remove_semantic_relation", "Correct a mistaken discovery relation before freeze, recording why and invalidating its reference review.", unlink, object_schema({"relation_id": TEXT, "reason": TEXT}, ["relation_id", "reason"])),
        ("review_source_node", "Record discovery review: enumerate ALL discovered claims in this node, or an explicit reason it has none. A context claim never hides a separate duty.", review_node, object_schema({"source_node_id": TEXT, "claim_ids": IDS, "no_relevant_claim_reason": TEXT}, ["source_node_id", "claim_ids"])),
        ("review_source_reference", "Account for an explicit reference with its semantic relation IDs or an Agent-authored non-material reason.", review_reference, object_schema({"reference_id": TEXT, "material": {"type": "boolean"}, "relation_ids": IDS, "non_material_reason": TEXT}, ["reference_id", "material", "relation_ids"])),
        ("get_claim_inventory", "Read bounded inventory status, unreviewed nodes, claims by node/ID, related claims, unaccounted claims or Requirements. Paginate rather than loading the full graph.", inspect, object_schema({"kind": {"type": "string", "enum": ["STATUS", "UNREVIEWED_SOURCE_NODES", "CLAIMS", "RELATIONS", "UNACCOUNTED_CLAIMS", "REQUIREMENTS"]}, "source_node_id": TEXT, "claim_id": TEXT, "offset": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}})),
        ("validate_semantic_claim_inventory", "Validate discovery and source/reference review WITHOUT requiring Requirements. Fix grouped gaps before finalization.", lambda: ledger.validate_inventory(False), object_schema({})),
        ("finalize_semantic_claim_inventory", "Explicitly finalize discovery and persist an immutable inventory revision. Requirements are not required at this phase.", lambda: ledger.validate_inventory(True), object_schema({})),
        ("start_rule_authoring", "Transition the same Agent from frozen inventory ready to Rule authoring against that revision.", ledger.begin_authoring, object_schema({})),
        ("reopen_semantic_claim_inventory", "Explicitly reopen discovery for a reason, increment revision, remap claim identities and invalidate ALL downstream candidates. Previous frozen revision stays immutable.", ledger.reopen, object_schema({"reason": TEXT}, ["reason"])),
        ("author_legal_requirement", "Bind selected frozen claim IDs to exact Requirement roles. Canonical actor/action/text/provenance and coverage-state shape are assembled from those claims. A non-assessable reason means external/non-repository performance, not a substitute software duty.", requirement, object_schema({"requirement_key": {**TEXT, "maxLength": 128}, "title": TEXT, "operative_claim_ids": IDS, "applicability_claim_ids": IDS, "qualifier_claim_ids": IDS, "exception_claim_ids": IDS, "context_claim_ids": IDS, "non_repository_duty": {"type": "boolean"}, "non_assessable_reason": TEXT}, ["requirement_key", "title", "operative_claim_ids", "applicability_claim_ids"])),
        ("remove_rule_candidate", "Remove a mistaken downstream candidate, recording why. Removing a Requirement invalidates its dependent AssessmentRule candidates; frozen claims stay unchanged.", remove_candidate, object_schema({"kind": {"type": "string", "enum": ["LEGAL_REQUIREMENT", "ASSESSMENT_RULE"]}, "candidate_id": TEXT, "reason": TEXT}, ["kind", "candidate_id", "reason"])),
        ("author_assessment_rule", "Choose assessable Requirement parents. API derives normative criteria, applicability and evidence from those parents; optional investigation focus cannot create a legal obligation.", assessment, object_schema({"assessment_rule_id": {**TEXT, "maxLength": 128}, "concept": TEXT, "legal_requirement_ids": {**IDS, "minItems": 1}, "investigation_focus": TEXT}, ["assessment_rule_id", "concept", "legal_requirement_ids"])),
    ]
    if ledger.frontier:
        specs = [spec for spec in specs if spec[0] != "review_source_node"]
        specs[0][3]["required"].remove("source_node_ids")
        specs[0][3]["description"] = "Source anchors default to the active review unit. Add ancestor/reference context only when it supplies claim provenance."
        specs += [
          ("get_next_review_unit","Get the next runtime-scheduled bounded source unit. Repeated calls return your leased unit until you complete or block it. No global node bookkeeping is required.",ledger.frontier.next,object_schema({})),
          ("get_review_progress","Get compact persisted queue progress and the exact next action. Queue empty with zero blocked units makes discovery eligible to freeze.",ledger.frontier.progress,object_schema({})),
          ("complete_source_review","Give the active unit a semantic disposition. Runtime collects ALL canonical claims authored here by default. Explicit claim_ids must include every authored claim. No-claim needs a reason; blocking needs reference_ids. This never completes children/siblings.",ledger.frontier.complete,object_schema({"disposition":{"type":"string","enum":["CLAIMS_AUTHORED","NO_RELEVANT_SEMANTIC_CLAIMS","CONTEXT_ONLY","REQUIRES_REFERENCE_RESOLUTION"]},"claim_ids":IDS,"reason":{**TEXT,"maxLength":2000},"reference_ids":IDS},["disposition"])),
          ("expand_review_frontier","Explicitly include a structurally referenced target in scope, recording why. Existing target work is reused. Never silently expand the frontier.",ledger.frontier.expand,object_schema({"reference_ids":{**IDS,"minItems":1},"reason":{**TEXT,"maxLength":2000}},["reference_ids","reason"])),
          ("reopen_source_review","Explicitly reopen a completed/blocked unit to correct its semantics. The runtime will schedule it; other units remain unchanged.",ledger.frontier.reopen,object_schema({"source_node_id":TEXT,"reason":{**TEXT,"maxLength":2000}},["source_node_id","reason"])),
        ]
    if context.discovery_only:
        specs=[spec for spec in specs if spec[0] not in {"start_rule_authoring","author_legal_requirement","author_assessment_rule","remove_rule_candidate","reopen_semantic_claim_inventory"}]
    tools = []
    for name, description, function, schema in specs:
        def invoke(_function=function, _schema=schema, _name=name, **kwargs):
            with context.mutation_lock:
                errors = list(Draft7Validator(_schema).iter_errors(kwargs))
                if errors:
                    return json.dumps(ledger.rejected("CLAIM_SCHEMA_INVALID", _name, "; ".join(e.message[:160] for e in errors[:3])))
                try:
                    result = _function(**kwargs)
                    if result.get("outcome") == "PASSED":
                        ledger.progress(_name)
                    return json.dumps(result, ensure_ascii=False)
                except (KeyError, TypeError, ValueError) as error:
                    return json.dumps(ledger.rejected("CLAIM_SCHEMA_INVALID", _name, str(error)[:200]))
        tools.append(StructuredTool.from_function(invoke, name=name, description=description, args_schema=schema))
    return tools
