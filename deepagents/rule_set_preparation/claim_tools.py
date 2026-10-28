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
from rule_set_preparation.authoring_state import normalize_page
from rule_set_preparation.authoring_rejections import (
    CURRENT_TOOL_CALL_ID, REPAIR, SOURCE_BODY, SOURCE_PREFLIGHT, TOOL_SCHEMA, classify_schema_error, draft_fingerprint, field_paths_of,
)
from rule_set_preparation.authoring_state import summary as claim_summary
from rule_set_preparation.semantic_closure import aggregate_closure, operative, claim_role


ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]*$"  # the same rule the Rule Set packet applies to every id


BUCKET_ARGS = {"OPERATIVE_PROPOSITION": "operative_claim_ids", "APPLICABILITY_CONDITION": "applicability_claim_ids", "QUALIFIER": "qualifier_claim_ids",
               "EXCEPTION": "exception_claim_ids", "CONTEXT": "context_claim_ids", "DEFINITION": "context_claim_ids"}
# Schema constraints the tool body enforces itself with a richer rejection (candidates, repair) than the generic pre-body check.
BODY_OWNED = {("author_legal_requirement", "operative_claim_ids", "minItems")}
ASSEMBLED_ROW_FIELDS = {"operativePropositions": "OPERATIVE_PROPOSITION", "applicabilityConditions": "APPLICABILITY_CONDITION", "qualifiers": "QUALIFIER",
                        "exceptions": "EXCEPTION", "semanticContext": "CONTEXT"}
CANDIDATE_LIMIT = 8
AUTHORING_MUTATIONS = frozenset({"author_legal_requirement", "author_assessment_rule", "remove_rule_candidate", "reopen_semantic_claim_inventory"})
TEXT = {"type": "string", "minLength": 1, "maxLength": 8000}
OPTIONAL_TEXT = {"anyOf": [{"type": "string", "maxLength": 8000}, {"type": "null"}]}
IDS = {"type": "array", "items": {"type": "string", "minLength": 1}, "maxItems": 128, "uniqueItems": True}


def object_schema(properties, required=()):
    """Business purpose: Declare the accepted argument shape of a governed preparation tool.

    Business rules:
    - Named tool arguments are closed to undeclared properties; required names are copied from the supplied contract.
    Execution flow:
    1. Return the object schema with properties, required names and additionalProperties:false.
    Failure cases:
    - This builder does not validate values; the invocation boundary performs schema validation before mutation.
    Side effects:
    - Pure schema construction; no inventory or tool invocation.
    """
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


def derive_requirement_relations(context):
    """Project the Agent-authored claim relation's existing kind/direction, without interpretation.

    Business purpose: Project agent-authored semantic relationships into the requirements bound to their endpoint claims.

    Business rules:
    - Preserve relation direction and the existing configured kind mapping; do not interpret source prose or create a self-relation within one requirement.
    Execution flow:
    1. Index requirement owners for each claim binding.
    2. Read frozen/current claim relations and connect distinct requirement owners of their endpoints.
    3. Deduplicate canonical relation identities and replace the draft context-relation projection.
    Failure cases:
    - Unowned endpoints contribute no requirement relation; malformed required bindings propagate rather than invent an owner.
    Side effects:
    - Replaces in-memory contextRelations derived from accepted claim bindings; no external persistence here.
    """
    owners: dict[str, set[str]] = {}
    for requirement in context.draft["legalRequirements"].values():
        for binding in requirement["claimBindings"]:
            owners.setdefault(binding["claimId"], set()).add(requirement["legalRequirementId"])
    relations = {}
    for relation in (context.inventory.frozen or context.inventory.graph())["relations"]:
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


def _squash(text):
    """Whitespace-collapsed copy of text plus, for every collapsed character, its index in the original.

    Business purpose: Locate source quotes despite whitespace variation while preserving original text coordinates.

    Business rules:
    - Collapse internal whitespace to one space and retain the original index for every emitted character.
    Execution flow:
    1. Walk the text and collect visible characters or the first separator in each whitespace run.
    2. Return the collapsed text and its source-index map.
    Failure cases:
    - Empty input returns empty outputs; invalid non-text values propagate iteration/type failures.
    Side effects:
    - Pure text/index transformation; no source content changes.
    """
    out, index, space = [], [], False
    for i, ch in enumerate(text):
        if ch.isspace():
            if out and not space:
                out.append(" ")
                index.append(i)
            space = True
        else:
            out.append(ch)
            index.append(i)
            space = False
    return "".join(out), index


