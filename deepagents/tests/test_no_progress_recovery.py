"""Retained failure contract replay; scripted verdicts are not semantic-accuracy evidence."""
from contextlib import redirect_stdout
from copy import deepcopy
from io import StringIO
import hashlib
import json
from pathlib import Path
import subprocess

import pytest

from middleware.failure_policy import NoProgressDetected
from review_frontier_harness import call
from rule_set_preparation.claim_inventory import fingerprint
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from structural_semantic_fixture import MechanicalTools, StructuralFixtureAuditor
from vertical.fixture_chunks import main as fixture_chunks

ROOT = Path(__file__).resolve().parents[2]
VERSION = "f3516f9a-b5a9-433d-acfb-681d2ba12b8e"
RUN = "06548392-6488-4a84-93ea-1af3bca2b80b"


def source_fixture():
    output = StringIO()
    with redirect_stdout(output):
        fixture_chunks()
    return json.loads(output.getvalue())


def structural_hash(value):
    # TS structuralHash hashes JSON.stringify, including the quotes of a string.
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class ScriptedFrontierApi:
    """In-memory API boundary, following active-first NEXT and explicit REOPEN.

    This does not establish transactional/database correctness of the TS handler.
    """
    def __init__(self, nodes):
        self.nodes = nodes
        self.rows = {n["nodeId"]: {"sourceNodeId": n["nodeId"], "state": "PENDING", "claimIds": [],
            "payload": {"claims": [], "identities": {}, "relations": [], "referenceAccounting": []}} for n in nodes}
        self.operations = []

    def source_review_operation(self, run_id, revision, action, **fields):
        self.operations.append((action, deepcopy(fields)))
        unit = None
        if action == "NEXT":
            row = next((r for state in ["IN_REVIEW", "PENDING", "REOPENED"] for r in self.rows.values() if r["state"] == state), None)
            if row:
                row["state"] = "IN_REVIEW"
                node = next(n for n in self.nodes if n["nodeId"] == row["sourceNodeId"])
                unit = {**deepcopy(row), "node": node, "structuralPath": node["structuralPath"], "ancestors": [],
                    "references": [], "referenceIds": [], "moreReferences": False, "contentLength": len(node["content"]), "contentTruncated": False}
        if action == "REOPEN":
            self.rows[fields["sourceNodeId"]]["state"] = "REOPENED"
        if action == "COMPLETE":
            row = self.rows[fields["sourceNodeId"]]
            assert row["state"] == "IN_REVIEW"
            assert all(row["sourceNodeId"] in c["sourceNodeIds"] for c in fields["payload"]["claims"])
            row.update(payload=deepcopy(fields["payload"]), claimIds=fields["claimIds"], reason=fields.get("reason"),
                state="REVIEWED_WITH_CLAIMS" if fields["claimIds"] else "REVIEWED_NO_CLAIMS")
        counts = {state: sum(r["state"] == state for r in self.rows.values()) for state in
            ["PENDING", "REOPENED", "IN_REVIEW", "REVIEWED_WITH_CLAIMS", "REVIEWED_NO_CLAIMS"]}
        result = {"outcome": "PASSED", "sourceRevision": "b" * 64, "frontierRevision": 1,
            "frontierFingerprint": "c" * 64, "frontierStateFingerprint": fingerprint(self.rows),
            "progress": {"total": len(self.rows), "pending": counts["PENDING"] + counts["REOPENED"], "inReview": counts["IN_REVIEW"],
                "reviewedWithClaims": counts["REVIEWED_WITH_CLAIMS"], "reviewedNoClaims": counts["REVIEWED_NO_CLAIMS"], "blocked": 0,
                "discoveryCompleteEligible": all(r["state"].startswith("REVIEWED_") for r in self.rows.values())}}
        if action == "LOAD":
            result.update(records=[deepcopy(r) for r in self.rows.values() if r["state"] != "PENDING"], nextOffset=None)
        if action == "NEXT":
            result["unit"] = unit
        if action == "COMPLETE":
            result.update(state=row["state"], claimIds=row["claimIds"], completedSourceNodeId=row["sourceNodeId"])
        return result


