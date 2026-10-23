"""Local review ownership and Python/API parity without providers or persisted business state."""
from types import SimpleNamespace

from rule_set_preparation.semantic_audit import audit_input
from semantic_fidelity_harness import bridge


def test_parent_review_does_not_expand_descendant_references_but_child_keeps_full_target():
    root, child, target = "a" * 64, "b" * 64, "c" * 64
    nodes = {
        root: {"nodeId": root, "parentNodeId": None, "structuralPath": "/document/title", "nodeType": "DOCUMENT", "content": "Instrument title and preamble.", "legalEffectStatus": "EFFECTIVE"},
        child: {"nodeId": child, "parentNodeId": root, "structuralPath": "/document/title/article/1", "nodeType": "ARTICLE", "content": "See Article 2 for the applicable duties.", "legalEffectStatus": "EFFECTIVE"},
        target: {"nodeId": target, "parentNodeId": root, "structuralPath": "/document/title/article/2", "nodeType": "ARTICLE", "content": "Referenced article introduction.", "legalEffectStatus": "EFFECTIVE"},
    }
    for index in range(40):
        identity = f"{index:064x}"
        nodes[identity] = {"nodeId": identity, "parentNodeId": target, "structuralPath": f"/document/title/article/2/clause/{index}", "nodeType": "CLAUSE", "content": "Complete referenced source text. " * 60, "legalEffectStatus": "EFFECTIVE"}
    reference = {"referenceId": "f" * 64, "fromNodeId": child, "toNodeId": target, "text": "Article 2", "charStart": 4, "charEnd": 13, "resolutionState": "RESOLVED", "candidateNodeIds": [target]}
    source = SimpleNamespace(nodes=nodes, graph={"materializationId": "e" * 64, "legalSourceVersionId": "00000000-0000-4000-8000-000000000001", "nodes": list(nodes.values()), "references": [reference]})
    graph = {"contractVersion": "LEGAL_GRAPH_V2", "materializationId": source.graph["materializationId"], "legalSourceVersionId": source.graph["legalSourceVersionId"], "claims": [], "relations": [], "sourceAccounting": [], "referenceAccounting": []}

    parent_input = audit_input(source, graph, root, 1)
    assert [node["nodeId"] for node in parent_input["sources"]] == [root]
    assert parent_input["references"] == []
    child_input = audit_input(source, graph, child, 1)
    assert child_input["references"] == [reference]
    assert {node["nodeId"] for node in child_input["sources"]} == set(nodes)
    for identity, expected in [(root, parent_input), (child, child_input)]:
        assert bridge("AUDIT_INPUT", source, graph, nodeId=identity)["input"] == expected
