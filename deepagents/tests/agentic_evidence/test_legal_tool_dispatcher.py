from __future__ import annotations

import inspect
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from tools.common.agentic_evidence import legal_tool_entrypoints
from tools.common.agentic_evidence.dispatcher import (
    ALL_TOOL_BINDINGS,
    AO6_LEGAL_TOOL_BINDINGS,
    LegalToolDispatcher,
    ToolRuntimeTarget,
    runtime_binding,
)
from tools.common.agentic_evidence.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)


EXPECTED_AO6_LOCAL_TOOLS = {
    "fetch_official_source_snapshot": (
        ToolRuntimeTarget.PYTHON_LOCAL,
        "OfficialSourceSnapshotFetcher.fetch",
    ),
    "extract_official_text": (
        ToolRuntimeTarget.PYTHON_LOCAL,
        "OfficialTextExtractor.extract",
    ),
    "run_ocr_fallback": (ToolRuntimeTarget.PYTHON_LOCAL, "OcrFallbackTool.run"),
    "evaluate_ocr_quality": (
        ToolRuntimeTarget.PYTHON_LOCAL,
        "OcrQualityValidator.evaluate",
    ),
    "build_reviewed_corpus_input": (
        ToolRuntimeTarget.PYTHON_LOCAL,
        "ReviewedCorpusInputBuilder.build",
    ),
    "build_legal_chunks": (ToolRuntimeTarget.PYTHON_LOCAL, "LegalChunkBuilder.build"),
    "validate_chunk_integrity": (
        ToolRuntimeTarget.PYTHON_LOCAL,
        "ChunkIntegrityValidator.validate",
    ),
    "build_vbpl_effected_chunk_set": (
        ToolRuntimeTarget.PYTHON_LOCAL,
        "VBPL effect detector + applier + chunk-set exporter",
    ),
    "build_legal_retrieval_index": (
        ToolRuntimeTarget.PYTHON_LOCAL,
        "LegalRetrievalIndexBuilder.build",
    ),
    "validate_retrieval_index": (
        ToolRuntimeTarget.PYTHON_LOCAL,
        "ChromaDbCitationRetriever.index_corpus + retrieve_exact",
    ),
    "activate_validated_corpus_version": (
        ToolRuntimeTarget.PROTECTED_API,
        "WorkerApiClient.activate_validated_corpus_version",
    ),
}


def _context() -> LegalToolExecutionContext:
    return LegalToolExecutionContext(
        api_client=MagicMock(),
        storage_root=Path("/tmp/lcsp-legal-test"),
    )


def test_ao6_bindings_have_exact_named_static_entrypoints() -> None:
    names = {binding.tool_name for binding in AO6_LEGAL_TOOL_BINDINGS}
    assert names == set(EXPECTED_AO6_LOCAL_TOOLS)
    assert len(names) == len(AO6_LEGAL_TOOL_BINDINGS)

    source = inspect.getsource(legal_tool_entrypoints)
    for binding in AO6_LEGAL_TOOL_BINDINGS:
        expected_runtime, expected_downstream = EXPECTED_AO6_LOCAL_TOOLS[
            binding.tool_name
        ]
        assert binding.runtime_target == expected_runtime
        assert binding.downstream_target == expected_downstream
        assert binding.entrypoint.__name__ == binding.tool_name
        assert getattr(legal_tool_entrypoints, binding.tool_name) is binding.entrypoint
        assert f"def {binding.tool_name}(" in source


def test_global_binding_index_covers_all_56_canonical_tools() -> None:
    names = [binding.tool_name for binding in ALL_TOOL_BINDINGS]

    assert len(names) == len(set(names))
    assert len(names) == 56
    assert runtime_binding("build_legal_chunks").downstream_target == "LegalChunkBuilder.build"
    assert (
        runtime_binding("activate_validated_corpus_version").runtime_target
        == ToolRuntimeTarget.PROTECTED_API
    )


def test_legal_dispatcher_keeps_activation_behind_protected_api() -> None:
    context = _context()
    context.api_client.activate_validated_corpus_version.return_value = {
        "status": "READY"
    }
    dispatcher = LegalToolDispatcher(context)

    response = dispatcher.dispatch(
        "activate_validated_corpus_version",
        corpus_version_id="corpus-1",
        payload={
            "integrityManifestRef": "integrity-1",
            "retrievalValidationRef": "retrieval-1",
            "idempotencyKey": "activate-12345678",
        },
    )

    assert response == {"status": "READY"}
    context.api_client.activate_validated_corpus_version.assert_called_once_with(
        "corpus-1",
        {
            "integrityManifestRef": "integrity-1",
            "retrievalValidationRef": "retrieval-1",
            "idempotencyKey": "activate-12345678",
        },
    )


def test_activation_rejects_missing_idempotency_key_before_api_call() -> None:
    context = _context()
    dispatcher = LegalToolDispatcher(context)

    with pytest.raises(ValueError, match="requires idempotencyKey"):
        dispatcher.dispatch(
            "activate_validated_corpus_version",
            corpus_version_id="corpus-1",
            payload={"integrityManifestRef": "integrity-1"},
        )

    context.api_client.activate_validated_corpus_version.assert_not_called()


def test_fetch_snapshot_dispatches_through_same_named_function() -> None:
    context = LegalToolExecutionContext(
        api_client=MagicMock(),
        storage_root=Path("/tmp/lcsp-legal-test"),
        snapshot_fetcher=MagicMock(),
    )
    expected = object()
    context.snapshot_fetcher.fetch.return_value = expected
    dispatcher = LegalToolDispatcher(context)

    result = dispatcher.dispatch(
        "fetch_official_source_snapshot",
        document_id="doc-1",
        catalog_source_ref="catalog:vbpl.vn",
        source_url="https://vbpl.vn/doc-1",
        max_bytes=1024,
        output_dir=Path("/tmp/legal-output"),
    )

    assert result is expected
    assert context.snapshot_fetcher.fetch.call_count == 1


def test_legal_dispatcher_fails_closed_for_unknown_tool() -> None:
    dispatcher = LegalToolDispatcher(_context())

    with pytest.raises(Exception, match="LEGAL_TOOL_RUNTIME_BINDING_NOT_FOUND"):
        dispatcher.dispatch("unknown_legal_tool")