class ScriptedAuditor(StructuralFixtureAuditor):
    def __init__(self, rejected_node):
        super().__init__()
        self.rejected_node = rejected_node

    def audit(self, value):
        receipt = super().audit(value)
        if value["sourceNodeId"] == self.rejected_node:
            unsupported = {c["claimId"] for c in value["claims"] if c["semanticAuthority"] != "DEFINITION"}
            for row in receipt["assertions"]:
                if row["id"] not in unsupported:
                    continue
                row.update(verdict="WRONG_SEMANTIC_AUTHORITY", gapCodes=["WRONG_SEMANTIC_AUTHORITY"])
                row["checks"]["semanticAuthority"] = "WRONG_SEMANTIC_AUTHORITY"
            if unsupported:
                receipt.update(verdict="WRONG_SEMANTIC_AUTHORITY", gaps=[{"code": "WRONG_SEMANTIC_AUTHORITY",
                    "detail": "Scripted rejection of the supplied candidate"} for _ in unsupported])
        return receipt


def runtime():
    fixture = source_fixture()
    chunk = next(c for c in fixture["chunks"] if c["locator"] == "art-4::cl-1::pt-a")
    path = "/document/" + fixture["documentId"].lower() + "/chapter/i/article/4/clause/1/point/a"
    nodes = []
    # Persisted historical materializations must remain repairable after the adapter is fixed.
    for suffix in ["", "/occurrence/2"]:
        node_path = path + suffix
        node_id = structural_hash([VERSION, fixture["documentId"], node_path, structural_hash(" ".join(chunk["content"].split()))])
        nodes.append({"nodeId": node_id, "parentNodeId": None, "structuralPath": node_path, "nodeType": "POINT", "label": "a",
            "title": "", "content": chunk["content"], "ordinal": len(nodes), "documentId": fixture["documentId"],
            "legalSourceVersionId": VERSION, "legalEffectStatus": "UNKNOWN"})
    api = ScriptedFrontierApi(nodes)
    source = PinnedSourceGraph({"nodes": nodes, "references": [], "chunkMappings": [], "legalSourceVersionId": VERSION, "materializationId": "b" * 64}, [])
    ctx = RuleSetPreparationContext(RUN, api, source_graph=source, discovery_only=True, semantic_auditor=ScriptedAuditor(nodes[1]["nodeId"]))
    tools = MechanicalTools(ctx, build_rule_set_tools(ctx))
    return ctx, tools, nodes


def author_previous_unit(ctx, tools):
    call(tools, "get_next_review_unit")
    ids = [call(tools, "register_semantic_claim", identity_key=key, claim_type="CONTEXT", statement=key)["claim"]["claimId"]
        for key in ["timestamp begins period", "timestamp recorded at receipt"]]
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    call(tools, "get_next_review_unit")
    return ids


