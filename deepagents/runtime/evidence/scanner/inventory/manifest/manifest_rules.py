from __future__ import annotations

import ast
import configparser
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import tomllib

from .manifest_types import ManifestFact


MAX_RAW_CONTENT_BYTES = 100 * 1024
MAX_MANIFEST_FILES = 200

AI_PACKAGE_REGISTRY = {
    "openai",
    "anthropic",
    "langchain",
    "autogen",
    "cohere",
    "mistralai",
    "mistral",
    "together",
    "huggingface_hub",
    "transformers",
    "llama-index",
    "ollama",
    "vllm",
}

AI_ENV_VAR_PATTERNS = {
    "OPENAI_API_KEY",
    "OPENAI_ORG_ID",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "VERTEX_AI_PROJECT",
    "VERTEX_AI_LOCATION",
    "HUGGINGFACE_API_TOKEN",
    "HF_TOKEN",
    "LANGCHAIN_API_KEY",
    "LANGCHAIN_TRACING_V2",
    "COHERE_API_KEY",
    "MISTRAL_API_KEY",
    "TOGETHER_AI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "MODEL_NAME",
    "MODEL_ENDPOINT",
    "INFERENCE_URL",
    "LLM_MODEL",
    "OLLAMA_BASE_URL",
    "VLLM_ENDPOINT",
}


ManifestParserFunc = Callable[[Path, Path], ManifestFact]


@dataclass(frozen=True)
class ManifestRule:
    manifest_type: str
    patterns: tuple[str, ...]
    parser: ManifestParserFunc


def build_manifest_rules() -> list[ManifestRule]:
    return [
        ManifestRule("pyproject_toml", ("pyproject.toml",), parse_pyproject_toml),
        ManifestRule("setup_cfg", ("setup.cfg",), parse_setup_cfg),
        ManifestRule("setup_py", ("setup.py",), parse_setup_py),
        ManifestRule("requirements_txt", ("requirements*.txt", "constraints.txt"), parse_requirements_txt),
        ManifestRule("package_json", ("package.json",), parse_package_json),
        ManifestRule("yarn_lock", ("yarn.lock",), parse_yarn_lock),
        ManifestRule("pnpm_lock", ("pnpm-lock.yaml",), parse_pnpm_lock),
        ManifestRule("package_lock_json", ("package-lock.json",), parse_package_lock_json),
        ManifestRule("env_file", (".env", ".env.*", "*.env", "*.env.*"), parse_env_file),
        ManifestRule("docker_compose", ("docker-compose*.yml", "docker-compose*.yaml"), parse_docker_compose),
        ManifestRule("yaml_config", ("*.yaml", "*.yml"), parse_yaml_config),
        ManifestRule("alembic_ini", ("alembic.ini",), parse_alembic_ini),
        ManifestRule("alembic_version", ("alembic/versions/*.py",), parse_alembic_version),
        ManifestRule("prisma_schema", ("prisma/schema.prisma",), parse_prisma_schema),
        ManifestRule("json_config", ("*.json",), parse_json_config),
    ]


def parse_pyproject_toml(file_path: Path, workspace: Path) -> ManifestFact:
    payload = _read_toml(file_path)
    project = payload.get("project", {}) if isinstance(payload, dict) else {}
    package_names = []
    config_key_names = []
    if isinstance(project, dict):
        config_key_names.extend([key for key in ("python_requires", "requires-python") if key in project])
        package_names.extend(_extract_dependency_names(project.get("dependencies", [])))

        optional_deps = project.get("optional-dependencies", {})
        if isinstance(optional_deps, dict):
            for deps in optional_deps.values():
                package_names.extend(_extract_dependency_names(deps if isinstance(deps, list) else []))

    tool = payload.get("tool", {}) if isinstance(payload, dict) else {}
    if isinstance(tool, dict):
        poetry = tool.get("poetry", {})
        if isinstance(poetry, dict):
            package_names.extend(_extract_mapping_keys(poetry.get("dependencies")))
            package_names.extend(_extract_mapping_keys(poetry.get("group", {}), nested_key="dependencies"))

    return _build_fact(
        manifest_type="pyproject_toml",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
        config_key_names=config_key_names,
    )


