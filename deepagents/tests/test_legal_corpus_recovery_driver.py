import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from tools.legal.sources.recovery.legal_corpus_recovery_driver import LegalCorpusRecoveryDriver
from tools.legal.sources.recovery import legal_corpus_recovery_driver


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


class FakeSourceCrawlDispatcher:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def dispatch(self, tool_name: str, **kwargs):
        self.calls.append((tool_name, kwargs))
        if tool_name == "activate_validated_corpus_version":
            return {"status": "APPROVED"}
        Path(kwargs["output_dir"]).mkdir(parents=True, exist_ok=True)
        manifest = raw_source_manifest(
            Path(kwargs["output_dir"]),
            str(kwargs["document_id"]),
            "Điều 1. Test\n1. Nội dung\n",
        )
        return SimpleNamespace(manifest_path=manifest)


def test_recovery_driver_ingests_indexes_activates_and_resumes(
    tmp_path: Path,
    monkeypatch,
):
    api_client = FakeApiClient()
    dispatcher = FakeSourceCrawlDispatcher()
    driver = LegalCorpusRecoveryDriver(
        api_client=api_client,
        legal_dispatcher=dispatcher,
    )
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "maxRuns": 25,
            "storageRoot": str(tmp_path / ".corpus"),
            "sourceCrawlRequests": [
                {
                    "documentId": "LAW-TEST",
                    "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
                    "sourceUrl": "https://vbpl.vn/test",
                }
            ],
        },
        "corr-1",
    )

    assert result["status"] == "READY"
    assert result["corpusVersionId"] == "corpus-1"
    assert [name for name, _payload in api_client.calls] == [
        "ingest",
        "register_index",
        "recover_rules",
        "resume",
    ]
    ingest_payload = api_client.calls[0][1]
    assert isinstance(ingest_payload, dict)
    assert ingest_payload["sourceManifest"]["reviewRequired"] is False
    assert (
        ingest_payload["sourceManifest"]["trustPolicy"]
        == "OFFICIAL_SOURCE_AUTO_TRUSTED"
    )
    assert "reviewSignoff" not in ingest_payload["sourceManifest"]
    assert dispatcher.calls[-1][0] == "activate_validated_corpus_version"
    artifact_root = tmp_path / ".corpus" / "recovery-artifacts"
    assert list((artifact_root / "legal-corpus").glob("VN-LEGAL-CORPUS-*.json"))
    assert list(
        (artifact_root / "legal-retrieval-index").glob("VN-LEGAL-CORPUS-*.json")
    )
    assert list(
        (artifact_root / "legal-corpus-activation").glob("VN-LEGAL-CORPUS-*.json")
    )
    assert list((artifact_root / "legal-rule-catalog").glob("*.json"))


def test_recovery_driver_skips_validation_activation_when_corpus_unchanged(
    tmp_path: Path,
    monkeypatch,
):
    api_client = FakeApiClient(
        ingest_response={
            "id": "corpus-active",
            "version": "VN-LEGAL-CORPUS-existing",
            "status": "APPROVED",
            "noChanges": True,
            "changeSet": {
                "mode": "NO_CHANGES",
                "changedChunkIds": [],
            },
        }
    )
    dispatcher = FakeSourceCrawlDispatcher()
    driver = LegalCorpusRecoveryDriver(
        api_client=api_client,
        legal_dispatcher=dispatcher,
    )
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "maxRuns": 25,
            "storageRoot": str(tmp_path / ".corpus"),
            "sourceCrawlRequests": [
                {
                    "documentId": "LAW-TEST",
                    "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
                    "sourceUrl": "https://vbpl.vn/test",
                }
            ],
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
    assert [name for name, _payload in dispatcher.calls] == [
        "fetch_official_source_snapshot",
    ]


