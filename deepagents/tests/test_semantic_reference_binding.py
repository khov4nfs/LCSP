"""Replay the exact retained Article 4 -> Article 6 semantic binding failure."""
import json
import subprocess
from copy import deepcopy
from pathlib import Path

from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools

FIXTURE = json.loads(Path(__file__).with_name("fixtures").joinpath("retained-reference-binding.json").read_text())
REFERENCE = "8ea2cefba4f32ab52734220b23127d3b012fdde99d82b4d9c0aaf0d8debf059e"
SOURCE = "5c7db953572e506cb3a0cfae917fdc605920d01611661b3da113c23dbd1ce912"
TARGET = "7bce058664a182ce4a88264d4ae1065534b04794ecfd3e97e39a7c23d91399b8"
SCOPE = "065019d9b5c435f9026ac00644901f872b4a146b23e5008d761894c10a2c9a95"
FAKE_TARGET = "45111c7074326f5ca7a3a83c2e5bed87183aadb4d2565dd0b69da5e96f2a7914"
DEFINITION = "12ff1db191f504d0aaca9f8fc0cd7088e2c3b2973aa8ec26b5726901e30b188a"


def retained_runtime():
    ctx = RuleSetPreparationContext(FIXTURE["runId"], object(), frontier_enabled=False,
        source_graph=PinnedSourceGraph(deepcopy(FIXTURE["graph"]), []))
    from rule_set_preparation.claim_tools import build_claim_tools
    from structural_semantic_fixture import MechanicalTools
    tools = MechanicalTools(ctx, build_rule_set_tools(ctx))
    tools.operations = {}
    build_claim_tools(ctx, operations=tools.operations)
    for review in FIXTURE["reviews"]:
        for claim in review["payload"]["claims"]:
            ctx.draft["semanticClaims"][claim["claimId"]] = deepcopy(claim)
        ctx.inventory.identities.update(review["payload"]["identities"])
    ctx.inventory.rebuild_node_index()
    return ctx, tools


def call(tools, name, **args):
    return tools.operations[name](**args)


def test_retained_same_source_fake_target_rejected_before_mutation():
    ctx, tools = retained_runtime()
    before = deepcopy(ctx.draft)
    result = call(tools, "link", from_claim_id=SCOPE, to_claim_id=FAKE_TARGET,
                  kind="CROSS_REFERENCE", reference_id=REFERENCE)
    assert result["outcome"] == "FAILED", result
    assert "SEMANTIC_DEPENDENCY_DETACHED" in result["gaps"]
    assert ctx.draft == before


def test_inspect_exact_retained_definition_and_atomic_idempotent_binding():
    ctx, tools = retained_runtime()
    before = deepcopy(ctx.draft)
    from rule_set_preparation.reference_binding import side_claims
    targets = side_claims(ctx.source_graph, ctx.draft["semanticClaims"], TARGET)
    assert ctx.draft == before
    assert [c["claimId"] for c in targets] == [DEFINITION]
    args = dict(reference_id=REFERENCE, from_claim_id=SCOPE, to_claim_id=DEFINITION, kind="DEFINITION")
    result = call(tools, "link", **args)
    assert result["outcome"] == "PASSED", result
    assert result == call(tools, "link", **args)
    assert len(ctx.draft["claimRelations"]) == 1
    assert result["referenceAccounting"]["relationIds"] == [result["relation"]["relationId"]]


def test_remove_relation_and_claim_reprojects_remaining_bindings():
    ctx, tools = retained_runtime()
    one = call(tools, "link", reference_id=REFERENCE, from_claim_id=SCOPE, to_claim_id=DEFINITION, kind="DEFINITION")["relation"]
    two = call(tools, "link", reference_id=REFERENCE, from_claim_id=FAKE_TARGET, to_claim_id=DEFINITION, kind="CROSS_REFERENCE")["relation"]
    rejected = call(tools, "non_material", reference_id=REFERENCE, reason="Contradictory decision")
    assert rejected["outcome"] == "FAILED"
    assert call(tools, "unlink", relation_id=one["relationId"], reason="One duplicate legal role is unnecessary")["outcome"] == "PASSED"
    assert ctx.draft["referenceAccounting"][REFERENCE]["relationIds"] == [two["relationId"]]
    assert call(tools, "remove", claim_id=FAKE_TARGET, reason="Redundant source-side cross-reference claim")["outcome"] == "PASSED"
    assert REFERENCE not in ctx.draft["referenceAccounting"]
    assert call(tools, "non_material", reference_id=REFERENCE, reason="No remaining claim depends on the definition in this scripted scope")["outcome"] == "PASSED"
    assert not ctx.draft["referenceAccounting"][REFERENCE]["material"]


