import json

import decision.pr_review_triage as pr_review_triage
from decision.pr_review_triage import (
    JsonlTelemetrySink,
    _packet_payload,
    _redact_persisted_value,
    _safe_domain,
    _write_safe_json,
    record_pr_review_shadow_triage_packet,
)
from decision.shadow import PrReviewTriagePacket, ShadowDecisionRecord


def _write_packet_input(tmp_path):
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(
        json.dumps(
            {
                "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_PACKET_V1",
                "packet": {
                    "pr_number": 359,
                    "head_sha": "b" * 40,
                    "base_sha": "c" * 40,
                    "changed_filenames": ["deepagents/decision/shadow.py"],
                },
            }
        ),
        encoding="utf-8",
    )
    return packet_path


def test_packet_projection_redacts_secret_like_values():
    packet = PrReviewTriagePacket(
        pr_number=56,
        head_sha="abc123",
        bounded_summary="token: ghp_123456789012345678901234567890123456",
    )

    persisted = _packet_payload(packet)

    assert "ghp_123456789012345678901234567890123456" not in json.dumps(persisted)
    assert persisted["bounded_summary"] == "[REDACTED]"


def test_jsonl_sink_redacts_sensitive_telemetry_values(tmp_path):
    sink = JsonlTelemetrySink(tmp_path / "events.jsonl")

    sink({"eventType": "test", "data": {"apiToken": "SENTINEL_TOKEN_VALUE"}})

    persisted = (tmp_path / "events.jsonl").read_text(encoding="utf-8")
    assert "SENTINEL_TOKEN_VALUE" not in persisted
    assert sink.events[0]["data"]["apiToken"] == "[REDACTED]"
    assert _redact_persisted_value({"password": "value"})["password"] == "[REDACTED]"


def test_report_writer_persists_only_bounded_packet_schema(tmp_path):
    output = tmp_path / "packet.json"
    _write_safe_json(
        output,
        {
            "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_PACKET_V1",
            "recordingStatus": "PACKET_READY_UNTRUSTED_PR_STAGE",
            "trustedRecorderRequired": True,
            "packet": {
                "pr_number": 359,
                "head_sha": "a" * 40,
                "changed_filenames": ["deepagents/decision/shadow.py"],
                "bounded_summary": "token: ghp_123456789012345678901234567890123456",
                "nested": {"authorization": "secret-sentinel"},
            },
        },
    )

    persisted = output.read_text(encoding="utf-8")
    assert "ghp_123456789012345678901234567890123456" not in persisted
    assert "secret-sentinel" not in persisted
    assert "changed_filenames" in persisted
    assert "bounded_summary" not in persisted


def test_report_projection_rejects_secret_patterns_in_allowed_scalar_fields(tmp_path):
    output = tmp_path / "record.json"
    _write_safe_json(
        output,
        {
            "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_RECORD_V1",
            "recordingStatus": "TYPED_RESULT_NOT_RECORDED_FALLBACK",
            "fallbackReason": "ghp_123456789012345678901234567890123456",
            "packet": {
                "changed_filenames": ["deepagents/ghp_123456789012345678901234567890123456.py"],
            },
        },
    )

    persisted = output.read_text(encoding="utf-8")
    assert "ghp_123456789012345678901234567890123456" not in persisted


def test_safe_domain_returns_only_approved_constants():
    approved = (
        "AUTH",
        "BILLING",
        "REPOSITORY",
        "AGENT_RUNTIME",
        "LEGAL_REQUIREMENTS",
        "CI_RELEASE",
        "WEB",
        "DATA",
        "OTHER",
    )
    assert [_safe_domain(value) for value in approved] == list(approved)
    assert _safe_domain(" AUTH ") == "OTHER"
    assert _safe_domain("ghp_123456789012345678901234567890123456") == "OTHER"
    assert _safe_domain("AUTH\u202e") == "OTHER"


def test_normal_record_persists_skipped_status_from_producer(tmp_path):
    class FakeObserver:
        def observe_pr_review_triage(self, packet, *, authoritative_domain=None):
            return ShadowDecisionRecord(
                decision_id="review-triage-v1:359:" + "b" * 40,
                decision_type="PR_REVIEW_TRIAGE",
                authoritative_action=authoritative_domain,
                shadow_proposed_action="AGENT_RUNTIME",
                agreement=True,
                confidence=0.9,
                fallback_reason=None,
                skipped=False,
            )

    output = tmp_path / "normal.json"
    result = record_pr_review_shadow_triage_packet(
        packet_path=_write_packet_input(tmp_path),
        output_path=output,
        trusted_authoritative_domain="REPOSITORY",
        observer_factory=lambda sink: FakeObserver(),
    )

    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert result["skipped"] is False
    assert persisted["skipped"] is False


def test_skipped_record_persists_skipped_status_from_producer(tmp_path):
    class FakeObserver:
        def observe_pr_review_triage(self, packet, *, authoritative_domain=None):
            return ShadowDecisionRecord(
                decision_id="review-triage-v1:359:" + "b" * 40,
                decision_type="PR_REVIEW_TRIAGE",
                authoritative_action=authoritative_domain,
                shadow_proposed_action=None,
                agreement=None,
                confidence=None,
                fallback_reason="DUPLICATE_DECISION_ID",
                skipped=True,
            )

    output = tmp_path / "skipped.json"
    result = record_pr_review_shadow_triage_packet(
        packet_path=_write_packet_input(tmp_path),
        output_path=output,
        trusted_authoritative_domain="REPOSITORY",
        observer_factory=lambda sink: FakeObserver(),
    )

    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert result["skipped"] is True
    assert persisted["skipped"] is True
    assert persisted["fallbackReason"] == "DUPLICATE_DECISION_ID"


def test_invalid_trusted_metadata_persists_safe_diagnostic(tmp_path):
    output = tmp_path / "trusted-metadata-invalid.json"
    result = record_pr_review_shadow_triage_packet(
        packet_path=_write_packet_input(tmp_path),
        output_path=output,
        require_trusted_metadata=True,
    )

    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert result["trustedMetadataError"] == "TRUSTED_COMPARE_JSON_MISSING"
    assert persisted["trustedMetadataError"] == "TRUSTED_COMPARE_JSON_MISSING"


def test_top_level_exception_persists_safe_status_without_message(tmp_path, monkeypatch):
    secret = "token: ghp_123456789012345678901234567890123456"

    def raise_observation(**_kwargs):
        raise RuntimeError(secret)

    monkeypatch.setattr(pr_review_triage, "run_pr_review_shadow_triage", raise_observation)
    output = tmp_path / "exception.json"

    assert pr_review_triage.main(["--output", str(output)]) == 0

    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert persisted["skipped"] is True
    assert persisted["fallbackReason"] == "PR_REVIEW_TRIAGE_OBSERVATION_FAILED"
    assert persisted["errorType"] == "RuntimeError"
    assert secret not in output.read_text(encoding="utf-8")


def test_invalid_audit_status_values_use_safe_fallbacks(tmp_path):
    output = tmp_path / "invalid-status.json"
    _write_safe_json(
        output,
        {
            "schemaVersion": "LCSP_PR_REVIEW_TRIAGE_RECORD_V1",
            "skipped": "yes",
            "trustedMetadataError": "secret: raw-value",
            "errorType": {"message": "nested secret"},
        },
    )

    persisted = json.loads(output.read_text(encoding="utf-8"))
    assert persisted["skipped"] is None
    assert persisted["trustedMetadataError"] == "UNKNOWN_ERROR"
    assert persisted["errorType"] == "UNKNOWN_ERROR"