def test_recovery_driver_does_not_fallback_to_repository_reports(tmp_path: Path) -> None:
    driver = LegalCorpusRecoveryDriver(api_client=FakeApiClient())

    with pytest.raises(RuntimeError, match="sourceCrawlRequests"):
        driver.run(
            {
                "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
                "storageRoot": str(tmp_path / ".corpus"),
            },
            "corr-1",
        )


def test_recovery_driver_runs_source_crawl_pipeline_when_manifests_are_missing(
    tmp_path: Path,
    monkeypatch,
) -> None:
    storage_root = tmp_path / ".corpus"
    api_client = FakeApiClient()
    dispatcher = FakeSourceCrawlDispatcher()
    driver = LegalCorpusRecoveryDriver(
        api_client=api_client,
        legal_dispatcher=dispatcher,
    )
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "storageRoot": str(storage_root),
            "sourceCrawlRequests": [
                {
                    "documentId": "LAW-TEST",
                    "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
                    "sourceUrl": "https://vbpl.vn/test",
                    "gatewayDocumentId": "123",
                    "expectedDocumentNumber": "1/2026/QH15",
                    "maxBytes": 1024,
                }
            ],
        },
        "corr-1",
    )

    assert result["status"] == "READY"
    assert [name for name, _payload in api_client.calls] == [
        "ingest",
        "register_index",
        "recover_rules",
        "resume",
    ]
    assert len(dispatcher.calls) == 2
    tool_name, crawl_payload = dispatcher.calls[0]
    assert tool_name == "fetch_official_source_snapshot"
    assert crawl_payload["document_id"] == "LAW-TEST"
    assert crawl_payload["catalog_source_ref"] == "catalog-source:vbpl.vn:law:law-test"
    assert crawl_payload["gateway_document_id"] == "123"
    assert crawl_payload["max_bytes"] == 1024
    assert crawl_payload["output_dir"] == (
        storage_root / "source-crawl" / "corpus-recovery" / "LAW-TEST"
    )
    assert dispatcher.calls[1][0] == "activate_validated_corpus_version"
    generated_manifest = (
        storage_root
        / "source-crawl"
        / "corpus-recovery"
        / "LAW-TEST"
        / "LAW-TEST.source.json"
    )
    manifest = json.loads(generated_manifest.read_text(encoding="utf-8"))
    assert "reviewPolicy" not in manifest
    assert "reviewedTextFile" not in manifest
    assert "hierarchyReviewFile" not in manifest
    assert not list(generated_manifest.parent.glob("*.reviewed.txt"))
    assert not list(generated_manifest.parent.glob("*.hierarchy-review.json"))
    ingest_payload = api_client.calls[0][1]
    assert isinstance(ingest_payload, dict)
    assert ingest_payload["sourceManifest"]["reviewRequired"] is False
    assert (
        ingest_payload["sourceManifest"]["trustPolicy"]
        == "OFFICIAL_SOURCE_AUTO_TRUSTED"
    )
    assert "reviewSignoff" not in ingest_payload["sourceManifest"]


