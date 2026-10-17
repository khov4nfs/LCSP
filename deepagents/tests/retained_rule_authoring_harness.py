"""Restore the retained frozen inventory of the failed live Preparation; no provider, no database, no discovery."""
import json
from copy import deepcopy
from pathlib import Path

from rule_set_preparation.claim_inventory import READY
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools

from claim_protocol_harness import ScriptedApi

FIXTURE = Path(__file__).with_name("fixtures").joinpath("retained-rule-authoring-failure-de491791.json")


def load():
    return json.loads(FIXTURE.read_text())


def source_snapshot(fx):
    keys = ("id", "documentId", "locator", "contentSha256", "legalStatus", "legalEffectStatus", "legalStatusSourceRef", "sourceEffectStatus")
    return {"legalSourceVersionId": fx["sourceVersionId"], "chunks": [{k: c[k] for k in keys} for c in fx["chunks"]],
            "retrievalIndexValid": True, "documentGraph": fx["graph"]}


class FrozenApi(ScriptedApi):
    """Real API domain validators through the bridge; persistence is the retained, already-frozen revision."""
    def __init__(self, fx):
        super().__init__({"source": source_snapshot(fx)})
        inv = fx["frozenInventory"]
        self.revision = inv["revision"]
        self.frozen = {"revision": inv["revision"], "fingerprint": inv["fingerprint"], "graph": deepcopy(inv["graph"])}


def restore(fx=None, api=None):
    """A fresh Agent context positioned exactly at CLAIM_INVENTORY_READY of the retained failed run."""
    fx = fx or load()
    graph, nodes = fx["graph"], {n["nodeId"]: n for n in fx["graph"]["nodes"]}
    owners = {m["chunkId"]: m["legalDocumentNodeId"] for m in graph["chunkMappings"]}
    chunks = [{**c, "chunkId": c["id"], "content": nodes[owners[c["id"]]]["content"]} for c in fx["chunks"]]
    api = api or FrozenApi(fx)
    ctx = RuleSetPreparationContext(fx["preparationId"], api, frontier_enabled=True, source_graph=PinnedSourceGraph(graph, chunks))
    tools = {t.name: t for t in build_rule_set_tools(ctx)}
    ledger, inv = ctx.inventory, fx["frozenInventory"]
    frozen = deepcopy(inv["graph"])
    ledger.revision, ledger.identities = inv["revision"], dict(inv["identities"])
    ctx.draft["semanticClaims"] = {c["claimId"]: deepcopy(c) for c in frozen["claims"]}
    ctx.draft["claimRelations"] = {r["relationId"]: deepcopy(r) for r in frozen["relations"]}
    ctx.draft["sourceAccounting"] = {r["sourceNodeId"]: deepcopy(r) for r in frozen["sourceAccounting"]}
    ctx.draft["referenceAccounting"] = {r["referenceId"]: deepcopy(r) for r in frozen["referenceAccounting"]}
    ctx.authored_claim_ids = set(ctx.draft["semanticClaims"])
    ledger.rebuild_node_index()
    ledger.frozen, ledger.frozen_fingerprint, ledger.phase = frozen, inv["fingerprint"], READY
    ledger.frontier.snapshot = deepcopy(fx["observedFrontierSnapshot"])
    return fx, ctx, tools, api


def rediscover(fx=None):
    """Re-register the retained claims/relations through the REAL discovery tools (no frontier, no freeze).

    Identity keys are the retained ones, so every canonical claim and relation ID must come out identical.
    """
    from claim_protocol_harness import call
    fx = fx or load()
    graph, nodes = fx["graph"], {n["nodeId"]: n for n in fx["graph"]["nodes"]}
    owners = {m["chunkId"]: m["legalDocumentNodeId"] for m in graph["chunkMappings"]}
    chunks = [{**c, "chunkId": c["id"], "content": nodes[owners[c["id"]]]["content"]} for c in fx["chunks"]]
    api = FrozenApi(fx)
    api.frozen = None
    ctx = RuleSetPreparationContext(fx["preparationId"], api, frontier_enabled=False, source_graph=PinnedSourceGraph(graph, chunks))
    tools = {t.name: t for t in build_rule_set_tools(ctx)}
    inv = fx["frozenInventory"]
    for c in inv["graph"]["claims"]:
        r = call(tools, "register_semantic_claim", identity_key=inv["identities"][c["claimId"]], source_node_ids=c["sourceNodeIds"], claim_type=c["claimType"],
                 statement=c["statement"], **({"actor": c["operative"]["actor"], "action": c["operative"]["action"]} if c["operative"] else {}))
        assert r["outcome"] == "PASSED" and r["claim"]["claimId"] == c["claimId"], r
    for r in inv["graph"]["relations"]:
        x = call(tools, "link_semantic_claims", from_claim_id=r["fromClaimId"], to_claim_id=r["toClaimId"], kind=r["kind"], **({"reference_id": r["referenceId"]} if r["referenceId"] else {}))
        assert x["outcome"] == "PASSED" and x["relation"]["relationId"] == r["relationId"], x
    reviewed = {r["sourceNodeId"]: r for r in inv["graph"]["sourceAccounting"]}
    for r in reviewed.values():
        assert call(tools, "review_source_node", source_node_id=r["sourceNodeId"], claim_ids=r["claimIds"], **({"no_relevant_claim_reason": r["nonSemanticReason"]} if r["nonSemanticReason"] else {}))["outcome"] == "PASSED"
    # The frontier mode schedules only leaf units; the legacy tool path also wants the content-bearing parents accounted for.
    for node in nodes.values():
        if node["content"].strip() and node["nodeId"] not in reviewed:
            assert call(tools, "review_source_node", source_node_id=node["nodeId"], claim_ids=[], no_relevant_claim_reason="Heading or lead-in text; its claims are authored on the child units")["outcome"] == "PASSED"
    for r in inv["graph"]["referenceAccounting"]:
        assert call(tools, "review_source_reference", reference_id=r["referenceId"], material=r["material"], relation_ids=r["relationIds"],
                    **({"non_material_reason": r["nonMaterialReason"]} if r["nonMaterialReason"] else {}))["outcome"] == "PASSED"
    return fx, ctx, tools, api


