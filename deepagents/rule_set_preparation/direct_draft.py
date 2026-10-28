"""Direct legal findings -> durable Requirement/Rule candidates.

The existing review/frozen graph is a deterministic compatibility projection for
the provenance validator and historical assessment readers, never another author.
"""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator
from langchain_core.tools import tool

from collections import defaultdict

from rule_set_preparation.claim_inventory import (
    AUTHORING_DRAFT_KEYS, FRAME_FIELDS, REQUIREMENT_KINDS, SCHEMA, fingerprint, utf16_slice,
)
from rule_set_preparation.claim_tools import build_claim_tools, support_span
from rule_set_preparation.reference_binding import project_reference_accounting, valid_binding

SUBMISSION_SCHEMA = json.loads(Path(__file__).with_name("direct-draft.schema.json").read_text())
PACKAGE_UNITS = 24
PACKAGE_CHARACTERS = 24000
ROLES = {
    "obligations": ("OPERATIVE_PROPOSITION", None, None),
    "conditions": ("APPLICABILITY_CONDITION", "CONDITION", "CONDITION_OF"),
    "qualifiers": ("QUALIFIER", "QUALIFIER", "QUALIFIES"),
    "exceptions": ("EXCEPTION", "EXCEPTION", "EXCEPTION_TO"),
    "definitions": ("DEFINITION", "DEFINITION", "DEFINED_BY"),
}
FIELDS = {"APPLICABILITY_CONDITION": "applicabilityConditions", "QUALIFIER": "qualifiers", "EXCEPTION": "exceptions", "DEFINITION": "semanticContext"}


def _normalize_json_arg(val: Any) -> Any:
    """Business purpose: Accept a JSON object/array supplied either as a native value or serialized text in a candidate submission.

    Business rules:
    - Only strings that look like a complete object or array are parsed; invalid JSON and other scalar text remain unchanged for schema validation.

    Execution flow:
    1. Trim string input and check its outer delimiters.
    2. Parse matching JSON when valid; otherwise return the original value.

    Failure cases:
    - JSON parse errors preserve the original input so the caller can return ordinary schema repair feedback.

    Side effects:
    - None: normalizes an in-memory input value only.
    """
    if isinstance(val, str):
        trimmed = val.strip()
        if (trimmed.startswith("{") and trimmed.endswith("}")) or (trimmed.startswith("[") and trimmed.endswith("]")):
            try:
                return json.loads(trimmed)
            except Exception:
                return val
    return val


def rejected(code, detail, ref="draft"):
    """Business purpose: Format a direct-draft submission failure with a stable code, affected reference and corrective action.

    Business rules:
    - Stale package failures require fetching a current package; other failures ask for a targeted correction while preserving already accepted candidates.

    Execution flow:
    1. Select the required action from the failure code.
    2. Return the standard FAILED result with one structured failure and its reference.

    Failure cases:
    - This function constructs failure results and does not throw for a rejected candidate.

    Side effects:
    - None: creates an in-memory repair response.
    """
    action = "get_next_legal_analysis_package" if code == "STALE_AUTHORING_DRAFT" else "Correct only the affected candidate or source-unit disposition; accepted candidates remain saved"
    return {"outcome": "FAILED", "failures": [{"code": code, "ref": ref, "detail": detail}], "requiredAction": action}


def project_context_relations(context):
    """Deterministically project cross-requirement claim relations into typed contextRelations.

    Business purpose: Project typed cross-Requirement claim relations into the compatibility `contextRelations` view.

    Business rules:
    - Only supported DEFINITION, SCOPE, QUALIFIER, EXCEPTION and CROSS_REFERENCE kinds are projected; same-Requirement links are omitted and IDs are deterministic.

    Execution flow:
    1. Index claim IDs by the Requirements that bind them.
    2. Traverse supported typed claim relations and generate every cross-Requirement pair.
    3. Replace the draft's projected contextRelations mapping.

    Failure cases:
    - Unsupported relation kinds are skipped; malformed endpoint references fail through the draft contract.

    Side effects:
    - Replaces `context.draft["contextRelations"]`; it does not create new legal claims or perform legal interpretation.
    """
    claim_to_reqs = defaultdict(set)
    for rid, req in context.draft["legalRequirements"].items():
        for b in req.get("claimBindings", []):
            claim_to_reqs[b["claimId"]].add(rid)

    relations = {}
    valid_kinds = {"DEFINITION", "SCOPE", "QUALIFIER", "EXCEPTION", "CROSS_REFERENCE"}
    for rel in context.draft["claimRelations"].values():
        kind = REQUIREMENT_KINDS.get(rel.get("kind"), rel.get("kind"))
        if kind not in valid_kinds:
            continue
        origins = claim_to_reqs.get(rel.get("fromClaimId"), set())
        targets = claim_to_reqs.get(rel.get("toClaimId"), set())
        for origin in origins:
            for target in targets:
                if origin != target:
                    cid = "rel_" + fingerprint([origin, target, kind])[:24]
                    relations[cid] = {
                        "relationId": cid,
                        "kind": kind,
                        "fromLegalRequirementId": origin,
                        "toLegalRequirementId": target,
                        "toSourceRef": None,
                    }
    context.draft["contextRelations"] = relations