def parse_setup_cfg(file_path: Path, workspace: Path) -> ManifestFact:
    _assert_text_size(file_path)
    parser = configparser.ConfigParser()
    parser.read(file_path, encoding="utf-8")

    package_names: list[str] = []
    config_keys: list[str] = []

    if parser.has_option("options", "install_requires"):
        raw = parser.get("options", "install_requires")
        package_names.extend(_extract_dependency_names(raw.splitlines()))
    if parser.has_option("options", "python_requires"):
        config_keys.append("python_requires")

    if parser.has_section("options.extras_require"):
        for _, value in parser.items("options.extras_require"):
            package_names.extend(_extract_dependency_names(value.splitlines()))

    return _build_fact(
        manifest_type="setup_cfg",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
        config_key_names=config_keys,
    )


def parse_setup_py(file_path: Path, workspace: Path) -> ManifestFact:
    source = _read_text(file_path)
    tree = ast.parse(source)
    package_names: list[str] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name) and node.func.id == "setup":
            for keyword in node.keywords:
                if keyword.arg == "install_requires":
                    package_names.extend(_extract_ast_string_list(keyword.value))
                if keyword.arg == "extras_require" and isinstance(keyword.value, ast.Dict):
                    for value in keyword.value.values:
                        package_names.extend(_extract_ast_string_list(value))

    return _build_fact(
        manifest_type="setup_py",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
    )


def parse_requirements_txt(file_path: Path, workspace: Path) -> ManifestFact:
    package_names: list[str] = []
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("-"):
                continue
            package = _normalize_package_name(stripped)
            if package:
                package_names.append(package)

    return _build_fact(
        manifest_type="requirements_txt",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
    )


def parse_package_json(file_path: Path, workspace: Path) -> ManifestFact:
    payload = _read_json(file_path)
    package_names: list[str] = []
    config_key_names: list[str] = []

    if isinstance(payload, dict):
        for key in ("dependencies", "devDependencies"):
            deps = payload.get(key)
            if isinstance(deps, dict):
                for dep_name in deps.keys():
                    if isinstance(dep_name, str):
                        npm_name = _extract_npm_name_from_descriptor(dep_name)
                        if npm_name:
                            package_names.append(npm_name)
        config_key_names.extend([key for key in ("name", "scripts") if key in payload])
    return _build_fact(
        manifest_type="package_json",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
        config_key_names=config_key_names,
    )


def parse_yarn_lock(file_path: Path, workspace: Path) -> ManifestFact:
    package_names: list[str] = []
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or not stripped.endswith(":"):
                continue
            token = stripped.rstrip(":").strip("\"")
            first = token.split(",", 1)[0]
            package = _extract_npm_name_from_descriptor(first)
            if package:
                package_names.append(package)

    return _build_fact(
        manifest_type="yarn_lock",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
    )


def parse_pnpm_lock(file_path: Path, workspace: Path) -> ManifestFact:
    package_names: list[str] = []
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            match = re.match(r"^\s{2,}/([^:]+):\s*$", line)
            if not match:
                continue
            package = _extract_npm_name_from_descriptor(match.group(1))
            if package:
                package_names.append(package)

    return _build_fact(
        manifest_type="pnpm_lock",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
    )


def parse_package_lock_json(file_path: Path, workspace: Path) -> ManifestFact:
    payload = _read_json(file_path)
    package_names: list[str] = []
    if isinstance(payload, dict):
        packages = payload.get("packages")
        if isinstance(packages, dict):
            for key in packages.keys():
                if not isinstance(key, str) or not key.startswith("node_modules/"):
                    continue
                name = key.removeprefix("node_modules/")
                package = _extract_npm_name_from_descriptor(name)
                if package:
                    package_names.append(package)

    return _build_fact(
        manifest_type="package_lock_json",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
    )


def parse_pipfile(file_path: Path, workspace: Path) -> ManifestFact:
    payload = _read_toml(file_path)
    package_names = []
    if isinstance(payload, dict):
        package_names.extend(_extract_mapping_keys(payload.get("packages")))
        package_names.extend(_extract_mapping_keys(payload.get("dev-packages")))

    return _build_fact(
        manifest_type="pipfile",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
    )


def parse_pipfile_lock(file_path: Path, workspace: Path) -> ManifestFact:
    payload = _read_json(file_path)
    package_names = []
    if isinstance(payload, dict):
        package_names.extend(_extract_mapping_keys(payload.get("default")))
        package_names.extend(_extract_mapping_keys(payload.get("develop")))

    return _build_fact(
        manifest_type="pipfile_lock",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
    )


