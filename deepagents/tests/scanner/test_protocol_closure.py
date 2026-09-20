from __future__ import annotations

from pathlib import Path

from tools.common.capabilities.evidence.graph.construction.assembly.assembler import ProgramGraphAssembler
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.lineage.data.data_lineage import SemanticDataLineageExtractor
from tools.common.capabilities.evidence.graph.resolution.dispatch.protocol_resolution import ProtocolBoundaryResolver
from tools.common.capabilities.evidence.graph.resolution.cross_project_resolution import CrossReferenceResolver


def test_graphql_document_and_decorated_resolver_reuse_canonical_symbol(tmp_path: Path) -> None:
    (tmp_path / "schema.graphql").write_text("type Query { users: [User!]! }\n", encoding="utf-8")
    (tmp_path / "resolver.py").write_text(
        "from graphene import ObjectType\nclass Query(ObjectType):\n    def users(self):\n        return []\n",
        encoding="utf-8",
    )
    graph = ProgramGraphAssembler().assemble(
        scan_job_id="protocol", snapshot_id="snapshot", commit_sha="commit", workspace_path=tmp_path
    )
    assert any(node["node_type"] == "GRAPHQL_OPERATION" for node in graph.nodes)


def test_proto_service_identity_is_qualified_and_ambiguous_methods_stay_unresolved(tmp_path: Path) -> None:
    proto = tmp_path / "users.proto"
    proto.write_text(
        "package users.v1;\nservice Users { rpc Get (GetRequest) returns (User); }\nmessage GetRequest { string id = 1; }\nmessage User { string id = 1; }\n",
        encoding="utf-8",
    )
    program = SemanticProgram()
    SemanticDataLineageExtractor(tmp_path).enrich(program)
    methods = [node for node in program.nodes if node.node_type == "GRPC_METHOD"]
    assert len(methods) == 1
    assert methods[0].attributes["service"] == "Users"
    assert methods[0].attributes["package"] == "users.v1"
    assert methods[0].label == "Get"

    program.add_node(SemanticNodeFact("symbol:a:Get", "METHOD", "Get"))
    program.add_node(SemanticNodeFact("symbol:b:Get", "METHOD", "Get"))
    ProtocolBoundaryResolver().enrich(program)
    assert any(node.node_type == "UNRESOLVED_DYNAMIC_TARGET" for node in program.nodes)


def test_messaging_facts_use_canonical_queue_and_event_vocabulary(tmp_path: Path) -> None:
    (tmp_path / "worker.py").write_text(
        "from celery import shared_task\n@shared_task(name='invoice-created')\ndef consume():\n    return True\n\ndef publish():\n    return consume.delay()\n",
        encoding="utf-8",
    )
    graph = ProgramGraphAssembler().assemble(
        scan_job_id="messaging", snapshot_id="snapshot", commit_sha="commit", workspace_path=tmp_path
    )
    assert any(node["node_type"] in {"QUEUE", "EVENT"} for node in graph.nodes)
    assert any(edge["edge_type"] in {"PUBLISHES_TO_QUEUE", "CONSUMES_FROM_QUEUE", "PUBLISHES_EVENT", "CONSUMES_EVENT"} for edge in graph.edges)


def test_messaging_resource_resolution_requires_provider_and_literal_name() -> None:
    program = SemanticProgram(
        nodes=[
            SemanticNodeFact("queue:a", "QUEUE", "orders", attributes={"provider": "kafka", "resourceName": "orders"}),
            SemanticNodeFact("queue:b", "QUEUE", "orders", attributes={"provider": "kafka", "resourceName": "orders"}),
            SemanticNodeFact("queue:c", "QUEUE", "orders", attributes={"provider": "rabbitmq", "resourceName": "orders"}),
        ]
    )
    CrossReferenceResolver().enrich(program, Path("."))
    assert any(edge.edge_type == "RESOLVES_TO" and edge.source_key == "queue:a" for edge in program.edges)
    assert not any(edge.source_key == "queue:a" and edge.target_key == "queue:c" for edge in program.edges)