class DirectDraft:
    def __init__(self, context):
        self.context = context
        self.package = None
        self.packages = {}
        self.rejected_submissions = {}
        self.accepted_through = None

    @property
    def rejected_submission(self):
        """Business purpose: Return the rejected payload associated with the current direct-draft package for precise repair.

        Business rules:
        - Prefer the current package's rejection; otherwise expose the most recently retained rejection, and return `None` when none exists.

        Execution flow:
        1. Check whether any rejected payload is retained.
        2. Return the current package's payload when available.
        3. Otherwise return the most recent payload.

        Failure cases:
        - Missing or stale package association falls back to the latest retained rejection without fabricating one.

        Side effects:
        - None: reads the rejection cache.
        """
        if not self.rejected_submissions:
            return None
        if self.package and self.package.get("packageId") in self.rejected_submissions:
            return self.rejected_submissions[self.package["packageId"]]
        return next(reversed(self.rejected_submissions.values()), None)

    @rejected_submission.setter
    def rejected_submission(self, value):
        """Business purpose: Clear or store one rejected direct-draft payload so the agent can repair the exact failed submission.

        Business rules:
        - Assigning `None` clears all retained rejected submissions; a mapping is stored only when it has a packageId.

        Execution flow:
        1. Clear the cache when given `None`.
        2. Otherwise validate the package key and save the payload under that package ID.

        Failure cases:
        - Values without a packageId are ignored and cannot be used to patch an unrelated package.

        Side effects:
        - Mutates the run-local rejected-submission cache.
        """
        if value is None:
            self.rejected_submissions.clear()
        elif isinstance(value, dict) and "packageId" in value:
            self.rejected_submissions[value["packageId"]] = value

    @property
    def ledger(self):
        """Business purpose: Expose the ClaimInventory attached to the direct-draft run context.

        Business rules:
        - The context inventory remains the sole lifecycle and frontier authority.

        Execution flow:
        1. Read and return `context.inventory`.

        Failure cases:
        - If inventory is not initialized, the property returns `None`; callers decide whether that state is valid.

        Side effects:
        - None: read-only context projection.
        """
        return self.context.inventory

    @property
    def source(self):
        """Business purpose: Expose the pinned LegalDocumentGraph used for direct-draft evidence checks.

        Business rules:
        - Candidate support and references are resolved only through the context's pinned graph.

        Execution flow:
        1. Read and return `context.source_graph`.

        Failure cases:
        - An absent graph returns `None`; source-dependent methods must not infer missing source content.

        Side effects:
        - None: read-only context projection.
        """
        return self.context.source_graph

    def next_package(self):
        """Business purpose: Assign the next bounded set of unreviewed pinned source units for direct legal analysis.

        Business rules:
        - Units are never reassigned after completion unless reopened or affected by the latest validation failure; packages stay bound to the current draft version.
        - Packages follow source-file order, include only exact ancestor context and cap both units and source text.

        Execution flow:
        1. Under the mutation lock, refresh frontier progress and restore the durable authoring draft.
        2. Select pending/reopened units, or units implicated by the last validation failure.
        3. Return the completion action if none remain; otherwise group a bounded same-file batch.
        4. Attach exact ancestor context, references and draft-version/package identity, then retain the package.

        Failure cases:
        - Frontier refusal is returned; units blocked on references remain visible when no ordinary pending units are available.

        Side effects:
        - Reads/restores durable draft state and updates the run-local current/package map; it does not decide legal meaning.
        """
        with self.context.mutation_lock:
            progress = self.ledger.frontier.progress()
            if progress.get("outcome") != "PASSED":
                return progress
            self.ledger.restore_authoring_draft()
            required = self.source.review_node_ids()
            accounted = self.context.draft["sourceAccounting"]
            remaining = {nid for nid in required if nid not in accounted or self.ledger.frontier.states.get(nid) in {"PENDING", "REOPENED"}}
            if not remaining and self.ledger.last_failures:
                affected = {f.get("ref", "").removeprefix("legalRequirement:") for f in self.ledger.last_failures if isinstance(f.get("ref"), str) and f["ref"].startswith("legalRequirement:")}
                remaining = {nid for rid in affected for b in self.context.draft["legalRequirements"].get(rid, {}).get("claimBindings", []) for nid in self.context.draft["semanticClaims"].get(b["claimId"], {}).get("sourceNodeIds", [])} & required
            pending = {nid for nid in remaining if self.ledger.frontier.states.get(nid) != "BLOCKED_REFERENCE"}
            selected = pending or remaining
            group = next(((path, [nid for nid in ids if nid in selected])
                          for path, ids in self.source.source_files.items()
                          if any(nid in selected for nid in ids)), None)
            if group is None:
                return {"outcome": "PASSED", "complete": True, "progress": progress["progress"],
                        "draftVersion": self.ledger.draft_version, "requirements": len(self.context.draft["legalRequirements"]),
                        "assessmentRules": len(self.context.draft["assessmentRules"]), "requiredAction": "validate_compliance_rule_set"}
            path, pending = group
            ids, used = [], 0
            for nid in pending:
                size = len(self.source.nodes[nid]["content"])
                if ids and (len(ids) >= PACKAGE_UNITS or used + size > PACKAGE_CHARACTERS):
                    break
                ids.append(nid)
                used += size
            ancestors = list(dict.fromkeys(a for nid in ids for a in reversed(self.source.ancestors(nid)) if a not in ids))
            # Every context node is an actual ancestor; sibling text is never inherited.
            nodes, budget = {}, PACKAGE_CHARACTERS
            for nid in [*ancestors, *ids]:
                node = self.source.nodes[nid]
                content = node["content"][:max(0, budget)]
                budget -= len(content)
                nodes[nid] = {key: node[key] for key in ("nodeId", "documentId", "nodeType", "parentNodeId", "structuralPath", "title", "contentSha256", "legalEffectStatus") if key in node}
                nodes[nid].update(locator=self.source.locators[nid], content=content, hasMore=len(content) < len(node["content"]))
            reference_ids = [rid for rid, owner in self.source.reference_owners().items() if owner in ids]
            package_id = fingerprint({**self.source.base(), "sourceNodeIds": ids, "draftVersion": self.ledger.draft_version})
            self.package = {"packageId": package_id, "sourceNodeIds": ids, "draftVersion": self.ledger.draft_version}
            self.packages[package_id] = self.package
            return {"outcome": "PASSED", **self.source.base(), "packageId": package_id, "sourceFile": path,
                    "targetDate": self.context.target_date,
                    "draftVersion": self.ledger.draft_version, "progress": progress["progress"],
                    "sourceUnits": [nodes[nid] for nid in ids], "ancestorContext": [nodes[nid] for nid in ancestors],
                    "references": [self.source.references[rid] for rid in reference_ids[:20]], "referenceCount": len(reference_ids),
                    "existingCandidateIds": [rid for rid, row in self.context.draft["legalRequirements"].items()
                        if any(set(self.context.draft["semanticClaims"].get(b["claimId"], {}).get("sourceNodeIds", [])) & set(ids) for b in row.get("claimBindings", []))],
                    "requiredAction": "Read any truncated nodes and material references, then submit_rule_set_draft_candidates"}

    def candidate(self, candidate_id):
        """Business purpose: Return one persisted Requirement candidate with its authored facts, source quotes and linked AssessmentRule for targeted repair.

        Business rules:
        - The requested candidate must exist in the current draft; support quotes are sliced from the pinned source, and the response includes only relevant reviewed units.

        Execution flow:
        1. Find the Requirement and its bound semantic claims.
        2. Project claim roles into candidate facts with exact source excerpts.
        3. Find linked rules, derive the package from the candidate's reviewed source units and retain it for correction.
        4. Return the candidate and its package metadata.

        Failure cases:
        - A candidate ID absent from the current draft returns CLAIM_SCHEMA_INVALID; malformed persisted bindings surface instead of being reconstructed from model memory.

        Side effects:
        - Adds the candidate package to the run-local package cache; no draft fact is changed.
        """
        row = self.context.draft["legalRequirements"].get(candidate_id)
        if row is None:
            return rejected("CLAIM_SCHEMA_INVALID", "Unknown candidate identity", candidate_id)
        facts = {key: [] for key in ROLES}
        reverse = {role: key for key, (role, _, _) in ROLES.items()}
        for binding in row["claimBindings"]:
            claim = self.context.draft["semanticClaims"][binding["claimId"]]
            fact = {"statement": claim["statement"], "support": [{"nodeId": s["nodeId"], "quote": utf16_slice(self.source.nodes[s["nodeId"]]["content"], s["startOffset"], s["endOffset"])} for s in claim["sourceSupport"]]}
            if claim["operative"]:
                fact.update(claim["operative"])
            facts[reverse[binding["role"]]].append((binding["index"], fact))
        facts = {key: [fact for _, fact in sorted(items)] for key, items in facts.items()}
        rules = [r for r in self.context.draft["assessmentRules"].values() if candidate_id in r["legalRequirementIds"]]
        anchor = next(self.context.draft["semanticClaims"][b["claimId"]] for b in row["claimBindings"] if b["role"] == "OPERATIVE_PROPOSITION")
        ids = sorted({nid for b in row["claimBindings"] for nid in self.context.draft["semanticClaims"][b["claimId"]]["sourceNodeIds"]} & self.source.review_node_ids())
        cand_pkg_id = fingerprint({**self.source.base(), "sourceNodeIds": ids, "draftVersion": self.ledger.draft_version})
        cand_pkg = {"packageId": cand_pkg_id, "sourceNodeIds": ids, "draftVersion": self.ledger.draft_version}
        self.packages[cand_pkg_id] = cand_pkg
        if not self.package:
            self.package = cand_pkg
        return {"outcome": "PASSED", **cand_pkg, "candidate": {"candidateId": candidate_id, "title": row["title"],
            "obligations": facts.pop("obligations"), "applicability": {"mode": row["applicabilityMode"], "conditions": facts.pop("conditions")},
            **facts, "repositoryAssessability": anchor["assessability"],
            "repositoryObservableAspect": anchor["semanticFrame"].get("repositoryObservableAspect"),
            "externalFulfillmentAspect": anchor["semanticFrame"].get("externalFulfillmentAspect"),
            "nonAssessableReason": row["coverage"]["nonAssessableReason"],
            "assessmentRule": {"assessmentRuleId": rules[0]["assessmentRuleId"], "concept": rules[0]["concept"],
                "investigationFocus": rules[0]["criteria"][0].get("investigationFocus")} if rules else None}}

    def _drop(self, candidate_id):
        """Business purpose: Remove one Requirement candidate and every draft object owned by its bindings before it is replaced.

        Business rules:
        - Only the identified candidate is removed; associated claims, owned relations, dependent AssessmentRules and contextRelations are removed to prevent dangling references.

        Execution flow:
        1. Remove the Requirement and return when it did not exist.
        2. Remove its bound claims from the draft, identity ledger, authored set and frontier ownership.
        3. Delete relations involving those claims, rules citing the candidate and projected context relations involving it.

        Failure cases:
        - Missing candidate is an idempotent no-op; malformed draft relationships surface as state errors.

        Side effects:
        - Mutates the in-memory direct-draft candidate, claim, relation and ownership indexes.
        """
        row = self.context.draft["legalRequirements"].pop(candidate_id, None)
        if not row:
            return
        ids = {b["claimId"] for b in row["claimBindings"]}
        for cid in ids:
            self.context.draft["semanticClaims"].pop(cid, None)
            self.ledger.identities.pop(cid, None)
            self.context.authored_claim_ids.discard(cid)
            self.ledger.frontier.claim_owners.pop(cid, None)
        for rid, relation in list(self.context.draft["claimRelations"].items()):
            if {relation["fromClaimId"], relation["toClaimId"]} & ids:
                del self.context.draft["claimRelations"][rid]
                self.ledger.frontier.relation_owners.pop(rid, None)
                self.ledger.frontier.relation_dependencies.pop(rid, None)
        for rid, rule in list(self.context.draft["assessmentRules"].items()):
            if candidate_id in rule["legalRequirementIds"]:
                del self.context.draft["assessmentRules"][rid]
        for rid, rel in list(self.context.draft["contextRelations"].items()):
            if candidate_id in (rel.get("fromLegalRequirementId"), rel.get("toLegalRequirementId")):
                del self.context.draft["contextRelations"][rid]

    def _fact(self, key, fact, claim_type, authority, assessability, frame, relevant=True):
        """Business purpose: Register one model-authored legal fact as a source-supported semantic claim in the direct-draft working inventory.

        Business rules:
        - Support quotes must resolve to pinned source spans; operative requirements cannot originate in reference-only material, and every claim needs a review-unit owner.
        - The deterministic layer records evidence and typed fields but does not invent or judge the legal proposition.

        Execution flow:
        1. Resolve each quote into an exact source span and source-node set.
        2. Select the owning reviewed source unit, preferring actual support.
        3. Create the claim through the inventory and reject any non-passing result.
        4. Return the created claim.

        Failure cases:
        - Reference-only operative origin, absent source-bearing owner or inventory rejection raises ValueError so the enclosing submission can roll back.

        Side effects:
        - Mutates the local claim inventory and draft identity map through `put_claim`.
        """
        spans = [support_span(self.source, s["nodeId"], s["quote"]) for s in fact["support"]]
        ids = sorted({s["nodeId"] for s in spans})
        if key[0] == "obligation" and any(self.source.is_reference_only(nid) for nid in ids):
            raise ValueError("Reference-only documents cannot be the author origin of operative requirements")
        owner = next((nid for nid in ids if nid in self.source.review_node_ids()), None)
        if owner is None:
            if self.ledger.frontier and self.ledger.frontier.active:
                owner = self.ledger.frontier.active["sourceNodeId"]
            elif self.ledger.frontier and self.ledger.frontier.active_batch:
                owner = self.ledger.frontier.active_batch[0]["sourceNodeId"]
            else:
                raise ValueError("A finding needs source-bearing structural support")
        active_u = next((u for u in self.ledger.frontier.active_batch if u["sourceNodeId"] == owner), None)
        if active_u:
            self.ledger.frontier.active = active_u
        result = self.ledger.put_claim("direct:" + fingerprint(key)[:40], ids, claim_type, fact["statement"], fact.get("actor"), fact.get("action"), relevant,
            None if relevant else "Legal-effect finding; not an independent operative requirement", source_support=spans,
            semantic_authority=authority, semantic_frame=frame, assessability=assessability)
        if result.get("outcome") != "PASSED":
            raise ValueError(json.dumps(result, ensure_ascii=False))
        return result["claim"]

    def _refs(self, claim):
        """Business purpose: Derive deduplicated legal-source chunk references for a semantic claim's support nodes.

        Business rules:
        - References come only from pinned chunks attached to the node or its ancestors; identity is document, locator and content hash.

        Execution flow:
        1. Traverse each claim source node and its ancestors to find chunk IDs.
        2. Build the source-reference projection for each chunk.
        3. Deduplicate by stable fingerprint and return the references.

        Failure cases:
        - Missing source nodes/chunks fail as inconsistent pinned-graph state rather than producing a guessed citation.

        Side effects:
        - None: returns source provenance derived from the graph.
        """
        refs = {}
        for nid in claim["sourceNodeIds"]:
            owner = next((n for n in [nid, *self.source.ancestors(nid)] if self.source.chunk_ids.get(n)), None)
            for chunk_id in self.source.chunk_ids.get(owner, []):
                chunk = self.source.chunks[chunk_id]
                ref = {key: chunk[key] for key in ("documentId", "locator", "contentSha256")}
                refs[fingerprint(ref)] = ref
        return list(refs.values())

    def _candidate(self, value, operations):
        """Business purpose: Convert one source-backed model candidate into governed Requirement, claim, relation and optional AssessmentRule draft rows.

        Business rules:
        - Repository assessability must match AssessmentRule/non-assessable-reason fields; obligations and modifiers retain their supplied support, and typed relations are linked through existing claim operations.
        - This builder enforces structure and provenance; the model remains responsible for legal interpretation.

        Execution flow:
        1. Remove the previous candidate version and validate its assessability pairing.
        2. Build the Requirement frame and source-backed semantic claims for obligations, conditions, qualifiers, exceptions and definitions.
        3. Link modifier claims to operative anchors and create the Requirement row with exact references.
        4. Create the optional AssessmentRule and its criterion/evidence binding.

        Failure cases:
        - Missing support, duplicate identity, invalid role pairing, failed relation operations or duplicate Rule identity raise ValueError for whole-submission rollback.

        Side effects:
        - Mutates the in-memory legalRequirements, semanticClaims, claimRelations and assessmentRules draft sections.
        """
        candidate_id = value["candidateId"]
        self._drop(candidate_id)
        is_repo_assessable = value["repositoryAssessability"] in ("REPOSITORY_VERIFIABLE", "MIXED")
        if is_repo_assessable and not value.get("assessmentRule"):
            raise ValueError(f"Candidate {candidate_id}: {value['repositoryAssessability']} duties require an assessmentRule")
        if is_repo_assessable and value.get("nonAssessableReason") is not None:
            raise ValueError(f"Candidate {candidate_id}: {value['repositoryAssessability']} duties require null nonAssessableReason")
        if not is_repo_assessable and value.get("assessmentRule") is not None:
            raise ValueError(f"Candidate {candidate_id}: non-repository duties require null assessmentRule")
        if not is_repo_assessable and not value.get("nonAssessableReason"):
            raise ValueError(f"Candidate {candidate_id}: non-repository duties require a nonAssessableReason")
        if value["repositoryAssessability"] == "MIXED" and not (value.get("repositoryObservableAspect") and value.get("externalFulfillmentAspect")):
            raise ValueError(f"Candidate {candidate_id}: Mixed duties require both repositoryObservableAspect and externalFulfillmentAspect")
        frame = {key: None for key in FRAME_FIELDS}
        frame.update(applicabilityMode=value["applicability"]["mode"],
                     repositoryObservableAspect=value.get("repositoryObservableAspect"), externalFulfillmentAspect=value.get("externalFulfillmentAspect"))
        row = {"legalRequirementId": candidate_id, "claimInventoryRevision": self.ledger.revision,
            "title": value["title"], "proposition": "", "operativePropositions": [], "claimBindings": [],
            "applicabilityMode": value["applicability"]["mode"], "applicabilityConditions": [], "qualifiers": [], "exceptions": [], "semanticContext": [],
            "sourceRefs": [], "nonRepositoryDuty": not is_repo_assessable,
            "coverage": {"state": "COVERED_BY_ASSESSMENT_RULES" if is_repo_assessable else "NON_ASSESSABLE", "nonAssessableReason": None if is_repo_assessable else value["nonAssessableReason"]}}
        anchors, modifiers, statements, refs = [], [], [], {}
        for key, (role, claim_type, relation) in ROLES.items():
            for index, fact in enumerate(value["applicability"]["conditions"] if key == "conditions" else value[key]):
                claim = self._fact([candidate_id, role, index], fact, claim_type or fact["modality"], "LEGAL_NORMATIVE" if key != "definitions" else "DEFINITION", value["repositoryAssessability"] if key == "obligations" else "NON_ASSESSABLE", frame)
                cid = claim["claimId"]
                row["claimBindings"].append({"claimId": cid, "role": role, "index": index})
                claim_refs = self._refs(claim)
                refs.update({fingerprint(ref): ref for ref in claim_refs})
                if key == "obligations":
                    row["operativePropositions"].append({**claim["operative"], "sourceRefs": claim_refs})
                    anchors.append(cid)
                    statements.append(claim["statement"])
                else:
                    row[FIELDS[role]].append(claim["statement"])
                    modifiers.append((cid, relation))
        for cid, kind in modifiers:
            for anchor in anchors:
                origin, target = (anchor, cid) if kind == "DEFINED_BY" else (cid, anchor)
                self.ledger.frontier.active = next(u for u in self.ledger.frontier.active_batch if u["sourceNodeId"] == self.ledger.frontier.claim_owners[origin])
                result = operations["link"](origin, target, kind)
                if result.get("outcome") != "PASSED":
                    raise ValueError(json.dumps(result, ensure_ascii=False))
        row.update(proposition="\n".join(statements), sourceRefs=list(refs.values()))
        self.context.draft["legalRequirements"][candidate_id] = row
        assessment = value["assessmentRule"]
        if assessment:
            rid = assessment["assessmentRuleId"]
            if rid in self.context.draft["assessmentRules"]:
                raise ValueError("AssessmentRule identity already belongs to another requirement")
            criterion = {"criterionId": "criterion_" + fingerprint([rid, candidate_id])[:24], "legalRequirementIds": [candidate_id]}
            if assessment["investigationFocus"]:
                criterion["investigationFocus"] = assessment["investigationFocus"]
            self.context.draft["assessmentRules"][rid] = {"assessmentRuleId": rid, "concept": assessment["concept"], "legalRequirementIds": [candidate_id],
                "criteria": [criterion], "evidenceBindings": [{"criterionId": criterion["criterionId"], "kind": "REQUIRED"}], "semanticAuthority": "CLAIM_DERIVED", "sourceRefs": row["sourceRefs"],
                **{key: [] for key in ("investigationGoals", "startingNodeTypes", "targetNodeTypes", "edgeStrategies", "graphQueries", "keywords", "commonApis", "commonLibraries", "patterns", "requiredEvidence", "supportingEvidence", "negativeEvidence")}}

    def submit(self, payload):
        """Business purpose: Submit one direct-draft payload and retain only rejected payloads that are still repairable against the same package.

        Business rules:
        - Successful submissions clear their package rejection; stale draft versions invalidate all package/rejection caches; other failures are retained only for a current package.

        Execution flow:
        1. Call `_submit` with the candidate payload.
        2. Clear stale rejection state after success or invalidate packages on stale-draft failure.
        3. Save other rejected payloads for the package and return precise correction guidance.

        Failure cases:
        - Stale package failures require a new analysis package; unrecognized package IDs are not retained for correction.

        Side effects:
        - Mutates run-local package/rejection caches; durable draft effects are owned by `_submit`.
        """
        result = self._submit(payload)
        pkg_id = payload.get("packageId") if isinstance(payload, dict) else None
        if result.get("outcome") == "PASSED":
            if pkg_id:
                self.rejected_submissions.pop(pkg_id, None)
        elif any(f.get("code") == "STALE_AUTHORING_DRAFT" for f in result.get("failures", [])):
            self.packages.clear()
            self.rejected_submissions.clear()
            result["requiredAction"] = "Draft revision has changed; get a new legal analysis package before submitting"
        elif pkg_id in self.packages:
            self.rejected_submissions[pkg_id] = deepcopy(payload)
            result["requiredAction"] = "Use correct_rule_set_draft_submission with only changed JSON-pointer fields; all fields are validated again before persistence"
        return result

    def correct(self, package_id, patches):
        """Business purpose: Apply targeted JSON-pointer patches to the latest rejected submission for one current package.

        Business rules:
        - Corrections are limited to candidate facts, source-unit dispositions, references, legal effects and candidate removals; the full payload is revalidated before persistence.
        - A current package/version and a previously rejected payload are required.

        Execution flow:
        1. Verify the package version and find its rejected payload.
        2. Parse and validate one to 64 `{path, value}` patches and apply them to a copy.
        3. Resubmit the complete corrected payload through the normal validation path.

        Failure cases:
        - Stale package or absent rejection returns STALE_AUTHORING_DRAFT; malformed pointers return CLAIM_SCHEMA_INVALID without accepting the patch.

        Side effects:
        - Replaces rejected-submission state only through the ordinary `submit` flow; it does not patch durable draft data directly.
        """
        pkg = self.packages.get(package_id)
        if not pkg or (pkg.get("draftVersion") is not None and pkg.get("draftVersion") != self.ledger.draft_version):
            self.packages.pop(package_id, None)
            self.rejected_submissions.pop(package_id, None)
            return rejected("STALE_AUTHORING_DRAFT", "Draft revision has changed; get a new legal analysis package before submitting")
        rejected_payload = self.rejected_submissions.get(package_id)
        if not rejected_payload:
            self.packages.pop(package_id, None)
            return rejected("STALE_AUTHORING_DRAFT", "No rejected submission for this current package; submit its source-backed facts first")
        patches = _normalize_json_arg(patches)
        value = deepcopy(rejected_payload)
        try:
            if not isinstance(patches, list) or not patches or len(patches) > 64:
                raise ValueError("Supply between one and 64 corrections")
            for patch in patches:
                if not isinstance(patch, dict) or set(patch) != {"path", "value"} or not isinstance(patch["path"], str) or not patch["path"].startswith("/"):
                    raise ValueError("Each correction has only path (a JSON pointer) and value")
                patch_val = _normalize_json_arg(patch["value"])
                keys = [key.replace("~1", "/").replace("~0", "~") for key in patch["path"][1:].split("/")]
                if keys[0] not in {"candidates", "sourceUnits", "references", "legalEffects", "removeCandidateIds"}:
                    raise ValueError("A correction may change only submitted legal findings or dispositions")
                owner = value
                for key in keys[:-1]:
                    if isinstance(owner, list):
                        try:
                            idx = int(key)
                        except ValueError:
                            raise ValueError(f"Invalid path '{patch['path']}': expected integer index in array, got '{key}'")
                        if idx < 0 or idx >= len(owner):
                            raise ValueError(f"Invalid path '{patch['path']}': array index {idx} out of range (length {len(owner)})")
                        owner = owner[idx]
                    elif isinstance(owner, dict):
                        if key not in owner or owner[key] is None:
                            owner[key] = {}
                        owner = owner[key]
                    elif owner is None:
                        raise ValueError(f"Invalid path '{patch['path']}': cannot navigate into null at '{key}'")
                    else:
                        raise ValueError(f"Invalid path '{patch['path']}': cannot navigate into {type(owner).__name__}")
                last_key = keys[-1]
                if isinstance(owner, list):
                    try:
                        idx = int(last_key)
                    except ValueError:
                        raise ValueError(f"Invalid path '{patch['path']}': expected integer index in array, got '{last_key}'")
                    if idx < 0 or idx >= len(owner):
                        raise ValueError(f"Invalid path '{patch['path']}': array index {idx} out of range (length {len(owner)})")
                    owner[idx] = patch_val
                elif isinstance(owner, dict):
                    owner[last_key] = patch_val
                else:
                    raise ValueError(f"Invalid path '{patch['path']}': cannot set property on {type(owner).__name__}")
        except ValueError as error:
            return rejected("CLAIM_SCHEMA_INVALID", str(error))
        return self.submit(value)

    def _submit(self, payload):
        """Business purpose: Validate and atomically persist one bounded direct-draft submission against the current pinned source package.

        Business rules:
        - The package and draft version must be current; source-unit ownership, exact support, legal-effect/reference accounting, candidate assessability, duplicate obligation ownership and typed draft schemas are enforced before completion.
        - Unknown facts and unresolved dependencies remain blocked with factual reasons; deterministic validation never supplies legal conclusions.

        Execution flow:
        1. Normalize JSON-valued fields and validate any reference-only dispositions and the full submission schema.
        2. Lock the run, verify package identity/version and source-unit membership, and adopt touched review units.
        3. Snapshot the draft and ownership state; apply candidate removals/upserts, legal effects, references and source dispositions.
        4. Validate all draft sections and references, then complete the frontier batch through the governed API.
        5. On success, clear stale validation/package state and return accepted IDs and the next package; on local validation failure restore the snapshot and return repair feedback.

        Failure cases:
        - Schema, stale package, unsupported source evidence, invalid reference binding, incomplete unit accounting or frontier/API refusal returns a failure; caught validation errors restore draft and ownership state.

        Side effects:
        - Mutates local draft/identity/frontier projections and persists accepted draft/source-review completion through the governed source-review operation.
        """
        if not isinstance(payload, dict):
            return rejected("CLAIM_SCHEMA_INVALID", "Submission payload must be an object")
        payload = dict(payload)
        for key in ("candidates", "sourceUnits", "references", "legalEffects", "removeCandidateIds"):
            val = _normalize_json_arg(payload.get(key))
            if val is not None:
                payload[key] = val
        if isinstance(payload.get("candidates"), list):
            for cand in payload["candidates"]:
                if isinstance(cand, dict):
                    for nested in ("obligations", "conditions", "qualifiers", "exceptions", "definitions", "assessmentRule", "applicability"):
                        v = _normalize_json_arg(cand.get(nested))
                        if v is not None:
                            cand[nested] = v
                    if isinstance(cand.get("applicability"), dict) and "conditions" in cand["applicability"]:
                        v = _normalize_json_arg(cand["applicability"]["conditions"])
                        if v is not None:
                            cand["applicability"]["conditions"] = v
        for reference in payload.get("references", []):
            if reference.get("kind") == "REFERENCE_ONLY_TARGET" or reference.get("reason") == "REFERENCE_ONLY_TARGET":
                rid = reference.get("referenceId")
                if rid not in self.source.references:
                    return rejected("CLAIM_SCHEMA_INVALID", f"Reference identity {rid} does not exist in the pinned corpus")
                ref = self.source.references[rid]
                if not (ref.get("toNodeId") and self.source.is_reference_only(ref["toNodeId"])):
                    return rejected("CLAIM_SCHEMA_INVALID", f"Reference {rid} cannot be marked REFERENCE_ONLY_TARGET: target node is not a verified REFERENCE_ONLY node in the pinned LegalDocumentGraph")
                reference["material"] = False
                reference["reason"] = "REFERENCE_ONLY_TARGET"
                reference["kind"] = None
                reference["fromCandidateId"] = None
                reference["targetNodeId"] = None
        errors = list(Draft7Validator(SUBMISSION_SCHEMA).iter_errors(payload))
        if errors:
            return rejected("CLAIM_SCHEMA_INVALID", "; ".join(".".join(map(str, e.path)) + ": " + e.message[:200] for e in errors[:10]))
        with self.context.mutation_lock:
            pkg = self.packages.get(payload.get("packageId"))
            if not pkg or self.ledger.frozen:
                return rejected("STALE_AUTHORING_DRAFT", "Get the current legal analysis package before submitting")
            if pkg.get("draftVersion") is not None and pkg.get("draftVersion") != self.ledger.draft_version:
                return rejected("STALE_AUTHORING_DRAFT", "Draft revision has changed; get a new legal analysis package before submitting")
            package_ids = set(pkg["sourceNodeIds"])
            unit_ids = [u["sourceNodeId"] for u in payload["sourceUnits"]]
            candidate_ids = [c["candidateId"] for c in payload["candidates"]]
            if not set(unit_ids) <= package_ids or len(unit_ids) != len(set(unit_ids)) or len(candidate_ids) != len(set(candidate_ids)):
                return rejected("CLAIM_IDENTITY_CONFLICT", "Supply distinct candidates and source units from this package")
            previous = deepcopy(self.context.draft)
            identities = deepcopy(self.ledger.identities)
            frontier = self.ledger.frontier
            ownership = {key: deepcopy(getattr(frontier, key)) for key in ("claim_owners", "relation_owners", "relation_dependencies", "invalidated_relations")}
            try:
                touched = set(unit_ids)
                for value in payload["candidates"]:
                    if len({(o["actor"], o["modality"]) for o in value["obligations"]}) > 1:
                        raise ValueError(f"Candidate {value['candidateId']}: INCOMPATIBLE_OPERATIVE_AGGREGATION. Split different actors or modalities into separate candidates, preserving each one's full conditions and source support")
                    if (value["applicability"]["mode"] == "UNCONDITIONAL") != (not value["applicability"]["conditions"]):
                        raise ValueError("Unconditional applicability has no extra conditions; conditional applicability needs source-backed conditions")
                    if value["repositoryAssessability"] == "MIXED":
                        if not (value.get("repositoryObservableAspect") and value.get("externalFulfillmentAspect")):
                            raise ValueError(f"Candidate {value['candidateId']}: Mixed duties need both repository-observable and external fulfillment aspects")
                        if not value.get("assessmentRule") or value.get("nonAssessableReason") is not None:
                            raise ValueError(f"Candidate {value['candidateId']}: Mixed duties require an assessmentRule for their repository-verifiable portion and null nonAssessableReason")
                    elif value["repositoryAssessability"] == "REPOSITORY_VERIFIABLE":
                        if not value.get("assessmentRule") or value.get("nonAssessableReason") is not None:
                            raise ValueError(f"Candidate {value['candidateId']}: repositoryAssessability=REPOSITORY_VERIFIABLE requires assessmentRule and null nonAssessableReason")
                    else:
                        if value.get("assessmentRule") or not value.get("nonAssessableReason"):
                            raise ValueError(f"Candidate {value['candidateId']}: {value['repositoryAssessability']} requires a nonblank nonAssessableReason and null assessmentRule")
                    evidence = [s["nodeId"] for key in ROLES for f in (value["applicability"]["conditions"] if key == "conditions" else value[key]) for s in f["support"]]
                    if not set(evidence) & package_ids:
                        raise ValueError("A candidate must address this package's actual source units")
                    touched.update(evidence)
                for effect in payload["legalEffects"]:
                    touched.update(s["nodeId"] for s in effect["support"])
                for rid in [*candidate_ids, *payload.get("removeCandidateIds", [])]:
                    existing = previous["legalRequirements"].get(rid)
                    if existing:
                        touched.update(nid for b in existing["claimBindings"] for nid in previous["semanticClaims"][b["claimId"]]["sourceNodeIds"])
                for reference in payload["references"]:
                    rid = reference["referenceId"]
                    if rid not in self.source.references:
                        raise ValueError(f"Reference identity {rid} does not exist in the pinned corpus")
                    ref = self.source.references[rid]
                    target_is_ref_only = bool(ref.get("toNodeId") and self.source.is_reference_only(ref["toNodeId"]))
                    if reference.get("reason") == "REFERENCE_ONLY_TARGET" and not target_is_ref_only:
                        raise ValueError(f"Reference {rid} cannot be marked REFERENCE_ONLY_TARGET: target node is not a verified REFERENCE_ONLY node in the pinned LegalDocumentGraph")
                    if target_is_ref_only and (reference.get("kind") == "REFERENCE_ONLY_TARGET" or reference.get("reason") == "REFERENCE_ONLY_TARGET" or reference.get("material") is False):
                        reference["material"] = False
                        reference["reason"] = "REFERENCE_ONLY_TARGET"
                        reference["kind"] = None
                        reference["fromCandidateId"] = None
                        reference["targetNodeId"] = None
                    owner = self.source.reference_owners().get(rid)
                    if owner and owner in self.source.review_node_ids():
                        touched.add(owner)
                refused = frontier.adopt(sorted(touched & self.source.review_node_ids()))
                if refused:
                    return refused
                operations = {}
                build_claim_tools(self.context, operations=operations)
                for rid in payload.get("removeCandidateIds", []):
                    if rid not in previous["legalRequirements"]:
                        raise ValueError("Cannot remove an unknown candidate")
                    self._drop(rid)
                for value in payload["candidates"]:
                    self._candidate(value, operations)
                for effect in payload["legalEffects"]:
                    self._fact(["effect", effect["effectId"]], effect, "CONTEXT", "CONTEXT", "NON_ASSESSABLE", {**{key: None for key in FRAME_FIELDS}, "legalEffect": effect["legalEffect"]}, relevant=False)
                # Equal supported normative predicates have one owner, even under different candidate IDs.
                seen = {}
                for rid, row in self.context.draft["legalRequirements"].items():
                    for binding in row["claimBindings"]:
                        if binding["role"] != "OPERATIVE_PROPOSITION":
                            continue
                        claim = self.context.draft["semanticClaims"][binding["claimId"]]
                        signature = fingerprint({"operative": claim["operative"], "support": claim["sourceSupport"],
                            **{field: row[field] for field in ("applicabilityMode", "applicabilityConditions", "qualifiers", "exceptions")}})
                        if signature in seen:
                            raise ValueError("Duplicate obligation ownership: " + seen[signature] + " and " + rid)
                        seen[signature] = rid
                for reference in payload["references"]:
                    rid = reference["referenceId"]
                    ref = self.source.references[rid]
                    target_is_ref_only = bool(ref.get("toNodeId") and self.source.is_reference_only(ref["toNodeId"]))
                    if target_is_ref_only and (reference.get("kind") == "REFERENCE_ONLY_TARGET" or reference.get("reason") == "REFERENCE_ONLY_TARGET" or reference.get("material") is False):
                        reference["material"] = False
                        reference["reason"] = "REFERENCE_ONLY_TARGET"
                        reference["kind"] = None
                        reference["fromCandidateId"] = None
                        reference["targetNodeId"] = None
                    owner = self.source.reference_owners().get(rid)
                    if owner:
                        owner_unit = next((u for u in frontier.active_batch if u["sourceNodeId"] == owner), None)
                        if owner_unit:
                            frontier.active = owner_unit
                        elif frontier.active_batch:
                            frontier.active = frontier.active_batch[0]
                    elif frontier.active_batch:
                        frontier.active = frontier.active_batch[0]
                    if frontier.active and rid not in frontier.active["referenceIds"]:
                        frontier.active["referenceIds"].append(rid)
                    if not reference["material"]:
                        result = operations["non_material"](rid, reference["reason"])
                    else:
                        is_legal_effect = any(
                            any(t.get("nodeId") == reference.get("targetNodeId") for t in (e.get("legalEffect") or {}).get("targets", []))
                            for e in payload.get("legalEffects", [])
                        ) or reference.get("kind") in {"AMENDS", "REPEALS", "REPLACES"}
                        if is_legal_effect and not reference.get("fromCandidateId"):
                            self.context.draft["referenceAccounting"][rid] = {
                                "referenceId": rid,
                                "material": True,
                                "relationIds": [],
                                "nonMaterialReason": None,
                            }
                            result = {"outcome": "PASSED"}
                        else:
                            row = self.context.draft["legalRequirements"].get(reference["fromCandidateId"])
                            origins = [self.context.draft["semanticClaims"][b["claimId"]] for b in (row or {}).get("claimBindings", []) if b["role"] == "OPERATIVE_PROPOSITION"]
                            targets = [c for c in self.context.draft["semanticClaims"].values() if reference["targetNodeId"] in c["sourceNodeIds"]]
                            pairs = [(a, b) for a in origins for b in targets if valid_binding(self.source, self.context.draft["semanticClaims"], {"fromClaimId": a["claimId"], "toClaimId": b["claimId"], "kind": reference["kind"], "referenceId": rid})]
                            if len(pairs) != 1:
                                decision = next((u for u in payload["sourceUnits"] if u["sourceNodeId"] == owner), None)
                                if decision and decision["disposition"] == "BLOCKED" and decision["reason"]:
                                    # An unresolved material dependency is persisted as blocked, never as a resolved edge.
                                    self.context.draft["referenceAccounting"].pop(rid, None)
                                    continue
                                raise ValueError(f"Material reference {rid} in source unit {owner} has {len(pairs)} supported target pairs. Keep that unit BLOCKED with a factual reason until its target findings resolve it")
                            result = operations["link"](pairs[0][0]["claimId"], pairs[0][1]["claimId"], reference["kind"], rid)
                    if result.get("outcome") != "PASSED":
                        raise ValueError(json.dumps(result, ensure_ascii=False))
                project_reference_accounting(self.context)
                project_context_relations(self.context)
                decisions = {u["sourceNodeId"]: u for u in payload["sourceUnits"]}
                completions = []
                for unit in frontier.active_batch:
                    nid = unit["sourceNodeId"]
                    decision = decisions.get(nid)
                    claim_ids = sorted(cid for cid, c in self.context.draft["semanticClaims"].items() if nid in c["sourceNodeIds"])
                    old = previous["sourceAccounting"].get(nid)
                    if not decision and not old and not claim_ids:
                        raise ValueError("Every touched source unit needs findings or its own accountable disposition")
                    reason = decision["reason"] if decision else (old or {}).get("nonSemanticReason")
                    blocked = decision and decision["disposition"] == "BLOCKED"
                    if (blocked or not claim_ids) and not reason:
                        raise ValueError("A blocked or non-requirement unit needs a source-faithful reason")
                    missing_refs = [rid for rid in unit["referenceIds"] if rid not in self.context.draft["referenceAccounting"]]
                    # Auto-account any references that target reference-only nodes
                    for rid in list(missing_refs):
                        ref = self.source.references.get(rid)
                        if ref and ref.get("toNodeId") and self.source.is_reference_only(ref["toNodeId"]):
                            frontier.active = unit
                            operations["non_material"](rid, "REFERENCE_ONLY_TARGET")
                            missing_refs.remove(rid)
                    if missing_refs and not blocked:
                        raise ValueError(f"Source unit {nid} has unaccounted referenceIds {missing_refs}. Bind their exact legal dependencies, give non-material reasons, or mark this unit BLOCKED")
                    completions.append({"source_node_id": nid, "claim_ids": claim_ids,
                        "disposition": "REQUIRES_REFERENCE_RESOLUTION" if blocked else "CLAIMS_AUTHORED" if claim_ids else "NO_RELEVANT_SEMANTIC_CLAIMS",
                        **({"reason": reason} if reason else {}), **({"reference_ids": missing_refs} if blocked else {})})
                from rule_set_preparation.claim_inventory import SCHEMA
                for section in AUTHORING_DRAFT_KEYS:
                    for row in self.context.draft[section].values():
                        issues = list(Draft7Validator(SCHEMA["properties"][section]["items"]).iter_errors(row))
                        if issues:
                            raise ValueError(section + ": " + issues[0].message[:300])
                for row in completions:
                    nid = row["source_node_id"]
                    if frontier.states.get(nid) in {"REVIEWED_WITH_CLAIMS", "REVIEWED_NO_CLAIMS", "BLOCKED_REFERENCE"}:
                        result = frontier.reopen(nid, "Direct draft candidate corrected its source-backed findings")
                        if result.get("outcome") != "PASSED":
                            raise ValueError(json.dumps(result, ensure_ascii=False))
                result = frontier.complete_batch(completions)
                if result.get("outcome") != "PASSED":
                    self.context.draft = previous
                    self.ledger.identities = identities
                    for key, value in ownership.items():
                        setattr(frontier, key, value)
                    self.ledger.rebuild_node_index()
                    return result
                self.context.validated_packet = self.context.last_validation = None
                self.ledger.last_failures = []
                self.ledger.rebuild_node_index()
                self.context.progress_revision += 1
                self.packages.clear()
                self.rejected_submissions.clear()
                self.package = None
                return {"outcome": "PASSED", "draftVersion": self.ledger.draft_version,
                    "acceptedCandidateIds": candidate_ids, "completedSourceNodeIds": result.get("completedSourceNodeIds", []),
                    "requirements": len(self.context.draft["legalRequirements"]), "assessmentRules": len(self.context.draft["assessmentRules"]),
                    "nextPackage": self.next_package(),
                    "requiredAction": "Analyze nextPackage; when complete=true, validate_compliance_rule_set"}
            except (ValueError, KeyError, TypeError) as error:
                self.context.draft = previous
                for nid, state in frontier.states.items():
                    if state == "REOPENED":
                        self.context.draft["sourceAccounting"].pop(nid, None)
                self.ledger.identities = identities
                for key, value in ownership.items():
                    setattr(frontier, key, value)
                self.ledger.rebuild_node_index()
                return rejected("SOURCE_SUPPORT_INVALID", str(error)[:2400])


