from enum import StrEnum


WORKER_API_KEY_HEADER = "X-Worker-Api-Key"
correlationId_HEADER = "X-Correlation-Id"


class CallbackPath(StrEnum):
    SCAN = "/internal/scan-jobs/{scan_job_id}/callback"
    SCAN_CLAIM = "/internal/scan-jobs/{scan_job_id}/claim"
    SCAN_TERMINAL_FAILURE = "/internal/scan-jobs/{scan_job_id}/terminal-failure"
    SCAN_RUNTIME_EVENT = "/internal/scan-jobs/{scan_job_id}/runtime-events"
    AGENT_STREAM_EVENT = "/internal/scan-jobs/agent-stream-events"
    BILLING_USAGE = "/internal/billing/usage"
    AUDIT_EXPORT = "/internal/callbacks/audit-export/{export_request_id}"
    LEGAL_CORPUS_PREPARATION = "/internal/legal-rule-catalog/corpus/{corpus_version_id}/preparation-callback"


class InternalPath(StrEnum):
    AUDIT_EVENTS = "/internal/audit-events"
    TECHNICAL_EVIDENCE_REPORT = "/internal/evidence/reports/{evidence_report_id}"
    AGENTIC_TOOL_DISPATCH = "/internal/evidence/agentic-tools/dispatch"
    LEGAL_SOURCE_SNAPSHOTS = "/internal/legal-rule-catalog/source-snapshots"
    LEGAL_PORTFOLIO_PREPARATIONS = "/internal/legal-portfolio/preparations"
    LEGAL_PORTFOLIO_CLAIMS = "/internal/legal-portfolio/claims"
    LEGAL_PORTFOLIO_VALIDATIONS = "/internal/legal-portfolio/validations"
    LEGAL_PORTFOLIO_SUBMISSIONS = "/internal/legal-portfolio/submissions"
    LEGAL_PORTFOLIO_FAILURES = "/internal/legal-portfolio/failures"
    LEGAL_PORTFOLIO_ACTIVE = "/internal/legal-portfolio/active"


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
