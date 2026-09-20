from pathlib import Path

from tools.common.capabilities.evidence.scanner.analyzers.ruby_analysis.ruby_analyzer import RubyAnalyzer
from tools.common.capabilities.evidence.scanner.frameworks import (
    FrameworkAdapterRegistry,
    RailsFrameworkAdapter,
    RailsFrameworkDetector,
)
from tools.common.capabilities.evidence.scanner.inventory.project import ProjectDescriptor


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _project(root: Path) -> ProjectDescriptor:
    return ProjectDescriptor("rails-project", root, "", manifest_paths=("Gemfile",))


def test_rails_detection_requires_rails_gem(tmp_path: Path) -> None:
    _write(tmp_path / "Gemfile", 'gem "rails"\n')
    assert RailsFrameworkDetector().detect(_project(tmp_path), tmp_path, None) == ("rails",)

    _write(tmp_path / "Gemfile", 'gem "sinatra"\n')
    assert RailsFrameworkDetector().detect(_project(tmp_path), tmp_path, None) == ()


def test_rails_routes_resolve_existing_ruby_controller_methods(tmp_path: Path) -> None:
    _write(tmp_path / "Gemfile", 'gem "rails"\n')
    _write(
        tmp_path / "config/routes.rb",
        'get "/users/:id", to: "users#show"\npost "/users", to: "users#create"\n',
    )
    _write(
        tmp_path / "app/controllers/users_controller.rb",
        "class UsersController < ApplicationController\n  def show; end\n  def create; end\nend\n",
    )
    ruby_result = RubyAnalyzer(tmp_path).analyze(
        ["config/routes.rb", "app/controllers/users_controller.rb"]
    )
    result = RailsFrameworkAdapter().analyze(
        _project(tmp_path), tmp_path, ruby_result
    )

    routes = [node for node in result.semantic_program.nodes if node.node_type == "HTTP_ROUTE"]
    handlers = [edge for edge in result.semantic_program.edges if edge.edge_type == "HANDLED_BY"]
    assert {node.attributes["method"] for node in routes} == {"GET", "POST"}
    assert len(handlers) == 2
    assert not any("unresolved" in limitation for limitation in result.coverage_limitations)


def test_rails_roles_reuse_ruby_class_identity_and_jobs_are_canonical(tmp_path: Path) -> None:
    _write(tmp_path / "Gemfile", 'gem "rails"\n')
    _write(tmp_path / "app/models/user.rb", "class User < ApplicationRecord\nend\n")
    _write(tmp_path / "app/jobs/report_job.rb", "class ReportJob < ApplicationJob\nend\n")
    ruby_result = RubyAnalyzer(tmp_path).analyze(
        ["app/models/user.rb", "app/jobs/report_job.rb"]
    )
    result = RailsFrameworkAdapter().analyze(_project(tmp_path), tmp_path, ruby_result)

    labels = {node.label: node for node in result.semantic_program.nodes}
    assert labels["User"].attributes["frameworkRole"] == "ENTITY"
    assert labels["ReportJob"].attributes["frameworkRole"] == "BACKGROUND_JOB"
    assert not any(node.node_type in {"RAILS_CLASS", "RAILS_JOB"} for node in result.semantic_program.nodes)


def test_rails_dynamic_route_is_unresolved(tmp_path: Path) -> None:
    _write(tmp_path / "Gemfile", 'gem "rails"\n')
    _write(tmp_path / "config/routes.rb", "get dynamic_path, to: dynamic_handler\n")
    ruby_result = RubyAnalyzer(tmp_path).analyze(["config/routes.rb"])
    result = RailsFrameworkAdapter().analyze(_project(tmp_path), tmp_path, ruby_result)

    assert result.coverage_limitations
    assert result.semantic_program.unresolved_frontiers


def test_framework_registry_is_deterministic_and_rejects_duplicate() -> None:
    registry = FrameworkAdapterRegistry.default()
    assert registry.detect(_project(Path(".")), Path("."), None) == ()
    try:
        registry.register(RailsFrameworkAdapter())
    except ValueError as error:
        assert "already registered" in str(error)
    else:
        raise AssertionError("duplicate Rails adapter registration must fail")


def test_two_rails_projects_are_analyzed_independently(tmp_path: Path) -> None:
    for name, action in (("service_a", "index"), ("service_b", "show")):
        root = tmp_path / name
        _write(root / "Gemfile", 'gem "rails"\n')
        _write(root / "config/routes.rb", f'get "/{name}", to: "{name}#{action}"\n')
        controller = name.title().replace("_", "") + "Controller"
        _write(
            root / "app/controllers" / f"{name}_controller.rb",
            f"class {controller} < ApplicationController\n  def {action}; end\nend\n",
        )
        ruby_result = RubyAnalyzer(root).analyze(
            ["config/routes.rb", f"app/controllers/{name}_controller.rb"]
        )
        result = RailsFrameworkAdapter().analyze(
            ProjectDescriptor(name, root, name, manifest_paths=("Gemfile",)),
            root,
            ruby_result,
        )
        assert result.project_id == name
        assert len([edge for edge in result.semantic_program.edges if edge.edge_type == "HANDLED_BY"]) == 1


def test_malformed_routes_are_partial_without_losing_ruby_facts(tmp_path: Path) -> None:
    _write(tmp_path / "Gemfile", 'gem "rails"\n')
    _write(tmp_path / "config/routes.rb", 'get "/broken", to: "users#show"\n  (\n')
    _write(tmp_path / "app/controllers/users_controller.rb", "class UsersController < ApplicationController\nend\n")
    ruby_result = RubyAnalyzer(tmp_path).analyze(
        ["config/routes.rb", "app/controllers/users_controller.rb"]
    )
    result = RailsFrameworkAdapter().analyze(_project(tmp_path), tmp_path, ruby_result)
    assert result.status == "PARTIAL"
    assert result.coverage_limitations
    assert any(node.node_type == "HTTP_ROUTE" for node in result.semantic_program.nodes)
    assert any(node.node_type == "CLASS" for node in ruby_result.semantic_program.nodes)
