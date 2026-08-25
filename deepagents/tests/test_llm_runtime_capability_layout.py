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


def test_removed_llm_infrastructure_has_no_runtime_tree() -> None:
    llm = PROJECT_ROOT / "runtime" / "infrastructure" / "llm"

    assert not llm.exists()


def _assert_alias(legacy: str, canonical: str) -> None:
    legacy_module = importlib.import_module(legacy)
    canonical_module = importlib.import_module(canonical)
    assert Path(str(legacy_module.__file__)).resolve() == Path(
        str(canonical_module.__file__)
    ).resolve()


def test_sandbox_is_owned_by_managed_sandbox_package() -> None:
    module = importlib.import_module("sandbox")

    assert Path(str(module.__file__)).resolve() == PROJECT_ROOT / "sandbox" / "__init__.py"
    assert module.sandbox.kind == "sandbox"


def test_legacy_model_runtime_is_removed() -> None:
    orchestration = PROJECT_ROOT / "orchestration"
    assert not (orchestration / "deep_agent_client.py").exists()
    assert not (orchestration / "provider_fallback.py").exists()
    assert not (orchestration / "model_runtime.py").exists()
    assert (PROJECT_ROOT / "skills" / "deep_agent_skills" / "lcsp" / "SKILL.md").is_file()
