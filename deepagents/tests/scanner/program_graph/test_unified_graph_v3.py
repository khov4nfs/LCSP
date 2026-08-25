from __future__ import annotations

from pathlib import Path

from tools.common.capabilities.evidence.graph.construction.assembly.assembler import ProgramGraphAssembler
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.evidence.graph.construction.validation.validator import validate_program_graph


def _assemble(tmp_path: Path):
    return ProgramGraphAssembler().assemble(
        scan_job_id="scan-v3",
        snapshot_id="snapshot-v3",
        commit_sha="abc123",
        workspace_path=tmp_path,
    )


def test_v3_persists_trust_metadata_on_every_node_and_edge(tmp_path: Path) -> None:
    (tmp_path / "app.py").write_text(
        "def transform(x):\n    y = x\n    return y\n",
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    assert graph.schema_version == "3.0.0"
    assert graph.nodes
    assert graph.edges
    assert all(node.get("origin") for node in graph.nodes)
    assert all(node.get("resolution_state") for node in graph.nodes)
    assert all(isinstance(node.get("support_refs"), list) for node in graph.nodes)
    assert all(edge.get("origin") for edge in graph.edges)
    assert all(edge.get("resolution_state") for edge in graph.edges)
    assert all(isinstance(edge.get("support_refs"), list) for edge in graph.edges)
    validate_program_graph(graph)


def test_generic_identifiers_are_classified_from_biometric_behavior_not_name(tmp_path: Path) -> None:
    (tmp_path / "verify.py").write_text(
        '''
def run(x):
    a = face_recognition.encode(x)
    b = embedding(a)
    score = similarity(b, stored_template)
    return verify(score)
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    biometric_nodes = [
        node
        for node in graph.nodes
        if node.get("node_type") in {"DATA_OBJECT", "DATA_ASSET"}
        and "SENSITIVE.BIOMETRIC" in (node.get("semantic_types") or [])
    ]
    assert biometric_nodes
    assert any(node.get("resolution_state") == "CORROBORATED" for node in biometric_nodes)
    assert any(
        str((node.get("source") or {}).get("file_path") or "") == "verify.py"
        for node in biometric_nodes
    )


def test_biometric_identifier_alone_remains_weak_inferred_seed(tmp_path: Path) -> None:
    (tmp_path / "profile.py").write_text(
        '''
def store(fingerprint):
    value = fingerprint
    return value
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    biometric_nodes = [
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and "SENSITIVE.BIOMETRIC" in (node.get("semantic_types") or [])
    ]
    assert biometric_nodes
    assert all(node.get("resolution_state") != "CORROBORATED" for node in biometric_nodes)
    assert all(
        "BIOMETRIC_PROCESSING"
        not in ((node.get("attributes") or {}).get("corroboratedCapabilities") or [])
        for node in biometric_nodes
    )


def test_protobuf_contract_creates_protocol_message_and_data_object(tmp_path: Path) -> None:
    (tmp_path / "identity.proto").write_text(
        '''
syntax = "proto3";
message VerifyRequest {
  bytes payload = 1;
}
message VerifyReply {
  bool accepted = 1;
}
service IdentityService {
  rpc Verify(VerifyRequest) returns (VerifyReply);
}
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    assert any(node.get("node_type") == "DATA_CONTRACT" for node in graph.nodes)
    assert any(
        node.get("node_type") == "PROTOCOL_MESSAGE"
        and node.get("label") == "VerifyRequest"
        for node in graph.nodes
    )
    payload = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "VerifyRequest.payload"
    )
    assert payload.get("origin") == "CONTRACT_ANALYSIS"
    assert payload.get("resolution_state") == "OBSERVED"
    assert any(
        node.get("node_type") == "GRPC_METHOD" and node.get("label") == "Verify"
        for node in graph.nodes
    )


def test_grpc_method_resolves_to_unique_concrete_implementation(tmp_path: Path) -> None:
    (tmp_path / "identity.proto").write_text(
        '''
syntax = "proto3";
message VerifyRequest { bytes payload = 1; }
message VerifyReply { bool accepted = 1; }
service IdentityService { rpc Verify(VerifyRequest) returns (VerifyReply); }
''',
        encoding="utf-8",
    )
    (tmp_path / "service.py").write_text(
        '''
def Verify(request):
    return handle(request)
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    grpc = next(node for node in graph.nodes if node.get("node_type") == "GRPC_METHOD")
    resolved = [
        edge
        for edge in graph.edges
        if edge.get("source_node_id") == grpc.get("node_id")
        and edge.get("edge_type") == "RESOLVES_TO"
    ]

    assert len(resolved) == 1
    target = next(
        node
        for node in graph.nodes
        if node.get("node_id") == resolved[0].get("target_node_id")
    )
    assert target.get("node_type") in {"FUNCTION", "METHOD"}
    assert target.get("label") == "Verify"
    assert resolved[0].get("resolution_state") == "CORROBORATED"


def test_unresolved_grpc_method_is_explicit_frontier(tmp_path: Path) -> None:
    (tmp_path / "identity.proto").write_text(
        '''
syntax = "proto3";
message VerifyRequest { bytes payload = 1; }
message VerifyReply { bool accepted = 1; }
service IdentityService { rpc Verify(VerifyRequest) returns (VerifyReply); }
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    grpc = next(node for node in graph.nodes if node.get("node_type") == "GRPC_METHOD")
    resolved = [
        edge
        for edge in graph.edges
        if edge.get("source_node_id") == grpc.get("node_id")
        and edge.get("edge_type") == "RESOLVES_TO"
    ]

    assert len(resolved) == 1
    target = next(
        node
        for node in graph.nodes
        if node.get("node_id") == resolved[0].get("target_node_id")
    )
    assert target.get("node_type") == "UNRESOLVED_DYNAMIC_TARGET"
    assert target.get("resolution_state") == "UNRESOLVED"
    assert target.get("node_id") in graph.unresolved_frontiers


def test_repository_training_lifecycle_is_not_collapsed_into_inference(tmp_path: Path) -> None:
    (tmp_path / "train.py").write_text(
        '''
from datasets import load_dataset
from transformers import Trainer
import mlflow

data = load_dataset("local")
trainer = Trainer()
trainer.train()
trainer.evaluate()
model.save_pretrained("artifact")
mlflow.register_model("runs:/model", "credit-model")
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    kinds = {node.get("node_type") for node in graph.nodes}

    assert "DATASET" in kinds
    assert "TRAINING_JOB" in kinds
    assert "EVALUATION_JOB" in kinds
    assert "MODEL_ARTIFACT" in kinds
    assert "MODEL_REGISTRY" in kinds
    model = next(node for node in graph.nodes if node.get("node_type") == "MODEL")
    assert (model.get("attributes") or {}).get("ownershipSignal") == "REPOSITORY_TRAINING_PRESENT"
    assert model.get("origin") == "AI_LIFECYCLE_ANALYSIS"


def test_inference_only_does_not_claim_repository_training(tmp_path: Path) -> None:
    (tmp_path / "serve.py").write_text(
        '''
import sklearn

def run(model, payload):
    return model.predict(payload)
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    assert not any(node.get("node_type") == "TRAINING_JOB" for node in graph.nodes)
    model = next(node for node in graph.nodes if node.get("node_type") == "MODEL")
    assert (model.get("attributes") or {}).get("ownershipSignal") == "UNRESOLVED"
    assert model.get("resolution_state") == "INFERRED"


def test_v2_artifact_remains_structurally_readable() -> None:
    payload = {
        "schema_version": "2.0.0",
        "graph_id": "program-graph:legacy",
        "snapshot_id": "snapshot-old",
        "commit_sha": "oldsha",
        "node_count": 1,
        "edge_count": 0,
        "nodes": [
            {
                "node_id": "node:legacy",
                "node_type": "FILE",
                "label": "src/app.py",
                "source": None,
                "attributes": {},
                "semantic_types": [],
                "evidence_refs": [],
                "coverage_state": "SUFFICIENT",
                "source_anchor_ref": None,
            }
        ],
        "edges": [],
        "source_anchors": [],
        "indexes": {"node:FILE": ["node:legacy"]},
        "unresolved_frontiers": [],
        "coverage_state": "SUFFICIENT",
        "coverage_notes": [],
        "provenance": {},
        "evidence_refs": [],
        "graph_hash": "sha256:legacy",
    }

    graph = ProgramEvidenceGraph.from_dict(payload)

    assert graph.schema_version == "2.0.0"
    assert validate_program_graph(graph) is graph
