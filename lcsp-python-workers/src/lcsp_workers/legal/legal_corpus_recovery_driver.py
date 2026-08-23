"""Rebuild, validate, activate, and resume workflows for the reviewed AO-6 legal corpus."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

import fcntl

from structlog import get_logger

from lcsp_workers.agentic_evidence.dispatcher import LegalToolDispatcher
from lcsp_workers.agentic_evidence.legal_tool_entrypoints import (
    LegalToolExecutionContext,
)
from lcsp_workers.platform.api_client import WorkerApiClient
from lcsp_workers.platform.config import default_legal_source_storage_root

logger = get_logger(__name__)

LEGAL_CORPUS_RECOVERY_COMMAND = "command.legal-corpus.recovery.requested.v1"
LEGAL_CORPUS_RECOVERY_QUEUE = "lcsp.legal-corpus-recovery.v1"
DEFAULT_VERSION_PREFIX = "VN-LEGAL-AO6"
DEFAULT_INDEX_CONFIG = "chromadb-vectorless-legal-retriever-v1"
SOURCE_CRAWL_DIR = "source-crawl"
RECOVERY_LOCK_FILE = "legal-corpus-recovery.lock"


@dataclass(frozen=True)
class LegalCorpusRecoveryResult:
    """Terminal corpus recovery identifiers and resumed workflow count."""

    status: str
    corpus_version_id: str
    retrieval_index_id: str | None
    resumed_run_count: int


class LegalCorpusRecoveryDriver:
    """Run the reviewed legal-corpus recovery pipeline with integrity validation.

    Recovery rebuilds a deterministic version from source manifests/reviewed
    artifacts, ingests the validated draft, verifies exact retrieval coverage,
    registers the retrieval index, activates the corpus, then resumes workflows
    waiting for the newly active version. Canonical AO-6 validation and activation
    are forced through ``LegalToolDispatcher`` rather than invoked directly.
    """

    def __init__(
        self,
        *,
        api_client: WorkerApiClient,
        chroma_path: str | None = None,
        source_manifest_paths: list[Path] | None = None,
        reviewed_dir: Path | None = None,
        legal_dispatcher: LegalToolDispatcher | None = None,
    ) -> None:
        """Create the recovery driver with optional storage/source overrides."""
        self._api_client = api_client
        self._chroma_path = chroma_path or os.getenv("LEGAL_CHROMA_PATH")
        self._source_manifest_paths = source_manifest_paths
        self._reviewed_dir = reviewed_dir
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
        manifests = self._resolve_source_manifests(message)
        reviewed_dir = self._resolve_reviewed_dir(message)
        builder = _load_script_module("build_reviewed_legal_corpus.py")
        orchestrator = _load_script_module("orchestrate_reviewed_legal_corpus.py")
        version = self._corpus_version(manifests, reviewed_dir)
        reviewed_dir = self._prepare_reviewed_dir(
            manifests=manifests,
            reviewed_dir=reviewed_dir,
            storage_root=self._resolve_storage_root(message),
            version=version,
        )
        payload = builder.build_payload(manifests, version, reviewed_dir=reviewed_dir)
        signoff = orchestrator.build_review_signoff(payload, reviewed_dir=reviewed_dir)
        enriched_payload = orchestrator.enrich_payload_with_signoff(payload, signoff)

        draft = self._api_client.ingest_validated_legal_corpus_draft(enriched_payload)
        corpus_id = required_response_string(draft, "id", "corpus ingest response")
        if bool(draft.get("noChanges")):
            catalog = self._recover_legal_rule_catalog(
                idempotency_key=idempotency_key,
                version=version,
                correlationId=correlationId,
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

        approved = self._legal_dispatcher.dispatch(
            "activate_validated_corpus_version",
            corpus_version_id=corpus_id,
            payload={
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
        catalog = self._recover_legal_rule_catalog(
            idempotency_key=idempotency_key,
            version=version,
            correlationId=correlationId,
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
        return response

    def _resolve_source_manifests(self, message: dict[str, Any]) -> list[Path]:
        """Resolve official-source manifests from runtime crawl artifacts."""
        if self._source_manifest_paths:
            return self._source_manifest_paths
        message_paths = message.get("sourceManifestPaths")
        if isinstance(message_paths, list):
            paths = [
                Path(str(part).strip())
                for part in message_paths
                if isinstance(part, str) and part.strip()
            ]
            if paths:
                return paths
        storage_root = self._resolve_storage_root(message)
        paths = sorted(
            path
            for path in (storage_root / SOURCE_CRAWL_DIR).glob("**/*.source.json")
            if path.is_file()
        )
        if paths:
            logger.info(
                "LEGAL_CORPUS_RECOVERY_USING_CRAWL_ARTIFACTS",
                source_manifest_count=len(paths),
                storage_root=str(storage_root),
            )
            return paths
        raise RuntimeError(
            "AO6 legal corpus recovery has no source manifests from the crawl "
            "pipeline. Provide sourceManifestPaths in the recovery command."
        )

    def _resolve_reviewed_dir(self, message: dict[str, Any]) -> Path:
        """Resolve the reviewed legal artifact directory from runtime crawl artifacts."""
        if self._reviewed_dir is not None:
            return self._reviewed_dir
        message_reviewed_dir = message.get("reviewedDir")
        if isinstance(message_reviewed_dir, str) and message_reviewed_dir.strip():
            path = Path(message_reviewed_dir.strip())
            if not path.is_dir():
                raise RuntimeError(
                    "AO6 legal corpus recovery reviewedDir does not exist: "
                    f"{message_reviewed_dir}"
                )
            return path
        storage_root = self._resolve_storage_root(message)
        crawl_root = storage_root / SOURCE_CRAWL_DIR
        if crawl_root.is_dir():
            return crawl_root
        raise RuntimeError(
            "AO6 legal corpus recovery has no reviewed artifact directory from the "
            "crawl pipeline. Provide reviewedDir in the recovery command."
        )

    def _corpus_version(self, manifests: list[Path], reviewed_dir: Path) -> str:
        """Derive a content-addressed corpus version from manifests and reviewed files."""
        digest = hashlib.sha256()
        for path in sorted(manifests):
            digest.update(path.read_bytes())
        for path in self._review_artifact_paths(manifests, reviewed_dir):
            digest.update(path.read_bytes())
        return f"{DEFAULT_VERSION_PREFIX}-{digest.hexdigest()[:16]}"

    def _review_artifact_paths(
        self,
        manifests: list[Path],
        reviewed_dir: Path,
    ) -> list[Path]:
        """Resolve reviewed artifacts declared by crawl manifests plus flat fallback files."""
        paths: list[Path] = []
        for manifest_path in sorted(manifests):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"{manifest_path}: invalid source manifest JSON"
                ) from exc
            for key in ("reviewedTextFile", "hierarchyReviewFile"):
                declared = manifest.get(key)
                if isinstance(declared, str) and declared.strip():
                    paths.append((manifest_path.parent / declared).resolve())
        paths.extend(path.resolve() for path in reviewed_dir.glob("*.reviewed.txt"))
        paths.extend(
            path.resolve() for path in reviewed_dir.glob("*.hierarchy-review.json")
        )
        return sorted(dict.fromkeys(paths))

    def _prepare_reviewed_dir(
        self,
        *,
        manifests: list[Path],
        reviewed_dir: Path,
        storage_root: Path,
        version: str,
    ) -> Path:
        """Build a flat reviewed artifact view for canonical review signoff."""
        if (
            self._reviewed_dir is not None
            or reviewed_dir != storage_root / SOURCE_CRAWL_DIR
        ):
            return reviewed_dir
        staging_dir = storage_root / "recovery-input" / _safe_ref(version)
        staging_dir.mkdir(parents=True, exist_ok=True)
        for manifest_path in manifests:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            document_id = required_manifest_string(
                manifest,
                "documentId",
                source=str(manifest_path),
            )
            for key, suffix in (
                ("reviewedTextFile", "reviewed.txt"),
                ("hierarchyReviewFile", "hierarchy-review.json"),
            ):
                declared = manifest.get(key)
                if not isinstance(declared, str) or not declared.strip():
                    continue
                source_path = (manifest_path.parent / declared).resolve()
                target_path = staging_dir / f"{document_id}.{suffix}"
                if source_path != target_path:
                    shutil.copy2(source_path, target_path)
        return staging_dir

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


def _load_script_module(filename: str):
    """Load an AO-6 corpus build/orchestration script from the worker scripts dir."""
    path = _worker_root() / "scripts" / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load AO-6 script: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _worker_root() -> Path:
    """Return the root directory of the Managed Agent package/project."""
    return Path(__file__).resolve().parents[3]


def _sha256_text(value: str) -> str:
    """Return a tagged SHA-256 digest for deterministic text configuration."""
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()}"


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
    with lock_path.open("w", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
