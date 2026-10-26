"""Direct candidates: bounded structural context, exact evidence and durable recovery."""
from copy import deepcopy
from hashlib import sha256
import json

import pytest

from rule_set_preparation.claim_inventory import ClaimInventory, fingerprint
from rule_set_preparation.direct_draft import DirectDraft
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from test_claim_files import fixture_bundle


class DraftApi:
    """In-memory durability for pure tests; PostgreSQL/HTTP are tested separately."""
    def __init__(self, source):
        self.rows = {nid: {"sourceNodeId": nid, "state": "PENDING", "claimIds": [], "referenceIds": [], "reason": None,
            "payload": {"claims": [], "identities": {}, "relations": [], "referenceAccounting": []}} for nid in source.review_node_ids()}
        self.materialization = source.graph["materializationId"]
        self.saved = None
        self.version = 0
        self.completions = 0
        self.reject = False

    def reply(self, **extra):
        complete = sum(r["state"] in {"REVIEWED_WITH_CLAIMS", "REVIEWED_NO_CLAIMS"} for r in self.rows.values())
        return {"outcome": "PASSED", "sourceRevision": self.materialization, "frontierRevision": 1,
            "frontierFingerprint": "a" * 64, "frontierStateFingerprint": fingerprint(self.rows), "reviewedFrontierFingerprint": fingerprint(self.rows),
            "progress": {"total": len(self.rows), "discoveryCompleteEligible": complete == len(self.rows), "completed": complete}, **extra}

    def source_review_operation(self, run_id, revision, action, **fields):
        if action == "COMPLETE":
            if self.reject or fields["draftVersion"] != self.version:
                return {"outcome": "FAILED", "failures": [{"code": "STALE_AUTHORING_DRAFT", "ref": "draft"}]}
            for row in fields["batch"]:
                self.rows[row["sourceNodeId"]] = {**row, "state": "BLOCKED_REFERENCE" if row["disposition"] == "REQUIRES_REFERENCE_RESOLUTION" else "REVIEWED_WITH_CLAIMS" if row["claimIds"] else "REVIEWED_NO_CLAIMS"}
            self.saved = deepcopy(fields["draft"])
            self.version += 1
            self.completions += 1
            return self.reply(draftVersion=self.version, completedSourceNodeIds=[r["sourceNodeId"] for r in fields["batch"]])
        if action == "REOPEN":
            self.rows[fields["sourceNodeId"]]["state"] = "REOPENED"
        if action == "LOAD":
            rows = list(self.rows.values())[fields["offset"]:fields["offset"] + fields["limit"]]
            return self.reply(records=deepcopy(rows), nextOffset=None, loadedThrough="2026-10-25T00:00:00.000Z")
        return self.reply()

    def claim_inventory_operation(self, run_id, action, revision, **fields):
        assert action == "LOAD_AUTHORING_DRAFT"
        return {"outcome": "PASSED", "draftVersion": self.version, "draft": deepcopy(self.saved)}


def context_for(tmp_path, bundle=None, api=None):
    bundle = bundle or fixture_bundle()
    for document in bundle["documents"]:
        for chunk in document["chunks"]:
            chunk["contentSha256"] = "sha256:" + sha256(chunk["content"].encode()).hexdigest()
    for node in bundle["documentGraph"]["nodes"]:
        node["contentSha256"] = sha256(node["content"].encode()).hexdigest()
    source = PinnedSourceGraph(bundle["documentGraph"], [c for d in bundle["documents"] for c in d["chunks"]])
    api = api or DraftApi(source)
    context = RuleSetPreparationContext("11111111-1111-4111-8111-111111111111", api, source_root=tmp_path, source_graph=source, direct_draft=True)
    context.inventory = ClaimInventory(context)
    return context, DirectDraft(context), api


def candidate(node_id, quote, *, key="protect-data", external=False):
    return {"candidateId": key, "title": "Protect data", "obligations": [{"statement": "Providers must protect data.", "actor": "Providers", "modality": "DUTY", "action": "protect data", "support": [{"nodeId": node_id, "quote": quote}]}],
        "applicability": {"mode": "UNCONDITIONAL", "conditions": []}, "qualifiers": [], "exceptions": [], "definitions": [],
        "repositoryAssessability": "EXTERNAL_FULFILLMENT" if external else "REPOSITORY_VERIFIABLE", "nonAssessableReason": "External performance cannot be established by repository evidence" if external else None,
        "assessmentRule": None if external else {"assessmentRuleId": "rule-" + key, "concept": "Data protection", "investigationFocus": "Inspect storage access controls"}}


def submission(package, values):
    supported = {s["nodeId"] for c in values for f in c["obligations"] for s in f["support"]}
    return {"packageId": package["packageId"], "candidates": values, "legalEffects": [], "references": [], "removeCandidateIds": [],
        "sourceUnits": [{"sourceNodeId": n["nodeId"], "disposition": "ANALYZED" if n["nodeId"] in supported else "NO_REQUIREMENT", "reason": None if n["nodeId"] in supported else "Source heading contains no independent obligation"} for n in package["sourceUnits"]]}


