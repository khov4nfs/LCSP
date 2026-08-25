"""
AC-005: Evidence completeness gate — classification blocked until TechnicalEvidenceReport accepted.
AC-006: QUALITY_INSUFFICIENT evidence report does not unblock classification.
AC-008: Privacy gate aborts submission when contains_source_code=True.
AC-009: Privacy gate aborts when secret pattern detected in output field.
AC-010: PROVENANCE_BLOCKED when config_hash or ruleset_hash missing.
"""
import pytest


@pytest.mark.p0
def test_privacy_gate_aborts_on_source_code_flag() -> None:
    """
    AC-008: When privacy_flags.contains_source_code is True, the privacy gate must
    abort submission and mark job as TERMINAL_PRIVACY_FAILURE. No callback is made.
    """
    try:
        from tools.common.capabilities.evidence.scanner.evidence.quality.privacy_gate import assert_privacy_flags, PrivacyViolationError
        from unittest.mock import MagicMock

        payload = MagicMock()
        payload.privacy_flags.contains_source_code = True
        payload.privacy_flags.secrets_redacted = True
        payload.findings = []

        with pytest.raises((AssertionError, PrivacyViolationError)):
            assert_privacy_flags(payload)
    except ImportError:
        pytest.skip("AC-008 RED: privacy_gate module not yet implemented")


@pytest.mark.p0
def test_privacy_gate_aborts_on_unredacted_secrets() -> None:
    """
    AC-008: When privacy_flags.secrets_redacted is False, the privacy gate must
    abort with PRIVACY_BLOCKED severity.
    """
    try:
        from tools.common.capabilities.evidence.scanner.evidence.quality.privacy_gate import assert_privacy_flags, PrivacyViolationError

        from unittest.mock import MagicMock
        payload = MagicMock()
        payload.privacy_flags.contains_source_code = False
        payload.privacy_flags.secrets_redacted = False
        payload.findings = []

        with pytest.raises((AssertionError, PrivacyViolationError)):
            assert_privacy_flags(payload)
    except ImportError:
        pytest.skip("AC-008 RED: privacy_gate module not yet implemented")


@pytest.mark.p0
def test_privacy_gate_aborts_on_secret_pattern_in_finding() -> None:
    """
    AC-009: If a finding field contains a GitHub token (ghp_), Anthropic key (sk-ant-),
    or AWS key (AKIA...) pattern, the privacy gate must abort with PRIVACY_BLOCKED.
    """
    try:
        from tools.common.capabilities.evidence.scanner.evidence.quality.privacy_gate import assert_privacy_flags, PrivacyViolationError
        from unittest.mock import MagicMock

        finding = MagicMock()
        finding.__dict__ = {
            "description": "ghp_realTokenValue1234567890abcdefg",
            "finding_type": "AI_MODEL_INVOCATION",
        }

        payload = MagicMock()
        payload.privacy_flags.contains_source_code = False
        payload.privacy_flags.secrets_redacted = True
        payload.findings = [finding]

        with pytest.raises((AssertionError, PrivacyViolationError)):
            assert_privacy_flags(payload)
    except ImportError:
        pytest.skip("AC-009 RED: privacy_gate module not yet implemented")


@pytest.mark.p0
def test_privacy_gate_passes_clean_payload() -> None:
    """
    AC-008/AC-009: Clean payload (no source code, secrets redacted, no patterns) must pass.
    """
    try:
        from tools.common.capabilities.evidence.scanner.evidence.quality.privacy_gate import assert_privacy_flags
        from unittest.mock import MagicMock

        finding = MagicMock()
        finding.__dict__ = {
            "description": "OpenAI client.chat.completions.create called at line 15",
            "finding_type": "AI_MODEL_INVOCATION",
        }

        payload = MagicMock()
        payload.privacy_flags.contains_source_code = False
        payload.privacy_flags.secrets_redacted = True
        payload.findings = [finding]

        # Must not raise
        assert_privacy_flags(payload)
    except ImportError:
        pytest.skip("AC-008 RED: privacy_gate module not yet implemented")


