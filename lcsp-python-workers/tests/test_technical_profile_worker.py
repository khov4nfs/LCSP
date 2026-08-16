from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from lcsp_workers.intelligence.evidence_quality_evaluator import (
    EVIDENCE_QUALITY_HIGH,
    EVIDENCE_QUALITY_INSUFFICIENT,
    EVIDENCE_QUALITY_LOW,
    EVIDENCE_QUALITY_MEDIUM,
    EvidenceQualityEvaluator,
)
from lcsp_workers.intelligence.technical_profile_builder import (
    PrivacyAssertionError,
    TechnicalProfileBuilder,
)
from lcsp_workers.intelligence.technical_profile_consumer import (
    TechnicalProfileConsumer,
)
from lcsp_workers.platform.config import WorkerConfig
from lcsp_workers.platform.callback_schemas import TechnicalProfileCallbackPayload


def _evidence_report(
    *,
    evidence_report_id: str = "ter-1",
    scan_job_id: str = "scan-job-1",
    assessment_id: str = "assessment-1",
    organization_id: str = "org-1",
    status: str = "accepted",
    tool_failures: list[dict] | None = None,
    ai_usage_signals: list[dict] | None = None,
    sbom_entries: list[dict] | None = None,
    coverage_notes: list[str] | None = None,
    privacy_flags: dict | None = None,
) -> dict:
    return {
        "id": evidence_report_id,
        "scan_job_id": scan_job_id,
        "assessment_id": assessment_id,
        "organization_id": organization_id,
        "status": status,
        "tools_version": {
            "syft": "syft v1.0.0",
            "semgrep_ai_usage": "semgrep 1.99.0",
            "semgrep_secret_detect": "semgrep 1.99.0",
        },
        "evidence_payload": {
            "sbom_entries": sbom_entries
            if sbom_entries is not None
            else [
                {
                    "name": "openai",
                    "version": "1.59.3",
                    "ecosystem": "pypi",
                    "location": "requirements.txt",
                    "purl": "pkg:pypi/openai@1.59.3",
                }
            ],
            "ai_usage_signals": ai_usage_signals
            if ai_usage_signals is not None
            else [
                {
                    "rule_id": "lcsp.model-call",
                    "signal_type": "model_call",
                    "file_path": "src/ai.py",
                    "line_start": 12,
                    "line_end": 12,
                    "message": "LLM model invocation detected",
                    "severity": "WARNING",
                },
                {
                    "rule_id": "lcsp.openai-client",
                    "signal_type": "provider_integration",
                    "file_path": "src/ai.py",
                    "line_start": 1,
                    "line_end": 1,
                    "message": "OpenAI client integration detected",
                    "severity": "INFO",
                },
            ],
            "tool_failures": list(tool_failures or []),
            "coverage_notes": list(coverage_notes or []),
        },
        "privacy_flags": privacy_flags
        if privacy_flags is not None
        else {"containsSourceCode": False, "secretsRedacted": True},
    }


def _config() -> WorkerConfig:
    return WorkerConfig(
        rabbitmq_url="amqp://guest:guest@localhost/",
        rabbitmq_exchange="test.events",
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )


@pytest.mark.p0
def test_t01_evidence_with_ai_signals_builds_high_quality_profile() -> None:
    profile = TechnicalProfileBuilder(provider_version="test-worker").build(
        _evidence_report()
    )

    assert profile.evidence_quality == EVIDENCE_QUALITY_HIGH
    assert profile.ai_usage_signal_count == 2
    assert profile.signal_types_detected == ["model_call", "provider_integration"]
    assert profile.dependency_ai_packages == ["openai"]
    assert profile.provider_version == "test-worker"


@pytest.mark.p0
def test_t02_evidence_with_no_ai_signals_is_low_quality() -> None:
    profile = TechnicalProfileBuilder().build(
        _evidence_report(ai_usage_signals=[], sbom_entries=[])
    )

    assert profile.evidence_quality == EVIDENCE_QUALITY_LOW
    assert profile.ai_usage_signal_count == 0
    assert profile.signal_types_detected == []


@pytest.mark.p0
def test_t03_syft_failed_semgrep_passed_is_medium_quality() -> None:
    profile = TechnicalProfileBuilder().build(
        _evidence_report(
            tool_failures=[
                {
                    "tool_name": "syft",
                    "tool_version": "syft v1.0.0",
                    "outcome": "tool_failure",
                    "messages": ["failed safely"],
                }
            ]
        )
    )

    assert profile.evidence_quality == EVIDENCE_QUALITY_MEDIUM
    assert profile.tool_coverage["syft"] is False
    assert profile.tool_coverage["semgrep"] is True


@pytest.mark.p0
def test_t04_all_critical_tools_failed_is_insufficient() -> None:
    profile = TechnicalProfileBuilder().build(
        _evidence_report(
            ai_usage_signals=[],
            tool_failures=[
                {"tool_name": "syft", "tool_version": "x", "outcome": "tool_failure"},
                {
                    "tool_name": "semgrep_ai_usage",
                    "tool_version": "x",
                    "outcome": "tool_failure",
                },
                {
                    "tool_name": "semgrep_secret_detect",
                    "tool_version": "x",
                    "outcome": "tool_failure",
                },
            ],
        )
    )

    assert profile.evidence_quality == EVIDENCE_QUALITY_INSUFFICIENT