def parse_cargo_toml(file_path: Path, workspace: Path) -> ManifestFact:
    payload = _read_toml(file_path)
    package_names = []
    if isinstance(payload, dict):
        package_names.extend(_extract_mapping_keys(payload.get("dependencies")))
        package_names.extend(_extract_mapping_keys(payload.get("dev-dependencies")))

    return _build_fact(
        manifest_type="cargo_toml",
        file_path=file_path,
        workspace=workspace,
        package_names=package_names,
    )


def parse_env_file(file_path: Path, workspace: Path) -> ManifestFact:
    env_var_names: list[str] = []
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if "=" not in stripped:
                continue
            left = stripped.split("=", 1)[0].strip()
            if left.startswith("export "):
                left = left.removeprefix("export ").strip()
            if left:
                env_var_names.append(left)

    return _build_fact(
        manifest_type="env_file",
        file_path=file_path,
        workspace=workspace,
        env_var_names=env_var_names,
    )


def parse_dockerfile(file_path: Path, workspace: Path) -> ManifestFact:
    config_keys: list[str] = []
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            stripped = line.strip()
            upper = stripped.upper()
            if upper.startswith("FROM "):
                image_part = stripped[5:].strip()
                image = re.split(r"\s+AS\s+", image_part, maxsplit=1, flags=re.IGNORECASE)[0].strip()
                if image:
                    config_keys.append(f"from:{image}")
                exposed = stripped[7:].strip()
                if exposed:
                    config_keys.append(f"expose:{exposed}")

    return _build_fact(
        manifest_type="dockerfile",
        file_path=file_path,
        workspace=workspace,
        config_key_names=config_keys,
    )


def parse_docker_compose(file_path: Path, workspace: Path) -> ManifestFact:
    top_keys = _extract_yaml_top_level_keys(file_path)
    service_names = _extract_compose_service_names(file_path)
    config_keys = top_keys + [f"service:{name}" for name in service_names]

    return _build_fact(
        manifest_type="docker_compose",
        file_path=file_path,
        workspace=workspace,
        config_key_names=config_keys,
    )


def parse_yaml_config(file_path: Path, workspace: Path) -> ManifestFact:
    return _build_fact(
        manifest_type="yaml_config",
        file_path=file_path,
        workspace=workspace,
        config_key_names=_extract_yaml_top_level_keys(file_path),
    )


def parse_alembic_ini(file_path: Path, workspace: Path) -> ManifestFact:
    return _build_fact(
        manifest_type="alembic_ini",
        file_path=file_path,
        workspace=workspace,
        config_key_names=["alembic_ini_present"],
    )


def parse_alembic_version(file_path: Path, workspace: Path) -> ManifestFact:
    return _build_fact(
        manifest_type="alembic_version",
        file_path=file_path,
        workspace=workspace,
        config_key_names=["migration_file_present"],
    )


def parse_prisma_schema(file_path: Path, workspace: Path) -> ManifestFact:
    model_names: list[str] = []
    field_names: list[str] = []

    in_model = False
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            stripped = line.strip()
            if stripped.startswith("model ") and stripped.endswith("{"):
                parts = stripped.split()
                if len(parts) >= 2:
                    model_names.append(parts[1])
                in_model = True
                continue
            if in_model and stripped == "}":
                in_model = False
                continue
            if in_model and stripped and not stripped.startswith("@@") and not stripped.startswith("//"):
                name = stripped.split()[0]
                if name and not name.startswith("@"):
                    field_names.append(name)

    return _build_fact(
        manifest_type="prisma_schema",
        file_path=file_path,
        workspace=workspace,
        config_key_names=model_names + field_names,
    )


def parse_json_config(file_path: Path, workspace: Path) -> ManifestFact:
    payload = _read_json(file_path)
    keys = list(payload.keys()) if isinstance(payload, dict) else []

    return _build_fact(
        manifest_type="json_config",
        file_path=file_path,
        workspace=workspace,
        config_key_names=keys,
    )