def test_retained_tail_rejects_foreign_accounting_before_audit_and_keeps_guard():
    ctx, tools, nodes = runtime()
    assert nodes[0]["nodeId"] == "201f5b149d763fb887a0771e61e59edb49820157618d8565211d1feb2ca8cd15"
    assert nodes[1]["nodeId"] == "6d1c217a3f0350d72d998c7e6360707bd1c5b28290dfbcc56971ffb1b9bd9bbb"
    ids = author_previous_unit(ctx, tools)
    before = deepcopy(ctx.draft)
    # Scripted Producer: the exact tail shape [63..68], including a malformed repair.
    first = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED", claim_ids=ids)
    for cid in ids:
        ctx.model_turn = 41
        call(tools, "update_semantic_claim", claim_id=cid, claim_type="DEFINITION", statement="Attempted correction")
    repeated = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED", claim_ids=ids)
    ctx.model_turn = 42
    malformed = call(tools, "update_semantic_claim", claim_id=ids[0], claim_type="DEFINITION", statement="Attempted correction", actor="", action="",
        source_support=[{"nodeId": nodes[0]["nodeId"], "startOffset": 0, "endOffset": 1, "contentSha256": ""}])
    ctx.model_turn = 43
    with pytest.raises(NoProgressDetected) as stopped:
        call(tools, "update_semantic_claim", claim_id=ids[0], claim_type="DEFINITION", statement="Attempted correction")
    assert "CLAIM_SOURCE_BINDING_INVALID" in first["gaps"], first
    assert first["requiredAction"] == "complete_source_review"
    assert repeated["NO_PROGRESS"]
    assert malformed["requiredAction"] == "update_semantic_claim"
    assert len(ctx.semantic_auditor.calls) == 1, "Invalid accounting must never spend an auditor call"
    assert ctx.draft == before
    assert "SOURCE_REVIEW_INCOMPLETE" in str(stopped.value) and "reopen_source_review" in str(stopped.value)


def test_foreign_update_guidance_can_reopen_then_schedule_owner_without_preemption():
    ctx, tools, nodes = runtime()
    ids = author_previous_unit(ctx, tools)
    rejected = call(tools, "update_semantic_claim", claim_id=ids[0], claim_type="DEFINITION", statement="Correction")
    assert rejected["requiredAction"] == "reopen_source_review", rejected
    assert nodes[0]["nodeId"] in rejected["guidance"]
    assert call(tools, "reopen_source_review", source_node_id=nodes[0]["nodeId"], reason="Correct the previous unit")["outcome"] == "PASSED"
    assert call(tools, "get_next_review_unit")["unit"]["sourceNodeId"] == nodes[1]["nodeId"]
    assert call(tools, "register_semantic_claim", identity_key="active assertion", claim_type="DEFINITION", statement="Scripted active-unit assertion")["outcome"] == "PASSED"
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    assert call(tools, "get_next_review_unit")["unit"]["sourceNodeId"] == nodes[0]["nodeId"]
    assert call(tools, "update_semantic_claim", claim_id=ids[0], claim_type="DEFINITION", statement="Correction")["outcome"] == "PASSED"
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"


def test_owned_audit_rejection_can_be_corrected_and_reaudited():
    ctx, tools, _ = runtime()
    author_previous_unit(ctx, tools)
    cid = call(tools, "register_semantic_claim", identity_key="active", claim_type="CONTEXT", statement="Scripted candidate")["claim"]["claimId"]
    rejected = call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")
    assert rejected["semanticAuditVerdict"] == "WRONG_SEMANTIC_AUTHORITY"
    assert rejected["requiredAction"] == "update_semantic_claim"
    assert call(tools, "update_semantic_claim", claim_id=cid, claim_type="DEFINITION", statement="Scripted corrected candidate")["outcome"] == "PASSED"
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    assert len(ctx.semantic_auditor.calls) == 3


def test_related_committed_claim_still_allowed_when_it_binds_active_node():
    ctx, tools, nodes = runtime()
    ctx.semantic_auditor = StructuralFixtureAuditor()
    call(tools, "get_next_review_unit")
    cid = call(tools, "register_semantic_claim", identity_key="shared anchors", source_node_ids=[n["nodeId"] for n in nodes],
        claim_type="CONTEXT", statement="Scripted shared source provenance")["claim"]["claimId"]
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED")["outcome"] == "PASSED"
    call(tools, "get_next_review_unit")
    assert call(tools, "complete_source_review", disposition="CLAIMS_AUTHORED", claim_ids=[cid])["outcome"] == "PASSED"
    assert ctx.inventory.frontier.claim_owners[cid] == nodes[0]["nodeId"]


