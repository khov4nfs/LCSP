from enum import StrEnum


WORKER_API_KEY_HEADER = "X-Worker-Api-Key"
CORRELATION_ID_HEADER = "X-Correlation-Id"


class CallbackPath(StrEnum):
    SCAN = "/internal/scan-jobs/{scan_job_id}/callback"
    TECHNICAL_PROFILE = "/internal/evidence/technical-profile-callback"
    AI_USAGE_FLOW = "/internal/ai-usage-flow/callback"
    RECONCILIATION_CONFLICT = "/internal/reconciliation/conflict-callback"
    VERIFIED_PROFILE = "/internal/reconciliation/verified-profile-callback"
    LEGAL_RULE_MATCH = "/internal/classification/legal-rule-match-callback"
    CLASSIFICATION = "/internal/classification/result-callback"
    AUDIT_EXPORT = "/internal/callbacks/audit-export/{export_request_id}"
    TARGETED_REANALYSIS_CLAIM = "/internal/targeted-reanalysis/{request_id}/claim"
    TARGETED_REANALYSIS_REQUEUE = "/internal/targeted-reanalysis/{request_id}/requeue"
    TARGETED_REANALYSIS_TERMINAL = "/internal/targeted-reanalysis/{request_id}/terminal"


class InternalPath(StrEnum):
    AUDIT_EVENTS = "/internal/organizations/{organization_id}/audit-events"
    TECHNICAL_EVIDENCE_REPORT = "/internal/evidence/reports/{evidence_report_id}"
    TECHNICAL_PROFILE = "/internal/evidence/technical-profiles/{technical_profile_id}"
    AGENTIC_TOOL_DISPATCH = "/internal/evidence/agentic-tools/dispatch"
    AI_USAGE_FLOW = "/internal/ai-usage-flow/{ai_usage_flow_id}"
    VERIFIED_PROFILE_CONTEXT = "/internal/reconciliation/verified-profile-context/{assessment_id}"
    WIZARD_PROFILE = "/internal/assessments/{assessment_id}/wizard-profile"
    LEGAL_RULE_MATCH = "/internal/classification/runtime/legal-rule-matches/{legal_rule_match_id}"
    TARGETED_REANALYSIS_REQUEST = "/internal/targeted-reanalysis/{request_id}"
    LEGAL_SOURCE_SNAPSHOTS = "/internal/legal-rule-catalog/source-snapshots"


class CallbackLogEvent(StrEnum):
    CLIENT_ERROR = "API_CALLBACK_CLIENT_ERROR"
    SERVER_ERROR_RETRYING = "API_CALLBACK_SERVER_ERROR_RETRYING"
    SERVER_ERROR_TERMINAL = "API_CALLBACK_SERVER_ERROR_TERMINAL"
    NETWORK_ERROR_RETRYING = "API_CALLBACK_NETWORK_ERROR_RETRYING"
    NETWORK_ERROR_TERMINAL = "API_CALLBACK_NETWORK_ERROR_TERMINAL"


def client_error_message(status_code: int) -> str:
    return f"Callback failed with client error {status_code}."


def server_error_message(max_retries: int, status_code: int) -> str:
    return (
        f"Callback failed after {max_retries} attempts "
        f"with server error {status_code}."
    )


def network_error_message(max_retries: int) -> str:
    return f"Callback network request failed after {max_retries} attempts."


def unexpected_error_message() -> str:
    return "Callback failed unexpectedly."