def test_recovery_driver_adds_partial_update_context_after_crawl_compare(
    tmp_path: Path,
    monkeypatch,
) -> None:
    storage_root = tmp_path / ".corpus"
    old_dir = storage_root / "source-crawl" / "corpus-active" / "LAW-TEST"
    old_dir.mkdir(parents=True)
    raw_source_manifest(
        old_dir,
        "LAW-TEST",
        "Điều 1. Test\n1. Nội dung cũ\n",
        html="<html>old</html>",
        html_sha="sha256:old",
    )
    api_client = FakeApiClient()
    dispatcher = FakeSourceCrawlDispatcher()
    driver = LegalCorpusRecoveryDriver(
        api_client=api_client,
        legal_dispatcher=dispatcher,
    )
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)
    monkeypatch.setattr(
        legal_corpus_recovery_driver,
        "build_partial_update_context",
        lambda **_kwargs: SimpleNamespace(
            to_json=lambda: json.dumps(
                {
                    "documentId": "LAW-TEST",
                    "sourceUrl": "https://vbpl.vn/test",
                    "baseSnapshotRef": "source-manifest:sha256:old",
                    "newSnapshotRef": "source-manifest:sha256:new",
                    "changedLocators": ["art-1"],
                    "observations": [{"locator": "art-1", "effect": "AMENDED"}],
                }
            )
        ),
    )

    driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "storageRoot": str(storage_root),
            "sourceCrawlRequests": [
                {
                    "documentId": "LAW-TEST",
                    "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
                    "sourceUrl": "https://vbpl.vn/test",
                }
            ],
        },
        "corr-1",
    )

    ingest_payload = api_client.calls[0][1]
    assert isinstance(ingest_payload, dict)
    assert ingest_payload["sourceManifest"]["partialUpdateContexts"] == [
        {
            "documentId": "LAW-TEST",
            "sourceUrl": "https://vbpl.vn/test",
            "baseSnapshotRef": "source-manifest:sha256:old",
            "newSnapshotRef": "source-manifest:sha256:new",
            "changedLocators": ["art-1"],
            "observations": [{"locator": "art-1", "effect": "AMENDED"}],
        }
    ]


def test_recovery_driver_reads_source_crawl_requests_from_environment(
    tmp_path: Path,
    monkeypatch,
) -> None:
    storage_root = tmp_path / ".corpus"
    api_client = FakeApiClient()
    dispatcher = FakeSourceCrawlDispatcher()
    driver = LegalCorpusRecoveryDriver(
        api_client=api_client,
        legal_dispatcher=dispatcher,
    )
    monkeypatch.setattr(driver, "_validate_retrieval_index", lambda *_args: None)
    monkeypatch.setenv(
        "LEGAL_SOURCE_CRAWL_REQUESTS",
        json.dumps(
            [
                {
                    "documentId": "LAW-TEST",
                    "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
                    "sourceUrl": "https://vbpl.vn/test",
                    "gatewayDocumentId": "123",
                }
            ]
        ),
    )

    result = driver.run(
        {
            "idempotencyKey": "vp-1:command.legal-corpus.recovery.requested.v1",
            "storageRoot": str(storage_root),
        },
        "corr-1",
    )

    assert result["status"] == "READY"
    assert dispatcher.calls[0][1]["document_id"] == "LAW-TEST"
    assert dispatcher.calls[0][1]["max_bytes"] == 20 * 1024 * 1024
    crawl_dir = storage_root / "source-crawl" / "corpus-recovery" / "LAW-TEST"
    assert not list(crawl_dir.glob("*.reviewed.txt"))
    assert not list(crawl_dir.glob("*.hierarchy-review.json"))


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


def raw_source_manifest(
    tmp_path: Path,
    document_id: str,
    text: str,
    *,
    html: str = "<h1>Điều 1. Test</h1><p>1. Nội dung</p>",
    html_sha: str | None = None,
) -> Path:
    html_path = tmp_path / f"{document_id}.source.html"
    text_path = tmp_path / f"{document_id}.source.txt"
    manifest_path = tmp_path / f"{document_id}.source.json"
    html_path.write_text(html, encoding="utf-8")
    text_path.write_text(text, encoding="utf-8")
    manifest_path.write_text(
        json.dumps(
            {
                "documentId": document_id,
                "title": document_id,
                "sourceUrl": "https://vbpl.vn/test",
                "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
                "gatewayDocumentId": "123",
                "htmlFile": html_path.name,
                "htmlSha256": html_sha or sha256(html.encode()),
                "textFile": text_path.name,
                "textSha256": sha256(text.encode()),
                "sourceEffectStatus": "CON_HIEU_LUC",
            }
        ),
        encoding="utf-8",
    )
    return manifest_path


def sha256(value: bytes) -> str:
    import hashlib

    return f"sha256:{hashlib.sha256(value).hexdigest()}"