def test_native_scripted_producer_stops_unchanged_tail_after_feedback(tmp_path, monkeypatch):
    from langchain_core.messages import AIMessage
    from middleware import usage_metering
    from rule_set_preparation.agent import create_rule_set_preparation_agent
    from rule_set_preparation.claim_inventory import claim_id
    from structural_semantic_fixture import mechanical_arguments
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel

    ctx, _, nodes = runtime()
    keys = ["timestamp begins period", "timestamp recorded at receipt"]
    ids = [claim_id(ctx.run_id, 1, [nodes[0]["nodeId"]], key) for key in keys]
    actions = []
    def step(name, **args):
        actions.append(AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": "replay-" + str(len(actions))}]))
    step("get_next_review_unit")
    for key in keys:
        step("register_semantic_claim", **mechanical_arguments(ctx, {"identity_key": key, "source_node_ids": [nodes[0]["nodeId"]], "claim_type": "CONTEXT", "statement": key}))
    step("complete_source_review", disposition="CLAIMS_AUTHORED")
    step("get_next_review_unit")
    step("complete_source_review", disposition="CLAIMS_AUTHORED", claim_ids=ids)
    def update(cid):
        return mechanical_arguments(ctx, {"claim_id": cid, "source_node_ids": [nodes[0]["nodeId"]], "claim_type": "DEFINITION", "statement": "Attempted correction"})
    updates = [{k: v for k, v in update(cid).items() if k != "source_node_ids"} for cid in ids]
    for args in updates:
        step("update_semantic_claim", **args)
    step("complete_source_review", disposition="CLAIMS_AUTHORED", claim_ids=ids)
    step("update_semantic_claim", **{**updates[0], "actor": "", "action": ""})
    step("update_semantic_claim", **updates[0])
    model = RuleSetPreparationScriptedModel(responses=actions)
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if m is model else original(m, response))
    graph = create_rule_set_preparation_agent(context=ctx, legal_source_root=tmp_path, model=model)
    with pytest.raises(NoProgressDetected, match="SOURCE_REVIEW_INCOMPLETE"):
        graph.invoke({"messages": [{"role": "user", "content": "Execute the scripted review contract replay."}]})
    assert len(model.prompts) == len(actions)
    assert len(ctx.semantic_auditor.calls) == 1
    assert any("CLAIM_SOURCE_BINDING_INVALID" in row["gap_counts"] for row in ctx.trace)
    assert ctx.inventory.frontier.active["sourceNodeId"] == nodes[1]["nodeId"]


def test_real_dependency_wake_resumes_published_targets_and_legacy_idle_snapshots():
    # Exercise the existing pure TS wake predicate, including partial publication in a cycle.
    script = r'''
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const source = readFileSync("apps/api/src/modules/compliance-rule-set/domain/reference-dependencies.ts", "utf8");
const wake = source.slice(source.indexOf("export function referenceDependencyWake("), source.indexOf("/** Preserve the Agent"));
const run = new Function("sourceReviewPayloadSchema", stripTypeScriptTypes(wake.replace("export function", "function")) + "; return referenceDependencyWake;")({parse: x => x});
const row = {blockedReferenceIds: ["forward", "other"], payload: {blockedEndpointFingerprints: {forward: "old", other: "none"}}};
let available = false;
const view = {target: id => ({referenceId: id, bindingCanProceed: id === "forward" && available, endpointFingerprint: "new"})};
assert.equal(run(row, view).wake, false);
available = true;
assert.equal(run(row, view).wake, true);
row.blockedReferenceIds = ["forward"];
row.payload.blockedEndpointFingerprints.forward = "new";
assert.equal(run(row, view).wake, true);
console.log("publication wake and legacy idle recovery: PASS");
'''
    subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True, check=True)