def test_binding_requires_durable_endpoint_but_not_completed_target_review():
    from types import SimpleNamespace
    from rule_set_preparation.review_frontier import ReviewFrontier
    from rule_set_preparation.reference_binding import endpoint_fingerprint
    ctx, tools = retained_runtime()
    frontier = ctx.inventory.frontier = ReviewFrontier(ctx.inventory)
    frontier.active = {"sourceNodeId": SOURCE, "referenceIds": [REFERENCE]}
    frontier.claim_owners.update({SCOPE: SOURCE, DEFINITION: TARGET})
    endpoints = []
    ctx.api = SimpleNamespace(source_review_operation=lambda *args, **kwargs: {"outcome": "PASSED", "endpoints": endpoints, "frontierRevision": 1, "frontierFingerprint": "a" * 64, "frontierStateFingerprint": "b" * 64})
    before = deepcopy(ctx.draft)
    args = dict(reference_id=REFERENCE, from_claim_id=SCOPE, to_claim_id=DEFINITION, kind="DEFINITION")
    rejected = call(tools, "link", **args)
    assert rejected["targetClaimAvailability"] == "NOT_AVAILABLE"
    assert ctx.draft == before
    # The claim is committed in a blocked review; completion accounting is absent.
    assert TARGET not in ctx.draft["sourceAccounting"]
    endpoints.append({"claim": ctx.draft["semanticClaims"][DEFINITION], "owner": TARGET,
                      "fingerprint": endpoint_fingerprint(ctx.draft["semanticClaims"][DEFINITION])})
    accepted = call(tools, "link", **args)
    assert accepted["outcome"] == "PASSED"
    assert frontier.relation_owners[accepted["relation"]["relationId"]] == SOURCE


def test_direction_subtree_version_resolution_and_api_parity():
    from rule_set_preparation.reference_binding import valid_binding
    ctx, _ = retained_runtime()
    graph, claims = ctx.source_graph, ctx.draft["semanticClaims"]
    cases = []
    for ref in graph.references.values():
        a = next(c["claimId"] for c in claims.values() if ref["fromNodeId"] in c["sourceNodeIds"])
        b = next(c["claimId"] for c in claims.values() if ref["toNodeId"] in c["sourceNodeIds"])
        c = next(c["claimId"] for c in claims.values() if ref["fromNodeId"] not in c["sourceNodeIds"] and ref["toNodeId"] not in c["sourceNodeIds"])
        for origin, target, expected in [(a, b, True), (b, a, False), (a, a, False), (b, b, False), (c, b, False), (a, c, False)]:
            cases.append(({"relationId": str(len(cases)), "fromClaimId": origin, "toClaimId": target, "referenceId": ref["referenceId"], "kind": "DEFINITION"}, expected))
    cases.append(({"relationId": "same-source-fake-target", "fromClaimId": SCOPE, "toClaimId": FAKE_TARGET, "referenceId": REFERENCE, "kind": "CROSS_REFERENCE"}, False))
    # Descendants on BOTH sides follow the exact same containment predicate.
    for parent, cid in [(SOURCE, SCOPE), (TARGET, DEFINITION)]:
        child_id = ("a" if parent == SOURCE else "b") * 64
        child = {**graph.nodes[parent], "nodeId": child_id, "parentNodeId": parent,
                 "structuralPath": graph.nodes[parent]["structuralPath"] + "/paragraph/2"}
        graph.nodes[child_id] = child
        graph.graph["nodes"].append(child)
        claims[cid]["sourceNodeIds"] = [child_id]
    for relation, expected in cases:
        assert valid_binding(graph, claims, relation) == expected
    payload = {"graph": graph.graph, "semantic": {**graph.base(), "claims": list(claims.values()), "relations": [r for r, _ in cases]}}
    result = subprocess.run(["pnpm", "exec", "tsx", "apps/api/test/support/semantic-reference-binding-bridge.ts"],
        cwd=Path(__file__).resolve().parents[2], input=json.dumps(payload), capture_output=True, text=True, check=True)
    assert [failure is None for failure in json.loads(result.stdout)] == [expected for _, expected in cases]
    valid = next(r for r, expected in cases if expected and r["referenceId"] == REFERENCE)
    for mutate in [lambda: claims[DEFINITION].update(legalSourceVersionId="different-version"),
                   lambda: graph.references[REFERENCE].update(resolutionState="UNRESOLVED"),
                   lambda: graph.references[REFERENCE].update(materializationId="f" * 64)]:
        mutate()
        assert not valid_binding(graph, claims, valid)


def test_endpoint_semantic_fingerprints_have_cross_runtime_unicode_and_field_parity():
    from rule_set_preparation.reference_binding import endpoint_fingerprint
    ctx, _ = retained_runtime()
    claim = deepcopy(ctx.draft["semanticClaims"][SCOPE])
    whitespace = "".join(chr(i) for i in range(0x110000) if chr(i).isspace())
    cases = [claim, {**claim, "statement": whitespace + "Cafe\u0301" + whitespace + "meaning" + whitespace},
             {**claim, "statement": "\ufeffMeaning with BOM retained\ufeff"},
             {**claim, "claimType": "DUTY", "operative": {"actor": whitespace + "operator", "modality": "DUTY", "action": "keep" + whitespace + "records"}},
             {**claim, "state": "INTENTIONALLY_NON_OPERATIVE", "nonOperativeReason": "Explicit" + whitespace + "exclusion"}]
    payload = {"graph": ctx.source_graph.graph, "semantic": {**ctx.source_graph.base(), "claims": cases, "relations": []}, "fingerprints": True}
    result = subprocess.run(["pnpm", "exec", "tsx", "apps/api/test/support/semantic-reference-binding-bridge.ts"],
        cwd=Path(__file__).resolve().parents[2], input=json.dumps(payload), capture_output=True, text=True, check=True)
    assert json.loads(result.stdout) == [endpoint_fingerprint(c) for c in cases]
