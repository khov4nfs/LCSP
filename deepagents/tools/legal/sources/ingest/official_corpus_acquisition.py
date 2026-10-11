"""Acquire, validate, and activate the official-source legal corpus, then start preparation."""

from __future__ import annotations

import hashlib
import json
import os
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

from structlog import get_logger

from tools.common.capabilities.agentic_evidence.dispatch.dispatcher import LegalToolDispatcher
from tools.common.capabilities.agentic_evidence.entrypoints.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.agent_runtime.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.platform.config import resolve_legal_source_storage_root
from tools.common.capabilities.platform.file_lock import (
    acquire_exclusive_lock,
    ensure_lock_file,
    release_file_lock,
)
from tools.legal.sources.ingest.official_source_payload import (
    _safe_ref,
    _source_text_path,
    build_official_source_payload,
    required_manifest_string,
)
from tools.legal.corpus.partial_update.partial_update_context_builder import (
    build_partial_update_context,
)

logger = get_logger(__name__)

DEFAULT_VERSION_PREFIX = "VN-LEGAL-CORPUS"
DEFAULT_INDEX_CONFIG = "chromadb-vectorless-legal-retriever-v1"
SOURCE_CRAWL_DIR = "source-crawl"
ACQUISITION_LOCK_FILE = "official-corpus-acquisition.lock"
DEFAULT_SOURCE_CRAWL_MAX_BYTES = 20 * 1024 * 1024


