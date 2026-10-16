"""Provider-free node retrieval/traversal and pinned source isolation."""
import json
import time

import pytest

from rule_set_preparation.source_graph import PinnedSourceGraph, build_source_graph_tools, MAX_CHARACTERS


def fixture():
    def node(number, parent, node_type, text, ordinal=0):
        return {"nodeId": f"{number:064x}", "parentNodeId": f"{parent:064x}" if parent else None,
                "legalSourceVersionId": "version-one", "documentId": "synthetic", "nodeType": node_type,
                "ordinal": ordinal, "structuralPath": f"/document/synthetic/article/1/node/{number}",
                "title": "", "content": text, "label": str(number), "sourcePath": "synthetic.txt",
                "pageStart": 1, "pageEnd": 1, "charStart": 0, "charEnd": len(text), "contentFingerprint": "f" * 64}
    nodes = [node(1, None, "DOCUMENT", "Heading"), node(2, 1, "ARTICLE", "Records article"),
             node(3, 2, "PARAGRAPH", "Keep the keeper records"), node(4, 2, "PARAGRAPH", "See paragraph 1", 1)]
    refs = [{"referenceId": "a" * 64, "fromNodeId": nodes[3]["nodeId"], "toNodeId": nodes[2]["nodeId"],
             "resolutionState": "RESOLVED", "candidateNodeIds": [nodes[2]["nodeId"]], "text": "paragraph 1", "charStart": 4, "charEnd": 15},
            {"referenceId": "b" * 64, "fromNodeId": nodes[3]["nodeId"], "toNodeId": None,
             "resolutionState": "UNRESOLVED", "candidateNodeIds": [], "text": "Article 99", "charStart": 16, "charEnd": 26}]
    graph = {"legalSourceVersionId": "version-one", "materializationId": "c" * 64, "nodes": nodes, "references": refs,
             "chunkMappings": [{"chunkId": "retrieval-one", "legalDocumentNodeId": nodes[2]["nodeId"]}]}
    chunks = [{"chunkId": "retrieval-one", "content": "Keep the keeper records", "documentId": "synthetic", "locator": "art-1::cl-1", "contentSha256": "sha256:" + "d" * 64}]
    return graph, chunks


@pytest.fixture
def source():
    return PinnedSourceGraph(*fixture())


def test_search_has_node_source_and_path(source):
    result = source.search("keeper records", 10, 0)
    assert result["legalSourceVersionId"] == "version-one"
    assert result["nodes"][0]["nodeType"] == "PARAGRAPH"
    assert result["nodes"][0]["structuralPath"]


@pytest.mark.parametrize("traversal,node,expected", [("PARENT", 3, [2]), ("CHILDREN", 2, [3, 4]),
    ("SIBLINGS", 3, [4]), ("ANCESTORS", 3, [2, 1])])
def test_traversals(source, traversal, node, expected):
    result = source.inspect(f"{node:064x}", traversal, 10, 0)
    assert [n["nodeId"] for n in result["nodes"]] == [f"{n:064x}" for n in expected]


def test_explicit_and_reverse_refs_and_unresolved_states(source):
    forward = source.inspect(f"{4:064x}", "REFERENCES", 10, 0)
    assert [r["resolutionState"] for r in forward["references"]] == ["RESOLVED", "UNRESOLVED"]
    assert source.inspect(f"{3:064x}", "REFERENCED_BY", 10, 0)["references"][0]["referenceId"] == "a" * 64


def test_bounded_context_and_pagination(source):
    for n in source.nodes.values():
        n["content"] = "x" * 30000
        n["title"] = "t" * 30000
    result = source.inspect(f"{4:064x}", "CONTEXT", 2, 0)
    assert len(result["nodes"]) == 2 and result["hasMore"]
    assert sum(len(n["content"]) for n in result["nodes"]) <= MAX_CHARACTERS
    assert all(len(n["title"]) <= 512 for n in result["nodes"])
    assert source.inspect(f"{2:064x}", "CHILDREN", 1, 1)["nodes"][0]["nodeId"] == f"{4:064x}"


