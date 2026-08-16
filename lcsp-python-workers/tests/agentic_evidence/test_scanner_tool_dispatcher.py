from __future__ import annotations
import inspect
from pathlib import Path
from unittest.mock import MagicMock
import pytest
from lcsp_workers.agentic_evidence import scanner_tool_entrypoints
from lcsp_workers.agentic_evidence.dispatcher import ALL_TOOL_BINDINGS, AO1_SCANNER_TOOL_BINDINGS, ScannerToolDispatcher, ToolRuntimeTarget, runtime_binding, tool_runtime_manifest
from lcsp_workers.agentic_evidence.registry import AgenticToolValidationError
from lcsp_workers.agentic_evidence.scanner_tool_entrypoints import ScannerToolExecutionContext
from lcsp_workers.scanner.scan_consumer import ScanConsumer
EXPECTED = {"materialize_snapshot", "classify_workspace_languages", "run_syft_inventory", "run_semgrep_rules", "run_knip_usage_analysis", "run_deptry_usage_analysis", "run_ts_js_semantic_analysis", "run_python_semantic_analysis", "run_structural_augmentation", "build_evidence_graph", "validate_evidence_report"}

def _context(): return ScannerToolExecutionContext(workspace=MagicMock(), language_classifier=MagicMock(), syft_tool=MagicMock(), semgrep_tool=MagicMock(), knip_tool=MagicMock(), deptry_tool=MagicMock(), ts_js_bridge_factory=MagicMock(), structural_augmentor=MagicMock(), evidence_graph_assembler=MagicMock())

def test_ao1_scanner_bindings_are_exact_python_functions() -> None:
    names = {b.tool_name for b in AO1_SCANNER_TOOL_BINDINGS}; assert names == EXPECTED
    source = inspect.getsource(scanner_tool_entrypoints)
    for b in AO1_SCANNER_TOOL_BINDINGS:
        assert b.runtime_target == ToolRuntimeTarget.PYTHON_LOCAL; assert b.entrypoint.__name__ == b.tool_name; assert getattr(scanner_tool_entrypoints, b.tool_name) is b.entrypoint; assert f"def {b.tool_name}(" in source

def test_global_runtime_index_places_technical_query_in_python() -> None:
    names = [b.tool_name for b in ALL_TOOL_BINDINGS]; assert len(names) == len(set(names))
    assert runtime_binding("run_syft_inventory").runtime_target == ToolRuntimeTarget.PYTHON_LOCAL
    evidence = runtime_binding("search_evidence"); assert evidence.runtime_target == ToolRuntimeTarget.PYTHON_LOCAL; assert "ProgramGraphQueryEngine" in evidence.downstream_target
    assert runtime_binding("get_assessment_context").runtime_target == ToolRuntimeTarget.NEST_CQRS

def test_manifest_is_deterministic() -> None:
    manifest = tool_runtime_manifest(); assert len(manifest) == len(ALL_TOOL_BINDINGS); assert [r["tool_name"] for r in manifest] == sorted(b.tool_name for b in ALL_TOOL_BINDINGS)

def test_scanner_dispatcher_routes_syft() -> None:
    context = _context(); expected = object(); context.syft_tool.run.return_value = expected; dispatcher = ScannerToolDispatcher(context)
    assert dispatcher.dispatch("run_syft_inventory", workspace_path=Path("/tmp/lcsp-workspace")) is expected
    context.syft_tool.run.assert_called_once_with(Path("/tmp/lcsp-workspace"))

def test_scan_consumer_does_not_bypass_canonical_entrypoints() -> None:
    source = inspect.getsource(ScanConsumer)
    for forbidden in ("self._syft_tool.run(", "self._semgrep_tool.run(", "self._knip_tool.run(", "self._deptry_tool.run(", "PythonAnalyzer(", "self._evidence_graph_assembler.assemble("): assert forbidden not in source
    for name in EXPECTED - {"validate_evidence_report"}: assert f'"{name}"' in source

def test_unknown_scanner_tool_fails_closed() -> None:
    with pytest.raises(AgenticToolValidationError, match="SCANNER_TOOL_RUNTIME_BINDING_NOT_FOUND"): ScannerToolDispatcher(_context()).dispatch("run_unknown_scanner_tool")
