from __future__ import annotations

import json
from pathlib import Path

import pytest

from tools.common.capabilities.evidence.scanner.inventory.manifest.manifest_parser import ManifestParser


def _find_fact(result, manifest_type: str, suffix: str):
    for fact in result.facts:
        if fact.manifest_type == manifest_type and fact.file_path.endswith(suffix):
            return fact
    raise AssertionError(f"manifest fact not found: type={manifest_type} suffix={suffix}")


@pytest.mark.p0
def test_t01_requirements_openai_detected(workspace_dir: Path) -> None:
    (workspace_dir / "requirements.txt").write_text("openai==1.14.0\n", encoding="utf-8")

    result = ManifestParser().parse_workspace(workspace_dir)
    fact = _find_fact(result, "requirements_txt", "requirements.txt")

    assert fact.package_names == ["openai"]
    assert fact.ai_relevant_signals == ["openai"]


@pytest.mark.p0
def test_t02_env_values_not_extracted(workspace_dir: Path) -> None:
    (workspace_dir / ".env.example").write_text(
        "OPENAI_API_KEY=sk-secret-value\nANTHROPIC_API_KEY=sk-ant-secret\n",
        encoding="utf-8",
    )

    result = ManifestParser().parse_workspace(workspace_dir)
    fact = _find_fact(result, "env_file", ".env.example")

    assert fact.env_var_names == ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
    rendered = json.dumps(fact.__dict__)
    assert "sk-secret-value" not in rendered
    assert "sk-ant-secret" not in rendered


@pytest.mark.p0
def test_t03_package_json_openai_detected(workspace_dir: Path) -> None:
    payload = {
        "name": "demo-app",
        "dependencies": {"openai": "^4.0.0", "react": "^19.0.0"},
    }
    (workspace_dir / "package.json").write_text(json.dumps(payload), encoding="utf-8")

    result = ManifestParser().parse_workspace(workspace_dir)
    fact = _find_fact(result, "package_json", "package.json")

    assert "openai" in fact.package_names
    assert "openai" in fact.ai_relevant_signals


@pytest.mark.p0
def test_t04_pyproject_langchain_detected(workspace_dir: Path) -> None:
    (workspace_dir / "pyproject.toml").write_text(
        "[project]\nname='demo'\ndependencies=['langchain==0.1.0']\n",
        encoding="utf-8",
    )

    result = ManifestParser().parse_workspace(workspace_dir)
    fact = _find_fact(result, "pyproject_toml", "pyproject.toml")

    assert "langchain" in fact.package_names
    assert "langchain" in fact.ai_relevant_signals


@pytest.mark.p0
def test_t05_yaml_top_level_keys_only(workspace_dir: Path) -> None:
    (workspace_dir / "config.yaml").write_text(
        "model:\n  provider: openai\nservices:\n  api:\n    timeout: 30\n",
        encoding="utf-8",
    )

    result = ManifestParser().parse_workspace(workspace_dir)
    fact = _find_fact(result, "yaml_config", "config.yaml")

    assert fact.config_key_names == ["model", "services"]
    rendered = json.dumps(fact.__dict__)
    assert "provider" not in rendered
    assert "openai" not in rendered


@pytest.mark.p0
def test_t06_malformed_toml_sets_parse_error(workspace_dir: Path) -> None:
    (workspace_dir / "pyproject.toml").write_text("[project\nname='broken'", encoding="utf-8")

    result = ManifestParser().parse_workspace(workspace_dir)
    fact = _find_fact(result, "pyproject_toml", "pyproject.toml")

    assert fact.parse_error is True


@pytest.mark.p0
def test_t07_manifest_limit_records_coverage_limitation(workspace_dir: Path) -> None:
    for index in range(201):
        (workspace_dir / f"requirements-{index}.txt").write_text("openai==1.0.0\n", encoding="utf-8")

    result = ManifestParser(max_manifest_files=200).parse_workspace(workspace_dir)

    assert len(result.facts) == 200
    assert len(result.coverage_limitations) == 1
    assert "manifest_file_limit_exceeded" in result.coverage_limitations[0]


@pytest.mark.p0
def test_t08_env_right_side_never_in_fact(workspace_dir: Path) -> None:
    (workspace_dir / ".env").write_text(
        "MODEL_ENDPOINT=https://internal.example.com/inference\n",
        encoding="utf-8",
    )

    result = ManifestParser().parse_workspace(workspace_dir)
    fact = _find_fact(result, "env_file", ".env")

    assert fact.env_var_names == ["MODEL_ENDPOINT"]
    rendered = json.dumps(fact.__dict__)
    assert "https://internal.example.com/inference" not in rendered