def build_direct_draft_tools(context):
    """Business purpose: Expose the native bounded-package, candidate-read, submission and targeted-correction tools for a direct-draft run.

    Business rules:
    - All tools share the run's DirectDraft state; accepted work is persisted by the governed submit path, and corrections operate only on rejected payloads.

    Execution flow:
    1. Reuse the context's DirectDraft state or initialize and attach one.
    2. Define package/candidate read tools and schema-governed submission/correction tools.
    3. Return the four model-facing tools without running them.

    Failure cases:
    - Invalid tool input is handled by the declared schema or DirectDraft failure result; construction errors propagate.

    Side effects:
    - May attach a run-local DirectDraft instance and constructs tool objects; persistent effects occur only on tool invocation.
    """
    state = context.direct_state or DirectDraft(context)
    context.direct_state = state

    @tool
    def get_next_legal_analysis_package() -> str:
        """Get one bounded Article-based package of pending source units, exact ancestors and references. Completed units are not assigned again.

        Business purpose: Give the agent the next bounded pinned-source package for independent legal analysis.

        Business rules:
        - Only pending/reopened source units and their exact ancestor context are assigned; completed units are not assigned again unless the governed frontier reopens them.

        Execution flow:
        1. Ask the shared DirectDraft state for its next package.
        2. Serialize pinned source, package revision and the required next action.

        Failure cases:
        - Frontier failures are returned in the package result; an exhausted frontier reports `complete=true` instead of an invented package.

        Side effects:
        - Reads durable source-review state and updates run-local package bookkeeping.
        """
        return json.dumps(state.next_package(), ensure_ascii=False)

    @tool
    def get_rule_set_draft_candidate(candidate_id: str) -> str:
        """Read one persisted candidate's facts and evidence for a targeted correction. Never reconstruct the entire Article draft.

        Business purpose: Retrieve one persisted candidate's authored facts and exact support for a targeted correction.

        Business rules:
        - The tool returns only the requested candidate and source evidence needed to revise it; it does not reconstruct the whole Article draft.

        Execution flow:
        1. Resolve the candidate ID through DirectDraft.
        2. Serialize its facts, exact quotes and linked AssessmentRule.

        Failure cases:
        - A candidate ID absent from the current draft returns a repairable CLAIM_SCHEMA_INVALID result.

        Side effects:
        - Adds package metadata to the local correction cache; no candidate content is mutated.
        """
        return json.dumps(state.candidate(candidate_id), ensure_ascii=False)

    @tool(args_schema=SUBMISSION_SCHEMA)
    def submit_rule_set_draft_candidates(**payload: Any) -> str:
        """Business purpose: Persist source-backed legal candidates and their review accounting.

        Business rules:
        - SUBMISSION_SCHEMA defines the typed input; pinned support and candidate ownership remain mandatory. Reuse a candidateId to update only that candidate.
        Execution flow:
        1. Validate package facts. 2. Save the governed draft and source review. 3. Return the persistence receipt.
        Failure cases:
        - Invalid candidates or stale draft versions return repair feedback without accepting rejected facts.
        Side effects:
        - Updates the existing durable authoring draft and source-review progress through the governed API.
        """
        return json.dumps(state.submit(payload), ensure_ascii=False)

    @tool
    def correct_rule_set_draft_submission(package_id: str, patches: list[dict[str, Any]]) -> str:
        """Correct only fields of the last rejected submission, retaining all its other exact authored facts. Each patch has path and value, e.g. {"path":"/candidates/0/nonAssessableReason","value":"External performance"}. Use the same package_id. The complete corrected submission is revalidated and saved atomically; nothing rejected is accepted silently.

        Business purpose: Let the agent repair selected fields of the last rejected direct-draft submission.

        Business rules:
        - Patches must name the same current package; all unchanged authored facts are retained and the complete payload is validated again before any persistence.

        Execution flow:
        1. Pass package ID and path/value patches to DirectDraft correction.
        2. Serialize the corrected submission result.

        Failure cases:
        - Stale package, absent rejected payload or invalid JSON pointer returns a structured failure; rejected facts are never accepted silently.

        Side effects:
        - Invocation may persist the complete corrected submission through the normal governed draft/frontier flow.
        """
        return json.dumps(state.correct(package_id, patches), ensure_ascii=False)

    return [get_next_legal_analysis_package, get_rule_set_draft_candidate, submit_rule_set_draft_candidates, correct_rule_set_draft_submission]
