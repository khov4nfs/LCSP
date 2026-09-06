"""Rebuild, validate, activate, and resume workflows for the legal corpus."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

from structlog import get_logger

from tools.common.capabilities.agentic_evidence.dispatch.dispatcher import LegalToolDispatcher
from tools.common.capabilities.agentic_evidence.entrypoints.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import default_legal_source_storage_root
from tools.common.capabilities.platform.file_lock import (
    acquire_exclusive_lock,
    ensure_lock_file,
    release_file_lock,
)
from tools.legal.corpus.artifact_store import write_recovery_artifact
from tools.legal.corpus.partial_update.partial_update_context_builder import (
    build_partial_update_context,
)

logger = get_logger(__name__)

LEGAL_CORPUS_RECOVERY_COMMAND = "command.legal-corpus.recovery.requested.v1"
LEGAL_CORPUS_RECOVERY_BOUNDARY_SOURCE = "lcsp.legal-corpus-recovery.v1"
DEFAULT_VERSION_PREFIX = "VN-LEGAL-CORPUS"
DEFAULT_INDEX_CONFIG = "chromadb-vectorless-legal-retriever-v1"
SOURCE_CRAWL_DIR = "source-crawl"
RECOVERY_LOCK_FILE = "legal-corpus-recovery.lock"
DEFAULT_SOURCE_CRAWL_MAX_BYTES = 20 * 1024 * 1024
OFFICIAL_SOURCE_AUTO_TRUSTED_POLICY = "OFFICIAL_SOURCE_AUTO_TRUSTED"


@dataclass(frozen=True)
class LegalCorpusRecoveryResult:
    """Terminal corpus recovery identifiers and resumed workflow count."""

    status: str
    corpus_version_id: str
    retrieval_index_id: str | None
    resumed_run_count: int


class LegalCorpusRecoveryDriver:
    """Run the official-source legal-corpus recovery pipeline.

    Recovery crawls bounded official-source requests, builds legal chunks from
    crawler text artifacts, ingests the validated draft, verifies exact retrieval
    coverage, registers the retrieval index, activates the corpus, then resumes
    workflows waiting for the newly active version.
    """

    def __init__(
        self,
        *,
        api_client: WorkerApiClient,
        chroma_path: str | None = None,
        legal_dispatcher: LegalToolDispatcher | None = None,
    ) -> None:
        """Create the recovery driver with optional storage/source overrides."""
        self._api_client = api_client
        self._chroma_path = chroma_path or os.getenv("LEGAL_CHROMA_PATH")
        self._legal_dispatcher = legal_dispatcher or LegalToolDispatcher(
            LegalToolExecutionContext(
                api_client=self._api_client,
                storage_root=None,
                chroma_path=self._chroma_path,
            )
        )

    def run(self, message: dict[str, Any], correlationId: str) -> dict[str, Any]:
        """Execute corpus rebuild, canonical validation/activation, and resume."""
        idempotency_key = required_string(message, "idempotencyKey")
        storage_root = self._resolve_storage_root(message)
        with _exclusive_recovery_lock(storage_root):
            return self._run_locked(message, correlationId, idempotency_key)

    def _run_locked(
        self,
        message: dict[str, Any],
        correlationId: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        """Run recovery while holding the per-core corpus recovery lock."""
        if bool(message.get("recoverLegalRulesOnly")):
            return self._run_legal_rule_only_recovery(
                message=message,
                correlationId=correlationId,
                idempotency_key=idempotency_key,
            )
        storage_root = self._resolve_storage_root(message)
        manifests = self._resolve_source_manifests(message, storage_root=storage_root)
        version = self._corpus_version(manifests)
        partial_update_contexts = self._build_partial_update_contexts(
            manifests,
            storage_root=storage_root,
        )
        enriched_payload = self._build_official_source_payload(
            manifests,
            version,
            partial_update_contexts=partial_update_contexts,
        )
        self._store_corpus_recovery_artifact(
            version=version,
            payload=enriched_payload,
            manifests=manifests,
            partial_update_contexts=partial_update_contexts,
            storage_root=storage_root,
        )

        draft = self._api_client.ingest_validated_legal_corpus_draft(enriched_payload)
        corpus_id = required_response_string(draft, "id", "corpus ingest response")
        if bool(draft.get("noChanges")):
            catalog = self._recover_legal_rule_catalog(
                idempotency_key=idempotency_key,
                version=version,
                correlationId=correlationId,
                storage_root=storage_root,
            )
            resumed = self._api_client.resume_waiting_runs(
                corpus_id,
                {
                    "maxRuns": int(message.get("maxRuns") or 500),
                    "idempotencyKey": f"{idempotency_key}:resume:{version}",
                },
            )
            resumed_count = int(
                (resumed.get("result") or {}).get("resumedRunCount") or 0
            )
            logger.info(
                "LEGAL_CORPUS_RECOVERY_SKIPPED_UNCHANGED",
                corpus_version_id=corpus_id,
                corpus_version=str(draft.get("version") or ""),
                change_set=draft.get("changeSet") or {},
                legal_rule_catalog_version_id=catalog.get("id"),
                legal_rule_count=catalog.get("ruleCount"),
                resumed_run_count=resumed_count,
                correlationId=correlationId,
            )
            return {
                "status": "READY",
                "corpusVersionId": corpus_id,
                "legalRuleCatalogVersionId": catalog.get("id"),
                "legalRuleCount": catalog.get("ruleCount"),
                "retrievalIndexId": None,
                "resumedRunCount": resumed_count,
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
        self._store_retrieval_index_artifact(
            version=version,
            corpus_id=corpus_id,
            payload=index_payload,
            index=index,
            storage_root=storage_root,
        )

        approved = self._legal_dispatcher.dispatch(
            "activate_validated_corpus_version",
            corpus_version_id=corpus_id,
            payload={
                "integrityManifestRef": integrity_ref,
                "retrievalValidationRef": validation_ref,
                "idempotencyKey": f"{idempotency_key}:activate:{version}",
                "scopeDescription": (
                    "Automatic AO-6 activation after official-source crawl, "
                    "chunk-integrity and retrieval-index validation"
                ),
                "comments": "Triggered by legal-corpus readiness recovery.",
            },
        )
        active_corpus_id = (
            str((approved.get("artifactVersions") or {}).get("corpusVersionId") or "")
            or corpus_id
        )
        self._store_corpus_activation_artifact(
            version=version,
            corpus_id=active_corpus_id,
            activation=approved,
            storage_root=storage_root,
        )
        catalog = self._recover_legal_rule_catalog(
            idempotency_key=idempotency_key,
            version=version,
            correlationId=correlationId,
            storage_root=storage_root,
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
            legal_rule_catalog_version_id=catalog.get("id"),
            legal_rule_count=catalog.get("ruleCount"),
            retrieval_index_id=retrieval_index_id,
            resumed_run_count=resumed_count,
            correlationId=correlationId,
        )
        return {
            "status": "READY",
            "corpusVersionId": active_corpus_id,
            "legalRuleCatalogVersionId": catalog.get("id"),
            "legalRuleCount": catalog.get("ruleCount"),
            "retrievalIndexId": retrieval_index_id,
            "resumedRunCount": resumed_count,
            "correlationId": correlationId,
        }

    def _validate_retrieval_index(
        self, corpus_version_id: str, payload: dict[str, Any]
    ) -> None:
        """Compatibility wrapper that still crosses the canonical tool boundary."""
        self._legal_dispatcher.dispatch(
            "validate_retrieval_index",
            corpus_version_id=corpus_version_id,
            payload=payload,
        )

    def _run_legal_rule_only_recovery(
        self,
        *,
        message: dict[str, Any],
        correlationId: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        """Recover LegalRule rows from the active corpus without local crawl files."""
        catalog = self._recover_legal_rule_catalog(
            idempotency_key=idempotency_key,
            version="active-corpus",
            correlationId=correlationId,
            storage_root=self._resolve_storage_root(message),
        )
        corpus_id = str(catalog.get("corpusVersionId") or "")
        resumed_count = 0
        if corpus_id and int(message.get("maxRuns") or 0) > 0:
            resumed = self._api_client.resume_waiting_runs(
                corpus_id,
                {
                    "maxRuns": int(message.get("maxRuns") or 500),
                    "idempotencyKey": f"{idempotency_key}:resume:active-corpus",
                },
            )
            resumed_count = int(
                (resumed.get("result") or {}).get("resumedRunCount") or 0
            )
        logger.info(
            "LEGAL_RULE_ONLY_RECOVERY_COMPLETED",
            legal_rule_catalog_version_id=catalog.get("id"),
            legal_rule_count=catalog.get("ruleCount"),
            corpus_version_id=corpus_id or None,
            resumed_run_count=resumed_count,
            correlationId=correlationId,
        )
        return {
            "status": "READY",
            "corpusVersionId": corpus_id or None,
            "legalRuleCatalogVersionId": catalog.get("id"),
            "legalRuleCount": catalog.get("ruleCount"),
            "retrievalIndexId": None,
            "resumedRunCount": resumed_count,
            "correlationId": correlationId,
            "legalRuleOnly": True,
        }

    def _recover_legal_rule_catalog(
        self,
        *,
        idempotency_key: str,
        version: str,
        correlationId: str,
        storage_root: Path | None = None,
    ) -> dict[str, Any]:
        """Recover approved LegalRule source rows after corpus chunks are ready."""
        response = self._api_client.recover_legal_rules_from_active_corpus(
            {
                "idempotencyKey": f"{idempotency_key}:legal-rules:{version}",
            }
        )
        rule_count = int(response.get("ruleCount") or 0)
        if rule_count <= 0:
            raise RuntimeError(
                "legal rule source recovery produced no approved LegalRule rows"
            )
        logger.info(
            "LEGAL_RULE_SOURCE_RECOVERY_COMPLETED",
            legal_rule_catalog_version_id=response.get("id"),
            legal_rule_count=rule_count,
            corpus_version_id=response.get("corpusVersionId"),
            no_changes=bool(response.get("noChanges")),
            correlationId=correlationId,
        )
        self._store_legal_rule_catalog_artifact(
            version=version,
            catalog=response,
            storage_root=storage_root,
        )
        return response

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
        raise RuntimeError(
            "legal corpus recovery requires sourceCrawlRequests in the recovery "
            "command or LEGAL_SOURCE_CRAWL_REQUESTS in the environment."
        )

    def _run_source_crawl_pipeline(
        self,
        *,
        message: dict[str, Any],
        storage_root: Path,
    ) -> list[Path]:
        """Run bounded official-source crawlers when recovery has no manifests."""
        requests = _source_crawl_requests(message)
        if not requests:
            return []

        manifest_paths: list[Path] = []
        corpus_version = str(
            message.get("corpusVersionId")
            or message.get("corpus_version_id")
            or "corpus-recovery"
        ).strip()
        crawl_root = storage_root / SOURCE_CRAWL_DIR / _safe_ref(corpus_version)
        for index, request in enumerate(requests, start=1):
            document_id = required_string(request, "documentId")
            catalog_source_ref = required_string(request, "catalogSourceRef")
            source_url = required_string(request, "sourceUrl")
            output_dir = crawl_root / _safe_ref(document_id)
            result = self._legal_dispatcher.dispatch(
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
            manifest_paths.append(manifest_path.resolve())

        logger.info(
            "LEGAL_CORPUS_RECOVERY_RAN_SOURCE_CRAWL_PIPELINE",
            source_manifest_count=len(manifest_paths),
            storage_root=str(storage_root),
        )
        return sorted(dict.fromkeys(manifest_paths))

    def _build_official_source_payload(
        self,
        manifests: list[Path],
        version: str,
        *,
        partial_update_contexts: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Build an ingest payload directly from official crawler artifacts."""
        builder = _load_script_module("build_reviewed_legal_corpus.py")
        documents: list[dict[str, Any]] = []
        source_artifacts: list[dict[str, Any]] = []
        document_ids: set[str] = set()
        for manifest_path in manifests:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            document_id = required_manifest_string(
                manifest,
                "documentId",
                source=str(manifest_path),
            )
            if document_id in document_ids:
                raise RuntimeError(f"duplicate source crawl document {document_id}")
            document_ids.add(document_id)
            text_path = self._source_text_path(manifest_path, manifest)
            text = text_path.read_text(encoding="utf-8")
            source_artifact_ref, source_artifact_sha = self._source_artifact(
                manifest_path,
                manifest,
            )
            chunks = [
                chunk
                for chunk in builder.parse_chunks(document_id, text, None)
                if chunk.get("content")
            ]
            if not chunks:
                raise RuntimeError(f"{document_id}: source crawl produced no chunks")
            source_effect_status = builder.normalize_source_effect_status(
                document_id,
                required_manifest_string(
                    manifest,
                    "sourceEffectStatus",
                    source=str(manifest_path),
                ),
            )
            documents.append(
                {
                    "documentId": document_id,
                    "title": required_manifest_string(
                        manifest,
                        "title",
                        source=str(manifest_path),
                    ),
                    "sourceUrl": required_manifest_string(
                        manifest,
                        "sourceUrl",
                        source=str(manifest_path),
                    ),
                    "sourceSha256": source_artifact_sha,
                    "sourceEffectStatus": source_effect_status,
                    "effectiveDate": manifest.get("effectiveFrom")
                    or manifest.get("effectiveDate"),
                    "snapshotPath": source_artifact_ref,
                    "chunks": chunks,
                }
            )
            source_artifacts.append(
                {
                    "documentId": document_id,
                    "sourceManifest": str(manifest_path),
                    "sourceManifestSha256": _sha256_bytes(manifest_path.read_bytes()),
                    "sourceArtifact": source_artifact_ref,
                    "sourceArtifactSha256": source_artifact_sha,
                    "textArtifact": str(text_path),
                    "textArtifactSha256": _sha256_bytes(text_path.read_bytes()),
                }
            )

        return {
            "version": version,
            "sourceManifest": {
                "reviewRequired": False,
                "trustPolicy": OFFICIAL_SOURCE_AUTO_TRUSTED_POLICY,
                "normalizationWarnings": [],
                "materializedRelationships": [],
                "sourceArtifacts": source_artifacts,
                "partialUpdateContexts": partial_update_contexts or [],
            },
            "documents": documents,
        }

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

    def _store_corpus_recovery_artifact(
        self,
        *,
        version: str,
        payload: dict[str, Any],
        manifests: list[Path],
        partial_update_contexts: list[dict[str, Any]],
        storage_root: Path,
    ) -> None:
        """Store the full ingest payload needed to restore corpus rows."""
        write_recovery_artifact(
            "legal-corpus",
            version,
            {
                "version": version,
                "ingestPayload": payload,
                "sourceManifests": [str(path) for path in manifests],
                "partialUpdateContexts": partial_update_contexts,
            },
            storage_root=storage_root,
        )

    def _store_retrieval_index_artifact(
        self,
        *,
        version: str,
        corpus_id: str,
        payload: dict[str, Any],
        index: dict[str, Any],
        storage_root: Path,
    ) -> None:
        """Store retrieval-index metadata needed for DB rehydration."""
        write_recovery_artifact(
            "legal-retrieval-index",
            version,
            {
                "corpusVersionId": corpus_id,
                "registerPayload": payload,
                "index": index,
            },
            storage_root=storage_root,
        )

    def _store_corpus_activation_artifact(
        self,
        *,
        version: str,
        corpus_id: str,
        activation: dict[str, Any],
        storage_root: Path,
    ) -> None:
        """Store activation metadata needed for DB rehydration."""
        write_recovery_artifact(
            "legal-corpus-activation",
            version,
            {
                "corpusVersionId": corpus_id,
                "activation": activation,
            },
            storage_root=storage_root,
        )

    def _store_legal_rule_catalog_artifact(
        self,
        *,
        version: str,
        catalog: dict[str, Any],
        storage_root: Path | None,
    ) -> None:
        """Store recovered LegalRule catalog data needed after DB reset."""
        payload = {"recoveryVersion": version, "catalog": catalog}
        try:
            active_catalog = self._api_client.get_active_legal_rule_catalog()
        except Exception:
            active_catalog = None
        if isinstance(active_catalog, dict):
            payload["activeCatalog"] = active_catalog
        write_recovery_artifact(
            "legal-rule-catalog",
            str(catalog.get("version") or catalog.get("id") or version),
            payload,
            storage_root=storage_root,
        )

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

    @staticmethod
    def _source_text_path(manifest_path: Path, manifest: dict[str, Any]) -> Path:
        """Resolve the canonical text file produced by the official crawler."""
        text_file = required_manifest_string(
            manifest,
            "textFile",
            source=str(manifest_path),
        )
        text_path = manifest_path.parent / text_file
        if not text_path.is_file():
            raise RuntimeError(f"{manifest_path}: textFile does not exist: {text_file}")
        return text_path

    @staticmethod
    def _source_artifact(
        manifest_path: Path,
        manifest: dict[str, Any],
    ) -> tuple[str, str]:
        """Resolve the official source artifact and its declared hash."""
        for file_key, hash_key in (
            ("sourceFile", "sourceSha256"),
            ("htmlFile", "htmlSha256"),
            ("textFile", "textSha256"),
        ):
            value = manifest.get(file_key)
            digest = manifest.get(hash_key)
            if not isinstance(value, str) or not value.strip():
                continue
            path = manifest_path.parent / value
            if not path.is_file():
                continue
            if isinstance(digest, str) and digest.strip():
                return value, digest.strip()
            return value, _sha256_bytes(path.read_bytes())
        raise RuntimeError(f"{manifest_path}: no source artifact is available")

    def _corpus_version(self, manifests: list[Path]) -> str:
        """Derive a content-addressed corpus version from crawl artifacts."""
        digest = hashlib.sha256()
        for path in sorted(manifests):
            digest.update(path.read_bytes())
            manifest = json.loads(path.read_text(encoding="utf-8"))
            digest.update(self._source_text_path(path, manifest).read_bytes())
        return f"{DEFAULT_VERSION_PREFIX}-{digest.hexdigest()[:16]}"

    def _resolve_storage_root(self, message: dict[str, Any]) -> Path:
        """Resolve the runtime corpus artifact root used by crawl/recovery."""
        raw = message.get("storageRoot")
        if isinstance(raw, str) and raw.strip():
            return Path(raw.strip()).resolve()
        raw_env = os.getenv("LEGAL_SOURCE_STORAGE_ROOT")
        if raw_env and raw_env.strip():
            return Path(raw_env.strip()).resolve()
        return Path(default_legal_source_storage_root()).resolve()


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


