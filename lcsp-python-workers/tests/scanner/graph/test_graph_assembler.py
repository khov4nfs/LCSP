import pytest
from lcsp_workers.scanner.graph.graph_builder import EvidenceGraphBuilder

def get_node(graph, node_type):
    for node in graph.nodes:
        if node["node_type"] == node_type:
            return node
    return None

def get_edge(graph, edge_type):
    for edge in graph.edges:
        if edge["edge_type"] == edge_type:
            return edge
    return None

def test_t01_file_with_openai_call():
    """T01: REPOSITORY -> FILE -> FUNCTION -> AI_MODEL_INVOCATION, AI_PROVIDER"""
    builder = EvidenceGraphBuilder(workspace_path="/workspace")
    repo_id = builder.add_node("REPOSITORY", "my-repo")
    file_id = builder.add_node("FILE", "app.py", "/workspace/app.py")
    func_id = builder.add_node("FUNCTION", "process", "/workspace/app.py")
    invoke_id = builder.add_node("AI_MODEL_INVOCATION", "openai.ChatCompletion", "/workspace/app.py")
    provider_id = builder.add_node("AI_PROVIDER", "openai")
    
    builder.add_edge("CONTAINS", repo_id, file_id)
    builder.add_edge("CONTAINS", file_id, func_id)
    builder.add_edge("CALLS", func_id, invoke_id)
    
    graph = builder.build_scan_graph()
    
    assert get_node(graph, "REPOSITORY") is not None
    assert get_node(graph, "FILE") is not None
    assert get_node(graph, "FUNCTION") is not None
    assert get_node(graph, "AI_MODEL_INVOCATION") is not None
    assert get_node(graph, "AI_PROVIDER") is not None
    assert get_edge(graph, "CALLS") is not None

def test_t02_sbom_corroborates():
    """T02: PACKAGE_DEPENDENCY node + CORROBORATES edge"""
    builder = EvidenceGraphBuilder()
    dep_id = builder.add_node("PACKAGE_DEPENDENCY", "openai")
    invoke_id = builder.add_node("AI_MODEL_INVOCATION", "openai.ChatCompletion")
    builder.add_edge("CORROBORATES", dep_id, invoke_id)
    
    graph = builder.build_scan_graph()
    assert get_node(graph, "PACKAGE_DEPENDENCY") is not None
    assert get_edge(graph, "CORROBORATES") is not None

def test_t03_agent_tools_decision():
    """T03: DECISION_RULE node, CONTROLS edge"""
    builder = EvidenceGraphBuilder()
    rule_id = builder.add_node("DECISION_RULE", "agent-tools")
    target_id = builder.add_node("FUNCTION", "target")
    builder.add_edge("CONTROLS", rule_id, target_id)
    
    graph = builder.build_scan_graph()
    assert get_node(graph, "DECISION_RULE") is not None
    assert get_edge(graph, "CONTROLS") is not None

def test_t04_human_review_step():
    """T04: HUMAN_REVIEW_STEP node + REVIEWS edge"""
    builder = EvidenceGraphBuilder()
    review_id = builder.add_node("HUMAN_REVIEW_STEP", "require_approval")
    target_id = builder.add_node("DECISION_RULE", "target_rule")
    builder.add_edge("REVIEWS", review_id, target_id)
    
    graph = builder.build_scan_graph()
    assert get_node(graph, "HUMAN_REVIEW_STEP") is not None
    assert get_edge(graph, "REVIEWS") is not None

def test_t05_unsupported_flow():
    """T05: UNSUPPORTED_FLOW node + HAS_LIMITATION edge"""
    builder = EvidenceGraphBuilder()
    func_id = builder.add_node("FUNCTION", "dynamic_call")
    unsupp_id = builder.add_node("UNSUPPORTED_FLOW", "dynamic")
    builder.add_edge("HAS_LIMITATION", func_id, unsupp_id)
    
    graph = builder.build_scan_graph()
    assert get_node(graph, "UNSUPPORTED_FLOW") is not None
    assert get_edge(graph, "HAS_LIMITATION") is not None
    assert unsupp_id in graph.unsupported_flow_nodes

