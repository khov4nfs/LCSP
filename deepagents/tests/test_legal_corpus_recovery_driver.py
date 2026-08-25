import json
from pathlib import Path

import pytest

from tools.legal.sources.recovery.legal_corpus_recovery_driver import LegalCorpusRecoveryDriver


class FakeApiClient:
    def __init__(self, *, ingest_response: dict | None = None) -> None:
        self.calls: list[tuple[str, object]] = []
        self.ingest_response = ingest_response

    def ingest_validated_legal_corpus_draft(self, payload: dict) -> dict:
        self.calls.append(("ingest", payload))
        if self.ingest_response is not None:
            return self.ingest_response
        return {"id": "corpus-1", "status": "DRAFT"}

    def register_validated_retrieval_index(
        self, corpus_version_id: str, payload: dict
    ) -> dict:
        self.calls.append(("register_index", (corpus_version_id, payload)))
        return {
            "id": "index-1",
            "validationManifestRef": payload["validationManifestRef"],
        }

    def activate_validated_corpus_version(
        self, corpus_version_id: str, payload: dict
    ) -> dict:
        self.calls.append(("activate", (corpus_version_id, payload)))
        return {
            "artifactVersions": {"corpusVersionId": corpus_version_id},
            "status": "APPROVED",
        }

    def resume_waiting_runs(self, corpus_version_id: str, payload: dict) -> dict:
        self.calls.append(("resume", (corpus_version_id, payload)))
        return {"result": {"resumedRunCount": 1}}

    def recover_legal_rules_from_active_corpus(self, payload: dict) -> dict:
        self.calls.append(("recover_rules", payload))
        return {
            "id": "catalog-1",
            "status": "APPROVED",
            "ruleCount": 3,
            "corpusVersionId": "corpus-1",
        }


def test_recovery_driver_ingests_indexes_activates_and_resumes(
    tmp_path: Path,
    monkeypatch,
):
    manifest = reviewed_manifest(tmp_path, "LAW-TEST", "Điều 1. Test\n")
    api_client = FakeApiClient()
    driver = LegalCorpusRecoveryDriver(
        api_client=api_client,
        source_manifest_paths=[manifest],
        reviewed_dir=tmp_path,
    )
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "maxRuns": 25,
        },
        "corr-1",
    )

    assert result["status"] == "READY"
    assert result["corpusVersionId"] == "corpus-1"
    assert [name for name, _payload in api_client.calls] == [
        "ingest",
        "register_index",
        "activate",
        "recover_rules",
        "resume",
    ]


def test_recovery_driver_skips_validation_activation_when_corpus_unchanged(
    tmp_path: Path,
    monkeypatch,
):
    manifest = reviewed_manifest(tmp_path, "LAW-TEST", "Điều 1. Test\n")
    api_client = FakeApiClient(
        ingest_response={
            "id": "corpus-active",
            "version": "VN-LEGAL-AO6-existing",
            "status": "APPROVED",
            "noChanges": True,
            "changeSet": {
                "mode": "NO_CHANGES",
                "changedChunkIds": [],
            },
        }
    )
    driver = LegalCorpusRecoveryDriver(
        api_client=api_client,
        source_manifest_paths=[manifest],
        reviewed_dir=tmp_path,
    )
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "maxRuns": 25,
        },
        "corr-1",
    )

    assert result["noChanges"] is True
    assert result["corpusVersionId"] == "corpus-active"
    assert result["legalRuleCatalogVersionId"] == "catalog-1"
    assert result["legalRuleCount"] == 3
    assert result["resumedRunCount"] == 1
    assert [name for name, _payload in api_client.calls] == [
        "ingest",
        "recover_rules",
        "resume",
    ]


def test_recovery_driver_uses_runtime_crawl_artifacts_from_message(
    tmp_path: Path,
    monkeypatch,
) -> None:
    manifest = reviewed_manifest(tmp_path, "LAW-TEST", "Điều 1. Test\n")
    api_client = FakeApiClient()
    driver = LegalCorpusRecoveryDriver(api_client=api_client)
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "sourceManifestPaths": [str(manifest)],
            "reviewedDir": str(tmp_path),
        },
        "corr-1",
    )

    assert result["status"] == "READY"
    assert [name for name, _payload in api_client.calls] == [
        "ingest",
        "register_index",
        "activate",
        "recover_rules",
        "resume",
    ]


