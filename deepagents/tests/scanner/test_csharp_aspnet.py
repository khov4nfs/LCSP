from pathlib import Path

from tools.common.capabilities.evidence.scanner.analyzers.adapters.csharp_adapter import CSharpLanguageAdapter
from tools.common.capabilities.evidence.scanner.analyzers.csharp_analysis import CSharpAnalyzer
from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
from tools.common.capabilities.evidence.scanner.frameworks import (
    AspNetCoreFrameworkAdapter,
    AspNetCoreFrameworkDetector,
    FrameworkAdapterRegistry,
)
from tools.common.capabilities.evidence.scanner.inventory.language.language_classifier import LanguageClassifier
from tools.common.capabilities.evidence.scanner.inventory.project.project_types import ProjectDescriptor
from tools.common.capabilities.evidence.scanner.inventory.project.project_discovery import ProjectDiscovery
from tools.common.capabilities.evidence.scanner.inventory.project.execution_plan import ProjectExecutionPlanner


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _project(root: Path) -> ProjectDescriptor:
    return ProjectDescriptor("api", root, "", manifest_paths=("Api.csproj",))


def test_csharp_adapter_extracts_symbols_usings_attributes_calls_and_dependencies(tmp_path: Path) -> None:
    _write(tmp_path / "Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="OpenAI" Version="1.0" /></ItemGroup></Project>')
    _write(tmp_path / "Users.cs", "using Microsoft.AspNetCore.Mvc; namespace Api; [ApiController] [Route(\"api/users\")] public class UsersController : ControllerBase { [HttpGet(\"{id}\")] public Task Get(string id) { client.CompleteAsync(id); } }")
    result = CSharpAnalyzer(tmp_path).analyze(["Users.cs", "Api.csproj"])
    labels = {node.label for node in result.semantic_program.nodes}
    assert "UsersController" in labels
    assert any(node.node_type == "PACKAGE_DEPENDENCY" and node.label == "Microsoft.AspNetCore.Mvc" for node in result.semantic_program.nodes)
    assert any(node.node_type == "CALL_SITE" for node in result.semantic_program.nodes)
    assert any(node.node_type == "AI_MODEL_INVOCATION" for node in result.semantic_program.nodes)
    assert result.target_frameworks == ("net8.0",)


def test_csharp_project_references_and_malformed_metadata_are_safe(tmp_path: Path) -> None:
    _write(tmp_path / "Core.csproj", '<Project><PropertyGroup><TargetFrameworks>net8.0;net9.0</TargetFrameworks></PropertyGroup></Project>')
    _write(tmp_path / "Api.csproj", '<Project><ItemGroup><ProjectReference Include="../Core/Core.csproj" /></ItemGroup></Project>')
    _write(tmp_path / "Broken.csproj", "<Project>")
    result = CSharpAnalyzer(tmp_path).analyze(["Api.csproj", "Core.csproj", "Broken.csproj"])
    assert "../Core/Core.csproj" in result.project_references
    assert result.target_frameworks == ("net8.0", "net9.0")
    assert any("metadata_partial" in item for item in result.coverage_limitations)


def test_csharp_classifier_and_registry_are_semantic_supported(tmp_path: Path) -> None:
    _write(tmp_path / "Api.cs", "public class Api {}")
    classification = LanguageClassifier().classify_workspace(tmp_path)
    assert classification[0].language == "csharp"
    assert classification[0].support_level == "FULL"
    assert CSharpLanguageAdapter().supports("csharp")


def test_aspnet_detection_requires_web_evidence(tmp_path: Path) -> None:
    _write(tmp_path / "Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web" />')
    assert AspNetCoreFrameworkDetector().detect(_project(tmp_path), tmp_path, None) == ("aspnet_core",)
    _write(tmp_path / "Api.csproj", '<Project Sdk="Microsoft.NET.Sdk" />')
    assert AspNetCoreFrameworkDetector().detect(_project(tmp_path), tmp_path, None) == ()


def test_aspnet_routes_and_di_reuse_csharp_symbols(tmp_path: Path) -> None:
    _write(tmp_path / "Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web" />')
    source = "[ApiController] [Route(\"api/users\")] public class UsersController : ControllerBase { [HttpGet(\"{id}\")] public Task Get(string id) { } } class Startup { void Configure(IServiceCollection services) { services.AddScoped<IUsers, Users>(); } }"
    _write(tmp_path / "Users.cs", source)
    native = CSharpAnalyzer(tmp_path).analyze(["Users.cs", "Api.csproj"])
    result = AspNetCoreFrameworkAdapter().analyze(_project(tmp_path), tmp_path, native)
    assert any(node.node_type == "HTTP_ROUTE" for node in result.semantic_program.nodes)
    assert any(edge.edge_type == "HANDLED_BY" for edge in result.semantic_program.edges)
    assert any(node.attributes.get("frameworkRole") == "CONTROLLER" for node in result.semantic_program.nodes)
    assert any(node.attributes.get("lifetime") == "Scoped" for node in result.semantic_program.nodes)


def test_aspnet_minimal_api_route_is_static_and_non_web_project_is_not_detected(tmp_path: Path) -> None:
    _write(tmp_path / "Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web" />')
    _write(tmp_path / "Program.cs", 'var app = builder.Build(); app.MapGet("/health", () => "ok");')
    native = CSharpAnalyzer(tmp_path).analyze(["Program.cs", "Api.csproj"])
    result = AspNetCoreFrameworkAdapter().analyze(_project(tmp_path), tmp_path, native)
    assert any(node.attributes.get("minimalApi") for node in result.semantic_program.nodes)


def test_framework_registry_contains_aspnet_and_rejects_duplicate() -> None:
    registry = FrameworkAdapterRegistry.default()
    assert [item for item in ("aspnet_core", "rails") if registry._adapters and any(adapter.framework == item for adapter in registry._adapters)] == ["aspnet_core", "rails"]
    try:
        registry.register(AspNetCoreFrameworkAdapter())
    except ValueError:
        pass
    else:
        raise AssertionError("duplicate ASP.NET adapter registration must fail")


def test_csharp_coexists_with_python_typescript_and_ruby_project_units(tmp_path: Path) -> None:
    _write(tmp_path / "api/Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web" />')
    _write(tmp_path / "api/Api.cs", "class Api {}")
    _write(tmp_path / "web/package.json", '{"name":"web"}')
    _write(tmp_path / "web/app.ts", "export const app = 1")
    _write(tmp_path / "worker/pyproject.toml", '[project]\nname="worker"\n')
    _write(tmp_path / "worker/main.py", "print(1)")
    _write(tmp_path / "billing/Gemfile", 'gem "rails"\n')
    _write(tmp_path / "billing/app.rb", "class Billing; end")
    discovery = ProjectDiscovery().discover(tmp_path)
    plan = ProjectExecutionPlanner().build(
        tmp_path, discovery, discovery.classifications, LanguageAnalyzerRegistry.default()
    )
    assert {unit.language for unit in plan.units} == {"csharp", "typescript", "python", "ruby"}
    assert len({file for unit in plan.units for file in unit.files}) == sum(len(unit.files) for unit in plan.units)
