"""Canonical same-name execution entrypoints for AO-1 scanner tools.

Every function in this module intentionally has the exact canonical tool name.
The functions are thin adapters only: they make runtime ownership discoverable
while preserving the existing scanner implementations and their tests.

This module deliberately avoids importing scanner boundary modules at
module-import time. ``scanner.__init__`` exports ``ScanBoundary`` eagerly, so
keeping scanner dependencies in the execution context (and lazy imports for
scanner-owned implementations) prevents a package initialization cycle.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping


@dataclass(frozen=True)
class ScannerToolExecutionContext:
    """Trusted local scanner dependencies used by AO-1 canonical entrypoints."""

    workspace: Any
    language_classifier: Any
    syft_tool: Any
    semgrep_tool: Any
    knip_tool: Any
    deptry_tool: Any
    ts_js_bridge_factory: Callable[[Path], Any]
    structural_augmentor: Any
    evidence_graph_assembler: Any
    language_analyzer_registry: Any = None
    project_discovery: Any = None


ScannerToolInput = Mapping[str, Any]


def _required(request: ScannerToolInput, name: str) -> Any:
    if name not in request:
        raise ValueError(f"scanner tool input missing required field: {name}")
    return request[name]


def _workspace_path(request: ScannerToolInput) -> Path:
    value = _required(request, "workspace_path")
    return value if isinstance(value, Path) else Path(str(value))


def materialize_snapshot(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Materialize one trusted snapshot archive into the bounded scanner workspace."""
    return context.workspace.materialize(
        str(_required(request, "scan_job_id")),
        _required(request, "archive"),
        snapshot_id=str(_required(request, "snapshot_id")),
    )