class OfficialCorpusAcquisition:
    """Run the official-source legal-corpus acquisition pipeline.

    Acquisition crawls bounded official-source requests, builds legal chunks from
    crawler text artifacts, ingests the validated draft, verifies exact retrieval
    coverage, registers the retrieval index, starts the Rule Set Preparation run that
    authors the LegalRequirement/AssessmentRule rule_set, and activates the corpus source. It
    never authors, recovers or approves legal semantics.
    """

    def __init__(
        self,
        *,
        api_client: WorkerApiClient,
        chroma_path: str | None = None,
        legal_dispatcher: LegalToolDispatcher | None = None,
    ) -> None:
        """Create the acquisition driver with optional storage/source overrides."""
        self._api_client = api_client
        self._chroma_path = chroma_path or os.getenv("LEGAL_CHROMA_PATH")
        self._legal_dispatcher = legal_dispatcher or LegalToolDispatcher(
            LegalToolExecutionContext(
                api_client=self._api_client,
                storage_root=None,
                chroma_path=self._chroma_path,
            )
        )
        self._dispatcher_injected = legal_dispatcher is not None

    def run(self, message: dict[str, Any], correlationId: str) -> dict[str, Any]:
        """Acquire official sources, validate the corpus, and enqueue canonical preparation."""
        idempotency_key = required_string(message, "idempotencyKey")
        storage_root = self._resolve_storage_root(message)
        with _exclusive_acquisition_lock(storage_root):
            return self._run_locked(message, correlationId, idempotency_key)

    def _run_locked(
        self,
        message: dict[str, Any],
        correlationId: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        """Run acquisition while holding the per-core corpus acquisition lock."""
        storage_root = self._resolve_storage_root(message)
        manifests = self._resolve_source_manifests(message, storage_root=storage_root)
        version = str(self._corpus_version(manifests)).strip()
        partial_update_contexts = self._build_partial_update_contexts(
            manifests,
            storage_root=storage_root,
        )
        enriched_payload = build_official_source_payload(
            manifests,
            version,
            partial_update_contexts=partial_update_contexts,
        )

        draft = self._api_client.ingest_validated_legal_corpus_draft(enriched_payload)
        corpus_id = required_response_string(draft, "id", "corpus ingest response")
        if bool(draft.get("noChanges")):
            logger.info(
                "OFFICIAL_CORPUS_ACQUISITION_SKIPPED_UNCHANGED",
                corpus_version_id=corpus_id,
                corpus_version=str(draft.get("version") or ""),
                change_set=draft.get("changeSet") or {},
                correlationId=correlationId,
            )
            return {
                "status": "READY",
                "corpusVersionId": corpus_id,
                "retrievalIndexId": None,
                "correlationId": correlationId,
                "noChanges": True,
            }

        validation_ref = f"retrieval-validation:{_safe_ref(version)}"
        integrity_ref = f"integrity-manifest:{_safe_ref(version)}"
        self._validate_retrieval_index(corpus_id, enriched_payload)
        index_payload = {
            "version": f"index-{version}",
            "configHash": _sha256_text(DEFAULT_INDEX_CONFIG),
            "contentHash": _sha256_json(enriched_payload.get("documents") or []),
            "validationManifestRef": validation_ref,
            "validatedAt": datetime.now(UTC).isoformat(),
        }
        index = self._api_client.register_validated_retrieval_index(
            corpus_id,
            index_payload,
        )
        # Activation emits the durable Legal Source activation event; the API consumes it and starts
        # the one shared Rule Set Preparation. The acquisition driver never starts it.
        approved = self._legal_dispatcher.dispatch(
            "activate_validated_corpus_version",
            corpus_version_id=corpus_id,
            payload={
                "integrityManifestRef": integrity_ref,
                "retrievalValidationRef": validation_ref,
                "idempotencyKey": f"{idempotency_key}:activate:{version}",
                "scopeDescription": (
                    "Automatic official-source activation after official-source crawl, "
                    "chunk-integrity and retrieval-index validation"
                ),
                "comments": "Triggered by official-source acquisition.",
            },
        )
        active_corpus_id = (
            str((approved.get("artifactVersions") or {}).get("corpusVersionId") or "")
            or corpus_id
        )
        retrieval_index_id = (
            str(index.get("id")) if isinstance(index.get("id"), str) else None
        )
        result = {
            "status": "READY",
            "corpusVersionId": active_corpus_id,
            "retrievalIndexId": retrieval_index_id,
            "correlationId": correlationId,
        }
        logger.info(
            "OFFICIAL_CORPUS_ACQUISITION_COMPLETED",
            corpus_version_id=active_corpus_id,
            retrieval_index_id=retrieval_index_id,
            correlationId=correlationId,
        )
        return result

    def _validate_retrieval_index(
        self, corpus_version_id: str, payload: dict[str, Any]
    ) -> None:
        """Validate exact source coverage through the mechanical tool boundary."""
        self._legal_dispatcher.dispatch(
            "validate_retrieval_index",
            corpus_version_id=corpus_version_id,
            payload=payload,
        )

    def _resolve_source_manifests(
        self,
        message: dict[str, Any],
        *,
        storage_root: Path,
    ) -> list[Path]:
        """Resolve official-source manifests by running source crawl requests."""
        crawled_paths = self._run_source_crawl_pipeline(
            message=message,
            storage_root=storage_root,
        )
        if crawled_paths:
            return crawled_paths
        raise NonRetryableAgentBoundaryError(
            "legal corpus acquisition requires sourceCrawlRequests in the acquisition "
            "command or LEGAL_SOURCE_CRAWL_REQUESTS in the environment."
        )

    def _run_source_crawl_pipeline(
        self,
        *,
        message: dict[str, Any],
        storage_root: Path,
    ) -> list[Path]:
        """Run bounded official-source crawlers when acquisition has no manifests."""
        requests = source_crawl_requests(message)
        if not requests:
            return []

        # The dispatcher created during construction intentionally has no
        # filesystem authority. Bind the resolved, policy-checked storage root
        # for this command before invoking source crawlers.
        crawl_dispatcher = self._legal_dispatcher if self._dispatcher_injected else LegalToolDispatcher(
            LegalToolExecutionContext(
                api_client=self._api_client,
                storage_root=storage_root,
                chroma_path=self._chroma_path,
            )
        )

        manifest_paths: list[Path] = []
        corpus_version = str(
            message.get("corpusVersionId") or "corpus-acquisition"
        ).strip()
        crawl_root = storage_root / SOURCE_CRAWL_DIR / _safe_ref(corpus_version)
        for index, request in enumerate(requests, start=1):
            document_id = required_string(request, "documentId")
            catalog_source_ref = required_string(request, "catalogSourceRef")
            source_url = required_string(request, "sourceUrl")
            output_dir = crawl_root / _safe_ref(document_id)
            result = crawl_dispatcher.dispatch(
                "fetch_official_source_snapshot",
                document_id=document_id,
                catalog_source_ref=catalog_source_ref,
                source_url=source_url,
                output_dir=output_dir,
                max_bytes=_positive_int(
                    request.get("maxBytes", request.get("max_bytes")),
                    default=DEFAULT_SOURCE_CRAWL_MAX_BYTES,
                ),
                gateway_document_id=_optional_string(
                    request, "gatewayDocumentId", "gateway_document_id"
                ),
                source_effect_status=_optional_string(
                    request, "sourceEffectStatus", "source_effect_status"
                ),
                expected_document_number=_optional_string(
                    request, "expectedDocumentNumber", "expected_document_number"
                ),
            )
            manifest_path = getattr(result, "manifest_path", None)
            if not isinstance(manifest_path, Path) or not manifest_path.is_file():
                fallback = output_dir / f"{document_id}.source.json"
                if not fallback.is_file():
                    raise RuntimeError(
                        "source crawl pipeline did not produce a source manifest "
                        f"for request #{index}: {document_id}"
                    )
                manifest_path = fallback
            self._complete_crawl_manifest_metadata(manifest_path, request)
            manifest_paths.append(manifest_path.resolve())

        logger.info(
            "OFFICIAL_CORPUS_ACQUISITION_RAN_SOURCE_CRAWL_PIPELINE",
            source_manifest_count=len(manifest_paths),
            storage_root=str(storage_root),
        )
        return sorted(dict.fromkeys(manifest_paths))

    @staticmethod
    def _complete_crawl_manifest_metadata(manifest_path: Path, request: dict[str, Any]) -> None:
        """Carry governed request metadata into crawler output when omitted."""
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(manifest, dict) or manifest.get("sourceEffectStatus"):
            return
        status = request.get("sourceEffectStatus") or request.get("source_effect_status")
        if not isinstance(status, str) or not status.strip():
            return
        manifest["sourceEffectStatus"] = status.strip()
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    def _build_partial_update_contexts(
        self,
        manifests: list[Path],
        *,
        storage_root: Path,
    ) -> list[dict[str, Any]]:
        """Compare freshly crawled snapshots with stored snapshots."""
        contexts: list[dict[str, Any]] = []
        manifest_set = {path.resolve() for path in manifests}
        for manifest_path in manifests:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            document_id = required_manifest_string(
                manifest,
                "documentId",
                source=str(manifest_path),
            )
            previous_path = self._previous_source_manifest(
                document_id,
                storage_root=storage_root,
                exclude=manifest_set,
            )
            if previous_path is None:
                continue
            previous = json.loads(previous_path.read_text(encoding="utf-8"))
            old_html_path = self._optional_artifact_path(previous_path, previous, "htmlFile")
            new_html_path = self._optional_artifact_path(manifest_path, manifest, "htmlFile")
            if old_html_path is None or new_html_path is None:
                continue
            context = build_partial_update_context(
                document_id=document_id,
                source_url=required_manifest_string(
                    manifest,
                    "sourceUrl",
                    source=str(manifest_path),
                ),
                base_snapshot_ref=f"source-manifest:{previous.get('htmlSha256')}",
                new_snapshot_ref=f"source-manifest:{manifest.get('htmlSha256')}",
                old_html=old_html_path.read_text(encoding="utf-8"),
                new_html=new_html_path.read_text(encoding="utf-8"),
            )
            if context is None:
                continue
            contexts.append(json.loads(context.to_json()))
        return contexts

    @staticmethod
    def _previous_source_manifest(
        document_id: str,
        *,
        storage_root: Path,
        exclude: set[Path],
    ) -> Path | None:
        """Find the most recent stored source manifest for a document."""
        candidates: list[Path] = []
        for path in (storage_root / SOURCE_CRAWL_DIR).glob("**/*.source.json"):
            resolved = path.resolve()
            if resolved in exclude or not path.is_file():
                continue
            try:
                manifest = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if manifest.get("documentId") == document_id:
                candidates.append(path)
        if not candidates:
            return None
        return max(candidates, key=lambda path: path.stat().st_mtime).resolve()

    @staticmethod
    def _optional_artifact_path(
        manifest_path: Path,
        manifest: dict[str, Any],
        key: str,
    ) -> Path | None:
        """Resolve an optional artifact path declared by a source manifest."""
        value = manifest.get(key)
        if not isinstance(value, str) or not value.strip():
            return None
        path = manifest_path.parent / value
        if not path.is_file():
            return None
        return path

    def _corpus_version(self, manifests: list[Path]) -> str:
        """Derive a content-addressed corpus version from crawl artifacts."""
        digest = hashlib.sha256()
        for path in sorted(manifests):
            digest.update(path.read_bytes())
            manifest = json.loads(path.read_text(encoding="utf-8"))
            digest.update(_source_text_path(path, manifest).read_bytes())
        return f"{DEFAULT_VERSION_PREFIX}-{digest.hexdigest()[:16]}"

    def _resolve_storage_root(self, message: dict[str, Any]) -> Path:
        """Resolve the runtime corpus artifact root used by crawl/acquisition."""
        raw = message.get("storageRoot")
        if isinstance(raw, str) and raw.strip():
            return Path(raw.strip()).resolve()
        return Path(resolve_legal_source_storage_root()).resolve()


def required_string(values: dict[str, Any], key: str) -> str:
    """Read a required non-empty command string."""
    value = values.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"missing {key}")
    return value.strip()