@pytest.mark.p0
def test_t05_dependency_ai_packages_are_names_only_from_sbom() -> None:
    profile = TechnicalProfileBuilder().build(
        _evidence_report(
            sbom_entries=[
                {"name": "openai", "version": "1.59.3"},
                {"name": "requests", "version": "2.32.3"},
                {"name": "llama-index", "version": "0.12.0"},
            ]
        )
    )

    assert profile.dependency_ai_packages == ["llama-index", "openai"]
    assert all("@" not in package for package in profile.dependency_ai_packages)


@pytest.mark.p0
def test_t06_privacy_flags_asserted_before_callback_payload() -> None:
    profile = TechnicalProfileBuilder().build(_evidence_report())
    payload = TechnicalProfileCallbackPayload(
        evidence_report_id=profile.evidence_report_id,
        assessment_id=profile.assessment_id,
        schema_version=profile.schema_version,
        provider_version=profile.provider_version,
        profile_data=profile.to_profile_data(),
        privacy_flags=profile.privacy_flags,
        scan_job_id="scan-job-1",
    )

    assert payload.privacy_flags["containsSourceCode"] is False


@pytest.mark.p0
def test_t06_contains_source_code_privacy_flag_blocks_profile() -> None:
    with pytest.raises(PrivacyAssertionError):
        TechnicalProfileBuilder().build(
            _evidence_report(
                privacy_flags={"containsSourceCode": True, "secretsRedacted": True}
            )
        )


@pytest.mark.p0
def test_t07_builder_makes_no_llm_calls() -> None:
    with patch("httpx.post") as http_post, patch("httpx.get") as http_get:
        TechnicalProfileBuilder().build(_evidence_report())

    http_post.assert_not_called()
    http_get.assert_not_called()


@pytest.mark.p0
def test_consumer_fetches_accepted_evidence_and_posts_callback() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_evidence_report.return_value = _evidence_report()
    consumer = TechnicalProfileConsumer(_config(), api_client=api_client)

    consumer.handle({"evidenceReportId": "ter-1"}, correlationId="corr-1")

    api_client.get_accepted_technical_evidence_report.assert_called_once_with("ter-1")
    api_client.post_technical_profile_callback.assert_called_once()
    payload = api_client.post_technical_profile_callback.call_args.args[0]
    assert payload.evidence_report_id == "ter-1"
    assert payload.privacy_flags["containsSourceCode"] is False
    assert payload.profile_data["external_integrations"] == []
    assert payload.profile_data["engineering_investigation"]["claims"] == []
    assert payload.profile_data["profile_data_ref"]


@pytest.mark.p0
def test_get_accepted_technical_profile_resolves_file_ref() -> None:
    import os
    import json
    from lcsp_workers.platform.api_client import WorkerApiClient
    
    ref_path = "/tmp/lcsp-technical-profile-data-mock-ter.json"
    mock_full_data = {
        "external_integrations": [{"nodeId": "node-1"}],
        "business_actions": [{"nodeId": "node-2"}],
        "dependency_licenses": [],
        "engineering_investigation": {"claims": [{"claim_id": "claim-1"}]}
    }
    with open(ref_path, "w") as f:
        json.dump(mock_full_data, f)
        
    client = WorkerApiClient("http://api.test", "test-key")
    client._get_with_retry = MagicMock(return_value={
        "status": "accepted",
        "profile_data_ref": ref_path,
        "external_integrations": [],
        "business_actions": [],
        "dependency_licenses": [],
        "engineering_investigation": {"claims": []}
    })
    
    resolved = client.get_accepted_technical_profile("profile-1")
    assert resolved["external_integrations"] == [{"nodeId": "node-1"}]
    assert resolved["business_actions"] == [{"nodeId": "node-2"}]
    assert resolved["engineering_investigation"]["claims"] == [{"claim_id": "claim-1"}]
    
    try:
        os.remove(ref_path)
    except Exception:
        pass


@pytest.mark.p0
def test_consumer_rejects_non_accepted_report_before_callback() -> None:
    api_client = MagicMock()
    api_client.get_accepted_technical_evidence_report.return_value = _evidence_report(
        status="rejected"
    )
    consumer = TechnicalProfileConsumer(_config(), api_client=api_client)

    with pytest.raises(ValueError, match="accepted"):
        consumer.handle({"evidenceReportId": "ter-1"}, correlationId="corr-1")

    api_client.post_technical_profile_callback.assert_not_called()


@pytest.mark.p0
def test_evaluator_exposes_tool_coverage_for_missing_tools() -> None:
    result = EvidenceQualityEvaluator().evaluate(
        tools_version={"syft": "syft v1.0.0"},
        tool_failures=[],
        ai_usage_signals=[{"signal_type": "model_call"}],
        coverage_notes=[],
    )

    assert result.tool_coverage["syft"] is True
    assert result.tool_coverage["semgrep"] is False
    assert result.evidence_quality == EVIDENCE_QUALITY_MEDIUM
