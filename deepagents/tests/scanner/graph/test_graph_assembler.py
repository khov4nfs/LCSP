from __future__ import annotations
from pathlib import Path
import pytest
from tools.graph.scanner.program_graph.assembler import ProgramGraphAssembler
from tools.graph.scanner.program_graph.builder import ProgramGraphBuilder, ProgramGraphValidationError
from tools.graph.scanner.program_graph.query_engine import ProgramGraphQueryEngine
from tools.graph.scanner.program_graph.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.graph.scanner.program_graph.validator import validate_program_graph


def _node(graph, kind: str): return next((n for n in graph.nodes if n["node_type"] == kind), None)
def _edge(graph, kind: str): return next((e for e in graph.edges if e["edge_type"] == kind), None)


def test_program_graph_scans_repository_before_ai_investigation(tmp_path: Path) -> None:
    source = tmp_path / "app.py"
    source.write_text('''import json\nfrom openai import OpenAI\nclient = OpenAI()\n\ndef evaluate(cccd, threshold):\n    payload = cccd\n    response = client.responses.create(input=payload)\n    parsed = json.loads(response.output_text)\n    if parsed.score > threshold:\n        return reject(parsed)\n    return parsed\n''')
    graph = ProgramGraphAssembler().assemble(scan_job_id="scan-1", snapshot_id="snapshot-1", commit_sha="abc", workspace_path=tmp_path)
    assert graph.schema_version == "3.0.0"
    assert _node(graph, "PARAMETER") is not None
    assert _node(graph, "VARIABLE") is not None
    assert _node(graph, "DATA_OBJECT") is not None
    assert _node(graph, "AI_MODEL_INVOCATION") is not None
    assert _node(graph, "AI_INPUT") is not None
    assert _node(graph, "AI_OUTPUT") is not None
    assert _node(graph, "PARSER") is not None
    assert _node(graph, "REJECTION") is not None
    assert _edge(graph, "ALIASES") is not None
    assert _edge(graph, "PASSES_ARGUMENT") is not None
    assert _edge(graph, "RECEIVES_RETURN") is not None
    assert _edge(graph, "SENDS_TO_AI") is not None
    assert _edge(graph, "FLOWS_TO") is not None
    assert graph.source_anchors
    assert all("source_code" not in str(n).lower() for n in graph.nodes)


def test_program_graph_preserves_semantic_pii_without_literal_value(tmp_path: Path) -> None:
    (tmp_path / "identity.py").write_text('''def submit(cccd, email):\n    identity = cccd\n    return send(identity, email)\n''')
    graph = ProgramGraphAssembler().assemble(scan_job_id="scan-2", snapshot_id="snapshot-2", commit_sha="def", workspace_path=tmp_path)
    semantic = {value for node in graph.nodes for value in node.get("semantic_types") or []}
    assert "PII.GOVERNMENT_ID" in semantic
    assert "PII.EMAIL" in semantic


def test_program_graph_query_traces_data_and_decision_path(tmp_path: Path) -> None:
    (tmp_path / "decision.py").write_text('''from openai import OpenAI\nclient = OpenAI()\ndef evaluate(applicant):\n    result = client.responses.create(input=applicant)\n    score = parse(result)\n    return reject(score)\n''')
    graph = ProgramGraphAssembler().assemble(scan_job_id="scan-3", snapshot_id="snapshot-3", commit_sha="ghi", workspace_path=tmp_path)
    engine = ProgramGraphQueryEngine(graph)
    invocation = engine.provider_invocations()[0]
    result = engine.inspect_decision_path(start_ref=invocation["node_id"], max_hops=12)
    assert any(n["node_type"] == "REJECTION" for n in result.nodes)
    review = engine.inspect_human_review_path(start_ref=invocation["node_id"], max_hops=12)
    assert review["state"] == "ABSENT_WITH_BOUNDED_PATH"


def test_dynamic_call_becomes_explicit_unresolved_frontier(tmp_path: Path) -> None:
    (tmp_path / "dynamic.py").write_text('''def run(registry, name, payload):\n    handler = registry[name]\n    return handler(payload)\n''')
    graph = ProgramGraphAssembler().assemble(scan_job_id="scan-4", snapshot_id="snapshot-4", commit_sha="jkl", workspace_path=tmp_path)
    assert _node(graph, "UNRESOLVED_DYNAMIC_TARGET") is not None
    assert graph.coverage_state == "LIMITED"
    assert graph.unresolved_frontiers


def test_builder_rejects_unknown_vocabulary_and_raw_attributes(tmp_path: Path) -> None:
    builder = ProgramGraphBuilder(tmp_path, scan_job_id="scan", snapshot_id="snap", commit_sha="sha")
    with pytest.raises(ProgramGraphValidationError):
        builder.add_program(SemanticProgram(nodes=[SemanticNodeFact("x", "NOT_A_NODE", "x")]))
    with pytest.raises(Exception):
        builder.add_program(SemanticProgram(nodes=[SemanticNodeFact("x", "FUNCTION", "x", attributes={"source_code": "def x(): pass"})]))


def test_graph_hash_and_source_anchors_are_deterministic(tmp_path: Path) -> None:
    (tmp_path / "simple.py").write_text("def value(x):\n    return x\n")
    kwargs = dict(scan_job_id="scan", snapshot_id="snap", commit_sha="sha", workspace_path=tmp_path)
    first = ProgramGraphAssembler().assemble(**kwargs); second = ProgramGraphAssembler().assemble(**kwargs)
    assert first.graph_hash == second.graph_hash
    assert first.graph_id == second.graph_id
    assert first.nodes == second.nodes
    validate_program_graph(first)