def test_foreign_source_support_names_the_active_unit_instead_of_repeating_the_same_tool():
    from rule_set_preparation.semantic_audit import FRAME_FIELDS
    ctx, tools, nodes = runtime()
    call(tools, "get_next_review_unit")
    rejected = call(tools, "register_semantic_claim", identity_key="foreign", claim_type="CONTEXT", statement="Scripted foreign support",
        source_support=[{"nodeId": nodes[1]["nodeId"], "startOffset": 0, "endOffset": 5}], semantic_authority="CONTEXT", assessability="NON_ASSESSABLE",
        semantic_frame={k: None for k in FRAME_FIELDS})
    assert "SOURCE_SUPPORT_INVALID" in rejected["gaps"], rejected
    assert nodes[0]["nodeId"] in rejected["guidance"] and "get_next_review_unit" in rejected["guidance"]


def test_unaccounted_references_are_listed_all_at_once_with_the_allowed_ways_to_account_for_them():
    ctx, tools, nodes = runtime()
    frontier = ctx.inventory.frontier
    frontier.active = {"sourceNodeId": nodes[0]["nodeId"], "referenceIds": ["r1", "r2", "r3"]}
    refused = {"outcome": "FAILED", "failures": [{"code": "SOURCE_REVIEW_REFERENCE_BLOCKED", "ref": "r2", "detail": "Review this explicit reference"}]}
    guided = frontier.reference_guidance(refused, ["r1"])
    assert guided["unaccountedReferenceIds"] == ["r2", "r3"]
    assert all(rid in guided["guidance"] for rid in ["r1", "r2", "r3"]) and "REQUIRES_REFERENCE_RESOLUTION" in guided["guidance"]
    unrelated = {"outcome": "FAILED", "failures": [{"code": "SEMANTIC_AUDIT_REQUIRED"}]}
    assert frontier.reference_guidance(unrelated, None) is unrelated


def test_update_of_a_claim_outside_the_active_draft_is_an_actionable_rejection_not_an_internal_error():
    ctx, tools, nodes = runtime()
    ids = author_previous_unit(ctx, tools)
    owner = ctx.inventory.frontier.claim_owners[ids[0]]
    # A live run holds only the active unit's claims in the draft; the previous unit's claim is owned elsewhere.
    ctx.draft["semanticClaims"].pop(ids[0])
    foreign = call(tools, "update_semantic_claim", claim_id=ids[0], claim_type="DEFINITION", statement="Correction")
    assert "KeyError" not in json.dumps(foreign) and foreign["requiredAction"] == "reopen_source_review", foreign
    assert owner in foreign["guidance"]
    unknown = call(tools, "update_semantic_claim", claim_id="f" * 64, claim_type="DEFINITION", statement="Correction")
    assert "KeyError" not in json.dumps(unknown) and unknown["requiredAction"] == "register_semantic_claim", unknown
    assert "register_semantic_claim" in unknown["guidance"] and "get_claim_inventory" in unknown["guidance"]


def test_a_relation_owned_by_another_unit_names_its_owner_and_the_way_to_get_it_scheduled():
    ctx, tools, nodes = runtime()
    author_previous_unit(ctx, tools)
    owner, active = nodes[0]["nodeId"], nodes[1]["nodeId"]
    ctx.inventory.frontier.relation_owners["rel-x"] = owner
    ctx.source_graph.graph["references"] = [{"referenceId": "ref-into-owner", "fromNodeId": active, "toNodeId": owner},
                                            {"referenceId": "ref-elsewhere", "fromNodeId": active, "toNodeId": None}]
    rejected = call(tools, "remove_semantic_relation", relation_id="rel-x", reason="Direction was swapped")
    assert rejected["requiredAction"] == "reopen_source_review" and rejected["sourceNodeId"] == owner, rejected
    assert rejected["relationOwners"] == {"rel-x": owner}
    # The remedy is the existing sequence: reopen the owner, then yield this unit through its reference into the owner.
    assert "reopen_source_review" in rejected["guidance"] and "REQUIRES_REFERENCE_RESOLUTION" in rejected["guidance"]
    assert "ref-into-owner" in rejected["guidance"] and "ref-elsewhere" not in rejected["guidance"]
    frontier = ctx.inventory.frontier
    assert frontier.foreign_relation_exit(["rel-owned-here-or-unknown"]) is None
    frontier.relation_owners["rel-mine"] = active
    assert frontier.foreign_relation_exit(["rel-mine"]) is None


