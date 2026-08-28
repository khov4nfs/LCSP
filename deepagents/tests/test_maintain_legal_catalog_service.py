import json
from pathlib import Path

from tools.triage.maintain_legal_catalog import service as maintain_service
from tools.triage.maintain_legal_catalog.service import MaintainLegalCatalogService


class FakePartialContext:
    def to_dict(self) -> dict:
        return {"affectedRuleIds": ["rule-1"]}


class FakeCrawler:
    def create_snapshot(
        self,
        *,
        document_id: str,
        gateway_document_id: str,
        source_url: str,
        output_dir: Path,
    ) -> Path:
        html_path = output_dir / f"{document_id}.source.html"
        manifest_path = output_dir / f"{document_id}.source.json"
        html_path.write_text("<html>new</html>", encoding="utf-8")
        manifest_path.write_text(
            json.dumps(
                {
                    "documentId": document_id,
                    "gatewayDocumentId": gateway_document_id,
                    "sourceUrl": source_url,
                    "htmlFile": html_path.name,
                    "htmlSha256": "sha256:new",
                }
            ),
            encoding="utf-8",
        )
        return manifest_path


def test_maintain_legal_catalog_passes_source_crawl_requests_without_resuming_assessment(
    tmp_path: Path,
    monkeypatch,
) -> None:
    storage_root = tmp_path / ".corpus"
    source_dir = storage_root / "source-crawl" / "corpus-v1" / "LAW-TEST"
    source_dir.mkdir(parents=True)
    html_path = source_dir / "LAW-TEST.source.html"
    html_path.write_text("<html>old</html>", encoding="utf-8")
    (source_dir / "LAW-TEST.source.json").write_text(
        json.dumps(
            {
                "documentId": "LAW-TEST",
                "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
                "sourceUrl": "https://vbpl.vn/test",
                "gatewayDocumentId": "123",
                "documentNumber": "1/2026/QH15",
                "sourceEffectStatus": "CON_HIEU_LUC",
                "htmlFile": html_path.name,
                "htmlSha256": "sha256:old",
            }
        ),
        encoding="utf-8",
    )
    recovery_messages: list[dict] = []
    delegated_resume_counts: list[int] = []

    class FakeRecoveryDriver:
        def __init__(self, *, api_client) -> None:
            self.api_client = api_client

        def run(self, message: dict, correlation_id: str) -> dict:
            recovery_messages.append(message)
            resume = self.api_client.resume_waiting_runs(
                "corpus-v2",
                {"maxRuns": 500, "idempotencyKey": "premature-resume"},
            )
            delegated_resume_counts.append(
                int((resume.get("result") or {}).get("resumedRunCount") or 0)
            )
            return {
                "status": "READY",
                "corpusVersionId": "corpus-v2",
                "legalRuleCatalogVersionId": "catalog-v2",
                "resumedRunCount": 99,
            }

    monkeypatch.setattr(maintain_service, "VbplDocumentCrawler", FakeCrawler)
    monkeypatch.setattr(
        maintain_service,
        "build_partial_update_context",
        lambda **_kwargs: FakePartialContext(),
    )
    monkeypatch.setattr(
        maintain_service,
        "LegalCorpusRecoveryDriver",
        FakeRecoveryDriver,
    )
    service = MaintainLegalCatalogService(api_client=object())
    service.storage_root = storage_root

    result = service.run(max_runs=25, correlation_id="corr-1")

    assert result["status"] == "READY"
    assert result["resumedRunCount"] == 0
    assert result["assessmentResumeDeferred"] is True
    assert delegated_resume_counts == [0]
    assert recovery_messages[0]["maxRuns"] == 0
    assert recovery_messages[0]["sourceCrawlRequests"] == [
        {
            "documentId": "LAW-TEST",
            "catalogSourceRef": "catalog-source:vbpl.vn:law:law-test",
            "sourceUrl": "https://vbpl.vn/test",
            "gatewayDocumentId": "123",
            "sourceEffectStatus": "CON_HIEU_LUC",
            "expectedDocumentNumber": "1/2026/QH15",
        }
    ]