def _build_fact(
    *,
    manifest_type: str,
    file_path: Path,
    workspace: Path,
    package_names: list[str] | None = None,
    env_var_names: list[str] | None = None,
    config_key_names: list[str] | None = None,
    parse_error: bool = False,
) -> ManifestFact:
    normalized_packages = _dedupe_lower(package_names or [])
    normalized_env_vars = _dedupe_preserve(env_var_names or [])
    normalized_keys = _dedupe_preserve(config_key_names or [])

    ai_signals = [
        package for package in normalized_packages if package in AI_PACKAGE_REGISTRY
    ]
    ai_signals.extend(
        env for env in normalized_env_vars if env.upper() in AI_ENV_VAR_PATTERNS
    )

    return ManifestFact(
        manifest_type=manifest_type,
        file_path=file_path.resolve(strict=False).relative_to(workspace.resolve(strict=False)).as_posix(),
        package_names=normalized_packages,
        env_var_names=normalized_env_vars,
        config_key_names=normalized_keys,
        ai_relevant_signals=_dedupe_preserve(ai_signals),
        parse_error=parse_error,
    )


def _read_toml(file_path: Path) -> dict:
    _assert_text_size(file_path)
    with file_path.open("rb") as handle:
        return tomllib.load(handle)


def _read_json(file_path: Path) -> dict:
    text = _read_text(file_path)
    payload = json.loads(text)
    if isinstance(payload, dict):
        return payload
    return {}


def _read_text(file_path: Path) -> str:
    _assert_text_size(file_path)
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        return handle.read()


def _assert_text_size(file_path: Path) -> None:
    if file_path.stat().st_size > MAX_RAW_CONTENT_BYTES:
        raise ValueError("manifest file exceeds parser content limit")


def _extract_dependency_names(entries: list[str]) -> list[str]:
    names = []
    for entry in entries:
        if not isinstance(entry, str):
            continue
        package = _normalize_package_name(entry)
        if package:
            names.append(package)
    return names


def _normalize_package_name(spec: str) -> str:
    candidate = spec.strip()
    if not candidate:
        return ""
    candidate = candidate.split(";", 1)[0].strip()
    candidate = candidate.split("[", 1)[0].strip()
    candidate = re.split(r"[<>=!~@\s]", candidate, maxsplit=1)[0].strip()
    return candidate.lower()


def _extract_mapping_keys(value: object, nested_key: str | None = None) -> list[str]:
    if not isinstance(value, dict):
        return []

    keys: list[str] = []
    for key, nested in value.items():
        if nested_key is not None and isinstance(nested, dict):
            keys.extend(_extract_mapping_keys(nested.get(nested_key)))
            continue
        if isinstance(key, str):
            normalized = _normalize_package_name(key)
            if normalized:
                keys.append(normalized)
    return keys


def _extract_ast_string_list(node: ast.AST) -> list[str]:
    if isinstance(node, ast.List):
        values = []
        for item in node.elts:
            if isinstance(item, ast.Constant) and isinstance(item.value, str):
                normalized = _normalize_package_name(item.value)
                if normalized:
                    values.append(normalized)
        return values
    return []


def _extract_yaml_top_level_keys(file_path: Path) -> list[str]:
    keys: list[str] = []
    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            if line.startswith(" ") or line.startswith("\t"):
                continue
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if ":" not in stripped:
                continue
            key = stripped.split(":", 1)[0].strip()
            if key:
                keys.append(key)
    return _dedupe_preserve(keys)


def _extract_compose_service_names(file_path: Path) -> list[str]:
    names: list[str] = []
    in_services = False

    with file_path.open("r", encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue

            if not line.startswith(" ") and stripped.startswith("services:"):
                in_services = True
                continue
            if not line.startswith(" ") and in_services and stripped.endswith(":"):
                in_services = False

            if in_services and line.startswith("  ") and not line.startswith("    ") and stripped.endswith(":"):
                service = stripped[:-1].strip()
                if service:
                    names.append(service)

    return _dedupe_preserve(names)


def _extract_npm_name_from_descriptor(descriptor: str) -> str:
    value = descriptor.strip().strip('"').strip("'")
    if not value:
        return ""

    if value.startswith("@"):
        second_at = value.find("@", 1)
        if second_at > 0:
            return value[:second_at]
        return value

    first_at = value.find("@")
    if first_at > 0:
        return value[:first_at]
    return value


def _dedupe_lower(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        output.append(normalized)
    return output


def _dedupe_preserve(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        output.append(normalized)
    return output
