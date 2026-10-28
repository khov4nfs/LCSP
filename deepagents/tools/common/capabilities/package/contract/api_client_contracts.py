from enum import StrEnum


WORKER_API_KEY_HEADER = "X-Worker-Api-Key"
correlationId_HEADER = "X-Correlation-Id"


class CallbackPath(StrEnum):
    AGENT_STREAM_EVENT = "/internal/assessment-runtime/agent-stream-events"
    BILLING_USAGE = "/internal/billing/usage"
    AUDIT_EXPORT = "/internal/callbacks/audit-export/{export_request_id}"


class InternalPath(StrEnum):
    AUDIT_EVENTS = "/internal/audit-events"
    LEGAL_SOURCE_SNAPSHOTS = "/internal/legal-sources/source-snapshots"
    COMPLIANCE_RULE_SET_CLAIMS = "/internal/compliance-rule-set/claims"
    COMPLIANCE_RULE_SET_VALIDATIONS = "/internal/compliance-rule-set/validations"
    COMPLIANCE_RULE_SET_SOURCE_REVIEWS = "/internal/compliance-rule-set/source-reviews"
    COMPLIANCE_RULE_SET_DISCOVERY_DIAGNOSTICS = "/internal/compliance-rule-set/discovery-diagnostics"
    COMPLIANCE_RULE_SET_CLAIM_INVENTORIES = "/internal/compliance-rule-set/claim-inventories"
    COMPLIANCE_RULE_SET_SUBMISSIONS = "/internal/compliance-rule-set/submissions"
    COMPLIANCE_RULE_SET_FAILURES = "/internal/compliance-rule-set/failures"
    COMPLIANCE_RULE_SET_ACTIVE = "/internal/compliance-rule-set/active"


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
