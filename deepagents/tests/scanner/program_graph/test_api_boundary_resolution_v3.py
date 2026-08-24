from __future__ import annotations

import json
from pathlib import Path

from tools.graph.scanner.program_graph.assembler import ProgramGraphAssembler
from tools.graph.scanner.program_graph.query_engine import ProgramGraphQueryEngine


def _assemble(tmp_path: Path):
    return ProgramGraphAssembler().assemble(
        scan_job_id="scan-api-boundary",
        snapshot_id="snapshot-api-boundary",
        commit_sha="api-boundary-sha",
        workspace_path=tmp_path,
    )


def test_openapi_generic_payload_traces_through_fastapi_handler_to_repository(tmp_path: Path) -> None:
    (tmp_path / "openapi.json").write_text(
        json.dumps(
            {
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
        ),
        encoding="utf-8",
    )
    (tmp_path / "app.py").write_text(
        '''
@app.post("/verify")
def verify(x):
    repository.save(x)
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    field = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "POST /verify request.payload"
    )
    route = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "HTTP_ROUTE"
        and node.get("label") == "POST /verify"
    )
    handler = next(
        node
        for node in graph.nodes
        if node.get("node_type") in {"FUNCTION", "METHOD"}
        and node.get("label") == "verify"
        and str((node.get("source") or {}).get("file_path") or "") == "app.py"
    )

    assert any(
        edge.get("edge_type") == "HANDLED_BY"
        and edge.get("source_node_id") == route.get("node_id")
        and edge.get("target_node_id") == handler.get("node_id")
        and edge.get("origin") == "FRAMEWORK_RESOLUTION"
        for edge in graph.edges
    )

    result = ProgramGraphQueryEngine(graph).inspect_data_path(
        start_ref=str(field["node_id"]),
        max_hops=12,
        max_results=100,
    )
    kinds = {node.get("node_type") for node in result.nodes}

    assert "HTTP_REQUEST" in kinds
    assert "HTTP_ROUTE" in kinds
    assert "FUNCTION" in kinds
    assert "REPOSITORY_ACCESS" in kinds
    assert result.unresolved_frontiers == []


def test_contract_field_flows_into_http_request_before_route(tmp_path: Path) -> None:
    (tmp_path / "openapi.json").write_text(
        json.dumps(
            {
                "openapi": "3.1.0",
                "paths": {
                    "/submit": {
                        "post": {
                            "requestBody": {
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {"blob": {"type": "string"}},
                                        }
                                    }
                                }
                            },
                            "responses": {"200": {"description": "ok"}},
                        }
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    field = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "DATA_OBJECT"
        and node.get("label") == "POST /submit request.blob"
    )
    request = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "HTTP_REQUEST"
        and node.get("label") == "POST /submit request"
    )

    assert any(
        edge.get("edge_type") == "FLOWS_TO"
        and edge.get("source_node_id") == field.get("node_id")
        and edge.get("target_node_id") == request.get("node_id")
        for edge in graph.edges
    )


def test_nest_controller_route_resolves_to_concrete_method_symbol(tmp_path: Path) -> None:
    (tmp_path / "controller.ts").write_text(
        '''
@Controller("identity")
export class IdentityController {
  @Post("verify")
  async verify(payload: unknown) {
    return this.service.verify(payload);
  }
}
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    route = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "HTTP_ROUTE"
        and node.get("label") == "POST /identity/verify"
    )
    handlers = [
        edge
        for edge in graph.edges
        if edge.get("source_node_id") == route.get("node_id")
        and edge.get("edge_type") == "HANDLED_BY"
    ]
    targets = {
        edge.get("target_node_id")
        for edge in handlers
    }

    assert any(
        node.get("node_id") in targets
        and node.get("node_type") in {"FUNCTION", "METHOD"}
        and node.get("label") == "verify"
        for node in graph.nodes
    )


def test_source_http_route_without_resolvable_handler_is_explicit_frontier(tmp_path: Path) -> None:
    (tmp_path / "controller.ts").write_text(
        '''
@Controller("identity")
export class IdentityController {
  @Post("verify")
  handler = createRuntimeHandler();
}
''',
        encoding="utf-8",
    )

    graph = _assemble(tmp_path)
    route = next(
        node
        for node in graph.nodes
        if node.get("node_type") == "HTTP_ROUTE"
        and node.get("label") == "POST /identity/verify"
    )
    unresolved_edges = [
        edge
        for edge in graph.edges
        if edge.get("source_node_id") == route.get("node_id")
        and edge.get("edge_type") == "RESOLVES_TO"
    ]

    assert unresolved_edges
    target = next(
        node
        for node in graph.nodes
        if node.get("node_id") == unresolved_edges[0].get("target_node_id")
    )
    assert target.get("node_type") == "UNRESOLVED_DYNAMIC_TARGET"
    assert target.get("node_id") in graph.unresolved_frontiers