def _quote_claim(nodes, support, key="quoted"):
    from rule_set_preparation.semantic_audit import FRAME_FIELDS
    return dict(identity_key=key, claim_type="CONTEXT", statement="Scripted quoted support", source_support=support, semantic_authority="CONTEXT",
                assessability="NON_ASSESSABLE", semantic_frame={k: None for k in FRAME_FIELDS})


def test_quote_spans_resolve_to_the_same_support_as_get_source_support_for_register_and_update():
    ctx, tools, nodes = runtime()
    call(tools, "get_next_review_unit")
    node = ctx.inventory.frontier.active["sourceNodeId"]
    content = ctx.source_graph.nodes[node]["content"]
    quote = next(content[i:i + 20] for i in range(len(content) - 20) if content.count(content[i:i + 20]) == 1 and content[i:i + 20].strip())
    resolved = call(tools, "get_source_support", node_id=node, quote=quote)["sourceSupport"]
    made = call(tools, "register_semantic_claim", **_quote_claim(nodes, [{"nodeId": node, "quote": quote}]))
    assert made["outcome"] == "PASSED" and made["claim"]["sourceSupport"] == [resolved], made
    other = next(content[i:i + 15] for i in range(len(content) - 15) if content.count(content[i:i + 15]) == 1 and content[i:i + 15].strip() and content[i:i + 15] not in quote)
    updated = call(tools, "update_semantic_claim", claim_id=made["claim"]["claimId"], claim_type="CONTEXT", statement="Scripted quoted correction",
                   source_support=[{"nodeId": node, "quote": other}], semantic_authority="CONTEXT", assessability="NON_ASSESSABLE", semantic_frame=_quote_claim(nodes, [])["semantic_frame"])
    assert updated["outcome"] == "PASSED" and updated["claim"]["sourceSupport"] == [call(tools, "get_source_support", node_id=node, quote=other)["sourceSupport"]], updated


def test_quote_spans_reject_ambiguous_missing_and_mixed_evidence_and_offset_spans_still_work():
    ctx, tools, nodes = runtime()
    call(tools, "get_next_review_unit")
    node = ctx.inventory.frontier.active["sourceNodeId"]
    content = ctx.source_graph.nodes[node]["content"]
    repeated = next(ch for ch in content if content.count(ch) > 1 and ch.strip())
    for bad in [[{"nodeId": node, "quote": repeated}], [{"nodeId": node, "quote": "text that is not in the pinned node"}],
                [{"nodeId": node, "quote": content[:10], "startOffset": 0, "endOffset": 10}]]:
        refused = call(tools, "register_semantic_claim", **_quote_claim(nodes, bad))
        assert refused["outcome"] == "FAILED" and ("SOURCE_SUPPORT_INVALID" in refused["gaps"] or "CLAIM_SCHEMA_INVALID" in refused["gaps"]), refused
    stale = call(tools, "register_semantic_claim", **_quote_claim(nodes, [{"nodeId": node, "startOffset": 0, "endOffset": 10, "contentSha256": "0" * 64}]))
    assert stale["outcome"] == "FAILED" and "SOURCE_SUPPORT_INVALID" in stale["gaps"], stale
    explicit = call(tools, "get_source_support", node_id=node, quote=content[:10] if content.count(content[:10]) == 1 else content.strip()[:25])["sourceSupport"]
    assert call(tools, "register_semantic_claim", **_quote_claim(nodes, [explicit], key="explicit"))["outcome"] == "PASSED"
