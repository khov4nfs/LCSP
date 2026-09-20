from pathlib import Path

from tools.common.capabilities.evidence.scanner.analyzers.jvm_analysis import JvmAnalyzer
from tools.common.capabilities.evidence.scanner.analyzers.adapters import JavaLanguageAdapter, KotlinLanguageAdapter
from tools.common.capabilities.evidence.scanner.frameworks.spring import SpringFrameworkAdapter, SpringFrameworkDetector
from tools.common.capabilities.evidence.scanner.inventory.project.project_discovery import ProjectDiscovery
from tools.common.capabilities.evidence.graph.resolution.cross_project_resolution import CrossReferenceResolver
from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticNodeFact, SemanticProgram


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_java_and_kotlin_adapters_extract_canonical_symbols_and_calls(tmp_path: Path) -> None:
    _write(tmp_path / "pom.xml", "<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3</version></dependency></dependencies></project>")
    _write(tmp_path / "User.java", "package com.example; @RestController @RequestMapping(\"/users\") class UserController { @GetMapping(\"/{id}\") String get(){ return client.send(); } }")
    _write(tmp_path / "Worker.kt", "package com.example\nclass Worker { fun run() = service.process() }")
    java = JavaLanguageAdapter().analyze(tmp_path, ["User.java"])
    kotlin = KotlinLanguageAdapter().analyze(tmp_path, ["Worker.kt"])
    assert java.native_result.files_analyzed == 1
    assert kotlin.native_result.files_analyzed == 1
    assert any(node.node_type == "CLASS" for node in java.native_result.semantic_program.nodes)
    assert any(node.node_type in {"FUNCTION", "METHOD"} for node in kotlin.native_result.semantic_program.nodes)
    assert any(node.node_type == "CALL_SITE" for node in java.native_result.semantic_program.nodes)


def test_spring_detection_routes_roles_and_dependency_facts(tmp_path: Path) -> None:
    _write(tmp_path / "pom.xml", "<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>")
    _write(tmp_path / "User.java", "package com.example; @RestController @RequestMapping(\"/users\") class UserController { @GetMapping(\"/{id}\") String get(){ return \"ok\"; } }")
    discovery = ProjectDiscovery().discover(tmp_path)
    project = discovery.projects[0]
    native = JvmAnalyzer(tmp_path, "java").analyze(["User.java"])
    assert SpringFrameworkDetector().detect(project, tmp_path, native) == ("spring",)
    result = SpringFrameworkAdapter().analyze(project, tmp_path, native)
    assert result.status == "SUCCESS"
    assert any(node.node_type == "HTTP_ROUTE" for node in result.semantic_program.nodes)
    assert any("CONTROLLER" in node.semantic_types for node in result.semantic_program.nodes)


def test_non_spring_jvm_project_is_not_detected(tmp_path: Path) -> None:
    _write(tmp_path / "pom.xml", "<project><dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId></dependency></dependencies></project>")
    discovery = ProjectDiscovery().discover(tmp_path)
    assert discovery.projects
    assert SpringFrameworkDetector().detect(discovery.projects[0], tmp_path, None) == ()


def test_jvm_ai_dependency_requires_an_invocation(tmp_path: Path) -> None:
    _write(tmp_path / "pom.xml", "<project><dependencies><dependency><groupId>org.springframework.ai</groupId><artifactId>spring-ai-openai</artifactId></dependency></dependencies></project>")
    _write(tmp_path / "Client.java", "class Client { String run(){ return chatClient.call(\"hello\"); } }")
    result = JvmAnalyzer(tmp_path, "java").analyze(["Client.java", "pom.xml"])
    assert any(node.node_type == "AI_MODEL_INVOCATION" for node in result.semantic_program.nodes)

    _write(tmp_path / "Client.java", "class Client { String run(){ return ordinary.generate(\"hello\"); } }")
    result = JvmAnalyzer(tmp_path, "java").analyze(["Client.java", "pom.xml"])
    assert not any(node.node_type == "AI_MODEL_INVOCATION" for node in result.semantic_program.nodes)


def test_typescript_client_resolves_to_spring_route_through_shared_resolver(tmp_path: Path) -> None:
    _write(tmp_path / "web/package.json", '{"name":"web"}')
    _write(tmp_path / "web/client.ts", "fetch('/api/users/42')")
    _write(tmp_path / "api/pom.xml", "<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>")
    _write(tmp_path / "api/User.java", "@RestController class UserController { @GetMapping(\"/api/users/{id}\") String get(){ return \"ok\"; } }")
    discovery = ProjectDiscovery().discover(tmp_path)
    program = SemanticProgram(nodes=[SemanticNodeFact("client", "CALL_SITE", "fetch", "web/client.ts", 1, 1, attributes={"integrationType":"HTTP", "method":"GET", "route":"/api/users/42"})])
    spring = SpringFrameworkAdapter().analyze(discovery.projects[0], tmp_path, JvmAnalyzer(tmp_path, "java").analyze(["api/User.java"]))
    program.extend(spring.semantic_program)
    result = CrossReferenceResolver().enrich(program, tmp_path, discovery)
    assert result.resolved_edges == 1
