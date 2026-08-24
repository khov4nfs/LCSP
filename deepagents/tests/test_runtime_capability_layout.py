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

    assert _directories(root) == {
        "contract",
        "scripts",
        "observability",
        "clarification",
    }
    assert _implementation_files(root) == {"tool_dispatch.py", "graph_runtime.py"}
    assert _implementation_files(root / "observability") == {
        "correlation.py",
        "dev_unsafe_instrumentation.py",
        "dev_unsafe_trace.py",
        "logging.py",
        "logging_config.py",
        "logging_path.py",
        "orchestration_logging.py",
        "tracing.py",
    }
    assert _implementation_files(root / "clarification") == {
        "wizard_clarification.py",
    }


def test_flat_dispatch_observability_import_routes_to_owner_package() -> None:
    legacy = importlib.import_module("runtime.infrastructure.dispatch.correlation")
    canonical = importlib.import_module(
        "runtime.infrastructure.dispatch.observability.correlation"
    )
    assert Path(str(legacy.__file__)).resolve() == Path(
        str(canonical.__file__)
    ).resolve()


def test_flat_dispatch_clarification_import_routes_to_owner_package() -> None:
    legacy = importlib.import_module(
        "runtime.infrastructure.dispatch.wizard_clarification"
    )
    canonical = importlib.import_module(
        "runtime.infrastructure.dispatch.clarification.wizard_clarification"
    )
    assert Path(str(legacy.__file__)).resolve() == Path(
        str(canonical.__file__)
    ).resolve()


def test_program_graph_runtime_groups_owned_capabilities() -> None:
    root = PROJECT_ROOT / "runtime" / "evidence" / "graph"

    assert _directories(root) == {
        "schema",
        "construction",
        "lineage",
        "resolution",
        "query",
    }
    assert _implementation_files(root) == set()
    assert _implementation_files(root / "schema") == {
        "models.py",
        "semantic_ir.py",
        "source_roles.py",
        "vocabulary.py",
    }

    construction = root / "construction"
    assert _directories(construction) == {"assembly", "extraction", "validation"}
    assert _implementation_files(construction) == set()
    assert _implementation_files(construction / "assembly") == {
        "assembler.py",
        "builder.py",
    }
    assert _implementation_files(construction / "extraction") == {
        "extractor.py",
        "source_evidence.py",
    }
    assert _implementation_files(construction / "validation") == {
        "semantic_integrity.py",
        "validator.py",
    }

    lineage = root / "lineage"
    assert _directories(lineage) == {"ai", "contract", "data", "sensitive", "decision"}
    assert _implementation_files(lineage) == set()
    assert _implementation_files(lineage / "ai") == {
        "ai_invocation_gate.py",
        "ai_lifecycle.py",
    }
    assert _implementation_files(lineage / "contract") == {
        "contract_flow.py",
        "contract_lineage.py",
    }
    assert _implementation_files(lineage / "data") == {
        "data_lineage.py",
        "database_lineage.py",
    }
    assert _implementation_files(lineage / "sensitive") == {
        "sensitive_data.py",
        "sensitive_lineage_gate.py",
    }
    assert _implementation_files(lineage / "decision") == {"decision_influence.py"}

    resolution = root / "resolution"
    assert _directories(resolution) == {"boundary", "framework", "architecture", "dispatch"}
    assert _implementation_files(resolution) == set()
    assert _implementation_files(resolution / "boundary") == {
        "api_boundary_resolution.py",
        "python_agent_boundary_resolution.py",
    }
    assert _implementation_files(resolution / "framework") == {
        "framework_boundary_finalizer.py",
        "framework_links.py",
        "framework_metadata.py",
        "framework_resolution.py",
        "python_framework_adapters.py",
    }
    assert _implementation_files(resolution / "architecture") == {
        "javascript_architecture_resolution.py",
        "managed_architecture_resolution.py",
        "python_architecture_resolution.py",
        "redux_extended_resolution.py",
    }
    assert _implementation_files(resolution / "dispatch") == {
        "generic_dispatch_resolution.py",
        "protocol_resolution.py",
    }
    assert _implementation_files(root / "query") == {"query_engine.py"}


def test_flat_program_graph_import_routes_to_owner_package() -> None:
    legacy = importlib.import_module("runtime.evidence.graph.models")
    canonical = importlib.import_module("runtime.evidence.graph.schema.models")
    assert Path(str(legacy.__file__)).resolve() == Path(
        str(canonical.__file__)
    ).resolve()


def test_graph_cross_capability_relative_imports_resolve_without_shims() -> None:
    builder = importlib.import_module("runtime.evidence.graph.construction.builder")
    query_engine = importlib.import_module("runtime.evidence.graph.query.query_engine")
    assert builder is not None
    assert query_engine is not None
