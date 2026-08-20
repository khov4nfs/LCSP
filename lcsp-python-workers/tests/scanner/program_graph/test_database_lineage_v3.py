from __future__ import annotations

from pathlib import Path

from lcsp_workers.scanner.program_graph.assembler import ProgramGraphAssembler
from lcsp_workers.scanner.program_graph.query_engine import ProgramGraphQueryEngine


def _assemble(tmp_path: Path):
    return ProgramGraphAssembler().assemble(
        scan_job_id="scan-db",
        snapshot_id="snapshot-db",
        commit_sha="db-sha",
        workspace_path=tmp_path,
    )


def test_prisma_schema_becomes_entity_table_and_field_lineage(tmp_path: Path) -> None:
    (tmp_path / "schema.prisma").write_text(
        '''
model Identity {
  id          String @id
  payload     Bytes
  fingerprint Bytes
}
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    entity = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "ENTITY" and node.get("label") == "Identity"
    )
    table = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "TABLE" and node.get("label") == "Identity"
    )
    fingerprint = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "Identity.fingerprint"
    )

    assert fingerprint["origin"] == "CONTRACT_ANALYSIS"
    assert fingerprint["resolution_state"] == "INFERRED"
    assert "SENSITIVE.BIOMETRIC" in fingerprint["semantic_types"]
    # The schema field name is a weak seed only. It must not taint the whole entity or
    # table until runtime/behavior lineage corroborates actual biometric processing.
    assert "SENSITIVE.BIOMETRIC" not in entity.get("semantic_types", [])
    assert "SENSITIVE.BIOMETRIC" not in table.get("semantic_types", [])
    assert any(
        edge.get("edge_type") == "MAPS_TO"
        and edge.get("source_node_id") == entity.get("node_id")
        and edge.get("target_node_id") == table.get("node_id")
        for edge in graph.edges
    )
    assert any(
        edge.get("edge_type") == "FLOWS_TO"
        and edge.get("source_node_id") == fingerprint.get("node_id")
        and edge.get("target_node_id") == entity.get("node_id")
        for edge in graph.edges
    )


def test_model_scoped_repository_access_resolves_to_prisma_table(tmp_path: Path) -> None:
    (tmp_path / "schema.prisma").write_text(
        '''
model Identity {
  id String @id
  payload Bytes
}
''',
        encoding="utf-8",
    )
    (tmp_path / "persist.py").write_text(
        '''
def persist(payload):
    return identity.update(payload)
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    access = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "REPOSITORY_ACCESS"
        and node.get("label") == "identity.update"
    )
    table = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "TABLE" and node.get("label") == "Identity"
    )

    assert any(
        edge.get("edge_type") == "PERSISTS_TO"
        and edge.get("source_node_id") == access.get("node_id")
        and edge.get("target_node_id") == table.get("node_id")
        and edge.get("resolution_state") == "CORROBORATED"
        for edge in graph.edges
    )


def test_behavior_corroborated_biometric_data_propagates_to_persisted_table(tmp_path: Path) -> None:
    (tmp_path / "schema.prisma").write_text(
        '''
model Identity {
  id String @id
  payload Bytes
}
''',
        encoding="utf-8",
    )
    (tmp_path / "verify.py").write_text(
        '''
def verify(x):
    a = face_recognition.encode(x)
    b = embedding(a)
    score = similarity(b, stored_template)
    identity.update(b)
    return verify_identity(score)
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    table = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "TABLE" and node.get("label") == "Identity"
    )
    access = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "REPOSITORY_ACCESS"
        and node.get("label") == "identity.update"
    )

    assert "SENSITIVE.BIOMETRIC" in access.get("semantic_types", [])
    assert "SENSITIVE.BIOMETRIC" in table.get("semantic_types", [])
    result = ProgramGraphQueryEngine(graph).inspect_data_path(
        start_ref=str(
            next(
                node["node_id"]
                for node in graph.nodes
                if node.get("node_type") == "DATA_OBJECT"
                and node.get("label") == "b"
                and "SENSITIVE.BIOMETRIC" in (node.get("semantic_types") or [])
            )
        ),
        max_hops=10,
        max_results=100,
    )
    assert table.get("node_id") in {node.get("node_id") for node in result.nodes}


def test_sql_ddl_schema_is_structural_evidence_not_sensitive_conclusion(tmp_path: Path) -> None:
    (tmp_path / "schema.sql").write_text(
        '''
CREATE TABLE people (
  id UUID PRIMARY KEY,
  government_id VARCHAR(64),
  payload BYTEA
);
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    government_id = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "people.government_id"
    )
    table = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "TABLE" and node.get("label") == "people"
    )

    assert "PII.GOVERNMENT_ID" in government_id["semantic_types"]
    assert government_id["resolution_state"] == "INFERRED"
    assert "PII.GOVERNMENT_ID" not in table.get("semantic_types", [])
    assert not (government_id.get("attributes") or {}).get("corroboratedCapabilities")
