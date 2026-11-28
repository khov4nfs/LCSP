"""RED contract tests for ASM-USAGE-01..04 (Output-cap & Telemetry Calibration)."""

import pytest
from middleware import usage_metering


def test_asm_usage_01_no_silent_4096_fallback():
    """ASM-USAGE-01: Silent DEFAULT_MAX_OUTPUT_TOKENS = 4096 fallback must be removed; missing max_output_tokens must fail."""
    assert not hasattr(usage_metering, "DEFAULT_MAX_OUTPUT_TOKENS"), (
        "Silent DEFAULT_MAX_OUTPUT_TOKENS = 4096 fallback must be removed; "
        "routes without explicit max_output_tokens > 0 must fail before provider call."
    )


def test_asm_usage_01_missing_max_output_tokens_raises():
    """ASM-USAGE-01: Model route missing or invalid max_output_tokens must fail closed before provider call."""
    class _MissingCapModel:
        profile = {}
        options = {}

    with pytest.raises(ValueError, match="max_output_tokens"):
        usage_metering.output_cap_settings(_MissingCapModel())


def test_asm_usage_02_provider_completion_and_output_evaluation_enums_present():
    """ASM-USAGE-02 & 04: Usage metering exposes separated provider completion and output evaluation states."""
    assert hasattr(usage_metering, "PROVIDER_COMPLETION_STATES")
    assert hasattr(usage_metering, "OUTPUT_EVALUATION_STATES")
    assert set(usage_metering.PROVIDER_COMPLETION_STATES) == {
        "COMPLETED",
        "MAX_TOKENS",
        "TRUNCATED",
        "FAILED",
        "OUTCOME_UNKNOWN",
    }
    assert set(usage_metering.OUTPUT_EVALUATION_STATES) == {
        "ACCEPTED",
        "SCHEMA_INVALID",
        "DOMAIN_REJECTED",
        "NOT_EVALUATED",
    }