def support_span(source, node_id, quote):
    """Resolve one unique verbatim quote to UTF-16 offsets; shared by both discovery flows.

    A quote that differs from the source only in whitespace/line breaks still resolves to the exact original slice,
    so the stored span, hash and text are always the source's own bytes.

    Business purpose: Resolve a unique source quotation into exact hashed UTF-16 support coordinates.

    Business rules:
    - Accept verbatim text or whitespace-only variation, but require one unique occurrence in the selected pinned node.
    - Store the original source slice and hash, never the normalized search copy.
    Execution flow:
    1. Validate the quote and locate an exact or whitespace-normalized unique match.
    2. Recover the original slice and convert its boundaries to UTF-16 offsets.
    3. Return node identity, offsets and exact source-text hash.
    Failure cases:
    - Empty, absent or repeated quotes raise ValueError with correction guidance; no paraphrase or arbitrary match is accepted.
    Side effects:
    - Read-only source validation and hashing; no claim is registered.
    """
    from rule_set_preparation.claim_inventory import text_sha
    node = source.nodes.get(node_id)
    content = node["content"] if node else ""
    if not isinstance(quote, str) or not quote.strip():
        raise ValueError("The quote is empty; copy a short verbatim passage from the locator")
    start = content.find(quote)
    if start >= 0:
        if content.find(quote, start + 1) >= 0:
            raise ValueError("The quote appears more than once in this locator; extend it with neighbouring words until it is unique")
        end = start + len(quote)
    else:
        squashed, index = _squash(content)
        needle = _squash(quote.strip())[0]
        at = squashed.find(needle)
        if at < 0:
            raise ValueError("The quote is not a verbatim passage of this locator; copy it exactly from the source file (no paraphrase)")
        if squashed.find(needle, at + 1) >= 0:
            raise ValueError("The quote appears more than once in this locator; extend it with neighbouring words until it is unique")
        start, end = index[at], index[at + len(needle) - 1] + 1
    quote = content[start:end]
    offset = len(content[:start].encode("utf-16-le")) // 2
    return {"nodeId": node_id, "startOffset": offset, "endOffset": offset + len(quote.encode("utf-16-le")) // 2, "contentSha256": text_sha(quote)}


def locate_quote(source, node_ids, quote):
    """The one node among node_ids whose text carries the quote exactly once (whitespace-tolerant), else None.

    Business purpose: Find the single supplied legal node that uniquely supports a quotation.

    Business rules:
    - A candidate counts only when support_span verifies a unique verbatim/whitespace-tolerant occurrence; cross-node ambiguity remains unresolved.
    Execution flow:
    1. Try source-span resolution for each candidate node.
    2. Return its identity only when exactly one candidate succeeds.
    Failure cases:
    - No match, multiple matching nodes or per-node quote errors yield None rather than a guessed source node.
    Side effects:
    - Read-only source lookup; no support span or claim is persisted.
    """
    hits = []
    for nid in node_ids:
        try:
            support_span(source, nid, quote)
        except ValueError:
            continue
        hits.append(nid)
    return hits[0] if len(hits) == 1 else None


def build_claim_tools(context, operations=None):
    """Business purpose: Bind typed preparation operations to one pinned inventory and its derived rule candidates.

    Business rules:
    - Source meaning remains agent-authored; deterministic code enforces identity, source bindings, phase and durable mutation contracts.
    - Discovery-only mode omits authoring/conclusion tools; explicit tool descriptions and schema-owned versus body-owned rejections remain distinct.
    Execution flow:
    1. Bind discovery, reference, closure and authoring operations to the current ledger.
    2. Select tools for the active mode and expose optional internal discovery operations.
    3. Wrap schema validation, mutation locking, durable saves and observations around every tool invocation.
    Failure cases:
    - Malformed arguments return field-addressed rejection feedback; terminal runtime/callback failures propagate instead of becoming claim-shape errors.
    Side effects:
    - Constructs tools; invocations may mutate discovery/authoring state, call the API and emit durable observations under their documented guards.
    """
    ledger: ClaimInventory = context.inventory

    def legal_state(node_id, at_date, offset=0, limit=20):
        """Business purpose: Retrieve dated legal-effect context for an exact pinned provision.

        Business rules:
        - A document#locator is resolved structurally when possible; the legal-effect service retains unresolved targets and dated evidence.
        Execution flow:
        1. Resolve a supplied document/locator to a pinned node when available.
        2. Delegate dated legal-state retrieval with requested pagination.
        Failure cases:
        - Unresolved addresses remain subject to legal-state validation; unknown dates or incomplete review never establish applicability.
        Side effects:
        - Reads pinned legal-effect context through the shared service; does not author legal effects here.
        """
        from rule_set_preparation.legal_effect import applicable_legal_state
        if "#" in node_id:
            document, locator = node_id.rsplit("#", 1)
            node_id = context.source_graph.resolve_locator(document, locator) or node_id
        return applicable_legal_state(context, node_id, at_date, offset, limit)

    def source_refs(claim):
        # Canonical provenance is the claim/node binding; retain exact legacy citation aids when available.
        """Business purpose: Retain canonical chunk citation aids supporting a claim's pinned source anchors.

        Business rules:
        - Claim/node binding remains provenance authority; use the nearest ancestor carrying chunk mappings and deduplicate exact document/locator/hash tuples.
        Execution flow:
        1. Walk each claim anchor toward a chunk-bearing owner with cycle protection.
        2. Collect and deduplicate its mapped chunk source references.
        Failure cases:
        - An anchor without mapped chunks contributes no citation aid; malformed node/chunk identities propagate rather than fabricate references.
        Side effects:
        - Read-only source projection; no claim identity or source text changes.
        """
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

    def register(identity_key, claim_type, statement, source_node_ids=None, actor=None, action=None, relevant=True, non_operative_reason=None, source_support=None, semantic_authority=None, semantic_frame=None, assessability=None):
        """Business purpose: Register an agent-authored semantic claim through the inventory's shared source/identity guards.

        Business rules:
        - Omitted source nodes default only to the active frontier unit; normalize empty optional actor/action/exclusion strings to absent values.
        Execution flow:
        1. Resolve the active source-node default and normalize optional text.
        2. Delegate complete claim registration and support validation to the ledger.
        Failure cases:
        - Frozen phase, unsupported source or invalid claim/support returns the ledger's repairable rejection; missing active anchors are not invented.
        Side effects:
        - May mutate in-memory claim/ownership indexes and publish rejection feedback through put_claim.
        """
        if source_node_ids is None:
            source_node_ids = [ledger.frontier.active["sourceNodeId"]] if ledger.frontier and ledger.frontier.active else []
        if actor == "": actor = None
        if action == "": action = None
        if non_operative_reason == "": non_operative_reason = None
        return ledger.put_claim(identity_key, source_node_ids, claim_type, statement, actor, action, relevant, non_operative_reason, source_support=source_support, semantic_authority=semantic_authority, semantic_frame=semantic_frame, assessability=assessability)


    def update(claim_id, claim_type, statement, actor=None, action=None, relevant=True, non_operative_reason=None, source_support=None, semantic_authority=None, semantic_frame=None, assessability=None, identity_key=None):
        """Business purpose: Correct an existing active claim without changing its canonical key or source anchors.

        Business rules:
        - Use the ledger's existing identity and claim anchors, regardless of an optional supplied identity_key; foreign completed-unit claims require their owner to reopen.
        Execution flow:
        1. Normalize optional empty fields and locate the active claim.
        2. Return ownership/schema feedback when absent or delegate an identity-preserving update.
        Failure cases:
        - An unknown/foreign claim or invalid replacement is rejected; no new canonical identity is silently substituted.
        Side effects:
        - May replace the current claim and invalidate derived validation through the shared ledger.
        """
        if actor == "": actor = None
        if action == "": action = None
        if non_operative_reason == "": non_operative_reason = None
        claim = context.draft["semanticClaims"].get(claim_id)
        if claim is None:
            # A completed unit's claim is not in the active draft; an id never issued by this run is not a claim at all.
            return ledger.foreign_claim(claim_id) or ledger.rejected("CLAIM_SCHEMA_INVALID", "claim_id", "No claim with this id is in the active review unit",
                requiredAction="commit_claims", guidance="commit_claims changes a claim you registered for the active unit; copy its claimId from the "
                "commit_claims result or get_claim_inventory, and call commit_claims to author a new one.")
        return ledger.put_claim(ledger.identities[claim_id], claim["sourceNodeIds"], claim_type, statement,
                                actor, action, relevant, non_operative_reason, update_id=claim_id, source_support=source_support, semantic_authority=semantic_authority, semantic_frame=semantic_frame, assessability=assessability)

    def link(from_claim_id, to_claim_id, kind, reference_id=None):
        """Business purpose: Bind a directed semantic claim relation to verified source and target authority.

        Business rules:
        - Discovery must be open; endpoints must be distinct known claims and the relation kind supported.
        - Active review ownership and structural-reference direction must validate; cross-review endpoints require matching durable fingerprints.
        Execution flow:
        1. Validate phase, endpoints, reference binding and active ownership.
        2. Resolve foreign endpoint authority and collect dependency fingerprints.
        3. Store the canonical relation, ownership/dependencies and projected reference accounting.
        Failure cases:
        - Detached bindings, unavailable/changed targets, unsupported kinds or foreign reference ownership return typed rejection without accepting the relation.
        Side effects:
        - May read frontier authority through the API, mutate relation/dependency/accounting state and record rejection observations.
        """
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
            batch_ids = {u["sourceNodeId"] for u in ledger.frontier.active_batch}
            local = [cid for cid in foreign if ledger.frontier.claim_owners.get(cid) in batch_ids]
            dependencies.update({cid: endpoint_fingerprint(context.draft["semanticClaims"][cid]) for cid in local})
            foreign = [cid for cid in foreign if cid not in local]
            if foreign:
                authority = ledger.frontier.request("PROGRESS", claimIds=foreign, sourceRevision=context.source_graph.graph["materializationId"])
                if authority.get("outcome") != "PASSED": return ledger.frontier.failure(authority)
                endpoints = {e["claim"]["claimId"]: e for e in authority["endpoints"]}
                for cid in foreign:
                    if cid not in endpoints:
                        return {**ledger.rejected("TARGET_CLAIMS_NOT_AVAILABLE", cid, "A cross-review endpoint must be a valid committed canonical claim; uncommitted drafts are unavailable"),
                                "targetClaimAvailability": "NOT_AVAILABLE", "requiredAction": "commit_claims"}
                    if endpoint_fingerprint(context.draft["semanticClaims"][cid]) != endpoints[cid]["fingerprint"]:
                        return {**ledger.rejected("SEMANTIC_ENDPOINT_CHANGED", cid, "Inspect the changed durable target and reconsider the semantic binding"),
                                "requiredAction": "commit_claims"}
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
        """Business purpose: Explain a detached semantic reference using actual structural endpoints and candidate claims.

        Business rules:
        - Keep the original reference direction and provide bounded source/target claim candidates; do not choose a semantic relation for the agent.
        Execution flow:
        1. Read the pinned reference and current endpoint-side claims.
        2. Record SEMANTIC_DEPENDENCY_DETACHED and return endpoint IDs with a commit_claims repair path.
        Failure cases:
        - Missing reference metadata stays absent in feedback; no replacement endpoint or binding is accepted.
        Side effects:
        - Records/publishes rejection feedback; does not mutate semantic relations.
        """
        ref = context.source_graph.references.get(reference_id, {})
        claims = context.draft["semanticClaims"]
        return {**ledger.rejected("SEMANTIC_DEPENDENCY_DETACHED", reference_id,
                    "Bind distinct claims anchored under the structural source and resolved target, in that direction"),
                "code": "SEMANTIC_DEPENDENCY_DETACHED",
                "referenceId": reference_id, "fromNodeId": ref.get("fromNodeId"), "sourceNodeId": ref.get("fromNodeId"),
                "targetNodeId": ref.get("toNodeId"), "suppliedFromClaimId": from_claim_id, "suppliedToClaimId": to_claim_id,
                "sourceClaimIds": [c["claimId"] for c in side_claims(context.source_graph, claims, ref.get("fromNodeId"))][:20],
                "targetClaimIds": [c["claimId"] for c in side_claims(context.source_graph, claims, ref.get("toNodeId"))][:20],
                "requiredAction": "commit_claims"}


    def remove(claim_id, reason):
        """Business purpose: Remove a mistaken discovery claim and invalidate its directly owned supporting state.

        Business rules:
        - Require open discovery, a nonblank reason and active frontier ownership when present; frozen claims cannot be removed implicitly.
        Execution flow:
        1. Validate mutation eligibility and remove the claim/identity.
        2. Invalidate source review indexes and remove incident relations owned by this unit.
        3. Reproject reference accounting and return the affected identities.
        Failure cases:
        - Ineligible phase/ownership returns rejection; a nonexistent active claim propagates lookup failure to the tool's schema-error boundary.
        Side effects:
        - Mutates claim identities, review indexes, owned relations and reference accounting; records rejection observations when refused.
        """
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
        """Business purpose: Remove a mistaken owned semantic relation before inventory freeze.

        Business rules:
        - Require open discovery, a nonblank reason and the active source unit's relation ownership; invalidated owned relations may also be removed.
        Execution flow:
        1. Validate phase/reason/ownership.
        2. Remove the current or invalidated relation and its owner.
        3. Invalidate validation and refresh reference accounting.
        Failure cases:
        - Missing relations return CLAIM_SCHEMA_INVALID; frozen/foreign relations return typed repair feedback without removal.
        Side effects:
        - Mutates relation/ownership/accounting state and may publish rejection observations.
        """
        if not ledger.discovery_allowed() or not reason.strip():
            return ledger.rejected("CLAIM_INVENTORY_FROZEN", relation_id, "Correct relations only before freeze, with a reason")
        if ledger.frontier and (not ledger.frontier.active or ledger.frontier.relation_owners.get(relation_id)!=ledger.frontier.active["sourceNodeId"]):
            return {**ledger.rejected("CLAIM_SOURCE_BINDING_INVALID",relation_id,"Reopen the owning review unit before changing its relation"),"requiredAction":"commit_claims","sourceNodeId":ledger.frontier.relation_owners.get(relation_id),
                    "guidance": "Correct the relation in its owning claim file"}
        old = context.draft["claimRelations"].pop(relation_id, None)
        if ledger.frontier: old = old or ledger.frontier.invalidated_relations.pop(relation_id, None)
        if old is None: return ledger.rejected("CLAIM_SCHEMA_INVALID", relation_id, "Inspect the existing relation before removing it")
        ledger.changed(old, None)
        if ledger.frontier: ledger.frontier.relation_owners.pop(relation_id, None)
        project_reference_accounting(context)
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, "removedRelationId": relation_id, "reason": reason}


    def review_reference(reference_id, material, relation_ids=None, non_material_reason=None):
        """Business purpose: Account for an explicit source reference without losing its bound semantic relations.

        Business rules:
        - Require open discovery and active-unit reference ownership.
        - Material references derive relation IDs from existing valid bindings; nonmaterial references require a reason and no remaining bindings.
        Execution flow:
        1. Validate source reference, materiality consistency and every existing binding.
        2. Store canonical reference accounting and invalidate prior validation when changed.
        Failure cases:
        - Frozen/foreign references, missing reasons or conflicting/detached bindings return typed rejection rather than mark the reference complete.
        Side effects:
        - Mutates in-memory referenceAccounting and validation/progress state; may record rejection evidence.
        """
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
        """Business purpose: Record the agent's reason that an active source reference is nonmaterial.

        Business rules:
        - Use the same ownership, phase and no-existing-bindings checks as full reference accounting.
        Execution flow:
        1. Delegate reference review with material:false and the supplied reason.
        Failure cases:
        - Missing reason, bound relations or invalid review ownership returns the shared rejection; no reference is silently discarded.
        Side effects:
        - May update reference accounting and publish rejection feedback through review_reference.
        """
        return review_reference(reference_id, False, non_material_reason=reason)

    def inspect(kind="STATUS", source_node_id=None, claim_id=None, offset=0, limit=None):
        """Business purpose: Page through current preparation inventory without treating navigation as semantic authority.

        Business rules:
        - Respect frontier recovery/progress and normalized page limits; retain explicit continuation and a bounded response body.
        Execution flow:
        1. Restore frontier state when needed and select the requested claims, relations, requirements or review gaps.
        2. Apply count/character bounds and compute current review counts.
        3. Return copied rows with truthful pagination and inventory binding.
        Failure cases:
        - Frontier restore failures return its repair feedback; an empty or truncated page never proves semantic absence or completed review.
        Side effects:
        - May refresh local frontier state through its API read; returns inventory/navigation metadata without authoring claims.
        """
        if ledger.frontier and kind in {"STATUS","UNREVIEWED_SOURCE_NODES"}:
            return ledger.frontier.progress()
        if ledger.frontier:
            restored = ledger.frontier.restore()
            if restored: return ledger.frontier.failure(restored)
        # A harmless oversized, missing or non-positive page size is normalized and reported, never rejected.
        applied, offset = normalize_page(limit, offset)
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
            rows = [{"claim": c, "accountingRole": claim_role(c), "identityKey": ledger.identities[c["claimId"]], "claimFingerprint": fingerprint(c)} for c in candidates
                    if (not claim_id or c["claimId"] == claim_id) and (not source_node_id or source_node_id in c["sourceNodeIds"])
                    and (kind != "UNACCOUNTED_CLAIMS" or (c["state"] == "RELEVANT" and c["claimId"] not in bound))] if kind != "STATUS" else []
        selected, chars = [], 0
        for row in rows[offset:offset + applied]:
            size = len(json.dumps(row, ensure_ascii=False))
            if chars + size > 24000:
                break
            selected.append(row); chars += size
        more = offset + len(selected) < len(rows)
        reviewed_count = len(reviewed)
        remaining_count = sum(n["nodeId"] not in reviewed for n in required)
        if ledger.frontier:
            progress = ledger.frontier.snapshot["progress"]
            reviewed_count = progress["reviewedWithClaims"] + progress["reviewedNoClaims"]
            remaining_count = progress["total"] - reviewed_count
        return {"phase": ledger.phase, "inventoryRevision": ledger.revision, "inventoryFingerprint": ledger.frozen_fingerprint,
                "sourceNodesReviewed": reviewed_count, "sourceNodesRemaining": remaining_count,
                "claimCount": len(ledger.identities), "relationCount": len(context.draft["claimRelations"]),
                "total": len(rows), "items": deepcopy(selected), "requestedLimit": limit, "appliedLimit": applied, "offset": offset,
                "returnedCount": len(selected), "hasMore": more, "nextOffset": offset + len(selected) if more else None, "endReached": not more}

    def authoring_context(offset=0, limit=None, operative_claim_ids=None):
        """Business purpose: Guide rule authoring from verified operative anchors instead of an unrelated global claim-role pool.

        Business rules:
        - Require active frozen authoring context; explicit operative selections retrieve their semantic closure, otherwise page operative anchors only.
        Execution flow:
        1. Check authoring eligibility.
        2. Return selected closure reads or the operative-anchor page with the next closure action.
        Failure cases:
        - Unfinalized/inactive authoring returns CLAIM_PHASE_INVALID; invalid selected anchors retain closure rejection feedback.
        Side effects:
        - Reads frozen authoring context and may record a rejection; does not create a requirement.
        """
        if context.authoring is None or not context.authoring.active():
            return ledger.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Finalize the claim inventory first; this view reads the frozen revision")
        if operative_claim_ids:
            return closure_reads(operative_claim_ids)
        result = context.authoring.page_view("OPERATIVE_PROPOSITION", offset, limit)
        result["requiredAction"] = "get_semantic_closure"
        result["guidance"] = "Choose a verified operative anchor, then retrieve its semantic closure. Global inventory search is diagnostic navigation only."
        return result

    def closure_view(operative_claim_ids):
        """Business purpose: Expose the verified typed closure that may legally support selected operative anchors.

        Business rules:
        - Require frozen relevant operative claims and compatible aggregation; only reachable bindings can support the resulting requirement.
        - Preserve other operative reference targets as context/navigation without transferring their modifiers implicitly.
        Execution flow:
        1. Validate each supplied anchor and provide real candidates for an invalid one.
        2. Compute the verified aggregate closure.
        3. Return its claims, dependencies and role-specific authoring arguments.
        Failure cases:
        - Missing/nonoperative anchors or incompatible/invalid closure return typed repairable rejection; no global role-compatible claim substitutes for a supported target.
        Side effects:
        - Read-only closure projection apart from rejection observations; no claim or candidate mutation.
        """
        if not ledger.frozen:
            return ledger.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Freeze the verified inventory first")
        known = {c["claimId"]: c for c in ledger.frozen["claims"]}
        for position, cid in enumerate(operative_claim_ids):
            if not operative(known.get(cid)):  # name the id at fault and the real anchors instead of a bare closure error
                candidates, total = role_candidates("OPERATIVE_PROPOSITION")
                unknown = cid not in known
                return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", cid, "Unknown claim ID; copy an exact ID from get_rule_authoring_context" if unknown else
                                       f"{known[cid]['claimType']} claim is not a relevant operative anchor (DUTY, PROHIBITION or PERMISSION)", suppliedField="operative_claim_ids",
                                       fieldPaths=[f"operative_claim_ids[{position}]"], suppliedClaimId=cid, candidates=candidates, candidateCount=total,
                                       repairKey="UNKNOWN_CLAIM" if unknown else "OPERATIVE_REQUIRED", requiredAction="get_rule_authoring_context")
        try:
            closure = aggregate_closure(ledger.frozen, operative_claim_ids)
        except ValueError as error:
            return ledger.rejected("SEMANTIC_CLOSURE_INVALID", "operative_claim_ids", str(error), requiredAction="get_rule_authoring_context",
                                   **({"repairKey": "INCOMPATIBLE_AGGREGATION"} if str(error) == "INCOMPATIBLE_OPERATIVE_AGGREGATION" else {}))
        by_id = {c["claimId"]: c for c in ledger.frozen["claims"]}
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, **closure,
                "claims": [{**row, "claim": deepcopy(by_id[row["claimId"]])} for row in closure["claims"]],
                "referenceDependencies": [{**r, "targetAssertion": deepcopy(by_id[r["toClaimId"]])} for r in closure["referenceDependencies"]],
                "authoringArguments": {arg: [r["claimId"] for r in closure["claims"] if BUCKET_ARGS[r["role"]] == arg] for arg in sorted(set(BUCKET_ARGS.values()))},
                "guidance": "Author from these operative anchors. All reachable semantic bindings are retained automatically; unrelated global role-compatible claims are refused. referenceDependencies retain other operative assertions as navigation/context; their modifiers cannot bind this anchor without an explicit compatible target relation."}

    def closure_reads(operative_claim_ids):
        """The read tools: anchors that cannot share one Requirement are answered anchor by anchor instead of with a rejection.

        Business purpose: Keep closure inspection usable when several operative anchors cannot share one requirement.

        Business rules:
        - Only incompatible aggregation may fall back to separate successful anchor closures; authoring compatibility is never silently approved.
        Execution flow:
        1. Try the aggregate closure when multiple frozen anchors are supplied.
        2. For the specific incompatibility case, return separate valid authoring arguments.
        3. Otherwise use the normal closure view.
        Failure cases:
        - Individual invalid anchors retain rejection feedback; a fallback succeeds only if every separate closure is valid.
        Side effects:
        - Read-only closure retrieval with possible rejection observations; no authoring mutation.
        """
        if len(operative_claim_ids) > 1 and ledger.frozen:
            try:
                aggregate_closure(ledger.frozen, operative_claim_ids)
            except ValueError as error:
                if str(error) == "INCOMPATIBLE_OPERATIVE_AGGREGATION":
                    singles = [closure_view([cid]) for cid in operative_claim_ids]
                    if all(view.get("outcome") == "PASSED" for view in singles):
                        return {"outcome": "PASSED", "aggregation": "INCOMPATIBLE", "guidance": REPAIR["INCOMPATIBLE_AGGREGATION"],
                                "closures": [{"operativeClaimId": cid, "authoringArguments": view["authoringArguments"]} for cid, view in zip(operative_claim_ids, singles)]}
        return closure_view(operative_claim_ids)

    def role_candidates(role, allowed=None):
        """Real, relevant claims of one accounting role, unbound first: navigation help from the frozen inventory, never legal meaning.

        Business purpose: Offer real relevant claim candidates for correcting an authoring role mismatch.

        Business rules:
        - Use frozen/draft claim identity and verified accounting roles; nonoperative roles require an allowed closure set.
        - Prefer unbound claims and return at most the configured candidate limit while retaining the full candidate count.
        Execution flow:
        1. Collect eligible relevant claims by role and closure allowance.
        2. Sort unbound-first and return bounded identity/type/summary hints plus total.
        Failure cases:
        - An empty eligible pool remains empty; candidate suggestions do not determine legal meaning or authorize binding.
        Side effects:
        - Read-only candidate projection; no claims or requirements are created.
        """
        bound = context.authoring.bound() if context.authoring is not None else {}
        pool = sorted((c for c in context.draft["semanticClaims"].values() if c["state"] == "RELEVANT" and claim_role(c) == role and (operative(c) if role == "OPERATIVE_PROPOSITION" else allowed is not None and c["claimId"] in allowed)),
                      key=lambda c: (c["claimId"] in bound, c["claimId"]))
        return [{"claimId": c["claimId"], "claimType": c["claimType"], "summary": claim_summary(c)} for c in pool[:CANDIDATE_LIMIT]], len(pool)

    def requirement(requirement_key, title, operative_claim_ids, applicability_claim_ids=None, qualifier_claim_ids=None,
                    exception_claim_ids=None, context_claim_ids=None, non_repository_duty=False, non_assessable_reason=None):
        """Business purpose: Assemble a LegalRequirement from exact frozen operative claims and their verified semantic closure.

        Business rules:
        - Require authoring eligibility, real relevant role-correct claims and no duplicate ownership of an operative anchor across requirements.
        - Retain every reachable modifier and source reference; repository-assessable requirements need source-grounded applicability while external/nonassessable duties stay explicitly external.
        Execution flow:
        1. Enter/recover authoring and derive omitted binding selections from the verified closure.
        2. Validate selected anchors, roles, closure membership and applicability requirements.
        3. Assemble canonical operative/context fields and source provenance, then validate the row schema.
        4. Store the candidate, derive requirement relations, invalidate stale validation and advance draft/phase state.
        Failure cases:
        - Unrecognized, duplicate, nonrelevant, wrong-role or out-of-closure claims and missing operative/applicability anchors return field-addressed repairs; invalid assembled rows are rejected before acceptance.
        Side effects:
        - Mutates the in-memory requirement/context-relation draft and observations; the invocation wrapper durably saves accepted authoring mutations.
        """
        started = ledger.begin_authoring()
        if started.get("outcome") != "PASSED":
            return started
        if applicability_claim_ids is None:  # not stated: bind everything the verified closure of the anchors reaches
            derived = closure_view(operative_claim_ids)
            if derived.get("outcome") != "PASSED":
                return derived
            bound = derived["authoringArguments"]
            applicability_claim_ids = bound.get("applicability_claim_ids", [])
            qualifier_claim_ids = bound.get("qualifier_claim_ids", []) if qualifier_claim_ids is None else qualifier_claim_ids
            exception_claim_ids = bound.get("exception_claim_ids", []) if exception_claim_ids is None else exception_claim_ids
            context_claim_ids = bound.get("context_claim_ids", []) if context_claim_ids is None else context_claim_ids
        duplicates = [(position, cid, key) for position, cid in enumerate(operative_claim_ids)
                      for key, row in context.draft["legalRequirements"].items() if key != requirement_key
                      and any(b["claimId"] == cid and b["role"] == "OPERATIVE_PROPOSITION" for b in row.get("claimBindings", []))]
        if duplicates:  # a restored draft must not turn one duty into two Requirements
            return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", requirement_key,
                                   "; ".join(f"Operative claim {cid} already belongs to Requirement {owner!r}" for _, cid, owner in duplicates[:20]),
                                   suppliedField="operative_claim_ids", fieldPaths=[f"operative_claim_ids[{position}]" for position, _, _ in duplicates[:20]],
                                   candidates=[{"claimId": cid, "legalRequirementId": owner} for _, cid, owner in duplicates[:20]], candidateCount=len(duplicates),
                                   repairKey="DUPLICATE_REQUIREMENT", requiredAction="get_rule_authoring_status")
        selections = {"OPERATIVE_PROPOSITION": operative_claim_ids, "APPLICABILITY_CONDITION": applicability_claim_ids or [],
                      "QUALIFIER": qualifier_claim_ids or [], "EXCEPTION": exception_claim_ids or [], "CONTEXT": context_claim_ids or []}
        claims = context.draft["semanticClaims"]
        closure_roles = {}
        if operative_claim_ids and all(operative(claims.get(cid)) for cid in operative_claim_ids):
            try:
                closure = aggregate_closure(ledger.frozen, operative_claim_ids)
            except ValueError as error:
                return ledger.rejected("SEMANTIC_CLOSURE_INVALID", requirement_key, str(error), requiredAction="get_semantic_closure")
            closure_roles = {r["claimId"]: r["role"] for r in closure["claims"]}
        for role, ids in selections.items():
            arg = BUCKET_ARGS[role]
            for position, cid in enumerate(ids):
                claim = claims.get(cid)
                fields = {"suppliedField": arg, "fieldPaths": [f"{arg}[{position}]"], "suppliedClaimId": cid}
                if claim is None:
                    candidates, total = role_candidates(role, closure_roles)
                    return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", cid, "Unknown claim ID; copy an exact ID from the verified closure", **fields,
                                           expectedRole=role, expectedField=arg, candidates=candidates, candidateCount=total, requiredAction="get_semantic_closure", repairKey="UNKNOWN_CLAIM")
                actual = closure_roles.get(cid, claim_role(claim))
                if claim["state"] != "RELEVANT":
                    return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", cid, "An intentionally non-operative claim cannot be bound to a Requirement", **fields,
                                           actualRole=actual, requiredAction="get_semantic_closure", repairKey="NON_RELEVANT_CLAIM")
                if actual != role and not (role == "CONTEXT" and actual == "DEFINITION"):
                    return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", cid, "Selected claim has a different accounting role", **fields,
                                           actualRole=actual, expectedRole=actual, expectedField=BUCKET_ARGS[actual], requiredAction="author_legal_requirement", repairKey="ROLE_MISMATCH")
                if closure_roles and cid not in closure_roles:
                    candidates, total = role_candidates(role, closure_roles)
                    return ledger.rejected("SEMANTIC_CLOSURE_INVALID", cid, "BINDING_OUTSIDE_SEMANTIC_CLOSURE", **fields,
                                           candidates=candidates, candidateCount=total, requiredAction="get_semantic_closure")
        if closure_roles:
            external = any(claims[cid]["assessability"] in {"EXTERNAL_FULFILLMENT", "NON_ASSESSABLE"} for cid in operative_claim_ids)
            if not applicability_claim_ids and not non_assessable_reason and not external:
                candidates, total = role_candidates("APPLICABILITY_CONDITION", closure_roles)
                return ledger.rejected("APPLICABILITY_SCOPE_MISSING", requirement_key, "Copy the applicability claims from the selected semantic closure", suppliedField="applicability_claim_ids",
                                       fieldPaths=["applicability_claim_ids"], candidates=candidates, candidateCount=total, expectedRole="APPLICABILITY_CONDITION", expectedField="applicability_claim_ids",
                                       repairKey="APPLICABILITY_REQUIRED", requiredAction="author_legal_requirement" if candidates else "reopen_semantic_claim_inventory")
            selections = {role: [cid for cid, actual in closure_roles.items() if actual == role or role == "CONTEXT" and actual == "DEFINITION"] for role in selections}
            applicability_claim_ids = selections["APPLICABILITY_CONDITION"]
            if any(claims[cid]["assessability"] in {"EXTERNAL_FULFILLMENT", "NON_ASSESSABLE"} for cid in operative_claim_ids):
                non_repository_duty = True
                non_assessable_reason = non_assessable_reason or "Verified semantic assessability requires fulfillment or evidence outside the repository; repository inspection cannot establish performance."
        row = {"legalRequirementId": requirement_key, "claimInventoryRevision": ledger.revision, "title": title,
               "proposition": "", "operativePropositions": [], "applicabilityConditions": [], "qualifiers": [], "exceptions": [],
               "semanticContext": [], "claimBindings": [], "sourceRefs": [], "nonRepositoryDuty": non_repository_duty,
               "coverage": {"state": "NON_ASSESSABLE" if non_assessable_reason else "COVERED_BY_ASSESSMENT_RULES", "nonAssessableReason": non_assessable_reason}}
        statements = []
        provenance = {}
        for role, ids in selections.items():
            for position, cid in enumerate(ids):
                arg = BUCKET_ARGS[role]
                path = f"{arg}[{position}]"
                claim = claims.get(cid)
                if claim is None:
                    candidates, total = role_candidates(role, closure_roles)
                    return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", cid, "Unknown claim ID; copy exact IDs from get_rule_authoring_context or get_claim_inventory",
                                           suppliedField=arg, fieldPaths=[path], suppliedClaimId=cid, expectedRole=role, expectedField=arg, candidateCount=total,
                                           candidates=candidates, requiredAction="get_claim_inventory", repairKey="UNKNOWN_CLAIM")
                actual_role = closure_roles.get(cid, claim_role(claim))
                if role == "OPERATIVE_PROPOSITION" and not operative(claim):
                    return ledger.rejected("SEMANTIC_CLOSURE_INVALID", cid, "LEGAL_NORMATIVE_ANCHOR_REQUIRED: guidance/context cannot author an operative Requirement", requiredAction="get_rule_authoring_context")
                if claim["state"] != "RELEVANT":
                    return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", cid, "An intentionally non-operative claim cannot be bound to a Requirement", suppliedField=arg,
                                           fieldPaths=[path], suppliedClaimId=cid, actualRole=actual_role, requiredAction="get_claim_inventory", repairKey="NON_RELEVANT_CLAIM")
                if actual_role != role and not (role == "CONTEXT" and actual_role == "DEFINITION"):
                    _, same_role = role_candidates(actual_role, closure_roles)
                    return ledger.rejected("CLAIM_REQUIREMENT_MISMATCH", cid, f"A {claim['claimType']} claim has accounting role {actual_role}, not {role}; role follows the verified semantic closure and authority",
                                           suppliedField=arg, fieldPaths=[path], suppliedClaimId=cid, actualRole=actual_role, expectedRole=actual_role, expectedField=BUCKET_ARGS[actual_role],
                                           candidateCount=same_role, requiredAction="author_legal_requirement", repairKey="ROLE_MISMATCH")
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
        if not operative_claim_ids:
            candidates, total = role_candidates("OPERATIVE_PROPOSITION")
            return ledger.rejected("OPERATIVE_PROPOSITION_REQUIRED", requirement_key, "Select at least one operative (DUTY, PROHIBITION or PERMISSION) claim", suppliedField="operative_claim_ids",
                                   fieldPaths=["operative_claim_ids"], expectedRole="OPERATIVE_PROPOSITION", expectedField="operative_claim_ids", candidateCount=total, candidates=candidates,
                                   requiredAction="author_legal_requirement", repairKey="OPERATIVE_REQUIRED")
        if not non_assessable_reason and not applicability_claim_ids:
            candidates = [c for cid, c in claims.items() if closure_roles.get(cid) == "APPLICABILITY_CONDITION"]
            summary = [{"claimId": c["claimId"], "claimType": c["claimType"], "statement": c["statement"][:200], "sourceNodeIds": c["sourceNodeIds"][:3]} for c in sorted(candidates, key=lambda c: c["claimId"])[:20]]
            return ledger.rejected("APPLICABILITY_SCOPE_MISSING", requirement_key,
                                   "An assessable Requirement needs applicability claims: choose the SCOPE/CONDITION claims that state its addressee and trigger"
                                   if candidates else "The frozen inventory has no SCOPE or CONDITION claim; reopen_semantic_claim_inventory and register the source-grounded one in its review unit",
                                   suppliedField="applicability_claim_ids", fieldPaths=["applicability_claim_ids"], expectedRole="APPLICABILITY_CONDITION", expectedField="applicability_claim_ids",
                                   candidateCount=len(candidates), candidates=summary, repairKey="APPLICABILITY_REQUIRED",
                                   requiredAction="author_legal_requirement" if candidates else "reopen_semantic_claim_inventory")
        errors = list(Draft7Validator(SCHEMA["properties"]["legalRequirements"]["items"]).iter_errors(row))
        if errors:
            path = list(errors[0].absolute_path)
            # An assembled-row field the model never wrote: say which of its claims produced it.
            role = ASSEMBLED_ROW_FIELDS.get(path[0]) if path else None
            offender = next((b["claimId"] for b in row["claimBindings"] if len(path) > 1 and isinstance(path[1], int) and b["index"] == path[1]
                             and (CLAIM_ROLES.get(claims[b["claimId"]]["claimType"]) == role or (role == "CONTEXT" and b["role"] in {"CONTEXT", "DEFINITION"}))), None)
            return ledger.rejected("CLAIM_SCHEMA_INVALID", requirement_key,
                                   "The assembled Requirement row is invalid at " + (".".join(map(str, path)) or "<row>") + ": " + errors[0].message[:160],
                                   fieldPaths=[BUCKET_ARGS[role]] if role else [], suppliedClaimId=offender, repairKey="ROW_INVALID")
        ledger.changed(context.draft["legalRequirements"].get(requirement_key), row)
        context.draft["legalRequirements"][requirement_key] = row
        context.validated_packet = context.last_validation = None
        derive_requirement_relations(context)
        ledger.draft_changed()
        ledger.transition(AUTHORING)
        return {"outcome": "PASSED", "phase": ledger.phase, "inventoryRevision": ledger.revision, "draftRevision": context.draft_revision, "requirement": deepcopy(row)}

    def assessable_requirements():
        """Business purpose: Select requirement candidates eligible to parent an AssessmentRule.

        Business rules:
        - Only COVERED_BY_ASSESSMENT_RULES coverage qualifies; nonassessable duties remain excluded from repository assessment parents.
        Execution flow:
        1. Filter the current requirement draft by its canonical coverage state.
        Failure cases:
        - An empty eligible set stays empty; missing required coverage metadata propagates instead of assuming assessability.
        Side effects:
        - Pure in-memory selection; no coverage or candidate mutation.
        """
        return {rid: r for rid, r in context.draft["legalRequirements"].items() if r["coverage"]["state"] == "COVERED_BY_ASSESSMENT_RULES"}

    def assessment(assessment_rule_id, concept, legal_requirement_ids, investigation_focus=None):
        """Business purpose: Author an AssessmentRule whose normative authority remains its exact assessable requirement parents.

        Business rules:
        - Require active authoring and at least one existing assessable parent.
        - Criterion identity is deterministic; investigation focus is optional nonnormative guidance and cannot create a legal duty.
        Execution flow:
        1. Validate authoring eligibility and every parent requirement.
        2. Assemble a claim-derived rule with canonical parent source references, criterion identity and required evidence binding.
        3. Validate/store the row, invalidate stale validation and advance draft state.
        Failure cases:
        - Absent, unknown or nonassessable parents return ORPHAN_ASSESSMENT_RULE with actual candidates; malformed assembled rows receive schema rejection.
        Side effects:
        - Mutates the in-memory AssessmentRule draft and observations; the tool wrapper durably saves successful authoring mutations.
        """
        started = ledger.begin_authoring()
        if started.get("outcome") != "PASSED":
            return started
        requirements, assessable = context.draft["legalRequirements"], assessable_requirements()
        bad = next(((i, rid) for i, rid in enumerate(legal_requirement_ids) if rid not in assessable), None)
        if not legal_requirement_ids or bad is not None:
            covered = {rid for rule in context.draft["assessmentRules"].values() for rid in rule["legalRequirementIds"]}
            candidates = [{"legalRequirementId": rid, "title": " ".join(r["title"].split())[:80], "hasAssessmentRule": rid in covered} for rid, r in sorted(assessable.items())[:20]]
            why = ("is a non-assessable Requirement; an AssessmentRule needs an assessable parent" if bad and bad[1] in requirements else
                   "is not an existing Requirement ID") if bad else "legal_requirement_ids must name at least one existing assessable Requirement"
            return ledger.rejected("ORPHAN_ASSESSMENT_RULE", assessment_rule_id, f"{bad[1]!r} {why}" if bad else why,
                                   suppliedField="legal_requirement_ids", fieldPaths=[f"legal_requirement_ids[{bad[0]}]" if bad else "legal_requirement_ids"],
                                   expectedField="legal_requirement_ids", candidateCount=len(assessable), candidates=candidates,
                                   requiredAction="get_rule_authoring_status", repairKey="UNKNOWN_REQUIREMENT")
        criteria = [{"criterionId": "criterion_" + fingerprint({"assessmentRuleId": assessment_rule_id, "legalRequirementIds": sorted(legal_requirement_ids)})[:24], "legalRequirementIds": legal_requirement_ids,
                     **({"investigationFocus": investigation_focus} if investigation_focus else {})}]
        row = {"assessmentRuleId": assessment_rule_id, "concept": concept, "legalRequirementIds": legal_requirement_ids, "criteria": criteria,
               "evidenceBindings": [{"criterionId": c["criterionId"], "kind": "REQUIRED"} for c in criteria],
               "sourceRefs": list({(ref["documentId"], ref["locator"], ref["contentSha256"]): ref for rid in legal_requirement_ids for ref in context.draft["legalRequirements"][rid]["sourceRefs"]}.values()),
               "semanticAuthority": "CLAIM_DERIVED", **{k: [] for k in ["investigationGoals", "startingNodeTypes", "targetNodeTypes", "edgeStrategies", "graphQueries", "keywords", "commonApis", "commonLibraries", "patterns", "requiredEvidence", "supportingEvidence", "negativeEvidence"]}}
        errors = list(Draft7Validator(SCHEMA["properties"]["assessmentRules"]["items"]).iter_errors(row))
        if errors:
            return ledger.rejected("CLAIM_SCHEMA_INVALID", assessment_rule_id,
                                   "The assembled AssessmentRule row is invalid at " + (".".join(map(str, errors[0].absolute_path)) or "<row>") + ": " + errors[0].message[:160],
                                   repairKey="ROW_INVALID")
        ledger.changed(context.draft["assessmentRules"].get(assessment_rule_id), row)
        context.draft["assessmentRules"][assessment_rule_id] = row
        context.validated_packet = context.last_validation = None
        ledger.draft_changed()
        ledger.transition(AUTHORING)
        return {"outcome": "PASSED", "phase": ledger.phase, "inventoryRevision": ledger.revision, "draftRevision": context.draft_revision, "assessmentRule": deepcopy(row),
                "authority": "Normative criteria/applicability/evidence are derived by the API from these exact parents. Investigation focus is a non-normative suggestion."}

    def remove_candidate(kind, candidate_id, reason):
        """Business purpose: Remove a mistaken authored candidate without changing its frozen source claims.

        Business rules:
        - Require valid authoring phase; match the visible trimmed candidate identity.
        - Removing a requirement also removes dependent AssessmentRule candidates and reprojects context relations.
        Execution flow:
        1. Enter/recover authoring and resolve the requested candidate.
        2. Remove it and any dependent assessment candidates.
        3. Advance draft/phase state and return the affected identifiers with the reason.
        Failure cases:
        - Missing candidates return CLAIM_SCHEMA_INVALID with bounded real candidates; authoring phase failures remain rejected.
        Side effects:
        - Mutates downstream candidate/relation state; the invocation wrapper persists successful draft removal.
        """
        started = ledger.begin_authoring()
        if started.get("outcome") != "PASSED":
            return started
        section = "legalRequirements" if kind == "LEGAL_REQUIREMENT" else "assessmentRules"
        # The agent only sees an id's visible text: an id saved with stray whitespace is removable by that text.
        candidate_id = next((key for key in context.draft[section] if key.strip() == candidate_id.strip()), candidate_id)
        if candidate_id not in context.draft[section]:
            label = "title" if kind == "LEGAL_REQUIREMENT" else "concept"
            existing = sorted(context.draft[section].items())
            return ledger.rejected("CLAIM_SCHEMA_INVALID", candidate_id, f"No {kind} candidate {candidate_id!r} exists in the draft", suppliedField="candidate_id",
                                   fieldPaths=["candidate_id"], candidateCount=len(existing), expectedField="candidate_id",
                                   candidates=[{"candidateId": cid, label: " ".join(str(row.get(label, "")).split())[:80]} for cid, row in existing[:20]],
                                   requiredAction="get_rule_authoring_status", repairKey="UNKNOWN_CANDIDATE")
        row = context.draft[section].pop(candidate_id)
        ledger.changed(row, None)
        invalidated = []
        if kind == "LEGAL_REQUIREMENT":
            for rule_id, rule in list(context.draft["assessmentRules"].items()):
                if candidate_id in rule["legalRequirementIds"]:
                    invalidated.append(rule_id)
                    del context.draft["assessmentRules"][rule_id]
            derive_requirement_relations(context)
        ledger.draft_changed()
        ledger.transition(AUTHORING)
        return {"outcome": "PASSED", "inventoryRevision": ledger.revision, "draftRevision": context.draft_revision, "removedCandidateId": candidate_id,
                "reason": reason, "invalidatedAssessmentRules": invalidated}

    def authoring_status(offset=0, limit=None):
        """Business purpose: Expose current rule-authoring progress from the frozen revision without granting new authority.

        Business rules:
        - Require an active authoring context and use its bounded status projection.
        Execution flow:
        1. Check authoring eligibility and return the requested status page.
        Failure cases:
        - Unfinalized/inactive inventory returns CLAIM_PHASE_INVALID; status reads never create a successful authoring result.
        Side effects:
        - Read-only status projection apart from rejection observations.
        """
        if context.authoring is None or not context.authoring.active():
            return ledger.rejected("CLAIM_PHASE_INVALID", "claimInventory", "Finalize the claim inventory first; this view reads the frozen revision")
        return context.authoring.status_view(offset, limit)

    def finalize():
        """Business purpose: Freeze discovery only after inventory validation accepts complete source and semantic accounting.

        Business rules:
        - A failed validator may release only the shared gate-permitted unreachable context/definition claims; any release must be recommitted and revalidated.
        Execution flow:
        1. Attempt inventory finalization.
        2. On failure ask the existing release helper for permitted cleanup.
        3. Revalidate only when cleanup changed committed state and report released identities explicitly.
        Failure cases:
        - Failed validation/recommit remains failed; cleanup is not a substitute for accepted finalization and never invents an operative obligation.
        Side effects:
        - May call validation APIs and update allowed claim files/committed reviews through release_unconnected; successful finalization freezes the inventory.
        """
        from rule_set_preparation.claim_files import release_unconnected
        result, released = ledger.validate_inventory(True), []
        if result.get("outcome") != "PASSED":
            released = release_unconnected(context, ledger.last_failures)
            if released:
                result = ledger.validate_inventory(True)
        return {**result, "releasedAsNonOperative": released} if released else result

    specs = [
        ("get_applicable_legal_state", "Retrieve dated source-grounded legal effects for an exact provision, including verified relationships, dates, evidence, unresolved targets and conflicts. Original source text stays unchanged; an incomplete review or an unknown date is never proof of applicability.", legal_state, object_schema({"node_id": TEXT, "at_date": {"type": "string", "format": "date"}, "offset": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}}, ["node_id", "at_date"])),
        ("get_semantic_closure", "Read the verified typed semantic closure of one operative anchor or a compatible operative aggregation. Only reachable applicability, qualifications, exceptions, temporal branches, definitions and context may bind its Requirement.", closure_reads, object_schema({"operative_claim_ids": {**IDS, "minItems": 1}}, ["operative_claim_ids"])),
        ("get_claim_inventory", "Read exact claims (statement, actor/action, provenance), relations, unaccounted claims or Requirements, one bounded page at a time. The reply states requestedLimit, appliedLimit, offset, returnedCount, hasMore and nextOffset; a page size above 20 is capped at 20 and reported, never rejected. Use claim_id to fetch one exact claim.", inspect, object_schema({"kind": {"type": "string", "enum": ["STATUS", "UNREVIEWED_SOURCE_NODES", "CLAIMS", "RELATIONS", "UNACCOUNTED_CLAIMS", "REQUIREMENTS"]}, "source_node_id": TEXT, "claim_id": TEXT, "offset": {"type": "integer", "description": "Zero-based start; negative values start at 0"}, "limit": {"type": "integer", "description": "Page size; default and maximum 20"}})),
        ("get_rule_authoring_context", "Choose verified LEGAL_NORMATIVE operative anchors from the frozen inventory, then call get_semantic_closure to obtain compatible bindings and exact authoringArguments. This normal path does not expose a global role pool. Global get_claim_inventory remains diagnostic/navigation only. Pages of at most 40 with explicit cursors.", authoring_context, object_schema({"operative_claim_ids": IDS, "offset": {"type": "integer"}, "limit": {"type": "integer", "description": "Default and maximum 40"}})),
        ("get_rule_authoring_status", "Bounded read-only projection of Rule authoring progress: the exact IDs and titles of your authored Requirements (assessable or not, with or without an AssessmentRule), your AssessmentRules, unbound relevant claims by role, any unresolved rejection of your last mutation and the next valid actions. Use it to get the exact legalRequirementId values author_assessment_rule needs. Not a second authority; pages of at most 40.", authoring_status, object_schema({"offset": {"type": "integer"}, "limit": {"type": "integer", "description": "Default and maximum 40"}})),
        ("validate_semantic_claim_inventory", "Validate discovery and source/reference review WITHOUT requiring Requirements. Reports the same authoring-readiness gaps as finalization (APPLICABILITY_AUTHORITY_MISSING). Fix grouped gaps before finalization.", lambda: ledger.validate_inventory(False), object_schema({})),
        ("finalize_semantic_claim_inventory", "Explicitly finalize discovery and persist an immutable inventory revision. Requirements are not required at this phase, but the inventory must be able to support one: it is refused (APPLICABILITY_AUTHORITY_MISSING) when duties exist and no SCOPE or CONDITION claim does. Correct the owning claim file and commit it.", finalize, object_schema({})),
        ("conclude_no_operative_obligations", "End the Preparation with an explicit outcome when every review unit is durably complete and the source states no duty, prohibition or permission (finalize then reports OPERATIVE_CLAIM_MISSING). The API accepts it only for such an inventory and it creates no Rule Set. Give a factual reason. Never use it to skip an unfinished unit or to dismiss an obligation the source states, and never register an obligation the source does not state.", ledger.conclude_no_operative_obligations, object_schema({"reason": {**TEXT, "maxLength": 2000}}, ["reason"])),
        ("start_rule_authoring", "Transition the same Agent from frozen inventory ready to Rule authoring against that revision.", ledger.begin_authoring, object_schema({})),
        ("reopen_semantic_claim_inventory", "Explicitly reopen discovery for a reason, increment revision, remap claim identities and invalidate ALL downstream candidates. Previous frozen revision stays immutable.", ledger.reopen, object_schema({"reason": TEXT}, ["reason"])),
        ("author_legal_requirement", "Bind selected frozen claim IDs to exact Requirement roles. Canonical actor/action/text/provenance and coverage-state shape are assembled from those claims. A non-assessable reason means external/non-repository performance, not a substitute software duty.", requirement, object_schema({"requirement_key": {**TEXT, "maxLength": 128, "pattern": ID_PATTERN}, "title": TEXT, "operative_claim_ids": {**IDS, "minItems": 1}, "applicability_claim_ids": IDS, "qualifier_claim_ids": IDS, "exception_claim_ids": IDS, "context_claim_ids": IDS, "non_repository_duty": {"type": "boolean"}, "non_assessable_reason": TEXT}, ["requirement_key", "title", "operative_claim_ids"])),
        ("remove_rule_candidate", "Remove a mistaken downstream candidate, recording why. Removing a Requirement invalidates its dependent AssessmentRule candidates; frozen claims stay unchanged.", remove_candidate, object_schema({"kind": {"type": "string", "enum": ["LEGAL_REQUIREMENT", "ASSESSMENT_RULE"]}, "candidate_id": TEXT, "reason": TEXT}, ["kind", "candidate_id", "reason"])),
        ("author_assessment_rule", "Choose assessable Requirement parents. API derives normative criteria, applicability and evidence from those parents; optional investigation focus cannot create a legal obligation.", assessment, object_schema({"assessment_rule_id": {**TEXT, "maxLength": 128, "pattern": ID_PATTERN}, "concept": TEXT, "legal_requirement_ids": {**IDS, "minItems": 1}, "investigation_focus": TEXT}, ["assessment_rule_id", "concept", "legal_requirement_ids"])),
    ]
    if context.discovery_only:
        specs=[spec for spec in specs if spec[0] not in {"conclude_no_operative_obligations","start_rule_authoring","author_legal_requirement","author_assessment_rule","remove_rule_candidate","reopen_semantic_claim_inventory","get_rule_authoring_context","get_rule_authoring_status", "get_semantic_closure"}]
    if operations is not None:
        operations.update(register=register, update=update, link=link, non_material=non_material, remove=remove, unlink=unlink)
    tools = []
    for name, description, function, schema in specs:
        def invoke(_function=function, _schema=schema, _name=name, **kwargs):
            """Business purpose: Execute one governed preparation tool with ordered rejection, mutation and durability observations.

            Business rules:
            - Serialize operations under the mutation lock and bind current call/tool identity before validating.
            - Argument-contract errors are distinct from body preconditions; accepted authoring mutations are saved before acknowledgment.
            Execution flow:
            1. Capture draft/call context and validate schema-owned constraints.
            2. Invoke the operation or return field-addressed schema feedback.
            3. Save accepted mutations, publish progress and observe authoring correction state.
            4. Serialize the result and clear current call context on every exit.
            Failure cases:
            - Only KeyError, TypeError and ValueError become the body safety-net rejection; terminal runtime/callback/no-progress errors propagate through their existing policies.
            Side effects:
            - May perform the bound operation's state/API/file effects, persist accepted drafts and publish observations; always restores call-local ledger metadata.
            """
            with context.mutation_lock:
                ledger.current_tool, ledger.current_args, ledger.current_call_id = _name, kwargs, CURRENT_TOOL_CALL_ID.get()
                ledger.current_layer = ledger.current_source = ledger.last_envelope = None
                try:
                    if context.draft_fp is None:
                        context.draft_fp = draft_fingerprint(context.draft)
                    ledger.current_draft_before = context.draft_fp
                    # Argument-contract violations (layer A). A constraint the body owns is left to the body, which gives a richer rejection.
                    errors = [e for e in Draft7Validator(_schema).iter_errors(kwargs)
                              if (_name, ".".join(map(str, e.absolute_path)), e.validator) not in BODY_OWNED]
                    if errors:
                        # Field-addressed: two different malformed arguments are different gaps, one repeated mistake is not.
                        paths = field_paths_of(errors)
                        ledger.current_layer, ledger.current_source = TOOL_SCHEMA, SOURCE_PREFLIGHT
                        result = ledger.rejected("CLAIM_SCHEMA_INVALID", _name + (("." + paths[0]) if paths and paths[0] != "<root>" else ""), "; ".join(
                            ".".join(map(str, e.absolute_path)) + (": " if e.absolute_path else "") + e.message[:160] for e in errors[:3]),
                            fieldPaths=paths, repairKey=classify_schema_error(errors[0]),
                            )
                    else:
                        try:
                            result = _function(**kwargs)
                            if result.get("outcome") == "PASSED":
                                if _name in AUTHORING_MUTATIONS:
                                    ledger.draft_changed()
                                    if _name != "reopen_semantic_claim_inventory":
                                        ledger.save_authoring_draft()
                                ledger.progress(_name)
                        except (KeyError, TypeError, ValueError) as error:
                            # Safety net only: every known precondition has an explicit, candidate-bearing rejection above.
                            ledger.current_layer, ledger.current_source = None, SOURCE_BODY
                            result = ledger.rejected("CLAIM_SCHEMA_INVALID", _name, f"Internal {type(error).__name__} in {_name}: {str(error)[:160]}", repairKey="FRAMEWORK_ERROR")
                    if context.authoring is not None:
                        context.authoring.observe_tool(_name, kwargs, result, call_id=ledger.current_call_id, envelope=ledger.last_envelope)
                    return json.dumps(result, ensure_ascii=False)
                finally:
                    ledger.current_tool = ledger.current_args = ledger.current_call_id = ledger.current_layer = ledger.current_source = None
        tools.append(StructuredTool.from_function(invoke, name=name, description=description, args_schema=schema))
    return tools
