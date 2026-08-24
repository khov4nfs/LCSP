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
    legal = PROJECT_ROOT / "runtime" / "legal"
    corpus = legal / "corpus"
    retrieval = legal / "retrieval"
    sources = legal / "sources"

    assert _dirs(corpus) == {
        "chunk_integrity",
        "legal_chunks",
        "reviewed_input",
        "partial_update",
        "relationships",
        "engineering_rules",
        "models",
    }
    assert _py(corpus) == set()
    assert _py(corpus / "chunk_integrity") == {
        "chunk_integrity_boundary.py",
        "chunk_integrity_repository.py",
        "chunk_integrity_validator.py",
    }
    assert _py(corpus / "legal_chunks") == {
        "legal_chunk_boundary.py",
        "legal_chunk_builder.py",
        "legal_chunk_repository.py",
    }
    assert _py(corpus / "reviewed_input") == {
        "reviewed_corpus_input_boundary.py",
        "reviewed_corpus_input_builder.py",
        "reviewed_corpus_input_repository.py",
    }
    assert _py(corpus / "partial_update") == {"partial_update_context_builder.py"}
    assert _py(corpus / "relationships") == {"relationship_manifest_repository.py"}

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
        "legal_match_builder.py",
        "legal_retrieval_boundary.py",
        "normative_chunk_filter.py",
        "rule_applicability_evaluator.py",
    }

    assert _dirs(sources) == {
        "change_detection",
        "recovery",
        "ingest",
        "extraction",
        "ocr_fallback",
        "ocr_quality",
        "vbpl_effects",
        "scripts",
    }
    assert _py(sources) == set()


def test_legacy_legal_flat_imports_resolve_to_capability_owner() -> None:
    cases = (
        (
            "runtime.legal.corpus.legal_chunk_builder",
            "runtime.legal.corpus.legal_chunks.legal_chunk_builder",
        ),
        (
            "runtime.legal.retrieval.chroma_path",
            "runtime.legal.retrieval.index.chroma_path",
        ),
        (
            "runtime.legal.retrieval.legal_retrieval_boundary",
            "runtime.legal.retrieval.legal_basis.legal_retrieval_boundary",
        ),
        (
            "runtime.legal.sources.official_text_extraction",
            "runtime.legal.sources.extraction.official_text_extraction",
        ),
        (
            "runtime.legal.sources.ocr_quality_validator",
            "runtime.legal.sources.ocr_quality.ocr_quality_validator",
        ),
    )
    for legacy_name, canonical_name in cases:
        legacy = importlib.import_module(legacy_name)
        canonical = importlib.import_module(canonical_name)
        assert Path(str(legacy.__file__)).resolve() == Path(
            str(canonical.__file__)
        ).resolve()
