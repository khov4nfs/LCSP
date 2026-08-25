"""Bounded implementation for the legal-catalog maintenance tool.

Only approved source manifests are discovered from the corpus store.  Agent
input cannot add source URLs or bypass the governed recovery pipeline.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from uuid import uuid4

from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.legal.corpus.partial_update.partial_update_context_builder import (
    build_partial_update_context,
)
from tools.legal.sources.recovery.legal_corpus_recovery_driver import LegalCorpusRecoveryDriver
from tools.legal.sources.scripts.crawl_vbpl_document import VbplDocumentCrawler


class MaintainLegalCatalogService:
    """Refresh approved sources and recover changed legal corpus artifacts."""

    def __init__(self, *, api_client: WorkerApiClient | None = None) -> None:
        self.storage_root = Path(
            os.getenv("LEGAL_SOURCE_STORAGE_ROOT", ".corpus")
        ).resolve()
        self.api_client = api_client or WorkerApiClient(
            os.environ["NESTJS_API_BASE_URL"],
            os.environ["WORKER_API_KEY"],
        )

    def run(self, *, max_runs: int = 500, correlation_id: str | None = None) -> dict[str, Any]:
        """Crawl approved manifests and recover only changed documents."""
        manifests = sorted(
            path
            for path in (self.storage_root / "source-crawl").glob("**/*.source.json")
            if path.is_file()
        )
        if not manifests:
            return {
                "status": "NEEDS_INPUT",
                "changed": False,
                "changedDocuments": [],
                "affectedRuleIds": [],
                "limitations": ["NO_APPROVED_SOURCE_MANIFESTS"],
            }

        changed_documents: list[str] = []
        affected_rule_ids: list[str] = []
        partial_contexts: list[dict[str, Any]] = []
        limitations: list[str] = []

        for manifest_path in manifests:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            document_id = str(manifest.get("documentId") or "").strip()
            source_url = str(manifest.get("sourceUrl") or "").strip()
            gateway_id = str(manifest.get("gatewayDocumentId") or "").strip()
            html_file = str(manifest.get("htmlFile") or "").strip()
            if not document_id or not source_url or not gateway_id or not html_file:
                limitations.append(f"UNSUPPORTED_OR_INCOMPLETE_SOURCE:{manifest_path.name}")
                continue

            old_html_path = manifest_path.parent / html_file
            if not old_html_path.is_file():
                limitations.append(f"MISSING_BASE_SOURCE:{document_id}")
                continue
            old_html = old_html_path.read_text(encoding="utf-8")

            with TemporaryDirectory(prefix="lcsp-legal-refresh-") as tmp:
                temp_dir = Path(tmp)
                refreshed_manifest_path = VbplDocumentCrawler().create_snapshot(
                    document_id=document_id,
                    gateway_document_id=gateway_id,
                    source_url=source_url,
                    output_dir=temp_dir,
                )
                refreshed = json.loads(refreshed_manifest_path.read_text(encoding="utf-8"))
                if refreshed.get("htmlSha256") == manifest.get("htmlSha256"):
                    continue

                new_html_path = temp_dir / str(refreshed["htmlFile"])
                new_html = new_html_path.read_text(encoding="utf-8")
                context = build_partial_update_context(
                    document_id=document_id,
                    source_url=source_url,
                    base_snapshot_ref=f"source-manifest:{manifest.get('htmlSha256')}",
                    new_snapshot_ref=f"source-manifest:{refreshed.get('htmlSha256')}",
                    old_html=old_html,
                    new_html=new_html,
                )
                if context is None:
                    limitations.append(f"CHANGE_WITHOUT_PARTIAL_CONTEXT:{document_id}")
                    continue

                for artifact in temp_dir.iterdir():
                    if artifact.is_file():
                        shutil.copy2(artifact, manifest_path.parent / artifact.name)

                payload = context.to_dict()
                partial_contexts.append(payload)
                changed_documents.append(document_id)
                affected_rule_ids.extend(
                    str(value)
                    for value in (payload.get("affectedRuleIds") or [])
                    if str(value).strip()
                )

        if not changed_documents:
            return {
                "status": "READY" if not limitations else "PARTIAL",
                "changed": False,
                "changedDocuments": [],
                "affectedRuleIds": [],
                "partialUpdateContexts": [],
                "limitations": limitations,
            }

        idempotency_key = f"legal-triage-{uuid4()}"
        recovery = LegalCorpusRecoveryDriver(api_client=self.api_client).run(
            {
                "idempotencyKey": idempotency_key,
                "storageRoot": str(self.storage_root),
                "maxRuns": max(0, min(int(max_runs), 500)),
            },
            correlation_id or idempotency_key,
        )
        return {
            "status": str(recovery.get("status") or "READY"),
            "changed": True,
            "changedDocuments": list(dict.fromkeys(changed_documents)),
            "affectedRuleIds": list(dict.fromkeys(affected_rule_ids)),
            "partialUpdateContexts": partial_contexts,
            "corpusVersionId": recovery.get("corpusVersionId"),
            "legalRuleCatalogVersionId": recovery.get("legalRuleCatalogVersionId"),
            "resumedRunCount": recovery.get("resumedRunCount", 0),
            "engineeringRuleUpdateMode": "AFFECTED_CHUNK_FINGERPRINT",
            "limitations": limitations,
        }
