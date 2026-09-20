from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from tools.common.capabilities.evidence.scanner.frameworks.registry import FrameworkAdapterRegistry


def _project(root: Path, manifest: str = "package.json"):
    return SimpleNamespace(project_id="project:test", root_path=root, manifest_paths=(manifest,))


def test_default_registry_registers_python_ts_and_frontend_frameworks() -> None:
    registry = FrameworkAdapterRegistry.default()
    names = {detector.name for detector in registry._detectors}
    assert {
        "django", "flask", "fastapi", "express", "nestjs", "react", "nextjs",
        "vue", "nuxt", "angular", "svelte", "sveltekit", "electron",
    } <= names


def test_fastapi_adapter_emits_canonical_route_and_handler(tmp_path: Path) -> None:
    (tmp_path / "pyproject.toml").write_text('[project]\ndependencies=["fastapi"]\n', encoding="utf-8")
    (tmp_path / "api.py").write_text(
        'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/users/{id}")\ndef show_user():\n    return {}\n',
        encoding="utf-8",
    )
    project = _project(tmp_path, "pyproject.toml")
    registry = FrameworkAdapterRegistry.default()
    assert registry.detect(project, tmp_path, None) == ("fastapi",)
    result = registry.analyze("fastapi", project, tmp_path, None)
    assert any(node.node_type == "HTTP_ROUTE" and node.attributes.get("route") == "/users/{id}" for node in result.semantic_program.nodes)
    assert any(edge.edge_type == "HANDLED_BY" for edge in result.semantic_program.edges)


def test_express_adapter_emits_canonical_backend_route(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"dependencies": {"express": "^5"}}), encoding="utf-8")
    (tmp_path / "app.ts").write_text(
        'app.get("/users/:id", showUser);\nfunction showUser() {}\n',
        encoding="utf-8",
    )
    project = _project(tmp_path)
    registry = FrameworkAdapterRegistry.default()
    assert "express" in registry.detect(project, tmp_path, None)
    result = registry.analyze("express", project, tmp_path, None)
    assert any(node.node_type == "HTTP_ROUTE" for node in result.semantic_program.nodes)
    assert any(edge.edge_type == "HANDLED_BY" for edge in result.semantic_program.edges)


def test_react_route_is_navigation_not_backend_http(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"dependencies": {"react": "^19"}}), encoding="utf-8")
    (tmp_path / "routes.tsx").write_text(
        '<Route path="/users/:id" element={<UserPage />} />\nfunction UserPage() { return null; }\n',
        encoding="utf-8",
    )
    project = _project(tmp_path)
    registry = FrameworkAdapterRegistry.default()
    assert "react" in registry.detect(project, tmp_path, None)
    result = registry.analyze("react", project, tmp_path, None)
    assert not any(node.node_type == "HTTP_ROUTE" for node in result.semantic_program.nodes)
    assert any(edge.edge_type == "NAVIGATES_TO" for edge in result.semantic_program.edges)


def test_plain_react_is_not_next_or_nest(tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text(json.dumps({"dependencies": {"react": "^19"}}), encoding="utf-8")
    project = _project(tmp_path)
    detected = set(FrameworkAdapterRegistry.default().detect(project, tmp_path, None))
    assert "react" in detected
    assert "nextjs" not in detected
    assert "nestjs" not in detected
