from __future__ import annotations

import pytest

from lcsp_workers.scanner.evidence_assembler import (
    EvidenceAssembler,
    PrivacyAssertionError,
)


def test_forbidden_field_reports_exact_json_path_without_value() -> None:
    assembler = EvidenceAssembler()
    payload = {
        "evidence_graph": {
            "nodes": [
                {
                    "attributes": {
                        "secret": "must-not-appear-in-log",
                    }
                }
            ]
        }
    }

    with pytest.raises(PrivacyAssertionError) as raised:
        assembler._assert_safe_payload(payload)

    error = raised.value
    assert (
        error.json_path
        == '$["evidence_graph"]["nodes"][0]["attributes"]["secret"]'
    )
    assert error.reason == "FORBIDDEN_PERSISTED_FIELD"
    assert error.field_name == "secret"
    assert error.value_type == "str"
    assert error.string_length == len("must-not-appear-in-log")
    assert "must-not-appear-in-log" not in str(error)
    assert "forbidden field secret" in str(error)


def test_secret_value_pattern_reports_location_without_secret_material() -> None:
    assembler = EvidenceAssembler()
    fake_secret = "Bearer abcdefghijklmnopqrstuvwxyz123456"

    with pytest.raises(PrivacyAssertionError) as raised:
        assembler._assert_safe_payload(
            {
                "technical_findings": [
                    {
                        "metadata": fake_secret,
                    }
                ]
            }
        )

    error = raised.value
    assert error.json_path == '$["technical_findings"][0]["metadata"]'
    assert error.reason == "SECRET_VALUE_PATTERN"
    assert error.field_name is None
    assert error.value_type == "str"
    assert error.string_length == len(fake_secret)
    assert fake_secret not in str(error)


def test_privacy_debug_is_explicitly_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    assembler = EvidenceAssembler()

    monkeypatch.delenv("SCANNER_PRIVACY_DEBUG", raising=False)
    assert assembler._privacy_debug_enabled() is False

    monkeypatch.setenv("SCANNER_PRIVACY_DEBUG", "true")
    assert assembler._privacy_debug_enabled() is True
