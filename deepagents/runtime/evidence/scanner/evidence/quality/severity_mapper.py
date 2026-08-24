class SeverityCode:
    ACCEPTED = "ACCEPTED"
    ACCEPTED_WITH_LIMITATION = "ACCEPTED_WITH_LIMITATION"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    RETRYABLE_FAILURE = "RETRYABLE_FAILURE"
    PROVENANCE_BLOCKED = "PROVENANCE_BLOCKED"
    PRIVACY_BLOCKED = "PRIVACY_BLOCKED"
    TERMINAL_PRIVACY_FAILURE = "TERMINAL_PRIVACY_FAILURE"
    CLEANUP_BLOCKED = "CLEANUP_BLOCKED"
    POLICY_VIOLATION = "POLICY_VIOLATION"


def map_severity(condition: str) -> str:
    mapper = {
        "unsupported_language": SeverityCode.ACCEPTED_WITH_LIMITATION,
        "non_critical_timeout": SeverityCode.ACCEPTED_WITH_LIMITATION,
        "critical_timeout": SeverityCode.INSUFFICIENT_EVIDENCE,
        "tool_crash": SeverityCode.RETRYABLE_FAILURE,
        "malformed_output": SeverityCode.INSUFFICIENT_EVIDENCE,
        "missing_config_hash": SeverityCode.PROVENANCE_BLOCKED,
        "missing_ruleset_hash": SeverityCode.PROVENANCE_BLOCKED,
        "redaction_failure": SeverityCode.PRIVACY_BLOCKED,
        "secret_detected": SeverityCode.PRIVACY_BLOCKED,
        "raw_source_persisted": SeverityCode.TERMINAL_PRIVACY_FAILURE,
        "cleanup_failure": SeverityCode.CLEANUP_BLOCKED,
        "dependency_installation_attempted": SeverityCode.POLICY_VIOLATION,
        "source_execution_attempted": SeverityCode.POLICY_VIOLATION,
        "all_evidence_present": SeverityCode.ACCEPTED
    }
    return mapper.get(condition, "UNKNOWN")

