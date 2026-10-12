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


def test_legal_runtime_is_grouped_by_capability() -> None:
    legal = PROJECT_ROOT / "tools" / "legal"
    legal_source = legal / "legal_source"
    retrieval = legal / "retrieval"
    sources = legal / "sources"

    assert _dirs(legal_source) == {
        "chunk_integrity",
        "legal_chunks",
        "reviewed_input",
        "partial_update",
        "relationships",
        "models",
    }
    assert _py(legal_source) == set()
    assert _py(legal_source / "chunk_integrity") == {
        "chunk_integrity_boundary.py",
        "chunk_integrity_repository.py",
        "chunk_integrity_validator.py",
    }
    assert _py(legal_source / "legal_chunks") == {
        "legal_chunk_boundary.py",
        "legal_chunk_builder.py",
        "legal_chunk_repository.py",
    }
    assert _py(legal_source / "reviewed_input") == {
        "reviewed_legal_source_input_boundary.py",
        "reviewed_legal_source_input_builder.py",
        "reviewed_legal_source_input_repository.py",
    }
    assert _py(legal_source / "partial_update") == {"partial_update_context_builder.py"}
    assert _py(legal_source / "relationships") == {"relationship_manifest_repository.py"}

    assert _dirs(retrieval) == {"index", "legal_basis"}
    assert _py(retrieval) == set()
    assert _py(retrieval / "index") == {
        "chroma_path.py",
        "chroma_vectorless.py",
        "legal_retrieval_index_boundary.py",
        "legal_retrieval_index_builder.py",
        "legal_retrieval_index_repository.py",
    }
    assert _py(retrieval / "legal_basis") == {
        "chromadb_citation_retriever.py",
        "structural_chunk_filter.py",
    }

    assert _dirs(sources) == {
        "change_detection",
        "ingest",
        "extraction",
        "ocr_fallback",
        "ocr_quality",
        "vbpl_effects",
        "scripts",
    }
    assert _py(sources) == set()
    assert _py(sources / "ingest") == {
        "official_legal_source_acquisition.py",
        "official_source_payload.py",
        "official_source_snapshot.py",
        "legal_source_ingest_boundary.py",
    }
    assert not (sources / "recovery").exists()


def test_canonical_legal_imports_resolve() -> None:
    for module_name in (
        "tools.legal.legal_source.legal_chunks.legal_chunk_builder",
        "tools.legal.retrieval.index.chroma_path",
        "tools.legal.retrieval.legal_basis.chromadb_citation_retriever",
        "tools.legal.sources.extraction.official_text_extraction",
        "tools.legal.sources.ocr_quality.ocr_quality_validator",
    ):
        assert importlib.import_module(module_name) is not None