def test_t06_tool_failure_coverage_gap():
    """T06: Tool failure -> COVERAGE_GAP node"""
    builder = EvidenceGraphBuilder()
    gap_id = builder.add_node("COVERAGE_GAP", "Tool failed")
    
    graph = builder.build_scan_graph()
    assert get_node(graph, "COVERAGE_GAP") is not None
    assert gap_id in graph.coverage_gap_nodes

def test_t07_relative_file_path():
    """T07: file_path in node -> Relative, no workspace prefix"""
    builder = EvidenceGraphBuilder(workspace_path="/app/workspace")
    node_id = builder.add_node("FILE", "test.py", "/app/workspace/src/test.py")
    
    graph = builder.build_scan_graph()
    node = get_node(graph, "FILE")
    assert node["file_path"] == "src/test.py"

def test_t08_raw_source_assertion():
    """T08: Raw source in node attribute -> Assertion error"""
    builder = EvidenceGraphBuilder()
    with pytest.raises(AssertionError):
        builder.add_node("FUNCTION", "test", attributes={"source_code": "def func(): pass"})
        
    with pytest.raises(AssertionError):
        builder.add_node("FUNCTION", "test", attributes={"content": "def func():\n    return 1"})

def test_t09_max_nodes_truncation():
    """T09: 10,001 nodes -> Truncated at 10,000, COVERAGE_GAP added"""
    builder = EvidenceGraphBuilder()
    # Add exactly 10,000 nodes (0 to 9999)
    for i in range(10000):
        builder.add_node("FILE", f"file_{i}.py")
        
    # Attempt to add the 10,001st node
    node_10001 = builder.add_node("FILE", "file_10000.py")
    
    graph = builder.build_scan_graph()
    
    assert node_10001 is None
    # 10,000 original + 1 coverage gap = 10001
    assert graph.node_count == 10001
    assert len(graph.coverage_gap_nodes) == 1

def test_t10_ai_invocation_nodes_tracking():
    """T10: ScanGraph.ai_invocation_nodes lists all AI_MODEL_INVOCATION node IDs"""
    builder = EvidenceGraphBuilder()
    inv1 = builder.add_node("AI_MODEL_INVOCATION", "call1")
    inv2 = builder.add_node("AI_MODEL_INVOCATION", "call2")
    
    graph = builder.build_scan_graph()
    assert len(graph.ai_invocation_nodes) == 2
    assert inv1 in graph.ai_invocation_nodes
    assert inv2 in graph.ai_invocation_nodes


def test_t11_graph_identity_and_metadata_are_deterministic_and_traceable():
    def build_graph():
        builder = EvidenceGraphBuilder(
            workspace_path="/workspace",
            scan_job_id="scan-42",
            repository_ref="repository:demo",
            commit_sha="abc123",
            tool_version="scanner-1.0.0",
            config_hash="sha256:scanner-config",
        )
        file_id = builder.add_node(
            "FILE",
            "src/app.py",
            "/workspace/src/app.py",
            evidence_refs=["evidence:finding-1"],
        )
        invocation_id = builder.add_node(
            "AI_MODEL_INVOCATION",
            "client.responses.create",
            "/workspace/src/app.py",
            line_number=12,
            finding_ids=["finding-1"],
            evidence_refs=["evidence:finding-1"],
        )
        builder.add_edge(
            "CALLS",
            file_id,
            invocation_id,
            evidence_refs=["evidence:finding-1"],
        )
        return builder.build_scan_graph()

    first = build_graph()
    second = build_graph()

    assert first.graph_id == second.graph_id
    assert first.graph_hash == second.graph_hash
    assert first.nodes == second.nodes
    assert first.edges == second.edges
    assert first.provenance["scan_job_id"] == "scan-42"
    assert first.provenance["commit_sha"] == "abc123"
    assert first.coverage_state == "SUFFICIENT"
    assert first.nodes[0]["evidence_refs"] == ["evidence:finding-1"]
    assert first.nodes[0]["provenance"]["tool_version"] == "scanner-1.0.0"
    assert first.edges[0]["coverage_state"] == "SUFFICIENT"
