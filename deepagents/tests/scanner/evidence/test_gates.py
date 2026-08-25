import pytest
import asyncio
from unittest.mock import AsyncMock, patch

from tools.common.capabilities.evidence.scanner.evidence.contract.models import EvidencePayload, PrivacyFlags, TechnicalFinding
from tools.common.capabilities.evidence.scanner.evidence.quality.severity_mapper import map_severity
from tools.common.capabilities.evidence.scanner.evidence.quality.privacy_gate import assert_privacy_flags, _looks_like_source_code
from tools.common.capabilities.evidence.scanner.evidence.contract.schema_validator import validate_schema, SchemaValidationError
from tools.common.capabilities.evidence.scanner.evidence.quality.quality_gate import classify_quality
from tools.common.capabilities.evidence.scanner.evidence.finalization.terminal_state_handler import mark_terminal_state, verify_workspace_cleanup, CleanupBlockedError

def test_t01_quality_valid():
    findings = [{"finding_type": "AI_INVOCATION"}]
    prov = [{"tool_name": "semgrep", "outcome": "success"}]
    assert classify_quality(findings, prov) == "QUALITY_VALID"

def test_t02_critical_timeout():
    findings = [{"finding_type": "AI_INVOCATION"}]
    prov = [{"tool_name": "semgrep", "outcome": "timeout"}]
    assert classify_quality(findings, prov) == "QUALITY_INSUFFICIENT"
    assert map_severity("critical_timeout") == "INSUFFICIENT_EVIDENCE"

def test_t03_contains_source_code():
    payload = EvidencePayload(
        job_id="1", snapshot_id="1", schema_version="1", tools_version={},
        config_hash="h", findings=[], privacy_flags=PrivacyFlags(True, True),
        quality_state="", coverage_limitations=[], scan_graph={}, scanned_at=""
    )
    with pytest.raises(AssertionError, match="TERMINAL_PRIVACY_FAILURE"):
        assert_privacy_flags(payload)

def test_t04_secrets_not_redacted():
    payload = EvidencePayload(
        job_id="1", snapshot_id="1", schema_version="1", tools_version={},
        config_hash="h", findings=[], privacy_flags=PrivacyFlags(False, False),
        quality_state="", coverage_limitations=[], scan_graph={}, scanned_at=""
    )
    with pytest.raises(AssertionError, match="TERMINAL_PRIVACY_FAILURE"):
        assert_privacy_flags(payload)

def test_t05_secret_detected_mapper():
    assert map_severity("secret_detected") == "PRIVACY_BLOCKED"

def test_t06_source_code_heuristic():
    finding = TechnicalFinding(finding_id="1", finding_type="AI", file_path="f", line_number=1, matched_rule_id="r", confidence=1.0)
    finding.details = "def my_function():\n    # This is a comment to make it > 50 chars\n    return 1"
    
    payload = EvidencePayload(
        job_id="1", snapshot_id="1", schema_version="1", tools_version={},
        config_hash="h", findings=[finding], privacy_flags=PrivacyFlags(False, True),
        quality_state="", coverage_limitations=[], scan_graph={}, scanned_at=""
    )
    with pytest.raises(AssertionError, match="TERMINAL_PRIVACY_FAILURE"):
        assert_privacy_flags(payload)

def test_t07_missing_config_hash():
    payload = {
        "job_id": "1", "snapshot_id": "1", "schema_version": "1", "tools_version": {},
        "config_hash": "h", "findings": [], "privacy_flags": {}, "quality_state": "",
        "coverage_limitations": [], "scan_graph": {}, "scanned_at": ""
    }
    prov = [{"tool_name": "t", "tool_version": "1", "ran_at": "1", "outcome": "success"}] # Missing config_hash
    with pytest.raises(SchemaValidationError) as exc:
        validate_schema(payload, prov)
    assert exc.value.quality_state == "BLOCKED"

def test_t08_missing_ruleset_hash():
    payload = {
        "job_id": "1", "snapshot_id": "1", "schema_version": "1", "tools_version": {},
        "config_hash": "h", "findings": [], "privacy_flags": {}, "quality_state": "",
        "coverage_limitations": [], "scan_graph": {}, "scanned_at": ""
    }
    prov = [{"tool_name": "semgrep_with_ruleset", "tool_version": "1", "config_hash": "h", "ran_at": "1", "outcome": "success"}]
    with pytest.raises(SchemaValidationError) as exc:
        validate_schema(payload, prov)
    assert exc.value.quality_state == "BLOCKED"

def test_t09_malformed_output():
    prov = [{"tool_name": "syft", "outcome": "malformed_output"}]
    assert classify_quality([{"finding_type": "AI"}], prov) == "QUALITY_INSUFFICIENT"

def test_t10_zero_ai_findings():
    prov = [{"tool_name": "syft", "outcome": "success"}]
    assert classify_quality([], prov) == "QUALITY_INSUFFICIENT"

def test_t11_non_critical_timeout():
    prov = [{"tool_name": "custom_linter", "outcome": "timeout"}]
    findings = [{"finding_type": "AI_INVOCATION"}]
    assert classify_quality(findings, prov) == "QUALITY_VALID"
    assert map_severity("non_critical_timeout") == "ACCEPTED_WITH_LIMITATION"

@pytest.mark.asyncio
async def test_t12_api_callback_200():
    client = AsyncMock()
    await mark_terminal_state("job-1", "QUALITY_VALID", client)
    client.mark_scan_job_complete.assert_called_once_with("job-1", "QUALITY_VALID")

@pytest.mark.asyncio
async def test_t13_api_callback_retry_failure():
    client = AsyncMock()
    client.mark_scan_job_complete.side_effect = Exception("HTTP 500")
    
    with patch("asyncio.sleep", new_callable=AsyncMock):
        with pytest.raises(RuntimeError, match="Callback failed after 3 attempts"):
            await mark_terminal_state("job-1", "QUALITY_VALID", client)
    
    assert client.mark_scan_job_complete.call_count == 3

def test_t14_policy_violation_mapper():
    assert map_severity("dependency_installation_attempted") == "POLICY_VIOLATION"
    assert map_severity("source_execution_attempted") == "POLICY_VIOLATION"

@pytest.mark.asyncio
async def test_t15_workspace_cleanup_failure(tmp_path):
    with pytest.raises(CleanupBlockedError):
        await verify_workspace_cleanup(str(tmp_path))

def test_t16_privacy_gate_log_message():
    finding = TechnicalFinding(finding_id="1", finding_type="AI", file_path="f", line_number=1, matched_rule_id="r", confidence=1.0)
    finding.details = "def my_function():\n    # This is a comment to make it > 50 chars\n    return 1"
    
    payload = EvidencePayload(
        job_id="1", snapshot_id="1", schema_version="1", tools_version={},
        config_hash="h", findings=[finding], privacy_flags=PrivacyFlags(False, True),
        quality_state="", coverage_limitations=[], scan_graph={}, scanned_at=""
    )
    with pytest.raises(AssertionError) as exc:
        assert_privacy_flags(payload)
    
    assert "def my_function" not in str(exc.value)
    assert "source code in finding.details" in str(exc.value)
