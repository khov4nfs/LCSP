"""Deterministic support fixtures for claim and authoring mechanics."""
def semantic_arguments(claim):
    return {"source_support": claim["sourceSupport"], "semantic_authority": claim["semanticAuthority"], "semantic_frame": claim["semanticFrame"], "assessability": claim["assessability"]}


def mechanical_arguments(context, arguments):
    """Explicit synthetic support for scheduler/tool-mechanics fixtures, not legal entailment evidence."""
    from rule_set_preparation.claim_inventory import canonical_support, FRAME_FIELDS
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
