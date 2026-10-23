"""Same-source V3 inventory through real freeze/authoring/Rule Validator/submission boundaries.

Persistence is explicitly in memory. The caller supplies independent receipts, or a scripted auditor for mechanical-only tests.
No Preparation is created or dispatched.
"""
from copy import deepcopy

from claim_protocol_harness import ScriptedApi, call
from corrected_semantic_fixture import corrected_graph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from rule_set_preparation.claim_inventory import READY, normalized_graph, fingerprint
from rule_set_preparation.semantic_audit import audit_input
from rule_set_preparation.semantic_closure import operative


def frozen_frontier_snapshot(graph):
    binding = graph["reviewFrontier"]
    reviewed = sum(bool(row["claimIds"]) for row in graph["sourceAccounting"])
    total = len(graph["sourceAccounting"])
    return {"frontierRevision": binding["revision"], "frontierFingerprint": binding["fingerprint"],
            "reviewedFrontierFingerprint": binding["reviewedFingerprint"],
            "progress": {"total": total, "reviewedWithClaims": reviewed, "reviewedNoClaims": total - reviewed}}


def authoring_fixture():
    """Scripted audit receipts for authoring/memory mechanics; never semantic acceptance evidence."""
    from structural_semantic_fixture import StructuralFixtureAuditor
    fixture, source, graph, identities, _ = corrected_graph()
    auditor = StructuralFixtureAuditor()
    graph["semanticAudits"] = [auditor.audit(audit_input(source, graph, r["sourceNodeId"], 1)) for r in graph["sourceAccounting"]]
    graph = normalized_graph(graph)
    return {"label": "Same-source V3 authoring mechanics; SCRIPTED verifier verdicts", "preparationId": fixture["identity"]["preparationRunId"],
            "sourceVersionId": source.version, "graph": source.graph, "chunks": list(source.chunks.values()),
            "frozenInventory": {"revision": 1, "fingerprint": fingerprint({"revision": 1, "graph": graph}), "graph": graph, "identities": identities},
            "observedFrontierSnapshot": frozen_frontier_snapshot(graph)}


def authoring_plan():
    from rule_set_preparation.semantic_closure import aggregate_closure
    _, _, graph, _, keys = corrected_graph()
    audit_ids = {keys[k]["claimId"] for k in ["audit.authorization", "audit.outcome"]}
    groups = [[c["claimId"]] for c in graph["claims"] if operative(c) and c["claimId"] not in audit_ids] + [sorted(audit_ids)]
    roles = [["OPERATIVE_PROPOSITION"], ["APPLICABILITY_CONDITION"], ["QUALIFIER"], ["EXCEPTION"], ["CONTEXT", "DEFINITION"]]
    return [(f"R-{i}", *[[r["claimId"][:8] for r in aggregate_closure(graph, ids)["claims"] if r["role"] in group] for group in roles]) for i, ids in enumerate(groups)]


def pipeline_context(auditor):
    fixture, source, graph, identities, keys = corrected_graph()
    graph["semanticAudits"] = [auditor.audit(audit_input(source, graph, review["sourceNodeId"], 1)) for review in graph["sourceAccounting"]]
    graph = normalized_graph(graph)
    source_snapshot = {"legalSourceVersionId": source.version, "documentGraph": source.graph, "retrievalIndexValid": True,
                       "chunks": [{k: v for k, v in c.items() if k not in {"chunkId", "content"}} for c in source.chunks.values()]}
    api = ScriptedApi({"source": source_snapshot})
    run_id = fixture["identity"]["preparationRunId"]
    ready = api.claim_inventory_operation(run_id, "FINALIZE", 1, graph=graph, identities=identities)
    assert ready["outcome"] == "PASSED", ready
    ctx = RuleSetPreparationContext(run_id, api, source_graph=source, frontier_enabled=True, semantic_auditor=auditor)
    tools = {t.name: t for t in build_rule_set_tools(ctx)}
    for field, key in [("semanticClaims", "claims"), ("claimRelations", "relations"), ("sourceAccounting", "sourceAccounting"), ("referenceAccounting", "referenceAccounting")]:
        identity = {"claims": "claimId", "relations": "relationId", "sourceAccounting": "sourceNodeId", "referenceAccounting": "referenceId"}[key]
        ctx.draft[field] = {r[identity]: deepcopy(r) for r in graph[key]}
    ctx.semantic_audits = {r["sourceNodeId"]: deepcopy(r) for r in graph["semanticAudits"]}
    ledger = ctx.inventory
    ledger.identities = identities
    ledger.rebuild_node_index()
    ledger.frozen, ledger.frozen_fingerprint, ledger.phase = graph, ready["fingerprint"], READY
    ledger.frontier.snapshot = frozen_frontier_snapshot(graph)
    ledger.frontier.loaded = True
    return ctx, tools, api, keys


def author_all(ctx, tools, keys):
    # The source expressly permits combining the two audit duties while preserving both meanings.
    audit_ids = {keys[k]["claimId"] for k in ["audit.authorization", "audit.outcome"]}
    groups = [[c["claimId"]] for c in ctx.inventory.frozen["claims"] if operative(c) and c["claimId"] not in audit_ids]
    groups.append(sorted(audit_ids))
    for i, ids in enumerate(groups):
        view = call(tools, "get_semantic_closure", operative_claim_ids=ids)
        assert view["outcome"] == "PASSED", view
        result = call(tools, "author_legal_requirement", requirement_key=f"R-{i}", title="Source-derived obligation " + str(i), **view["authoringArguments"])
        assert result["outcome"] == "PASSED", result
        if result["requirement"]["coverage"]["state"] == "COVERED_BY_ASSESSMENT_RULES":
            rule = call(tools, "author_assessment_rule", assessment_rule_id=f"AR-{i}", concept="Repository-observable aspect " + str(i), legal_requirement_ids=[f"R-{i}"])
            assert rule["outcome"] == "PASSED", rule
    return groups
