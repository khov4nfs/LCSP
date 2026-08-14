import json
from pathlib import Path

from lcsp_workers.legal.legal_corpus_recovery_driver import LegalCorpusRecoveryDriver


class FakeApiClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def ingest_validated_legal_corpus_draft(self, payload: dict) -> dict:
        self.calls.append(("ingest", payload))
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
        "resume",
    ]


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
