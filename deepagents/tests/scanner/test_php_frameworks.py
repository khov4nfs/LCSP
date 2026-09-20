from pathlib import Path
from tools.common.capabilities.evidence.scanner.analyzers.php_analysis import PhpAnalyzer
from tools.common.capabilities.evidence.scanner.analyzers.adapters import PhpLanguageAdapter
from tools.common.capabilities.evidence.scanner.frameworks.php_frameworks import LaravelFrameworkAdapter, LaravelFrameworkDetector, SymfonyFrameworkAdapter, SymfonyFrameworkDetector
from tools.common.capabilities.evidence.scanner.inventory.project.project_discovery import ProjectDiscovery
from tools.common.capabilities.evidence.graph.resolution.cross_project_resolution import CrossReferenceResolver
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticNodeFact, SemanticProgram

def _write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True); path.write_text(content, encoding="utf-8")

def test_php_adapter_extracts_symbols_imports_calls_and_composer(tmp_path: Path):
    _write(tmp_path / "composer.json", '{"require":{"laravel/framework":"^11.0","openai-php/client":"^1.0"},"autoload":{"psr-4":{"App\\\\":"src/"}}}')
    _write(tmp_path / "User.php", "<?php namespace App; use App\\Services\\UserService; class User extends Model { public function find(){ return User::find(1); } }")
    result = PhpLanguageAdapter().analyze(tmp_path, ["User.php", "composer.json"])
    assert result.native_result.files_analyzed == 1
    assert any(node.node_type == "CLASS" for node in result.native_result.semantic_program.nodes)
    assert any(node.node_type == "CALL_SITE" for node in result.native_result.semantic_program.nodes)
    assert result.native_result.package_dependencies

def test_laravel_and_symfony_detection_are_exclusive(tmp_path: Path):
    _write(tmp_path / "composer.json", '{"require":{"laravel/framework":"^11.0","symfony/console":"^7.0"}}')
    discovery = ProjectDiscovery().discover(tmp_path); project = discovery.projects[0]
    assert LaravelFrameworkDetector().detect(project, tmp_path, None) == ("laravel",)
    assert SymfonyFrameworkDetector().detect(project, tmp_path, None) == ()

def test_symfony_routes_reuse_php_symbols(tmp_path: Path):
    _write(tmp_path / "composer.json", '{"require":{"symfony/framework-bundle":"^7.0"}}')
    _write(tmp_path / "Controller.php", "<?php namespace App; use Symfony\\Component\\Routing\\Attribute\\Route; #[Route('/users')] class UserController { public function list() {} }")
    discovery = ProjectDiscovery().discover(tmp_path); project = discovery.projects[0]
    native = PhpAnalyzer(tmp_path).analyze(["Controller.php"])
    result = SymfonyFrameworkAdapter().analyze(project, tmp_path, native)
    assert any(node.node_type == "HTTP_ROUTE" for node in result.semantic_program.nodes)
    assert any(node.node_type == "CLASS" for node in result.semantic_program.nodes)

def test_ts_client_resolves_to_laravel_route_through_shared_resolver(tmp_path: Path):
    _write(tmp_path / "composer.json", '{"require":{"laravel/framework":"^11.0"}}')
    _write(tmp_path / "routes.php", "<?php Route::get('/users/{id}', [UserController::class, 'show']);")
    discovery = ProjectDiscovery().discover(tmp_path); project = discovery.projects[0]
    native = PhpAnalyzer(tmp_path).analyze(["routes.php"])
    framework = LaravelFrameworkAdapter().analyze(project, tmp_path, native)
    program = SemanticProgram(nodes=[SemanticNodeFact("client", "CALL_SITE", "fetch", "web.ts", 1, 1, attributes={"integrationType":"HTTP", "method":"GET", "route":"/users/42"})])
    program.extend(framework.semantic_program)
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 1
