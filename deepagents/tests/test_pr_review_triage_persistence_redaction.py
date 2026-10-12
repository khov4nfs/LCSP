import json

from decision.pr_review_triage import (
    JsonlTelemetrySink,
    _packet_payload,
    _redact_persisted_value,
    _write_safe_json,
)
from decision.shadow import PrReviewTriagePacket


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