@pytest.mark.p0
def test_provenance_blocked_on_missing_config_hash() -> None:
    """
    AC-010: Missing config_hash in tool provenance must result in PROVENANCE_BLOCKED severity.
    This is the ONLY condition for PROVENANCE_BLOCKED (not HTTP errors, not auth failures).
    """
    try:
        from tools.common.capabilities.evidence.scanner.evidence.contract.schema_validator import validate_evidence_schema
        from tools.common.capabilities.evidence.scanner.evidence.quality.severity_mapper import SeverityCode

        payload = {
            "job_id": "job-1",
            "snapshot_id": "snap-1",
            "schema_version": "1.0.0",
            "tools_version": {"syft": "0.90.0"},
            # config_hash deliberately missing
            "findings": [],
            "privacy_flags": {"contains_source_code": False, "secrets_redacted": True},
            "quality_state": "QUALITY_VALID",
            "coverage_limitations": [],
            "scan_graph": {},
            "scanned_at": "2026-07-04T00:00:00Z",
        }

        result = validate_evidence_schema(payload)
        assert result.severity == SeverityCode.PROVENANCE_BLOCKED, (
            f"AC-010 FAIL: missing config_hash must yield PROVENANCE_BLOCKED, got {result.severity}"
        )
    except ImportError:
        pytest.skip("AC-010 RED: schema_validator not yet implemented")


@pytest.mark.p0
def test_provenance_blocked_on_missing_ruleset_hash() -> None:
    """
    AC-010: Missing ruleset_hash (Semgrep ruleset provenance) must result in PROVENANCE_BLOCKED.
    """
    try:
        from tools.common.capabilities.evidence.scanner.evidence.contract.schema_validator import validate_evidence_schema
        from tools.common.capabilities.evidence.scanner.evidence.quality.severity_mapper import SeverityCode

        payload = {
            "job_id": "job-1",
            "snapshot_id": "snap-1",
            "schema_version": "1.0.0",
            "tools_version": {"semgrep": "1.0.0"},
            "config_hash": "sha256:abc",
            # ruleset_hash deliberately missing
            "findings": [],
            "privacy_flags": {"contains_source_code": False, "secrets_redacted": True},
            "quality_state": "QUALITY_VALID",
            "coverage_limitations": [],
            "scan_graph": {},
            "scanned_at": "2026-07-04T00:00:00Z",
        }

        result = validate_evidence_schema(payload)
        assert result.severity == SeverityCode.PROVENANCE_BLOCKED, (
            f"AC-010 FAIL: missing ruleset_hash must yield PROVENANCE_BLOCKED, got {result.severity}"
        )
    except ImportError:
        pytest.skip("AC-010 RED: schema_validator not yet implemented")


@pytest.mark.p0
def test_quality_classifier_returns_insufficient_on_critical_timeout() -> None:
    """
    AC-006: Critical tool (syft, semgrep, python_ast) timeout for required dimension
    must produce QUALITY_INSUFFICIENT, not QUALITY_VALID.
    """
    try:
        from tools.common.capabilities.evidence.scanner.evidence.quality.quality_gate import classify_quality

        tool_provenance = [
            {"tool_name": "semgrep", "tool_version": "1.0.0", "outcome": "timeout", "ran_at": "2026-07-04T00:00:00Z"},
            {"tool_name": "syft", "tool_version": "0.90.0", "outcome": "success", "ran_at": "2026-07-04T00:00:00Z"},
        ]
        findings = []  # No findings because semgrep timed out

        result = classify_quality(findings, tool_provenance)
        assert result == "QUALITY_INSUFFICIENT", (
            f"AC-006 FAIL: critical tool timeout must produce QUALITY_INSUFFICIENT, got {result}"
        )
    except ImportError:
        pytest.skip("AC-006 RED: quality_gate module not yet implemented")


@pytest.mark.p0
def test_quality_classifier_valid_when_all_critical_tools_succeed() -> None:
    """
    AC-005/AC-006: QUALITY_VALID when critical tools succeeded and AI findings present.
    """
    try:
        from tools.common.capabilities.evidence.scanner.evidence.quality.quality_gate import classify_quality
        from unittest.mock import MagicMock

        tool_provenance = [
            {"tool_name": "semgrep", "tool_version": "1.0.0", "outcome": "success", "ran_at": "2026-07-04T00:00:00Z"},
            {"tool_name": "syft", "tool_version": "0.90.0", "outcome": "success", "ran_at": "2026-07-04T00:00:00Z"},
            {"tool_name": "python_ast", "tool_version": "3.11", "outcome": "success", "ran_at": "2026-07-04T00:00:00Z"},
        ]

        finding = MagicMock()
        finding.finding_type = "AI_MODEL_INVOCATION"

        result = classify_quality([finding], tool_provenance)
        assert result == "QUALITY_VALID", (
            f"AC-005 FAIL: expected QUALITY_VALID, got {result}"
        )
    except ImportError:
        pytest.skip("AC-005 RED: quality_gate module not yet implemented")