def test_graphql_client_links_only_to_explicit_unique_server_operation() -> None:
    from tools.common.capabilities.evidence.graph.resolution.dispatch.protocol_resolution import ProtocolBoundaryResolver

    program = SemanticProgram(
        nodes=[
            SemanticNodeFact(
                "client:get-user", "GRAPHQL_OPERATION", "Query.GetUser", "web/query.graphql",
                attributes={"graphqlRole": "CLIENT", "operationType": "Query", "operationName": "GetUser", "endpoint": "api"},
            ),
            SemanticNodeFact(
                "server:get-user", "GRAPHQL_OPERATION", "Query.GetUser", "api/schema.graphql",
                attributes={"graphqlRole": "SERVER", "operationType": "Query", "operationName": "GetUser", "service": "api"},
            ),
        ]
    )
    ProtocolBoundaryResolver().enrich(program)
    assert any(edge.source_key == "client:get-user" and edge.target_key == "server:get-user" for edge in program.edges)


def test_graphql_operation_documents_emit_client_contract_facts(tmp_path: Path) -> None:
    document = tmp_path / "GetUser.graphql"
    document.write_text("query GetUser($id: ID!) { user(id: $id) { id } }\n", encoding="utf-8")
    program = SemanticProgram()
    from tools.common.capabilities.evidence.graph.lineage.contract.contract_lineage import ContractDataLineageExtractor

    ContractDataLineageExtractor(tmp_path).enrich(program)
    operation = next(node for node in program.nodes if node.node_type == "GRAPHQL_OPERATION")
    assert operation.attributes["graphqlRole"] == "CLIENT"
    assert operation.attributes["operationName"] == "GetUser"


def test_graphql_client_ambiguity_and_dynamic_endpoint_stay_unresolved() -> None:
    from tools.common.capabilities.evidence.graph.resolution.dispatch.protocol_resolution import ProtocolBoundaryResolver

    program = SemanticProgram(
        nodes=[
            SemanticNodeFact("client:get-user", "GRAPHQL_OPERATION", "Query.GetUser", "query.graphql", attributes={"graphqlRole": "CLIENT", "operationType": "Query", "operationName": "GetUser"}),
            SemanticNodeFact("a:get-user", "GRAPHQL_OPERATION", "Query.GetUser", "a.graphql", attributes={"graphqlRole": "SERVER", "operationType": "Query", "operationName": "GetUser", "service": "a"}),
            SemanticNodeFact("b:get-user", "GRAPHQL_OPERATION", "Query.GetUser", "b.graphql", attributes={"graphqlRole": "SERVER", "operationType": "Query", "operationName": "GetUser", "service": "b"}),
        ]
    )
    ProtocolBoundaryResolver().enrich(program)
    assert not any(edge.source_key == "client:get-user" for edge in program.edges)
    assert "graphql-client:client:get-user" in program.unresolved_frontiers


def test_grpc_client_links_by_proto_identity_and_preserves_ambiguity_safety() -> None:
    from tools.common.capabilities.evidence.graph.resolution.dispatch.protocol_resolution import ProtocolBoundaryResolver

    program = SemanticProgram(
        nodes=[
            SemanticNodeFact("rpc:get", "GRPC_METHOD", "Get", "users.proto", attributes={"package": "users.v1", "service": "Users", "method": "Get"}),
            SemanticNodeFact("server:get", "METHOD", "Get", "server.py"),
            SemanticNodeFact("client:get", "CALL_SITE", "stub.Get", "client.py", attributes={"protocol": "GRPC", "grpcPackage": "users.v1", "grpcService": "Users", "grpcMethod": "Get"}),
        ]
    )
    ProtocolBoundaryResolver().enrich(program)
    assert any(edge.source_key == "client:get" and edge.target_key == "rpc:get" for edge in program.edges)
    assert any(edge.source_key == "rpc:get" and edge.target_key == "server:get" for edge in program.edges)


