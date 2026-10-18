"""Scripted semantic verdicts for mechanical tests, NOT source-entailment evidence.

Real governed verifier/model-quality tests live in test_semantic_auditor and the retained-source evaluations.
"""
from datetime import datetime, timezone
from rule_set_preparation.semantic_audit import audit_identity, digest, ROLE, ASSERTION_CHECKS, RELATION_CHECKS, completeness_input, relation_batches, relation_input


class StructuralFixtureAuditor:
    def __init__(self):
        self.calls = []

    def audit(self, value):
        self.calls.append(value)
        sha = digest(value)
        return {**{k: value[k] for k in ["schemaRevision", "sourceRevision", "inventoryRevision", "sourceNodeId"]}, **audit_identity(value),
                "verifierOperationId": f"{sha[:8]}-{sha[8:12]}-4{sha[13:16]}-8{sha[17:20]}-{sha[20:32]}", "verifierRole": ROLE,
                "relationAudits": [{"relationIds": [r["relationId"] for r in batch], "inputFingerprint": digest(relation_input(value, batch)), "verifierOperationId": f"{sha[:8]}-{sha[8:12]}-4{sha[13:16]}-8{sha[17:20]}-{sha[20:32]}", "verdict": "SUPPORTED", "gaps": []} for batch in relation_batches(value)],
                "completenessAudit": {"inputFingerprint": digest(completeness_input(value)), "verifierOperationId": f"{sha[:8]}-{sha[8:12]}-4{sha[13:16]}-8{sha[17:20]}-{sha[20:32]}", "verdict": "SUPPORTED", "gaps": []},
                "verdict": "SUPPORTED", "reportedVerdict": "SUPPORTED", "gaps": [], "assertions": [{"id": c["claimId"], "fingerprint": digest(c), "checks": {k: "SUPPORTED" for k in ASSERTION_CHECKS}, "verdict": "SUPPORTED", "gapCodes": []} for c in value["claims"]],
                "relations": [{"id": r["relationId"], "fingerprint": digest(r), "checks": {k: "SUPPORTED" for k in RELATION_CHECKS}, "verdict": "SUPPORTED", "gapCodes": []} for r in value["relations"]], "auditedAt": "2026-10-18T00:00:00.000Z"}


def semantic_arguments(claim):
    return {"source_support": claim["sourceSupport"], "semantic_authority": claim["semanticAuthority"], "semantic_frame": claim["semanticFrame"], "assessability": claim["assessability"]}


def mechanical_arguments(context, arguments):
    """Explicit synthetic support for scheduler/tool-mechanics fixtures, not legal entailment evidence."""
    from rule_set_preparation.semantic_audit import canonical_support, FRAME_FIELDS
    args = dict(arguments)
    if "source_support" in args:
        return args
    nodes = args.get("source_node_ids")
    if nodes is None:
        existing = context.draft["semanticClaims"].get(args.get("claim_id"))
        nodes = existing["sourceNodeIds"] if existing else [context.inventory.frontier.active["sourceNodeId"]]
    kind = args["claim_type"]
    supports = [{"nodeId": nid, "startOffset": 0, "endOffset": len(context.source_graph.nodes[nid]["content"].encode("utf-16-le")) // 2} for nid in nodes if nid in context.source_graph.nodes]
    args.update(source_support=canonical_support(context.source_graph, nodes, supports) if nodes and supports else [],
                semantic_authority="DEFINITION" if kind == "DEFINITION" else "LEGAL_NORMATIVE" if kind in {"DUTY", "PROHIBITION", "PERMISSION", "SCOPE", "CONDITION", "QUALIFIER", "EXCEPTION", "TEMPORAL_RULE", "TRANSITION_RULE"} else "CONTEXT",
                assessability="REPOSITORY_VERIFIABLE" if kind in {"DUTY", "PROHIBITION", "PERMISSION"} else "NON_ASSESSABLE", semantic_frame={k: None for k in FRAME_FIELDS})
    return args


class MechanicalTools(dict):
    def __init__(self, context, tools):
        super().__init__((t.name, t) for t in tools)
        self.context = context
