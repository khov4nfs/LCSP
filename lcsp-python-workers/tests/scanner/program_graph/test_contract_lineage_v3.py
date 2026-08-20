from __future__ import annotations

import json
from pathlib import Path

from lcsp_workers.scanner.program_graph.assembler import ProgramGraphAssembler


def _assemble(tmp_path: Path):
    return ProgramGraphAssembler().assemble(
        scan_job_id="scan-contract",
        snapshot_id="snapshot-contract",
        commit_sha="contract-sha",
        workspace_path=tmp_path,
    )


def test_openapi_generic_payload_is_first_class_data_without_name_semantics(tmp_path: Path) -> None:
    payload = {
        "openapi": "3.1.0",
        "paths": {
            "/verify": {
                "post": {
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "payload": {"type": "string"},
                                    },
                                }
                            }
                        }
                    },
                    "responses": {"204": {"description": "ok"}},
                }
            }
        },
    }
    (tmp_path / "openapi.json").write_text(json.dumps(payload), encoding="utf-8")

    graph = _assemble(tmp_path)

    route = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "HTTP_ROUTE" and node.get("label") == "POST /verify"
    )
    request = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "HTTP_REQUEST" and "POST /verify request" == node.get("label")
    )
    data = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "POST /verify request.payload"
    )

    assert route["origin"] == "CONTRACT_ANALYSIS"
    assert request["origin"] == "CONTRACT_ANALYSIS"
    assert data["origin"] == "CONTRACT_ANALYSIS"
    assert data["resolution_state"] == "OBSERVED"
    assert data["semantic_types"] == []
    assert any(
        edge.get("edge_type") == "CARRIES_DATA"
        and edge.get("source_node_id") == request.get("node_id")
        and edge.get("target_node_id") == data.get("node_id")
        for edge in graph.edges
    )
    assert any(
        edge.get("edge_type") == "FLOWS_TO"
        and edge.get("source_node_id") == request.get("node_id")
        and edge.get("target_node_id") == route.get("node_id")
        for edge in graph.edges
    )


def test_openapi_sensitive_field_name_stays_inferred_until_behavior_corroborates(tmp_path: Path) -> None:
    payload = {
        "openapi": "3.1.0",
        "paths": {
            "/profile": {
                "post": {
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "fingerprint": {"type": "string"},
                                    },
                                }
                            }
                        }
                    },
                    "responses": {"200": {"description": "ok"}},
                }
            }
        },
    }
    (tmp_path / "swagger.json").write_text(json.dumps(payload), encoding="utf-8")

    graph = _assemble(tmp_path)
    data = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "POST /profile request.fingerprint"
    )

    assert "SENSITIVE.BIOMETRIC" in data["semantic_types"]
    assert data["resolution_state"] == "INFERRED"
    assert not (data.get("attributes") or {}).get("corroboratedCapabilities")


def test_openapi_component_schema_is_resolved_into_request_and_response_lineage(tmp_path: Path) -> None:
    payload = {
        "openapi": "3.1.0",
        "components": {
            "schemas": {
                "VerifyRequest": {
                    "type": "object",
                    "properties": {"blob": {"type": "string", "format": "binary"}},
                },
                "VerifyResponse": {
                    "type": "object",
                    "properties": {"accepted": {"type": "boolean"}},
                },
            }
        },
        "paths": {
            "/verify": {
                "post": {
                    "requestBody": {
                        "content": {
                            "application/octet-stream": {
                                "schema": {"$ref": "#/components/schemas/VerifyRequest"}
                            }
                        }
                    },
                    "responses": {
                        "200": {
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/VerifyResponse"}
                                }
                            }
                        }
                    },
                }
            }
        },
    }
    (tmp_path / "openapi.json").write_text(json.dumps(payload), encoding="utf-8")

    graph = _assemble(tmp_path)

    assert any(
        node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "POST /verify request.blob"
        for node in graph.nodes
    )
    assert any(
        node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "POST /verify response 200.accepted"
        for node in graph.nodes
    )
    assert any(
        node.get("node_type") == "HTTP_RESPONSE"
        and node.get("label") == "POST /verify response 200"
        for node in graph.nodes
    )


def test_graphql_input_object_survives_generic_payload_naming(tmp_path: Path) -> None:
    (tmp_path / "schema.graphql").write_text(
        '''
input VerifyInput {
  payload: String!
}

type Mutation {
  verify(input: VerifyInput!): Boolean!
}
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    operation = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "GRAPHQL_OPERATION"
        and node.get("label") == "Mutation.verify"
    )
    generic = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "Mutation.verify.input.payload"
    )

    assert operation["origin"] == "CONTRACT_ANALYSIS"
    assert generic["resolution_state"] == "OBSERVED"
    assert generic["semantic_types"] == []


def test_openapi_yaml_fallback_records_route_without_inventing_field_schema(tmp_path: Path) -> None:
    (tmp_path / "openapi.yaml").write_text(
        '''
openapi: 3.1.0
paths:
  /verify:
    post:
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                payload:
                  type: string
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)

    assert any(
        node.get("node_type") == "HTTP_ROUTE" and node.get("label") == "POST /verify"
        for node in graph.nodes
    )
    assert any(
        node.get("node_type") == "HTTP_REQUEST" and node.get("label") == "POST /verify request"
        for node in graph.nodes
    )
    assert not any(
        node.get("node_type") == "DATA_OBJECT"
        and "POST /verify request.payload" == node.get("label")
        for node in graph.nodes
    )
