import json

from decision.pr_review_triage import (
    JsonlTelemetrySink,
    _packet_payload,
    _redact_persisted_value,
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
