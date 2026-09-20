from pathlib import Path
from tools.common.capabilities.evidence.scanner.analyzers.systems_analysis import SystemsAnalyzer
from tools.common.capabilities.evidence.scanner.analyzers.adapters import GoLanguageAdapter, RustLanguageAdapter
from tools.common.capabilities.evidence.scanner.inventory.project.project_discovery import ProjectDiscovery

def write(path: Path, value: str): path.parent.mkdir(parents=True, exist_ok=True); path.write_text(value, encoding="utf-8")

def test_go_and_rust_adapters_extract_symbols_calls_and_dependencies(tmp_path: Path):
    write(tmp_path/"go.mod", "module example.com/api\n\ngo 1.22\nrequire github.com/gin-gonic/gin v1.9.0\n")
    write(tmp_path/"api.go", "package api\ntype Service struct{}\nfunc (s *Service) Charge(){ http.Get(\"/health\") }\n")
    write(tmp_path/"Cargo.toml", "[package]\nname='worker'\nversion='0.1.0'\n[dependencies]\nreqwest='0.12'\n")
    write(tmp_path/"main.rs", "mod worker;\nstruct Service {}\nimpl Service { fn run(&self){ client.send(); } }\n")
    go = GoLanguageAdapter().analyze(tmp_path, ["api.go", "go.mod"])
    rust = RustLanguageAdapter().analyze(tmp_path, ["main.rs", "Cargo.toml"])
    assert go.native_result.files_analyzed == 1 and go.native_result.package_dependencies
    assert rust.native_result.files_analyzed == 1 and rust.native_result.package_dependencies
    assert any(node.node_type in {"TYPE", "FUNCTION", "METHOD"} for node in go.native_result.semantic_program.nodes)
    assert any(node.node_type in {"TYPE", "FUNCTION", "METHOD"} for node in rust.native_result.semantic_program.nodes)
    assert any(node.node_type == "HTTP_ROUTE" and node.attributes["route"] == "/health" for node in go.native_result.semantic_program.nodes)


def test_rust_attribute_route_is_canonical_http_evidence(tmp_path: Path):
    write(tmp_path / "Cargo.toml", "[package]\nname='api'\nversion='0.1.0'\n")
    write(tmp_path / "main.rs", '#[get("/users/{id}")]\nasync fn user() {}\n')
    result = RustLanguageAdapter().analyze(tmp_path, ["main.rs", "Cargo.toml"])
    routes = [node for node in result.native_result.semantic_program.nodes if node.node_type == "HTTP_ROUTE"]
    assert routes and routes[0].attributes["method"] == "GET"
    assert routes[0].attributes["route"] == "/users/{id}"

def test_go_rust_projects_are_discovered_without_toolchain_execution(tmp_path: Path):
    write(tmp_path/"go.mod", "module example.com/api\n")
    write(tmp_path/"main.go", "package main\nfunc main(){}")
    write(tmp_path/"worker/Cargo.toml", "[package]\nname='worker'\nversion='0.1.0'\n")
    write(tmp_path/"worker/main.rs", "fn main(){}")
    result = ProjectDiscovery().discover(tmp_path)
    assert {project.project_kind for project in result.projects} >= {"go", "rust"}
