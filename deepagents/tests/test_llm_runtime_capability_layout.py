from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def _dirs(path: Path) -> set[str]:
    return {
        item.name
        for item in path.iterdir()
        if item.is_dir() and item.name != "__pycache__"
    }


def _py(path: Path) -> set[str]:
    return {
        item.name
        for item in path.iterdir()
        if item.is_file() and item.suffix == ".py" and item.name != "__init__.py"
    }


def test_llm_runtime_groups_support_capabilities() -> None:
    llm = PROJECT_ROOT / "runtime" / "infrastructure" / "llm"

    assert _dirs(llm) == {
        "providers",
        "budget",
        "safety",
        "sandbox",
        "deep_agent_skills",
    }
    assert _py(llm) == {"deep_agent_client.py"}
    assert _py(llm / "providers") == {"fallback_client.py"}
    assert _py(llm / "budget") == {"budget_tracker.py"}
    assert _py(llm / "safety") == {"prompt_safety.py"}
    assert _py(llm / "sandbox") == {"docker_sandbox.py"}


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_flat_llm_support_imports_route_to_capability_packages() -> None:
    _assert_alias(
        "runtime.infrastructure.llm.fallback_client",
        "runtime.infrastructure.llm.providers.fallback_client",
    )
    _assert_alias(
        "runtime.infrastructure.llm.budget_tracker",
        "runtime.infrastructure.llm.budget.budget_tracker",
    )
    _assert_alias(
        "runtime.infrastructure.llm.prompt_safety",
        "runtime.infrastructure.llm.safety.prompt_safety",
    )
    _assert_alias(
        "runtime.infrastructure.llm.docker_sandbox",
        "runtime.infrastructure.llm.sandbox.docker_sandbox",
    )


def test_tools_common_llm_legacy_submodules_route_to_capability_files() -> None:
    _assert_alias(
        "tools.common.llm.budget_tracker",
        "runtime.infrastructure.llm.budget.budget_tracker",
    )
    _assert_alias(
        "tools.common.llm.prompt_safety",
        "runtime.infrastructure.llm.safety.prompt_safety",
    )
    _assert_alias(
        "tools.common.llm.docker_sandbox",
        "runtime.infrastructure.llm.sandbox.docker_sandbox",
    )


def test_deep_agent_client_remains_root_entrypoint_for_skill_paths() -> None:
    module = importlib.import_module("runtime.infrastructure.llm.deep_agent_client")
    module_path = Path(str(module.__file__)).resolve()
    assert module_path.parent.name == "llm"
    assert (module_path.parent / "deep_agent_skills" / "lcsp" / "SKILL.md").is_file()