def required_manifest_string(values: dict[str, Any], key: str, source: str) -> str:
    """Read a required non-empty string from a local crawl manifest."""
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


def _source_crawl_requests(message: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize recovery-command crawl requests into bounded request objects."""
    value = message.get("sourceCrawlRequests", message.get("source_crawl_requests"))
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


def _load_script_module(filename: str):
    """Load an AO-6 corpus build/orchestration script from the legal source tools."""
    path = Path(__file__).resolve().parents[1] / "scripts" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load AO-6 script: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _worker_root() -> Path:
    """Return the root directory of the Managed Agent package/project."""
    return Path(__file__).resolve().parents[5]


def _sha256_text(value: str) -> str:
    """Return a tagged SHA-256 digest for deterministic text configuration."""
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()}"


def _sha256_bytes(value: bytes) -> str:
    """Return a tagged SHA-256 digest for source artifact bytes."""
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _sha256_json(value: Any) -> str:
    """Return a tagged SHA-256 digest for canonical sorted JSON content."""
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True).encode()
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _safe_ref(value: str) -> str:
    """Normalize a bounded identifier for validation/integrity manifest references."""
    return "".join(ch if ch.isalnum() or ch in "._:-" else "-" for ch in value)[:128]


@contextmanager
def _exclusive_recovery_lock(storage_root: Path) -> Iterator[None]:
    """Serialize corpus recovery on one repo/core so waiting runs share one rebuild."""
    lock_dir = storage_root / "locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    lock_path = lock_dir / RECOVERY_LOCK_FILE
    ensure_lock_file(lock_path)
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        acquire_exclusive_lock(lock_file)
        try:
            yield
        finally:
            release_file_lock(lock_file)
