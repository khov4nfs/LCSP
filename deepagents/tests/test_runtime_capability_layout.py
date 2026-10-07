from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def _directories(path: Path) -> set[str]:
    return {
        entry.name
        for entry in path.iterdir()
        if entry.is_dir() and entry.name != "__pycache__"
    }


def _implementation_files(path: Path) -> set[str]:
    return {
        entry.name
        for entry in path.iterdir()
        if entry.is_file() and entry.suffix == ".py" and entry.name != "__init__.py"
    }


def test_dispatch_runtime_groups_support_capabilities() -> None:
    root = PROJECT_ROOT / "runtime" / "infrastructure" / "dispatch"

    assert not root.exists()

    platform = PROJECT_ROOT / "tools" / "common" / "capabilities" / "platform"
    # The evidence/graph/query/ builder runtime was intentionally deleted;
    # graph_runtime.py + graph schema vocabulary remain as infrastructure only.
    assert _implementation_files(platform) == {
        "api_client.py",
        "artifact_storage.py",
        "callback_schemas.py",
        "codebase_memory.py",
        "config.py",
        "correlation.py",
        "dev_unsafe_trace.py",
        "docker_sandbox.py",
        "env.py",
        "file_lock.py",
        "graph_runtime.py",
        "logging.py",
        "logging_config.py",
        "logging_path.py",
        "repository_sandbox.py",
        "orchestration_logging.py",
        "rbac_client.py",
        "repository_snapshot_client.py",
        "repository_workspace.py",
        "subject_repository_tools.py",
        "tracing.py",
    }

    # New capability layout: Codebase Memory graph tools, subject repository
    # root guard, and governed submit_rule_assessment tools.
    from tools.common.codebase_memory_graph import CODEBASE_MEMORY_GRAPH_TOOLS
    from tools.common.capabilities.platform import subject_repository_tools

    assert {getattr(tool, "name", "") for tool in CODEBASE_MEMORY_GRAPH_TOOLS} == {
        "search_code_graph",
        "trace_call_path",
        "search_code_text",
        "get_repository_architecture",
    }
    assert subject_repository_tools.SUBJECT_REPOSITORY_ROOT == "/workspace/repository"
    # The per-rule submit/cite tools are gone: the Assessment Root's governed tools live in
    # assessment_root/tools.py and mint evidence only through the API.
    assert not (PROJECT_ROOT / "tools" / "common" / "submit_rule_assessment").exists()


def _assert_import_blocked(module_name: str) -> None:
    try:
        importlib.import_module(module_name)
    except ModuleNotFoundError:
        return
    raise AssertionError(f"legacy import unexpectedly resolved: {module_name}")


def test_flat_dispatch_observability_import_is_not_supported() -> None:
    _assert_import_blocked("runtime.infrastructure.dispatch.correlation")


def test_flat_dispatch_clarification_import_is_not_supported() -> None:
    _assert_import_blocked("runtime.infrastructure.dispatch.source_clarification")


def test_program_graph_runtime_groups_owned_capabilities() -> None:
    root = PROJECT_ROOT / "tools" / "common" / "capabilities" / "evidence" / "graph"

    # The evidence/graph/query/ directory was intentionally deleted; only the
    # schema vocabulary remains, with graph_runtime.py as infrastructure only.
    assert _directories(root) == {"schema"}
    assert not (root / "query").exists()
    assert _implementation_files(root) == set()
    assert _implementation_files(root / "schema") == {
        "models.py",
        "source_roles.py",
        "vocabulary.py",
    }
    assert (PROJECT_ROOT / "tools" / "common" / "capabilities" / "platform" / "graph_runtime.py").exists()


def test_flat_program_graph_import_is_not_supported() -> None:
    _assert_import_blocked("tools.common.capabilities.evidence.graph.models")


def test_graph_schema_and_query_import_without_legacy_builder_runtime() -> None:
    schema = importlib.import_module("tools.common.capabilities.evidence.graph.schema.models")
    vocabulary = importlib.import_module(
        "tools.common.capabilities.evidence.graph.schema.vocabulary"
    )
    assert schema is not None
    assert vocabulary is not None
    assert hasattr(vocabulary, "PROGRAM_GRAPH_SCHEMA_VERSION")
    # The graph/query builder runtime was intentionally deleted: it must stay
    # unimportable while schema vocabulary remains as infrastructure only.
    _assert_import_blocked("tools.common.capabilities.evidence.graph.query.query_engine")
    _assert_import_blocked(
        "tools.common.capabilities.evidence.graph.construction.assembly.builder"
    )
