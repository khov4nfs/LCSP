from pathlib import Path

from tools.common.capabilities.evidence.graph.resolution.cross_project_resolution import CrossReferenceResolver
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.scanner.inventory.project.project_discovery import ProjectDiscovery


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_dotnet_project_reference_resolves_to_stable_project_nodes(tmp_path: Path) -> None:
    _write(tmp_path / "api/Api.csproj", '<Project><ItemGroup><ProjectReference Include="../core/Core.csproj" /></ItemGroup></Project>')
    _write(tmp_path / "core/Core.csproj", "<Project />")
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram()
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 1
    assert any(edge.edge_type == "DEPENDS_ON" for edge in program.edges)
    assert {node.attributes["projectId"] for node in program.nodes} == {item.project_id for item in discovery.projects}


def test_http_template_resolution_is_method_aware_and_cross_project(tmp_path: Path) -> None:
    _write(tmp_path / "web/package.json", '{"name":"web"}')
    _write(tmp_path / "web/client.ts", "fetch('/api/users/42')")
    _write(tmp_path / "api/Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web" />')
    _write(tmp_path / "api/Users.cs", "class UsersController {}")
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram(
        nodes=[
            SemanticNodeFact("call", "CALL_SITE", "fetch", "web/client.ts", 1, 1, attributes={"integrationType": "HTTP", "method": "GET", "route": "/api/users/42"}),
            SemanticNodeFact("route", "HTTP_ROUTE", "GET /api/users/{id}", "api/Users.cs", 1, 1, attributes={"method": "GET", "route": "/api/users/{id}"}),
        ]
    )
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 1
    assert any(edge.edge_type == "CALLS_API" for edge in program.edges)


def test_ambiguous_http_targets_remain_unresolved(tmp_path: Path) -> None:
    for name in ("one", "two"):
        _write(tmp_path / name / "package.json", '{"name":"service"}')
        _write(tmp_path / name / "route.ts", "export const route = 1")
    _write(tmp_path / "web/package.json", '{"name":"web"}')
    _write(tmp_path / "web/client.ts", "fetch('/health')")
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram(
        nodes=[
            SemanticNodeFact("call", "CALL_SITE", "fetch", "web/client.ts", 1, 1, attributes={"integrationType": "HTTP", "method": "GET", "route": "/health"}),
            SemanticNodeFact("r1", "HTTP_ROUTE", "GET /health", "one/route.ts", 1, 1, attributes={"method": "GET", "route": "/health"}),
            SemanticNodeFact("r2", "HTTP_ROUTE", "GET /health", "two/route.ts", 1, 1, attributes={"method": "GET", "route": "/health"}),
        ]
    )
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 0
    assert "call" in result.unresolved
    assert not any(edge.edge_type == "CALLS_API" for edge in program.edges)


def test_same_project_duplicate_http_targets_remain_unresolved(tmp_path: Path) -> None:
    _write(tmp_path / "api/package.json", '{"name":"api"}')
    _write(tmp_path / "api/routes_a.ts", "export const route = 1")
    _write(tmp_path / "api/routes_b.ts", "export const route = 2")
    _write(tmp_path / "web/package.json", '{"name":"web"}')
    _write(tmp_path / "web/client.ts", "fetch('/health')")
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram(
        nodes=[
            SemanticNodeFact("call", "CALL_SITE", "fetch", "web/client.ts", 1, 1, attributes={"integrationType": "HTTP", "method": "GET", "route": "/health"}),
            SemanticNodeFact("r1", "HTTP_ROUTE", "GET /health", "api/routes_a.ts", 1, 1, attributes={"method": "GET", "route": "/health"}),
            SemanticNodeFact("r2", "HTTP_ROUTE", "GET /health", "api/routes_b.ts", 1, 1, attributes={"method": "GET", "route": "/health"}),
        ]
    )
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 0
    assert "call" in result.unresolved
    assert any(item.startswith("cross_http_ambiguous:") for item in result.limitations)


def test_unique_gradle_project_reference_resolves(tmp_path: Path) -> None:
    _write(tmp_path / "app/build.gradle", "implementation project(':common')\n")
    _write(tmp_path / "libs/common/build.gradle", "")
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram()
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 1
    assert any(edge.edge_type == "DEPENDS_ON" for edge in program.edges)


def test_ambiguous_gradle_suffix_reference_remains_unresolved(tmp_path: Path) -> None:
    _write(tmp_path / "app/build.gradle", "implementation project(':common')\n")
    _write(tmp_path / "services/common/build.gradle", "")
    _write(tmp_path / "libs/common/build.gradle", "")
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram()
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 0
    assert any(item.startswith("cross_project_reference_ambiguous:") for item in result.limitations)
    assert not any(edge.edge_type == "DEPENDS_ON" for edge in program.edges)


def test_dynamic_http_target_remains_unresolved(tmp_path: Path) -> None:
    _write(tmp_path / "web/package.json", '{"name":"web"}')
    _write(tmp_path / "web/client.ts", "fetch(baseUrl + path)")
    _write(tmp_path / "api/Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web" />')
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram(nodes=[
        SemanticNodeFact(
            "call", "CALL_SITE", "fetch", "web/client.ts", 4, 4,
            attributes={"integrationType": "HTTP", "method": "GET", "route": "baseUrl + path"},
        ),
        SemanticNodeFact(
            "route", "HTTP_ROUTE", "GET /health", "api/Program.cs", 8, 8,
            attributes={"method": "GET", "route": "/health"},
        ),
    ])
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 0
    assert "call" in result.unresolved
    assert any(item.startswith("cross_http_dynamic:") for item in result.limitations)
    assert not any(edge.edge_type == "CALLS_API" for edge in program.edges)


def test_go_replace_and_cargo_path_dependencies_resolve_projects(tmp_path: Path) -> None:
    _write(tmp_path / "go.mod", "module example.com/app\nreplace example.com/core => ./core\n")
    _write(tmp_path / "core/go.mod", "module example.com/core\n")
    _write(tmp_path / "rust/Cargo.toml", "[package]\nname='rust-app'\nversion='0.1.0'\n[dependencies]\ncore={path='../core-rust'}\n")
    _write(tmp_path / "core-rust/Cargo.toml", "[package]\nname='core-rust'\nversion='0.1.0'\n")
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram()
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 2
    assert sum(edge.edge_type == "DEPENDS_ON" for edge in program.edges) == 2