def test_chunk_node_mapping(source):
    assert source.inspect(f"{3:064x}", "CHUNKS", 10, 0)["chunks"][0]["chunkId"] == "retrieval-one"
    assert source.graph["chunkMappings"][0]["legalDocumentNodeId"] == f"{3:064x}"


def test_real_tool_schemas_and_reference_following(source):
    tools = {t.name: t for t in build_source_graph_tools(source)}
    node = json.loads(tools["get_legal_node"].invoke({"node_id": f"{3:064x}", "max_characters": 4}))
    assert node["node"]["content"] == "Keep" and node["hasMore"]
    resolved = json.loads(tools["follow_legal_reference"].invoke({"reference_id": "a" * 64}))
    assert resolved["nodes"][0]["nodeId"] == f"{3:064x}"
    unresolved = json.loads(tools["follow_legal_reference"].invoke({"reference_id": "b" * 64}))
    assert unresolved["reference"]["resolutionState"] == "UNRESOLVED" and not unresolved["nodes"]


def test_structural_progress_records_identity_and_traversal_without_source_prose(source, monkeypatch):
    events = []
    monkeypatch.setattr("rule_set_preparation.source_graph.publish_agent_stream_event", lambda kind, **fields: events.append((kind, fields)))
    tool = {t.name: t for t in build_source_graph_tools(source)}["inspect_legal_node"]
    tool.invoke({"node_id": f"{3:064x}", "traversal": "PARENT"})
    assert events[0][1]["data"] == {"activity_kind": "SOURCE_STRUCTURE_TRAVERSED", "source_node_id": f"{3:064x}", "structural_path": source.nodes[f"{3:064x}"]["structuralPath"], "traversal": "PARENT"}


def test_source_and_tenant_scope_cannot_be_selected_by_model(source):
    assert source.inspect("9" * 64, "CONTEXT", 10, 0)["error"] == "NODE_NOT_IN_PINNED_SOURCE"
    graph, chunks = fixture()
    graph["nodes"][0]["legalSourceVersionId"] = "another-version-or-tenant"
    with pytest.raises(ValueError, match="crosses pinned"):
        PinnedSourceGraph(graph, chunks)
    for t in build_source_graph_tools(source):
        schema = t.get_input_schema().model_json_schema()
        assert not {"legalSourceVersionId", "tenantId", "preparationRunId"} & schema["properties"].keys()


def test_scale_indexes_nodes_once_and_returns_bounded_results():
    graph, chunks = fixture()
    template = graph["nodes"][2]
    graph["nodes"] += [{**template, "nodeId": f"{i:064x}", "content": f"keeper records {i}"} for i in range(100, 3100)]
    start = time.monotonic()
    source = PinnedSourceGraph(graph, chunks)
    assert len(source.search("keeper", 10, 0)["nodes"]) == 10
    assert time.monotonic() - start < 5


def test_claim_draft_binds_pinned_graph_and_known_claims_cannot_disappear(source):
    from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
    class Api:
        calls = 0
        def validate_compliance_rule_set(self, run_id, packet):
            self.calls += 1
            return {"outcome": "FAILED", "failures": []}
    api = Api()
    context = RuleSetPreparationContext("synthetic-run", api, source_graph=source)
    tools = {tool.name: tool for tool in build_rule_set_tools(context)}
    claim = {"claimId": "duty-one", "legalSourceVersionId": source.version, "sourceNodeIds": [f"{3:064x}"],
             "claimType": "DUTY", "statement": "Synthetic duty", "operative": {"actor": "Keeper", "modality": "DUTY", "action": "Keep records"},
             "state": "RELEVANT", "nonOperativeReason": None}
    tools["add_to_packet_draft"].invoke({"semanticClaims": [claim]})
    drafted = context.draft_packet()
    assert drafted["semanticGraph"]["claims"] == [claim]
    assert drafted["semanticGraph"]["materializationId"] == source.graph["materializationId"]
    rejected = json.loads(tools["validate_compliance_rule_set"].invoke({"packet": {"semanticGraph": {"claims": []}}}))
    assert rejected["failures"][0]["code"] == "UNACCOUNTED_SEMANTIC_CLAIM"
    assert api.calls == 0
    assert context.last_validation["outcome"] == "FAILED"
