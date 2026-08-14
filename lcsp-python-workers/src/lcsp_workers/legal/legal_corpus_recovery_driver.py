from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from structlog import get_logger

from lcsp_workers.legal.chromadb_citation_retriever import ChromaDbCitationRetriever
from lcsp_workers.platform.api_client import WorkerApiClient

logger = get_logger(__name__)

LEGAL_CORPUS_RECOVERY_COMMAND = "command.legal-corpus.recovery.requested.v1"
LEGAL_CORPUS_RECOVERY_QUEUE = "lcsp.legal-corpus-recovery.v1"
DEFAULT_VERSION_PREFIX = "VN-LEGAL-AO6"
DEFAULT_INDEX_CONFIG = "chromadb-vectorless-legal-retriever-v1"


@dataclass(frozen=True)
class LegalCorpusRecoveryResult:
    status: str
    corpus_version_id: str
    retrieval_index_id: str | None
    resumed_run_count: int


class LegalCorpusRecoveryDriver:
    def __init__(
        self,
        *,
        api_client: WorkerApiClient,
        chroma_path: str | None = None,
        source_manifest_paths: list[Path] | None = None,
        reviewed_dir: Path | None = None,
    ) -> None:
        self._api_client = api_client
        self._chroma_path = chroma_path or os.getenv("LEGAL_CHROMA_PATH")
        self._source_manifest_paths = source_manifest_paths
        self._reviewed_dir = reviewed_dir

    def run(self, message: dict[str, Any], correlationId: str) -> dict[str, Any]:
        idempotency_key = required_string(message, "idempotencyKey")
        manifests = self._resolve_source_manifests()
        reviewed_dir = self._resolve_reviewed_dir()
        builder = _load_script_module("build_reviewed_legal_corpus.py")
        orchestrator = _load_script_module("orchestrate_reviewed_legal_corpus.py")

        version = self._corpus_version(manifests, reviewed_dir)
        payload = builder.build_payload(manifests, version, reviewed_dir=reviewed_dir)
        signoff = orchestrator.build_review_signoff(payload, reviewed_dir=reviewed_dir)
        enriched_payload = orchestrator.enrich_payload_with_signoff(payload, signoff)

        draft = self._api_client.ingest_validated_legal_corpus_draft(
            enriched_payload
        )
        corpus_id = required_response_string(draft, "id", "corpus ingest response")

        validation_ref = f"retrieval-validation:{_safe_ref(version)}"
        integrity_ref = f"integrity-manifest:{_safe_ref(version)}"
        self._validate_retrieval_index(corpus_id, enriched_payload)
        index = self._api_client.register_validated_retrieval_index(
            corpus_id,
            {
                "version": f"index-{version}",
                "configHash": _sha256_text(DEFAULT_INDEX_CONFIG),
                "contentHash": _sha256_json(enriched_payload.get("documents") or []),
                "validationManifestRef": validation_ref,
                "validatedAt": datetime.now(UTC).isoformat(),
            },
        )

        approved = self._api_client.activate_validated_corpus_version(
            corpus_id,
            {
                "integrityManifestRef": integrity_ref,
                "retrievalValidationRef": validation_ref,
                "idempotencyKey": f"{idempotency_key}:activate:{version}",
                "scopeDescription": (
                    "Automatic AO-6 activation after official-source, "
                    "reviewed-text, chunk-integrity and retrieval-index validation"
                ),
                "comments": "Triggered by legal-corpus readiness recovery.",
            },
        )
        active_corpus_id = (
            str((approved.get("artifactVersions") or {}).get("corpusVersionId") or "")
            or corpus_id
        )
        resumed = self._api_client.resume_waiting_runs(
            active_corpus_id,
            {
                "maxRuns": int(message.get("maxRuns") or 500),
                "idempotencyKey": f"{idempotency_key}:resume:{version}",
            },
        )
        resumed_count = int((resumed.get("result") or {}).get("resumedRunCount") or 0)
        retrieval_index_id = (
            str(index.get("id")) if isinstance(index.get("id"), str) else None
        )
        logger.info(
            "LEGAL_CORPUS_RECOVERY_COMPLETED",
            corpus_version_id=active_corpus_id,
            retrieval_index_id=retrieval_index_id,
            resumed_run_count=resumed_count,
            correlationId=correlationId,
        )
        return {
            "status": "READY",
            "corpusVersionId": active_corpus_id,
            "retrievalIndexId": retrieval_index_id,
            "resumedRunCount": resumed_count,
            "correlationId": correlationId,
        }

    def _validate_retrieval_index(
        self, corpus_version_id: str, payload: dict[str, Any]
    ) -> None:
        chunks = [
            chunk
            for document in payload.get("documents") or []
            if isinstance(document, dict)
            for chunk in document.get("chunks") or []
            if isinstance(chunk, dict)
        ]
        if not chunks:
            raise RuntimeError("Corpus payload has no chunks to index")
        retriever = ChromaDbCitationRetriever(self._chroma_path)
        retriever.index_corpus(corpus_version_id, chunks)
        expected_ids = {str(chunk.get("id") or "") for chunk in chunks}
        if "" in expected_ids:
            raise RuntimeError("Corpus payload contains a chunk without stable ID")
        retrieved = retriever.retrieve_exact(corpus_version_id, list(expected_ids))
        primary_ids = {
            chunk.id for chunk in retrieved if chunk.role == "PRIMARY_MATCH"
        }
        if primary_ids != expected_ids:
            missing = sorted(expected_ids - primary_ids)
            raise RuntimeError(
                f"Retrieval index validation failed; missing chunk IDs: {missing}"
            )

    def _resolve_source_manifests(self) -> list[Path]:
        if self._source_manifest_paths:
            return self._source_manifest_paths
        raw = os.getenv("AO6_LEGAL_CORPUS_SOURCE_MANIFESTS", "")
        if raw.strip():
            paths = [Path(part.strip()) for part in raw.split(",") if part.strip()]
        else:
            paths = sorted(_repo_root().glob("reports/legal-corpus-source/*.source.json"))
        if not paths:
            raise RuntimeError(
                "AO6 legal corpus recovery has no source manifests. Set "
                "AO6_LEGAL_CORPUS_SOURCE_MANIFESTS."
            )
        return paths

    def _resolve_reviewed_dir(self) -> Path:
        if self._reviewed_dir is not None:
            return self._reviewed_dir
        raw = os.getenv("AO6_LEGAL_CORPUS_REVIEWED_DIR", "")
        path = Path(raw) if raw.strip() else _repo_root() / "reports/legal-corpus-ocr"
        if not path.is_dir():
            raise RuntimeError(
                "AO6 legal corpus recovery has no reviewed artifact directory. "
                "Set AO6_LEGAL_CORPUS_REVIEWED_DIR."
            )
        return path

    def _corpus_version(self, manifests: list[Path], reviewed_dir: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(manifests):
            digest.update(path.read_bytes())
        for path in sorted(reviewed_dir.glob("*.reviewed.txt")):
            digest.update(path.read_bytes())
        for path in sorted(reviewed_dir.glob("*.hierarchy-review.json")):
            digest.update(path.read_bytes())
        return f"{DEFAULT_VERSION_PREFIX}-{digest.hexdigest()[:16]}"


def required_string(values: dict[str, Any], key: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"missing {key}")
    return value.strip()


def required_response_string(values: dict[str, Any], key: str, source: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"{source} is missing {key}")
    return value.strip()


def _load_script_module(filename: str):
    path = _worker_root() / "scripts" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load AO-6 script: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _worker_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _repo_root() -> Path:
    return _worker_root().parent


def _sha256_text(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()}"


def _sha256_json(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _safe_ref(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._:-" else "-" for ch in value)[:128]