def test_recovery_driver_discovers_runtime_crawl_artifacts_from_corpus_store(
    tmp_path: Path,
    monkeypatch,
) -> None:
    storage_root = tmp_path / ".corpus"
    artifact_dir = storage_root / "source-crawl" / "corpus-draft" / "LAW-TEST"
    artifact_dir.mkdir(parents=True)
    reviewed_manifest(artifact_dir, "LAW-TEST", "Điều 1. Test\n")
    api_client = FakeApiClient()
    driver = LegalCorpusRecoveryDriver(api_client=api_client)
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "storageRoot": str(storage_root),
        },
        "corr-1",
    )

    assert result["status"] == "READY"
    assert (storage_root / "locks" / "legal-corpus-recovery.lock").is_file()
    assert [name for name, _payload in api_client.calls] == [
        "ingest",
        "register_index",
        "activate",
        "recover_rules",
        "resume",
    ]


def test_recovery_driver_does_not_fallback_to_repository_reports(tmp_path: Path) -> None:
    driver = LegalCorpusRecoveryDriver(api_client=FakeApiClient())

    with pytest.raises(RuntimeError, match="source manifests from the crawl pipeline"):
        driver.run(
            {
                "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
                "storageRoot": str(tmp_path / ".corpus"),
            },
            "corr-1",
        )


def test_recovery_driver_can_recover_rules_from_active_corpus_without_artifacts(
    tmp_path: Path,
) -> None:
    api_client = FakeApiClient()
    driver = LegalCorpusRecoveryDriver(api_client=api_client)

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "storageRoot": str(tmp_path / ".corpus"),
            "recoverLegalRulesOnly": True,
            "maxRuns": 0,
        },
        "corr-1",
    )

    assert result["status"] == "READY"
    assert result["legalRuleOnly"] is True
    assert result["legalRuleCatalogVersionId"] == "catalog-1"
    assert result["legalRuleCount"] == 3
    assert [name for name, _payload in api_client.calls] == ["recover_rules"]


def reviewed_manifest(tmp_path: Path, document_id: str, text: str) -> Path:
    text_path = tmp_path / f"{document_id}.reviewed.txt"
    review_path = tmp_path / f"{document_id}.hierarchy-review.json"
    manifest_path = tmp_path / f"{document_id}.source.json"
    snapshot_path = tmp_path / f"{document_id}.pdf"
    text_path.write_text(text, encoding="utf-8")
    snapshot_path.write_bytes(f"pdf:{document_id}".encode())
    source_sha = sha256(snapshot_path.read_bytes())
    review_path.write_text(
        json.dumps(
            {
                "documentId": document_id,
                "reviewState": "APPROVED",
                "reviewedBy": "admin-catalog-validator",
                "reviewedAt": "2026-08-14T00:00:00.000Z",
                "reviewedTextSha256": sha256(text.encode()),
                "reviewedSourceSha256": source_sha,
                "sourceReview": {
                    "sourceSnapshotReviewed": snapshot_path.name,
                    "canonicalSourceUrl": "https://vbpl.vn/test",
                },
                "reviewScope": {"fullTextReviewedLocators": ["art-1"]},
                "chapters": [],
            }
        ),
        encoding="utf-8",
    )
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": document_id,
                "title": document_id,
                "sourceUrl": "https://vbpl.vn/test",
                "sourceSha256": source_sha,
                "sourceEffectStatus": "CON_HIEU_LUC",
                "reviewedTextFile": text_path.name,
                "hierarchyReviewFile": review_path.name,
            }
        ),
        encoding="utf-8",
    )
    return manifest_path


def sha256(value: bytes) -> str:
    import hashlib

    return f"sha256:{hashlib.sha256(value).hexdigest()}"