def classify_workspace_languages(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Classify files in one materialized workspace for analyzer routing."""
    return context.language_classifier.classify_workspace(_workspace_path(request))


def run_syft_inventory(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run the pinned Syft implementation over one trusted workspace."""
    return context.syft_tool.run(_workspace_path(request))


def run_semgrep_rules(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run the configured Semgrep rules over one trusted workspace."""
    include_files = request.get("include_files")
    if include_files is None:
        return context.semgrep_tool.run(_workspace_path(request))
    return context.semgrep_tool.run(
        _workspace_path(request),
        include_files=list(include_files),
    )


def run_knip_usage_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run Knip usage analysis through the existing Python wrapper."""
    return context.knip_tool.run(_workspace_path(request))


def run_deptry_usage_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run Deptry usage analysis through the existing Python wrapper."""
    return context.deptry_tool.run(_workspace_path(request))


def run_ts_js_semantic_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run the TS/JS semantic bridge for a bounded file set."""
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import TsJsLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry

    include_files = request.get("include_files")
    registry = context.language_analyzer_registry or LanguageAnalyzerRegistry.default(
        context.ts_js_bridge_factory
    )
    adapter = registry.resolve("typescript") or TsJsLanguageAdapter(context.ts_js_bridge_factory)
    result = adapter.analyze(
        _workspace_path(request),
        list(include_files) if include_files is not None else None,
    )
    return result.native_result


def run_python_semantic_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run Python semantic analysis for a bounded file set."""
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import PythonLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry

    include_files = request.get("include_files")
    registry = context.language_analyzer_registry or LanguageAnalyzerRegistry.default(
        context.ts_js_bridge_factory
    )
    adapter = registry.resolve("python") or PythonLanguageAdapter()
    result = adapter.analyze(
        _workspace_path(request),
        list(include_files) if include_files is not None else None,
    )
    return result.native_result


def run_ruby_semantic_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run Ruby semantic analysis for a bounded file set."""
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import RubyLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry

    include_files = request.get("include_files")
    registry = context.language_analyzer_registry or LanguageAnalyzerRegistry.default(
        context.ts_js_bridge_factory
    )
    adapter = registry.resolve("ruby") or RubyLanguageAdapter()
    result = adapter.analyze(
        _workspace_path(request),
        list(include_files) if include_files is not None else None,
    )
    return result.native_result


def run_csharp_semantic_analysis(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run bounded C# semantic analysis without invoking dotnet tooling."""
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import CSharpLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry

    include_files = list(request.get("include_files") or [])
    project_root = request.get("project_root")
    if project_root:
        root = Path(project_root)
        include_files.extend(
            path.relative_to(_workspace_path(request)).as_posix()
            for path in root.glob("*.csproj")
            if path.is_file()
        )
    registry = context.language_analyzer_registry or LanguageAnalyzerRegistry.default(
        context.ts_js_bridge_factory
    )
    adapter = registry.resolve("csharp") or CSharpLanguageAdapter()
    result = adapter.analyze(
        _workspace_path(request),
        include_files,
    )
    return result.native_result


def run_java_semantic_analysis(request: ScannerToolInput, context: ScannerToolExecutionContext):
    """Run bounded Java syntax analysis without invoking Maven."""
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import JavaLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
    registry = context.language_analyzer_registry or LanguageAnalyzerRegistry.default(context.ts_js_bridge_factory)
    adapter = registry.resolve("java") or JavaLanguageAdapter()
    include_files = list(request.get("include_files") or [])
    root = Path(request.get("project_root")) if request.get("project_root") else _workspace_path(request)
    include_files.extend(path.relative_to(_workspace_path(request)).as_posix() for pattern in ("pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts") for path in root.glob(pattern) if path.is_file())
    result = adapter.analyze(_workspace_path(request), sorted(set(include_files)))
    return result.native_result


def run_kotlin_semantic_analysis(request: ScannerToolInput, context: ScannerToolExecutionContext):
    """Run bounded Kotlin syntax analysis without invoking Gradle."""
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import KotlinLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
    registry = context.language_analyzer_registry or LanguageAnalyzerRegistry.default(context.ts_js_bridge_factory)
    adapter = registry.resolve("kotlin") or KotlinLanguageAdapter()
    include_files = list(request.get("include_files") or [])
    root = Path(request.get("project_root")) if request.get("project_root") else _workspace_path(request)
    include_files.extend(path.relative_to(_workspace_path(request)).as_posix() for pattern in ("pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts") for path in root.glob(pattern) if path.is_file())
    result = adapter.analyze(_workspace_path(request), sorted(set(include_files)))
    return result.native_result


def run_php_semantic_analysis(request: ScannerToolInput, context: ScannerToolExecutionContext):
    """Run bounded PHP syntax/Composer analysis without executing PHP."""
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import PhpLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
    registry = context.language_analyzer_registry or LanguageAnalyzerRegistry.default(context.ts_js_bridge_factory)
    adapter = registry.resolve("php") or PhpLanguageAdapter()
    include_files = list(request.get("include_files") or [])
    root = Path(request.get("project_root")) if request.get("project_root") else _workspace_path(request)
    include_files.extend(path.relative_to(_workspace_path(request)).as_posix() for path in root.glob("composer.json") if path.is_file())
    result = adapter.analyze(_workspace_path(request), sorted(set(include_files)))
    return result.native_result

def run_go_semantic_analysis(request: ScannerToolInput, context: ScannerToolExecutionContext):
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import GoLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
    registry=context.language_analyzer_registry or LanguageAnalyzerRegistry.default(context.ts_js_bridge_factory); adapter=registry.resolve("go") or GoLanguageAdapter(); files=list(request.get("include_files") or [])
    root=Path(request.get("project_root")) if request.get("project_root") else _workspace_path(request); files.extend(p.relative_to(_workspace_path(request)).as_posix() for p in root.glob("go.mod") if p.is_file())
    return adapter.analyze(_workspace_path(request),sorted(set(files))).native_result

def run_rust_semantic_analysis(request: ScannerToolInput, context: ScannerToolExecutionContext):
    from tools.common.capabilities.evidence.scanner.analyzers.adapters import RustLanguageAdapter
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
    registry=context.language_analyzer_registry or LanguageAnalyzerRegistry.default(context.ts_js_bridge_factory); adapter=registry.resolve("rust") or RustLanguageAdapter(); files=list(request.get("include_files") or [])
    root=Path(request.get("project_root")) if request.get("project_root") else _workspace_path(request); files.extend(p.relative_to(_workspace_path(request)).as_posix() for p in root.glob("Cargo.toml") if p.is_file())
    return adapter.analyze(_workspace_path(request),sorted(set(files))).native_result

def _run_mobile_semantic_analysis(request, context, language, manifest_names=()):
    from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
    registry=context.language_analyzer_registry or LanguageAnalyzerRegistry.default(context.ts_js_bridge_factory)
    files=list(request.get("include_files") or [])
    root=Path(request.get("project_root")) if request.get("project_root") else _workspace_path(request)
    workspace=_workspace_path(request)
    for name in manifest_names:
        path=root/name
        if path.is_file(): files.append(path.relative_to(workspace).as_posix())
    return registry.resolve(language).analyze(workspace, sorted(set(files))).native_result

def run_swift_semantic_analysis(request: ScannerToolInput, context: ScannerToolExecutionContext):
    return _run_mobile_semantic_analysis(request, context, "swift", ("Package.swift", "Podfile"))

def run_objc_semantic_analysis(request: ScannerToolInput, context: ScannerToolExecutionContext):
    return _run_mobile_semantic_analysis(request, context, "objc", ("Podfile",))

def run_dart_semantic_analysis(request: ScannerToolInput, context: ScannerToolExecutionContext):
    return _run_mobile_semantic_analysis(request, context, "dart", ("pubspec.yaml",))


def run_structural_augmentation(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Run structural augmentation through the existing deterministic augmentor."""
    return context.structural_augmentor.augment(
        files=list(_required(request, "files")),
        finding_ids=list(_required(request, "finding_ids")),
    )


def build_evidence_graph(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
):
    """Build the scanner evidence graph through its existing assembler."""
    return context.evidence_graph_assembler.assemble(
        scan_job_id=str(_required(request, "scan_job_id")),
        snapshot_id=str(_required(request, "snapshot_id")),
        commit_sha=str(request.get("commit_sha") or ""),
        workspace_path=_workspace_path(request),
        technical_findings=list(_required(request, "technical_findings")),
        structural_facts=list(request.get("structural_facts") or []),
        semantic_program=request.get("semantic_program"),
        package_dependencies=list(request.get("package_dependencies") or []),
        coverage_notes=list(request.get("coverage_notes") or []),
        project_discovery=request.get("project_discovery"),
    )


def validate_evidence_report(
    request: ScannerToolInput,
    context: ScannerToolExecutionContext,
) -> dict[str, str]:
    """Run the scanner schema, privacy, and quality gates behind one tool boundary."""
    del context  # Validation is deterministic and does not require injected services.

    from tools.common.capabilities.evidence.scanner.evidence.quality.privacy_gate import assert_privacy_flags
    from tools.common.capabilities.evidence.scanner.evidence.quality.quality_gate import classify_quality
    from tools.common.capabilities.evidence.scanner.evidence.contract.schema_validator import validate_schema

    payload = dict(_required(request, "payload"))
    tool_provenance = list(_required(request, "tool_provenance"))

    validate_schema(payload, tool_provenance)
    assert_privacy_flags(payload)
    quality_state = classify_quality(
        list(payload.get("findings") or []),
        tool_provenance,
    )
    return {"quality_state": quality_state}
