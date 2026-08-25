import os
import json
import shutil
from unittest.mock import MagicMock

from tools.common.capabilities.platform.artifact_storage import ArtifactStorage
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.callback_schemas import TechnicalProfileCallbackPayload


def test_artifact_storage_chunking() -> None:
    from tools.common.capabilities.platform.logging_path import get_repo_root

    storage_path = os.path.join(get_repo_root(), "tmp", "lcsp-storage-test-python")
    storage = ArtifactStorage(storage_path=storage_path)

    payload = {
        "hello": "world",
        "data": "A" * 1000,
    }

    manifest = storage.write_payload_chunks(payload, chunk_size=200)

    assert manifest["total_size"] > 0
    assert len(manifest["chunks"]) >= 5
    assert manifest["hash"]

    reconstructed_bytes = b""
    for chunk_id in manifest["chunks"]:
        chunk_path = os.path.join(storage.chunks_path, chunk_id)
        with open(chunk_path, "rb") as file_handle:
            reconstructed_bytes += file_handle.read()

    reconstructed_payload = json.loads(reconstructed_bytes.decode("utf-8"))
    assert reconstructed_payload == payload

    shutil.rmtree(storage_path, ignore_errors=True)


def test_api_client_callback_chunking(monkeypatch) -> None:
    from tools.common.capabilities.platform.logging_path import get_repo_root

    client = WorkerApiClient("http://api.test", "key-123")

    mock_post = MagicMock(return_value={"success": True, "accepted": True})
    client._post_with_retry = mock_post

    monkeypatch.setenv("LCSP_PROFILE_CALLBACK_THRESHOLD", "10")
    monkeypatch.setenv("LCSP_PROFILE_CALLBACK_CHUNK_SIZE", "5")
    client_storage_path = os.path.join(
        get_repo_root(), "tmp", "lcsp-storage-test-python-client"
    )
    monkeypatch.setenv("LCSP_ARTIFACT_STORAGE_PATH", client_storage_path)

    payload = TechnicalProfileCallbackPayload(
        evidence_report_id="rep-1",
        assessment_id="ass-1",
        schema_version="2.0.0",
        provider_version="prov-1",
        privacy_flags={"containsSourceCode": False, "secretsRedacted": True},
        profile_data={"some": "large_profile_data"},
    )

    resp = client.post_technical_profile_callback(payload)

    assert resp.success is True
    mock_post.assert_called_once()
    posted_payload = mock_post.call_args.args[1]
    assert posted_payload["is_artifact_reference"] is True
    assert "artifact_manifest" in posted_payload
    assert posted_payload["artifact_manifest"]["total_size"] > 0

    shutil.rmtree(client_storage_path, ignore_errors=True)


def test_provider_failure_uses_compilation_failure_semantics() -> None:
    from tools.common.capabilities.assessment.claims.evidence_claim.models import ENGINEERING_LIMITATION_CODES
    from tools.common.capabilities.assessment.investigation.engineering_rule.pipeline import EngineeringInvestigationPipeline
    rule_service = MagicMock()
    rule_service.get_or_compile.side_effect = RuntimeError("provider failed")

    api_client = MagicMock()
    api_client.get_active_legal_rule_catalog.return_value = {
        "versionId": "cat-1",
        "rules": [
            {"id": "rule-1", "legalRuleId": "L1", "status": "APPROVED"},
            {"id": "rule-2", "legalRuleId": "L2", "status": "APPROVED"},
            {"id": "rule-3", "legalRuleId": "L3", "status": "APPROVED"},
        ],
    }
    api_client.get_active_legal_corpus.return_value = {"versionId": "corp-1"}
    api_client.get_legal_corpus_chunks.return_value = {"chunks": []}

    pipeline = EngineeringInvestigationPipeline(
        api_client=api_client,
        model="test:model",
        rule_service=rule_service,
    )

    result = pipeline.run(
        evidence_report={
            "evidence_payload": {
                "evidence_graph": {
                    "graph_id": "graph-1",
                    "graph_hash": "sha256-hash",
                    "nodes": [],
                    "edges": [],
                }
            }
        },
        workflow_run_id="workflow-1",
    )

    assert rule_service.get_or_compile.call_count == 3
    assert result.status == "BLOCKED"
    assert result.engineering_rules_executed == 0
    assert result.evaluations == ()
    assert result.limitations == (
        ENGINEERING_LIMITATION_CODES["engineering_rule_compilation_failed"],
    )
    assert all("BUDGET" not in limitation for limitation in result.limitations)