def test_grpc_client_without_service_identity_stays_unresolved() -> None:
    from tools.common.capabilities.evidence.graph.resolution.dispatch.protocol_resolution import ProtocolBoundaryResolver

    program = SemanticProgram(
        nodes=[
            SemanticNodeFact("a", "GRPC_METHOD", "Get", "a.proto", attributes={"package": "a", "service": "Users", "method": "Get"}),
            SemanticNodeFact("b", "GRPC_METHOD", "Get", "b.proto", attributes={"package": "b", "service": "Users", "method": "Get"}),
            SemanticNodeFact("call", "CALL_SITE", "stub.Get", "client.py", attributes={"protocol": "GRPC", "grpcMethod": "Get"}),
        ]
    )
    ProtocolBoundaryResolver().enrich(program)
    assert not any(edge.source_key == "call" for edge in program.edges)


def test_integrated_protocol_acceptance_matrix_is_deterministic_and_provenance_backed() -> None:
    def build() -> SemanticProgram:
        return SemanticProgram(
            nodes=[
                SemanticNodeFact("http-call", "CALL_SITE", "fetch", "frontend/api.ts", 4, 4, attributes={"integrationType": "HTTP", "method": "GET", "route": "/users/1"}),
                SemanticNodeFact("http-route", "HTTP_ROUTE", "GET /users/{id}", "api/routes.ts", 8, 8, attributes={"method": "GET", "path": "/users/{id}"}),
                SemanticNodeFact("gql-client", "GRAPHQL_OPERATION", "Query.GetUser", "frontend/query.graphql", 1, 1, attributes={"graphqlRole": "CLIENT", "operationType": "Query", "operationName": "GetUser", "endpoint": "api"}),
                SemanticNodeFact("gql-server", "GRAPHQL_OPERATION", "Query.GetUser", "api/schema.graphql", 1, 1, attributes={"graphqlRole": "SERVER", "operationType": "Query", "operationName": "GetUser", "service": "api"}),
                SemanticNodeFact("rpc", "GRPC_METHOD", "GetUser", "contracts/users.proto", 5, 5, attributes={"package": "users.v1", "service": "Users", "method": "GetUser"}),
                SemanticNodeFact("rpc-server", "METHOD", "GetUser", "worker/server.py", 12, 12),
                SemanticNodeFact("rpc-client", "CALL_SITE", "stub.GetUser", "worker/client.py", 6, 6, attributes={"protocol": "GRPC", "grpcPackage": "users.v1", "grpcService": "Users", "grpcMethod": "GetUser"}),
                SemanticNodeFact("producer", "EVENT", "invoice-created", "api/events.ts", attributes={"provider": "kafka", "resourceName": "invoice-created"}),
                SemanticNodeFact("consumer", "EVENT", "invoice-created", "worker/events.py", attributes={"provider": "kafka", "resourceName": "invoice-created"}),
                SemanticNodeFact("screen", "FUNCTION", "HomeScreen", "frontend/Home.tsx"),
                SemanticNodeFact("page", "FUNCTION", "UserPage", "frontend/User.tsx"),
            ],
            edges=[SemanticEdgeFact("NAVIGATES_TO", "screen", "page", evidence_refs=("frontend/Home.tsx", "frontend/User.tsx")), SemanticEdgeFact("HANDLES_COMMAND", "api-command", "api-handler")],
        )

    first = build()
    CrossReferenceResolver().enrich(first, Path("."))
    ProtocolBoundaryResolver().enrich(first)
    second = build()
    CrossReferenceResolver().enrich(second, Path("."))
    ProtocolBoundaryResolver().enrich(second)
    first_edges = sorted((edge.edge_type, edge.source_key, edge.target_key) for edge in first.edges)
    second_edges = sorted((edge.edge_type, edge.source_key, edge.target_key) for edge in second.edges)
    assert first_edges == second_edges
    assert {"NAVIGATES_TO", "RESOLVES_TO"}.issubset({edge[0] for edge in first_edges})
    assert any(edge.source_key == "rpc-client" and edge.target_key == "rpc" for edge in first.edges)
    assert any(edge.source_key == "gql-client" and edge.target_key == "gql-server" for edge in first.edges)
    assert any(
        {edge.source_key, edge.target_key} == {"producer", "consumer"}
        and edge.attributes.get("resolution") == "MESSAGING_RESOURCE"
        for edge in first.edges
    )