def test_rejected_submission_repairs_one_field_without_resending_facts(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = package["sourceUnits"][0]
    payload = submission(package, [candidate(node["nodeId"], node["content"])])
    payload["candidates"][0]["applicability"]["mode"] = "UNCONDitionAL"
    assert state.submit(payload)["outcome"] == "FAILED"
    assert api.saved is None
    assert not context.draft["legalRequirements"]
    result = state.correct(package["packageId"], [{"path": "/candidates/0/applicability/mode", "value": "UNCONDITIONAL"}])
    assert result["outcome"] == "PASSED", result
    assert api.completions == 1
    assert api.saved["legalRequirements"]["protect-data"]["legalRequirementId"] == "protect-data"
    assert state.rejected_submission is None


def test_correction_cannot_change_pins_or_bypass_validation(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = package["sourceUnits"][0]
    payload = submission(package, [candidate(node["nodeId"], node["content"])])
    payload["candidates"][0]["nonAssessableReason"] = "Wrong for repository assessability"
    assert state.submit(payload)["outcome"] == "FAILED"
    assert state.correct(package["packageId"], [{"path": "/packageId", "value": "invented"}])["outcome"] == "FAILED"
    assert state.correct("stale", [{"path": "/candidates/0/nonAssessableReason", "value": None}])["outcome"] == "FAILED"
    assert state.correct(package["packageId"], [{"path": "/candidates/0/obligations/0/support/0/quote", "value": "fabricated evidence"}])["outcome"] == "FAILED"
    assert api.saved is None
    assert not context.draft["legalRequirements"]


def test_direct_candidate_persists_requirement_rule_and_source_evidence_together_then_recovers(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    value = candidate(node["nodeId"], "phải bảo vệ dữ liệu.")
    result = state.submit(submission(package, [value]))
    assert result["outcome"] == "PASSED", result
    assert api.completions == 1 and api.version == 1
    row = api.saved["legalRequirements"]["protect-data"]
    assert row["applicabilityMode"] == "UNCONDITIONAL" and row["applicabilityConditions"] == []
    assert len(row["operativePropositions"]) == 1 and len(api.saved["assessmentRules"]) == 1
    assert {c["claimType"] for c in context.draft["semanticClaims"].values()} == {"DUTY"}
    recovered, resumed, _ = context_for(tmp_path / "restart", api=api)
    following = resumed.next_package()
    assert recovered.draft["legalRequirements"] == api.saved["legalRequirements"]
    assert recovered.draft["assessmentRules"] == api.saved["assessmentRules"]
    assert not {n["nodeId"] for n in following["sourceUnits"]} & {n["nodeId"] for n in package["sourceUnits"]}
    assert resumed.candidate("protect-data")["candidate"] == {**value, "repositoryObservableAspect": None, "externalFulfillmentAspect": None}


@pytest.mark.parametrize("corrupt", ["quote", "identity", "applicability", "fabricated-rule", "database-rejection"])
def test_rejected_package_cannot_lose_or_partially_accept_candidates(tmp_path, corrupt):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    value = candidate(node["nodeId"], "phải bảo vệ dữ liệu.")
    payload = submission(package, [value])
    if corrupt == "quote": value["obligations"][0]["support"][0]["quote"] = "Invented legal text"
    if corrupt == "identity": payload["candidates"].append(deepcopy(value))
    if corrupt == "applicability": value["applicability"]["mode"] = "CONDITIONAL"
    if corrupt == "fabricated-rule": value["repositoryAssessability"] = "EXTERNAL_FULFILLMENT"
    if corrupt == "database-rejection": api.reject = True
    before = deepcopy(context.draft)
    result = state.submit(payload)
    assert result["outcome"] == "FAILED", result
    assert context.draft == before and api.saved is None and api.completions == 0


def test_duplicate_supported_obligation_has_one_owner(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    values = [candidate(node["nodeId"], "phải bảo vệ dữ liệu.", key=key) for key in ("first", "duplicate")]
    result = state.submit(submission(package, values))
    assert result["outcome"] == "FAILED" and "Duplicate obligation" in result["failures"][0]["detail"]
    assert not context.draft["legalRequirements"] and api.saved is None


def test_one_package_contains_multiple_leaves_and_preserves_only_actual_parent_context(tmp_path):
    bundle = fixture_bundle()
    nodes = bundle["documentGraph"]["nodes"]
    parent = next(n for n in nodes if n["nodeType"] == "CLAUSE")
    parent["content"] = "For providers processing health data:"
    for index, action in enumerate(("Encrypt stored records.", "Restrict access to records.")):
        nodes.append({**parent, "nodeId": sha256(action.encode()).hexdigest(), "nodeType": "POINT", "label": str(index),
            "parentNodeId": parent["nodeId"], "structuralPath": parent["structuralPath"] + "/point/" + str(index), "content": action, "ordinal": parent["ordinal"] + index + 1})
    context, state, api = context_for(tmp_path, bundle)
    package = state.next_package()
    leaves = [n for n in package["sourceUnits"] if n["nodeType"] == "POINT"]
    assert len(leaves) == 2 and all(n["parentNodeId"] == parent["nodeId"] for n in leaves)
    assert len({n["nodeId"] for n in package["ancestorContext"]}) == len(package["ancestorContext"])
    value = candidate(leaves[0]["nodeId"], leaves[0]["content"])
    value["obligations"][0]["action"] = "encrypt stored records"
    value["obligations"].append({**deepcopy(value["obligations"][0]), "action": "restrict access", "statement": "Providers must restrict access to records.", "support": [{"nodeId": leaves[1]["nodeId"], "quote": leaves[1]["content"]}]})
    value["applicability"] = {"mode": "CONDITIONAL", "conditions": [{"statement": "Providers processing health data", "support": [{"nodeId": parent["nodeId"], "quote": parent["content"]}]}]}
    result = state.submit(submission(package, [value]))
    assert result["outcome"] == "PASSED", result
    row = api.saved["legalRequirements"][value["candidateId"]]
    assert len(row["operativePropositions"]) == 2
    assert row["applicabilityConditions"] == ["Providers processing health data"]


def test_external_obligation_is_retained_without_repository_rule_and_tools_have_no_claim_cycle(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    result = state.submit(submission(package, [candidate(node["nodeId"], "phải bảo vệ dữ liệu.", external=True)]))
    assert result["outcome"] == "PASSED", result
    assert api.saved["legalRequirements"] and not api.saved["assessmentRules"]
    names = {t.name for t in build_rule_set_tools(context)}
    assert {"get_next_legal_analysis_package", "submit_rule_set_draft_candidates", "validate_compliance_rule_set", "submit_compliance_rule_set"} <= names
    assert not {"get_claim_inventory", "finalize_semantic_claim_inventory", "start_rule_authoring", "author_legal_requirement", "author_assessment_rule", "commit_claims"} & names


def test_completed_source_still_allows_one_candidate_correction_without_losing_siblings(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    value = candidate(node["nodeId"], "phải bảo vệ dữ liệu.")
    assert state.submit(submission(package, [value]))["outcome"] == "PASSED"
    # A restart has no in-memory package; reading the one affected candidate recovers its repair scope.
    recovered, state, _ = context_for(tmp_path / "restart", api=api)
    recovered.inventory.frontier.restore()
    recovered.inventory.restore_authoring_draft()
    view = state.candidate("protect-data")
    assert view["outcome"] == "PASSED"
    fixed = view["candidate"]
    fixed["title"] = "Corrected requirement title"
    payload = {"packageId": view["packageId"], "candidates": [fixed], "removeCandidateIds": [], "legalEffects": [], "references": [],
        "sourceUnits": [{"sourceNodeId": nid, "disposition": "ANALYZED", "reason": None} for nid in view["sourceNodeIds"]]}
    result = state.submit(payload)
    assert result["outcome"] == "PASSED", result
    assert api.saved["legalRequirements"]["protect-data"]["title"] == fixed["title"]
    assert len(api.saved["legalRequirements"]) == 1 and len(api.saved["assessmentRules"]) == 1


def test_inspecting_candidate_does_not_stale_active_analysis_package(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    value = candidate(node["nodeId"], "phải bảo vệ dữ liệu.")
    assert state.submit(submission(package, [value]))["outcome"] == "PASSED"

    # Now open the next package
    next_pkg = state.next_package()
    assert next_pkg["outcome"] == "PASSED"
    # Inspect the previously created candidate
    cand_view = state.candidate("protect-data")
    assert cand_view["outcome"] == "PASSED"

    # Submitting for next_pkg must NOT fail with STALE_AUTHORING_DRAFT
    payload = {
        "packageId": next_pkg["packageId"],
        "candidates": [],
        "removeCandidateIds": [],
        "legalEffects": [],
        "references": [],
        "sourceUnits": [{"sourceNodeId": u["nodeId"], "disposition": "NO_REQUIREMENT", "reason": "No operative rule"} for u in next_pkg["sourceUnits"]],
    }
    result = state.submit(payload)
    assert result["outcome"] == "PASSED", result



def test_incompatible_actors_are_rejected_before_any_persistence(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    value = candidate(node["nodeId"], "phải bảo vệ dữ liệu.")
    value["obligations"].append({**deepcopy(value["obligations"][0]), "actor": "Deployers"})
    result = state.submit(submission(package, [value]))
    assert result["outcome"] == "FAILED" and "different actors" in result["failures"][0]["detail"]
    assert not api.saved and not context.draft["legalRequirements"]


def test_unresolved_material_reference_persists_blocked_candidates_without_a_fabricated_edge(tmp_path):
    bundle = fixture_bundle()
    node = next(n for n in bundle["documentGraph"]["nodes"] if "phải" in n["content"])
    rid = "f" * 64
    bundle["documentGraph"]["references"] = [{"referenceId": rid, "fromNodeId": node["nodeId"], "toNodeId": None,
        "resolutionState": "UNRESOLVED", "candidateNodeIds": [], "text": "Referenced rule", "charStart": 0, "charEnd": 1}]
    context, state, api = context_for(tmp_path, bundle)
    package = state.next_package()
    payload = submission(package, [candidate(node["nodeId"], "phải bảo vệ dữ liệu.")])
    next(u for u in payload["sourceUnits"] if u["sourceNodeId"] == node["nodeId"]).update(disposition="BLOCKED", reason="External target is missing from the pinned corpus")
    payload["references"] = [{"referenceId": rid, "material": True, "reason": "External target is missing", "fromCandidateId": "protect-data", "targetNodeId": None, "kind": "INCORPORATES"}]
    result = state.submit(payload)
    assert result["outcome"] == "PASSED", result
    assert api.saved["legalRequirements"] and not context.draft["claimRelations"]
    assert api.rows[node["nodeId"]]["state"] == "BLOCKED_REFERENCE"
    assert rid not in context.draft["referenceAccounting"]


def test_mixed_assessability_retains_requirement_and_rule_with_both_aspects(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    value = candidate(node["nodeId"], "phải bảo vệ dữ liệu.", key="mixed-data")
    value["repositoryAssessability"] = "MIXED"
    value["nonAssessableReason"] = None
    value["repositoryObservableAspect"] = "Audit logs must record data access"
    value["externalFulfillmentAspect"] = "Annual third-party compliance audit"
    value["assessmentRule"] = {
        "assessmentRuleId": "rule-mixed-data",
        "concept": "Access audit logging",
        "investigationFocus": "Verify audit log daemon configuration and permissions",
    }
    result = state.submit(submission(package, [value]))
    assert result["outcome"] == "PASSED", result
    assert api.completions == 1
    req = api.saved["legalRequirements"]["mixed-data"]
    assert req["coverage"]["state"] == "COVERED_BY_ASSESSMENT_RULES"
    assert req["coverage"]["nonAssessableReason"] is None
    assert req["nonRepositoryDuty"] is False
    assert len(api.saved["assessmentRules"]) == 1
    assert api.saved["assessmentRules"]["rule-mixed-data"]["concept"] == "Access audit logging"

    # Recover and verify candidate extraction preserves aspects
    recovered, resumed, _ = context_for(tmp_path / "restart", api=api)
    recovered.inventory.frontier.restore()
    recovered.inventory.restore_authoring_draft()
    view = resumed.candidate("mixed-data")
    assert view["outcome"] == "PASSED", view
    c = view["candidate"]
    assert c["repositoryAssessability"] == "MIXED"
    assert c["repositoryObservableAspect"] == "Audit logs must record data access"
    assert c["externalFulfillmentAspect"] == "Annual third-party compliance audit"


def test_correction_safe_pointer_and_bounds_checking(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = package["sourceUnits"][0]
    payload = submission(package, [candidate(node["nodeId"], node["content"])])
    payload["candidates"][0]["applicability"]["mode"] = "INVALID_MODE"
    assert state.submit(payload)["outcome"] == "FAILED"

    # Test out of bounds index
    bad_index = state.correct(package["packageId"], [{"path": "/candidates/99/applicability/mode", "value": "UNCONDITIONAL"}])
    assert bad_index["outcome"] == "FAILED"
    assert "out of range" in bad_index["failures"][0]["detail"]

    # Test non-integer index for array
    bad_key = state.correct(package["packageId"], [{"path": "/candidates/first/applicability/mode", "value": "UNCONDITIONAL"}])
    assert bad_key["outcome"] == "FAILED"
    assert "expected integer index" in bad_key["failures"][0]["detail"]

    # Test adding previously omitted field like repositoryObservableAspect
    add_field = state.correct(package["packageId"], [
        {"path": "/candidates/0/applicability/mode", "value": "UNCONDITIONAL"},
        {"path": "/candidates/0/repositoryObservableAspect", "value": "Observability verified"},
    ])
    assert add_field["outcome"] == "PASSED", add_field
    assert api.completions == 1


def test_mixed_candidate_without_rule_or_with_reason_is_rejected(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = package["sourceUnits"][0]
    
    # 1. MIXED with null assessmentRule must be rejected
    bad1 = candidate(node["nodeId"], node["content"], key="mixed-bad1")
    bad1["repositoryAssessability"] = "MIXED"
    bad1["repositoryObservableAspect"] = "Observable aspect"
    bad1["externalFulfillmentAspect"] = "External aspect"
    bad1["assessmentRule"] = None
    bad1["nonAssessableReason"] = "Reason given"
    res1 = state.submit(submission(package, [bad1]))
    assert res1["outcome"] == "FAILED", res1
    assert any("Mixed duties" in f["detail"] for f in res1["failures"])

    # 2. MIXED with nonAssessableReason != null must be rejected
    bad2 = candidate(node["nodeId"], node["content"], key="mixed-bad2")
    bad2["repositoryAssessability"] = "MIXED"
    bad2["repositoryObservableAspect"] = "Observable aspect"
    bad2["externalFulfillmentAspect"] = "External aspect"
    bad2["nonAssessableReason"] = "Reason shouldn't be here"
    res2 = state.submit(submission(package, [bad2]))
    assert res2["outcome"] == "FAILED", res2
    assert any("Mixed duties" in f["detail"] for f in res2["failures"])


def test_unresolved_reference_cannot_forge_reference_only_target(tmp_path):
    bundle = fixture_bundle()
    node = next(n for n in bundle["documentGraph"]["nodes"] if "phải" in n["content"])
    rid = "e" * 64
    bundle["documentGraph"]["references"] = [{
        "referenceId": rid,
        "fromNodeId": node["nodeId"],
        "toNodeId": None,
        "resolutionState": "UNRESOLVED",
        "candidateNodeIds": [],
        "text": "Law 71",
        "charStart": 0,
        "charEnd": 6,
    }]
    context, state, api = context_for(tmp_path, bundle)
    package = state.next_package()
    payload = submission(package, [candidate(node["nodeId"], "phải bảo vệ dữ liệu.")])
    # The model attempts to claim REFERENCE_ONLY_TARGET on an UNRESOLVED reference
    payload["references"] = [{
        "referenceId": rid,
        "material": False,
        "reason": "REFERENCE_ONLY_TARGET",
        "fromCandidateId": None,
        "targetNodeId": None,
        "kind": None,
    }]
    result = state.submit(payload)
    assert result["outcome"] == "FAILED", result
    assert any("not a verified REFERENCE_ONLY node" in f["detail"] for f in result["failures"])


def test_reference_only_target_normalization_on_resolved_reference_only_target(tmp_path):
    bundle = fixture_bundle()
    bundle["documents"][1]["corpusRole"] = "REFERENCE_ONLY"
    bundle["documentGraph"]["referenceOnlyDocumentIds"] = ["qd-33"]
    origin = next(n for n in bundle["documentGraph"]["nodes"] if n["documentId"] == "luat-134" and "phải" in n["content"])
    target = next(n for n in bundle["documentGraph"]["nodes"] if n["documentId"] == "qd-33")
    rid = "e" * 64
    bundle["documentGraph"]["references"] = [{
        "referenceId": rid,
        "fromNodeId": origin["nodeId"],
        "toNodeId": target["nodeId"],
        "resolutionState": "RESOLVED",
        "candidateNodeIds": [],
        "text": "QD 33",
        "charStart": 0,
        "charEnd": 5,
    }]
    context, state, api = context_for(tmp_path, bundle)
    package = state.next_package()
    payload = submission(package, [candidate(origin["nodeId"], "phải bảo vệ dữ liệu.")])
    # Model provides kind="REFERENCE_ONLY_TARGET" on a verified reference-only target
    payload["references"] = [{
        "referenceId": rid,
        "material": True,
        "reason": None,
        "fromCandidateId": "protect-data",
        "targetNodeId": None,
        "kind": "REFERENCE_ONLY_TARGET",
    }]
    result = state.submit(payload)
    assert result["outcome"] == "PASSED", result
    assert rid in context.draft["referenceAccounting"]
    assert context.draft["referenceAccounting"][rid]["nonMaterialReason"] == "REFERENCE_ONLY_TARGET"
    assert not any(rel["referenceId"] == rid for rel in context.draft["claimRelations"])


def test_project_context_relations_projects_cross_requirement_edges(tmp_path):
    from rule_set_preparation.direct_draft import project_context_relations
    context, state, api = context_for(tmp_path)
    # Set up two requirements with separate claims
    context.draft["legalRequirements"] = {
        "req-a": {"legalRequirementId": "req-a", "claimBindings": [{"claimId": "c-1", "role": "OPERATIVE_PROPOSITION", "index": 0}]},
        "req-b": {"legalRequirementId": "req-b", "claimBindings": [{"claimId": "c-2", "role": "OPERATIVE_PROPOSITION", "index": 0}]},
    }
    # An INCORPORATES relation between c-1 and c-2
    context.draft["claimRelations"] = {
        "r-1": {"relationId": "r-1", "fromClaimId": "c-1", "toClaimId": "c-2", "kind": "INCORPORATES"}
    }
    project_context_relations(context)
    assert len(context.draft["contextRelations"]) == 1
    rel = list(context.draft["contextRelations"].values())[0]
    assert rel["fromLegalRequirementId"] == "req-a"
    assert rel["toLegalRequirementId"] == "req-b"
    assert rel["kind"] == "CROSS_REFERENCE"
    assert rel["toSourceRef"] is None


def test_reference_only_definition_used_as_context_and_material_reference(tmp_path):
    bundle = fixture_bundle()
    bundle["documents"][1]["corpusRole"] = "REFERENCE_ONLY"
    bundle["documentGraph"]["referenceOnlyDocumentIds"] = ["qd-33"]
    origin = next(n for n in bundle["documentGraph"]["nodes"] if n["documentId"] == "luat-134" and "phải" in n["content"])
    target = next(n for n in bundle["documentGraph"]["nodes"] if n["documentId"] == "qd-33" and n["content"])
    rid = "d" * 64
    bundle["documentGraph"]["references"] = [{
        "referenceId": rid,
        "fromNodeId": origin["nodeId"],
        "toNodeId": target["nodeId"],
        "resolutionState": "RESOLVED",
        "candidateNodeIds": [],
        "text": "QD 33",
        "charStart": 0,
        "charEnd": 5,
    }]
    context, state, api = context_for(tmp_path, bundle)
    package = state.next_package()
    c = candidate(origin["nodeId"], "phải bảo vệ dữ liệu.")
    # Add definition from reference-only document target
    c["definitions"] = [{
        "statement": "Hệ thống AI được hiểu theo Quyết định 33.",
        "support": [{"nodeId": target["nodeId"], "quote": target["content"][:20]}],
    }]
    payload = submission(package, [c])
    payload["references"] = [{
        "referenceId": rid,
        "material": True,
        "reason": None,
        "fromCandidateId": "protect-data",
        "targetNodeId": target["nodeId"],
        "kind": "DEFINED_BY",
    }]
    result = state.submit(payload)
    assert result["outcome"] == "PASSED", result
    assert rid in context.draft["referenceAccounting"]
    assert context.draft["referenceAccounting"][rid]["material"] is True
    rel = next(r for r in context.draft["claimRelations"].values() if r.get("referenceId") == rid)
    assert rel["kind"] == "DEFINED_BY"


def test_legal_effects_partial_repeal_article_repeal_and_exact_vs_subtree(tmp_path):
    from rule_set_preparation.legal_effect import applicable_legal_state
    bundle = fixture_bundle()
    context, state, api = context_for(tmp_path, bundle)
    source = context.source_graph
    target_art = next(n for n in source.nodes.values() if n["documentId"] == "qd-33" and n["nodeType"] == "ARTICLE")
    child_clause = next(n for n in source.nodes.values() if n["parentNodeId"] == target_art["nodeId"])
    sibling_art = next(n for n in source.nodes.values() if n["documentId"] == target_art["documentId"] and n["nodeType"] == "ARTICLE" and n != target_art)
    owner = next(n for n in source.nodes.values() if n["documentId"] == "luat-134" and n["content"])

    # 1. Partial repeal of a single clause (EXACT)
    effect_exact = {"kind": "REPEALS", "targets": [{"nodeId": child_clause["nodeId"], "scope": "EXACT"}],
                    "unresolvedTargets": [], "effectiveFrom": "2026-01-01", "effectiveUntil": None, "conditions": None}
    claim_exact = {"claimId": "reviewed-exact-repeal", "sourceNodeIds": [owner["nodeId"]], "semanticFrame": {"legalEffect": effect_exact},
                   "sourceSupport": [{"nodeId": owner["nodeId"], "startOffset": 0, "endOffset": 1}]}
    from types import SimpleNamespace
    frontier = SimpleNamespace(restore=lambda **_: None, claim_owners={}, snapshot={"progress": {"discoveryCompleteEligible": True}})
    ctx = SimpleNamespace(source_graph=source, draft={"sourceAccounting": {owner["nodeId"]: {}}},
                          inventory=SimpleNamespace(frontier=frontier, graph=lambda: {"claims": [claim_exact]}))

    res_child = applicable_legal_state(ctx, child_clause["nodeId"], "2026-10-25")
    assert res_child["applicableVerifiedKinds"] == ["REPEALS"]
    res_parent = applicable_legal_state(ctx, target_art["nodeId"], "2026-10-25")
    assert res_parent["applicableVerifiedKinds"] == []

    # 2. Repeal of entire article (SUBTREE)
    effect_subtree = {"kind": "REPEALS", "targets": [{"nodeId": target_art["nodeId"], "scope": "SUBTREE"}],
                      "unresolvedTargets": [], "effectiveFrom": "2026-01-01", "effectiveUntil": None, "conditions": None}
    claim_subtree = {"claimId": "reviewed-subtree-repeal", "sourceNodeIds": [owner["nodeId"]], "semanticFrame": {"legalEffect": effect_subtree},
                     "sourceSupport": [{"nodeId": owner["nodeId"], "startOffset": 0, "endOffset": 1}]}
    ctx_sub = SimpleNamespace(source_graph=source, draft={"sourceAccounting": {owner["nodeId"]: {}}},
                             inventory=SimpleNamespace(frontier=frontier, graph=lambda: {"claims": [claim_subtree]}))
    assert applicable_legal_state(ctx_sub, target_art["nodeId"], "2026-10-25")["applicableVerifiedKinds"] == ["REPEALS"]
    assert applicable_legal_state(ctx_sub, child_clause["nodeId"], "2026-10-25")["applicableVerifiedKinds"] == ["REPEALS"]
    assert applicable_legal_state(ctx_sub, sibling_art["nodeId"], "2026-10-25")["applicableVerifiedKinds"] == []


def test_amendment_affecting_reference_only_document(tmp_path):
    bundle = fixture_bundle()
    bundle["documents"][1]["corpusRole"] = "REFERENCE_ONLY"
    bundle["documentGraph"]["referenceOnlyDocumentIds"] = ["qd-33"]
    origin = next(n for n in bundle["documentGraph"]["nodes"] if n["documentId"] == "luat-134" and "phải" in n["content"])
    target = next(n for n in bundle["documentGraph"]["nodes"] if n["documentId"] == "qd-33" and n["content"])
    rid = "a" * 64
    bundle["documentGraph"]["references"] = [{
        "referenceId": rid,
        "fromNodeId": origin["nodeId"],
        "toNodeId": target["nodeId"],
        "resolutionState": "RESOLVED",
        "candidateNodeIds": [],
        "text": "QD 33",
        "charStart": 0,
        "charEnd": 5,
    }]
    context, state, api = context_for(tmp_path, bundle)
    package = state.next_package()
    c = candidate(origin["nodeId"], "phải bảo vệ dữ liệu.")
    payload = submission(package, [c])
    payload["legalEffects"] = [{
        "effectId": "amend-qd33",
        "statement": "Sửa đổi Quyết định 33.",
        "support": [{"nodeId": origin["nodeId"], "quote": "phải bảo vệ dữ liệu."}],
        "legalEffect": {
            "kind": "AMENDS",
            "targets": [{"nodeId": target["nodeId"], "scope": "EXACT"}],
            "unresolvedTargets": [],
            "effectiveFrom": "2026-01-01",
            "effectiveUntil": None,
            "conditions": None,
        },
    }]
    payload["references"] = [{
        "referenceId": rid,
        "material": True,
        "reason": None,
        "fromCandidateId": None,
        "targetNodeId": target["nodeId"],
        "kind": None,
    }]
    result = state.submit(payload)
    assert result["outcome"] == "PASSED", result
    assert rid in context.draft["referenceAccounting"]
    assert context.draft["referenceAccounting"][rid]["material"] is True


def test_stringified_json_arguments_are_normalized_and_accepted(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = next(n for n in package["sourceUnits"] if "phải" in n["content"])
    value = candidate(node["nodeId"], "phải bảo vệ dữ liệu.")
    payload = submission(package, [value])
    # Pass candidates and sourceUnits as JSON strings, simulating LLM tool serializers
    payload["candidates"] = json.dumps(payload["candidates"])
    payload["sourceUnits"] = json.dumps(payload["sourceUnits"])
    result = state.submit(payload)
    assert result["outcome"] == "PASSED", result
    assert api.completions == 1
    assert "protect-data" in api.saved["legalRequirements"]

    # Test correction with patches passed as a JSON string
    context2, state2, _ = context_for(tmp_path / "patch")
    package2 = state2.next_package()
    node2 = package2["sourceUnits"][0]
    payload2 = submission(package2, [candidate(node2["nodeId"], node2["content"])])
    payload2["candidates"][0]["applicability"]["mode"] = "INVALID_MODE"
    assert state2.submit(payload2)["outcome"] == "FAILED"
    patch_str = json.dumps([{"path": "/candidates/0/applicability/mode", "value": "UNCONDITIONAL"}])
    corr_result = state2.correct(package2["packageId"], patch_str)
    assert corr_result["outcome"] == "PASSED", corr_result


def test_multiple_open_packages_correct_targets_exact_rejected_package_payload(tmp_path):
    context, state, api = context_for(tmp_path)
    # Seed an initial candidate to enable candidate inspection
    pkg_init = state.next_package()
    node1 = pkg_init["sourceUnits"][0]
    sub_init = state.submit(submission(pkg_init, [candidate(node1["nodeId"], node1["content"], key="cand-pkg-1")]))
    assert sub_init["outcome"] == "PASSED"

    # Open package 1 via public candidate inspection
    package1 = state.candidate("cand-pkg-1")
    assert package1["outcome"] == "PASSED"

    # Open package 2 via public next_package for remaining units
    package2 = state.next_package()
    assert package2["outcome"] == "PASSED"
    node2 = package2["sourceUnits"][0]

    # Package 1 submission with invalid applicability mode
    payload1 = {
        "packageId": package1["packageId"],
        "candidates": [candidate(node1["nodeId"], node1["content"], key="cand-pkg-1")],
        "legalEffects": [],
        "references": [],
        "removeCandidateIds": [],
        "sourceUnits": [{"sourceNodeId": node1["nodeId"], "disposition": "ANALYZED", "reason": None}],
    }
    payload1["candidates"][0]["applicability"]["mode"] = "INVALID_MODE_1"
    sub1 = state.submit(payload1)
    assert sub1["outcome"] == "FAILED"
    assert package1["packageId"] in state.rejected_submissions

    # Package 2 submission with a different error
    payload2 = submission(package2, [candidate(node2["nodeId"], node2["content"], key="cand-pkg-2")])
    payload2["candidates"][0]["applicability"]["mode"] = "INVALID_MODE_2"
    sub2 = state.submit(payload2)
    assert sub2["outcome"] == "FAILED"
    assert package2["packageId"] in state.rejected_submissions

    # Correcting package 1 must use package 1's rejected payload, NOT package 2's
    corr1 = state.correct(package1["packageId"], [{"path": "/candidates/0/applicability/mode", "value": "UNCONDITIONAL"}])
    assert corr1["outcome"] == "PASSED", corr1
    assert "cand-pkg-1" in api.saved["legalRequirements"]
    assert "cand-pkg-2" not in api.saved["legalRequirements"]


def test_same_package_id_across_revisions_rejects_stale_payload(tmp_path):
    context, state, api = context_for(tmp_path)
    # Open package at revision 0
    package_v0 = state.next_package()
    node = package_v0["sourceUnits"][0]
    payload_v0 = submission(package_v0, [candidate(node["nodeId"], node["content"], key="cand-v0")])

    # Advance draft revision from 0 to 1
    state.ledger.draft_version += 1
    api.version += 1
    context.draft_revision = 1

    # Re-issue package for the same pending units at revision 1
    package_v1 = state.next_package()
    # Cryptographic binding must prove exact revision/generation: packageIds must differ
    assert package_v1["packageId"] != package_v0["packageId"]
    assert package_v1["draftVersion"] == 1

    # Attempting to submit stale payload authored against revision 0 must be rejected
    res = state.submit(payload_v0)
    assert res["outcome"] == "FAILED"
    assert res["failures"][0]["code"] == "STALE_AUTHORING_DRAFT"


def test_actual_multi_package_correction_via_public_tool_path(tmp_path):
    context, state, api = context_for(tmp_path)

    # 1. Seed initial candidate cand-1 via public tool methods (next_package + submit)
    pkg0 = state.next_package()
    node0 = pkg0["sourceUnits"][0]
    sub0 = state.submit(submission(pkg0, [candidate(node0["nodeId"], node0["content"], key="cand-1")]))
    assert sub0["outcome"] == "PASSED", sub0
    assert "cand-1" in context.draft["legalRequirements"]

    # 2. Open two packages via public tool paths without manual registry injection:
    # Package 1 via candidate inspection
    pkg1 = state.candidate("cand-1")
    assert pkg1["outcome"] == "PASSED"
    # Package 2 via next_package for remaining pending units
    pkg2 = state.next_package()
    assert pkg2["outcome"] == "PASSED"

    assert pkg1["packageId"] in state.packages
    assert pkg2["packageId"] in state.packages
    assert pkg1["packageId"] != pkg2["packageId"]

    # 3. Reject submissions for both packages:
    # Reject package 1 with invalid applicability mode
    payload1 = {
        "packageId": pkg1["packageId"],
        "candidates": [candidate(node0["nodeId"], node0["content"], key="cand-1")],
        "legalEffects": [],
        "references": [],
        "removeCandidateIds": [],
        "sourceUnits": [{"sourceNodeId": node0["nodeId"], "disposition": "ANALYZED", "reason": None}],
    }
    payload1["candidates"][0]["applicability"]["mode"] = "INVALID_MODE_1"
    sub1 = state.submit(payload1)
    assert sub1["outcome"] == "FAILED"
    assert pkg1["packageId"] in state.rejected_submissions

    # Reject package 2 with invalid applicability mode
    node2 = pkg2["sourceUnits"][0]
    payload2 = submission(pkg2, [candidate(node2["nodeId"], node2["content"], key="cand-2")])
    payload2["candidates"][0]["applicability"]["mode"] = "INVALID_MODE_2"
    sub2 = state.submit(payload2)
    assert sub2["outcome"] == "FAILED"
    assert pkg2["packageId"] in state.rejected_submissions

    # 4. Correct package 1 via state.correct(...)
    corr1 = state.correct(pkg1["packageId"], [{"path": "/candidates/0/applicability/mode", "value": "UNCONDITIONAL"}])
    assert corr1["outcome"] == "PASSED", corr1
    assert "cand-1" in api.saved["legalRequirements"]
    assert "cand-2" not in api.saved["legalRequirements"]

    # 5. Verify package 2 is invalidated (STALE_AUTHORING_DRAFT) because draft revision changed
    corr2 = state.correct(pkg2["packageId"], [{"path": "/candidates/0/applicability/mode", "value": "UNCONDITIONAL"}])
    assert corr2["outcome"] == "FAILED"
    assert corr2["failures"][0]["code"] == "STALE_AUTHORING_DRAFT"

    # Also verify direct submit with stale package 2 fails with STALE_AUTHORING_DRAFT
    payload2_valid = submission(pkg2, [candidate(node2["nodeId"], node2["content"], key="cand-2")])
    sub2_stale = state.submit(payload2_valid)
    assert sub2_stale["outcome"] == "FAILED"
    assert sub2_stale["failures"][0]["code"] == "STALE_AUTHORING_DRAFT"

    # 6. Verify package 2 is recoverable via public tool path
    pkg2_recovered = state.next_package()
    assert pkg2_recovered["outcome"] == "PASSED"
    assert pkg2_recovered["draftVersion"] == state.ledger.draft_version
    payload2_recovered = submission(pkg2_recovered, [candidate(node2["nodeId"], node2["content"], key="cand-2")])
    sub2_recovered = state.submit(payload2_recovered)
    assert sub2_recovered["outcome"] == "PASSED", sub2_recovered

    # 7. Verify candidate evidence is strictly preserved and candidate 2 is persisted
    assert "cand-1" in api.saved["legalRequirements"]
    assert "cand-2" in api.saved["legalRequirements"]
    assert "cand-1" in context.draft["legalRequirements"]
    assert "cand-2" in context.draft["legalRequirements"]


def test_stale_package_rejected_after_draft_revision_changes(tmp_path):
    context, state, api = context_for(tmp_path)
    package = state.next_package()
    node = package["sourceUnits"][0]
    stale_draft_ver = state.ledger.draft_version  # 0

    # Submit valid candidate for package -> advances draft revision to 1
    val = candidate(node["nodeId"], node["content"], key="first-candidate")
    sub = state.submit(submission(package, [val]))
    assert sub["outcome"] == "PASSED"
    assert state.ledger.draft_version == 1

    # Attempting to submit or correct using an old package snapshot with draftVersion=0
    stale_pkg_id = "c" * 64
    stale_pkg = {"packageId": stale_pkg_id, "sourceNodeIds": [node["nodeId"]], "draftVersion": stale_draft_ver}
    state.packages[stale_pkg_id] = stale_pkg
    stale_payload = {
        "packageId": stale_pkg_id,
        "candidates": [candidate(node["nodeId"], node["content"], key="stale-cand")],
        "legalEffects": [],
        "references": [],
        "removeCandidateIds": [],
        "sourceUnits": [{"sourceNodeId": node["nodeId"], "disposition": "ANALYZED", "reason": None}],
    }
    res_submit = state.submit(stale_payload)
    assert res_submit["outcome"] == "FAILED"
    assert res_submit["failures"][0]["code"] == "STALE_AUTHORING_DRAFT"
    assert "Draft revision has changed" in res_submit["failures"][0]["detail"]

    # Also verifying correct() on a stale package fails
    state.rejected_submissions[stale_pkg_id] = stale_payload
    res_correct = state.correct(stale_pkg_id, [{"path": "/candidates/0/title", "value": "New title"}])
    assert res_correct["outcome"] == "FAILED"
    assert res_correct["failures"][0]["code"] == "STALE_AUTHORING_DRAFT"


def test_stale_validation_cleared_on_draft_advance_and_does_not_poison_next_package(tmp_path):
    context, state, api = context_for(tmp_path)
    # Seed an initial candidate so the requirement exists
    package = state.next_package()
    node = package["sourceUnits"][0]
    val = candidate(node["nodeId"], node["content"], key="cand-valid")
    sub = state.submit(submission(package, [val]))
    assert sub["outcome"] == "PASSED"

    # Simulate historical validation failure received from server (e.g. at draft version 1)
    state.ledger.last_failures = [
        {"code": "LEGAL_REQUIREMENT_UNACCOUNTED", "ref": "legalRequirement:cand-valid", "detail": "Stale validation"}
    ]
    assert len(state.ledger.last_failures) == 1

    # Advance the draft by submitting candidate on next package
    next_pkg = state.next_package()
    assert next_pkg["outcome"] == "PASSED"
    node2 = next_pkg["sourceUnits"][0]
    val2 = candidate(node2["nodeId"], node2["content"], key="cand-valid-2")
    sub2 = state.submit(submission(next_pkg, [val2]))
    assert sub2["outcome"] == "PASSED"

    # Invariant: last_failures must be cleared to [] on draft advance so stale rejections do not persist
    assert state.ledger.last_failures == []