# --- Scripted Agent output. Not product logic: the semantic decisions a repaired discovery and Rule authoring would make. ---
REPAIR = [  # (identity key, article path suffix, type, source-grounded statement)
    ("scope.operator", "article/1", "SCOPE", "The duties of this instrument are addressed to the operator of a covered service, being a service that stores customer-created records and offers them through a digital interface."),
    ("cond.request", "article/2/paragraph/1", "CONDITION", "A customer requests a portable copy of their customer-created records."),
    ("cond.loss", "article/3/paragraph/1", "CONDITION", "Failure to perform Article 2(1) causes a customer documented financial loss and the operator has received notice of the loss."),
    ("cond.delegation5", "article/5", "CONDITION", "The operator delegates export fulfillment to an external fulfillment provider."),
    ("cond.delegation7", "article/7", "CONDITION", "Actor A delegates export fulfillment to Actor B."),
    ("cond.incident", "article/8", "CONDITION", "A documented, specific security incident makes access to the export interface unsafe."),
]
# requirement key -> (operative, applicability keys, qualifier, exception, context claim-ID prefixes); None applicability = non-assessable
PLAN = [
    ("R1-export", ["14b91c88", "bfe5c0e8"], ["scope.operator", "cond.request"], ["5800187c", "8391d3e7", "e33095b2"], [], ["0feb5e44", "2c5ec6df", "2d1a3847", "5c10d55e"]),
    ("R2-no-obstacles", ["6d142dd4"], ["scope.operator"], ["a4f6de36", "6bd22b6c", "c02a699b"], ["68449a39"], []),
    ("R3-compensation", ["a904a30b"], ["cond.loss"], [], [], ["5cae9cc6"]),
    ("R4-provider", ["e68ff98e", "7f5c9953"], ["cond.delegation5", "cond.delegation7"], [], [], ["8ff8747d", "dae2788c", "504a4226", "4e9e6e74"]),
    ("R5-operator-delegation", ["d5bc695a", "c66f0063"], ["cond.delegation5", "cond.delegation7"], [], [], []),
    ("R6-config-safeguards", ["d0139643", "aeb9979f"], ["scope.operator"], ["9b86ca7d"], [], ["101a0cea", "a791994f"]),
    ("R7-audit", ["01d14195", "f6174e86"], ["scope.operator"], [], [], ["bfba28a9"]),
    ("R8-restriction", ["11cc55af", "ec585d27", "e49c7f83"], ["cond.incident"], ["28e0956c"], [], []),
    ("R9-access-rights", ["6d923c65", "70758db8"], None, [], [], []),
]
NON_ASSESSABLE = "These permissions grant access rights to third parties; they create no obligation whose performance repository evidence can establish."


def repair_discovery(fx, ctx, tools):
    """Register the SCOPE/CONDITION claims the failed discovery omitted, re-account their units, return key -> canonical ID."""
    from claim_protocol_harness import call
    nodes = {n["structuralPath"].rsplit("/chapter/", 1)[-1].split("/", 1)[-1]: n["nodeId"] for n in fx["graph"]["nodes"] if "/article/" in n["structuralPath"]}
    new, touched = {}, set()
    for key, suffix, claim_type, statement in REPAIR:
        node = next(nid for path, nid in nodes.items() if path == suffix)
        result = call(tools, "register_semantic_claim", identity_key=key, source_node_ids=[node], claim_type=claim_type, statement=statement)
        assert result["outcome"] == "PASSED", result
        new[key] = result["claim"]["claimId"]
        touched.add(node)
    for node in touched:
        assert call(tools, "review_source_node", source_node_id=node, claim_ids=sorted(ctx.inventory.claims_by_node[node]))["outcome"] == "PASSED"
    return new


def author_plan(tools, claims, new, order=None, only=None):
    """Author the scripted Requirements then one AssessmentRule per assessable Requirement; returns the tool results."""
    from claim_protocol_harness import call
    pick = lambda prefix: next(k for k in claims if k.startswith(prefix))
    plan = [p for p in PLAN if only is None or p[0] in only]
    plan = [plan[i] for i in order] if order else plan
    results = []
    for key, operative, applicability, qualifiers, exceptions, context in plan:
        results.append(call(tools, "author_legal_requirement", requirement_key=key, title=key, operative_claim_ids=[pick(p) for p in operative],
                            applicability_claim_ids=[new[k] for k in applicability or []], qualifier_claim_ids=[pick(p) for p in qualifiers],
                            exception_claim_ids=[pick(p) for p in exceptions], context_claim_ids=[pick(p) for p in context],
                            **({"non_assessable_reason": NON_ASSESSABLE} if applicability is None else {})))
    return results


def author_rules(tools, only=None):
    from claim_protocol_harness import call
    assessable = [p[0] for p in PLAN if p[2] is not None and (only is None or p[0] in only)]
    return [call(tools, "author_assessment_rule", assessment_rule_id=f"AR-{key}", concept=key, legal_requirement_ids=[key]) for key in assessable]