def required_response_string(values: dict[str, Any], key: str, source: str) -> str:
    """Read a required non-empty string from an internal API response."""
    value = values.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"{source} is missing {key}")
    return value.strip()


def _optional_string(values: dict[str, Any], *keys: str) -> str | None:
    """Read the first non-empty optional string from a crawl request."""
    for key in keys:
        value = values.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _positive_int(value: Any, *, default: int) -> int:
    """Normalize optional crawl byte limits without accepting unsafe values."""
    if value is None:
        return default
    if not isinstance(value, int) or value < 1:
        raise RuntimeError("source crawl request maxBytes must be a positive integer")
    return value


def source_crawl_requests(message: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize acquisition-command crawl requests into bounded request objects."""
    value = message.get("sourceCrawlRequests")
    if value is None:
        env_value = os.getenv("LEGAL_SOURCE_CRAWL_REQUESTS")
        if env_value and env_value.strip():
            try:
                value = json.loads(env_value)
            except json.JSONDecodeError as exc:
                raise RuntimeError("LEGAL_SOURCE_CRAWL_REQUESTS must be JSON") from exc
    if value is None:
        return []
    if not isinstance(value, list):
        raise RuntimeError("sourceCrawlRequests must be a list")
    requests = [item for item in value if isinstance(item, dict)]
    if len(requests) != len(value):
        raise RuntimeError("sourceCrawlRequests entries must be objects")
    return requests


def _sha256_text(value: str) -> str:
    """Return a tagged SHA-256 digest for deterministic text configuration."""
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()}"


def _sha256_json(value: Any) -> str:
    """Return a tagged SHA-256 digest for canonical sorted JSON content."""
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


@contextmanager
def _exclusive_acquisition_lock(storage_root: Path) -> Iterator[None]:
    """Serialize corpus acquisition on one repo/core so waiting runs share one rebuild."""
    lock_dir = storage_root / "locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / ACQUISITION_LOCK_FILE
    ensure_lock_file(lock_path)
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        acquire_exclusive_lock(lock_file)
        try:
            yield
        finally:
            release_file_lock(lock_file)
