import time
from urllib.parse import urlencode
import httpx
from structlog import get_logger

from package.contract.api_client_contracts import (
    CORRELATION_ID_HEADER,
    WORKER_API_KEY_HEADER,
    CallbackLogEvent,
    CallbackPath,
    InternalPath,
    client_error_message,
    network_error_message,
    server_error_message,
    unexpected_error_message,
)
from lcsp_workers.platform.correlation import get_correlation_id
from lcsp_workers.platform.redaction import redact_dict, redact_source_code
from lcsp_workers.platform.callback_schemas import (
    CallbackResponse,
    ScanCallbackPayload,
    TechnicalProfileCallbackPayload,
    AIUsageFlowCallbackPayload,
    ConflictDetectionCallbackPayload,
    VerifiedProfileCallbackPayload,
    LegalRuleMatchCallbackPayload,
    ClassificationCallbackPayload,
    AuditExportCallbackPayload,
)

logger = get_logger(__name__)

_IDEMPOTENT_CONFLICT_CODES = {
    "FLOW_ALREADY_EXISTS",
    "PROFILE_ALREADY_EXISTS",
    "RESULT_ALREADY_EXISTS",
}
_PRIVACY_FLAG_KEYS = {
    "containsSourceCode",
    "secretsRedacted",
    "sourceStrippedFromFindings",
}


class WorkerCallbackError(Exception):
    """Raised when an API callback permanently fails (after retries or due to 4xx client errors)."""

    pass


class WorkerApiClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = 30.0
        self._max_retries = 3

    def _post_with_retry(self, path: str, payload: dict) -> dict:
        """
        Executes a POST request with exponential backoff for network and 5xx errors.
        Fails fast on non-idempotent 4xx errors.
        """
        url = f"{self._base_url}{path}"
        cid = get_correlation_id()
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            CORRELATION_ID_HEADER: cid,
        }
        safe_payload = self._redact_callback_payload(payload)

        for attempt in range(self._max_retries):
            try:
                resp = httpx.post(
                    url,
                    json=safe_payload,
                    headers=headers,
                    timeout=self._timeout,
                )

                if 400 <= resp.status_code < 500:
                    error_code = self._response_error_code(resp)
                    if resp.status_code == 409 and error_code in _IDEMPOTENT_CONFLICT_CODES:
                        logger.info(
                            "API_CALLBACK_IDEMPOTENT_DUPLICATE",
                            path=path,
                            error_code=error_code,
                        )
                        return {
                            "accepted": True,
                            "status": "duplicate",
                            "correlation_id": cid,
                        }
                    logger.error(
                        CallbackLogEvent.CLIENT_ERROR,
                        path=path,
                        status_code=resp.status_code,
                        error_code=error_code,
                    )
                    message = client_error_message(resp.status_code)
                    if error_code:
                        message = f"{error_code}: {message}"
                    raise WorkerCallbackError(message)

                if resp.status_code >= 500:
                    if attempt < self._max_retries - 1:
                        backoff = 2**attempt
                        logger.warning(
                            CallbackLogEvent.SERVER_ERROR_RETRYING,
                            path=path,
                            status_code=resp.status_code,
                            attempt=attempt + 1,
                            sleep=backoff,
                        )
                        time.sleep(backoff)
                        continue
                    logger.error(
                        CallbackLogEvent.SERVER_ERROR_TERMINAL,
                        path=path,
                        status_code=resp.status_code,
                    )
                    raise WorkerCallbackError(
                        server_error_message(self._max_retries, resp.status_code)
                    )

                return self._unwrap_result_envelope(resp.json())

            except httpx.RequestError as exc:
                if attempt < self._max_retries - 1:
                    backoff = 2**attempt
                    logger.warning(
                        CallbackLogEvent.NETWORK_ERROR_RETRYING,
                        path=path,
                        error=type(exc).__name__,
                        attempt=attempt + 1,
                        sleep=backoff,
                    )
                    time.sleep(backoff)
                    continue
                logger.error(
                    CallbackLogEvent.NETWORK_ERROR_TERMINAL,
                    path=path,
                    error=type(exc).__name__,
                )
                raise WorkerCallbackError(
                    network_error_message(self._max_retries)
                ) from exc

        raise WorkerCallbackError(unexpected_error_message())

    def _response_error_code(self, response) -> str | None:
        try:
            data = response.json()
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        value = data.get("error_code") or data.get("errorCode")
        if value:
            return str(value)
        problem = data.get("problem")
        if isinstance(problem, dict):
            value = problem.get("code") or problem.get("error_code")
            if value:
                return str(value)
        return None

    @staticmethod
    def _unwrap_result_envelope(data):
        if isinstance(data, dict) and data.get("ok") is True:
            nested = data.get("data")
            if isinstance(nested, (dict, list)):
                return nested
        return data

    def _get_with_retry(self, path: str, params: dict = None) -> dict | list:
        """
        Executes a GET request with exponential backoff for network and 5xx errors.
        Fails fast on 4xx errors.
        """
        url = f"{self._base_url}{path}"
        cid = get_correlation_id()
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            CORRELATION_ID_HEADER: cid,
        }

        for attempt in range(self._max_retries):
            try:
                resp = httpx.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=self._timeout,
                )

                if 400 <= resp.status_code < 500:
                    error_code = self._response_error_code(resp)
                    logger.error(
                        CallbackLogEvent.CLIENT_ERROR,
                        path=path,
                        status_code=resp.status_code,
                        error_code=error_code,
                    )
                    message = client_error_message(resp.status_code)
                    if error_code:
                        message = f"{error_code}: {message}"
                    raise WorkerCallbackError(message)

                if resp.status_code >= 500:
                    if attempt < self._max_retries - 1:
                        backoff = 2**attempt
                        logger.warning(
                            CallbackLogEvent.SERVER_ERROR_RETRYING,
                            path=path,
                            status_code=resp.status_code,
                            attempt=attempt + 1,
                            sleep=backoff,
                        )
                        time.sleep(backoff)
                        continue
                    logger.error(
                        CallbackLogEvent.SERVER_ERROR_TERMINAL,
                        path=path,
                        status_code=resp.status_code,
                    )
                    raise WorkerCallbackError(
                        server_error_message(self._max_retries, resp.status_code)
                    )

                return self._unwrap_result_envelope(resp.json())

            except httpx.RequestError as exc:
                if attempt < self._max_retries - 1:
                    backoff = 2**attempt
                    logger.warning(
                        CallbackLogEvent.NETWORK_ERROR_RETRYING,
                        path=path,
                        error=type(exc).__name__,
                        attempt=attempt + 1,
                        sleep=backoff,
                    )
                    time.sleep(backoff)
                    continue
                logger.error(
                    CallbackLogEvent.NETWORK_ERROR_TERMINAL,
                    path=path,
                    error=type(exc).__name__,
                )
                raise WorkerCallbackError(
                    network_error_message(self._max_retries)
                ) from exc

        raise WorkerCallbackError(unexpected_error_message())

    def _redact_callback_payload(self, payload: dict) -> dict:
        safe_payload = dict(payload)
        findings = safe_payload.get("findings")
        if isinstance(findings, list):
            safe_payload["findings"] = redact_source_code(
                [finding for finding in findings if isinstance(finding, dict)]
            )
        evidence_payload = safe_payload.get("evidence_payload")
        if isinstance(evidence_payload, dict):
            safe_evidence_payload = dict(evidence_payload)
            signals = safe_evidence_payload.get("ai_usage_signals")
            if isinstance(signals, list):
                safe_evidence_payload["ai_usage_signals"] = redact_source_code(
                    [signal for signal in signals if isinstance(signal, dict)]
                )
            safe_payload["evidence_payload"] = safe_evidence_payload
        redacted_payload = redact_dict(safe_payload)
        privacy_flags = safe_payload.get("privacy_flags")
        if isinstance(privacy_flags, dict):
            redacted_payload["privacy_flags"] = {
                key: value
                for key, value in privacy_flags.items()
                if key in _PRIVACY_FLAG_KEYS and isinstance(value, bool)
            }
        return redacted_payload

    def post_scan_callback(
        self, scan_job_id: str, payload: ScanCallbackPayload
    ) -> CallbackResponse:
        path = CallbackPath.SCAN.format(scan_job_id=scan_job_id)
        request_payload = payload.model_dump(exclude_none=True)
        if request_payload.get("findings") == []:
            request_payload.pop("findings")
        resp_data = self._post_with_retry(path, request_payload)
        return CallbackResponse(**resp_data)

    def post_technical_profile_callback(
        self, payload: TechnicalProfileCallbackPayload
    ) -> CallbackResponse:
        path = CallbackPath.TECHNICAL_PROFILE
        resp_data = self._post_with_retry(path, payload.model_dump(exclude_none=True))
        return CallbackResponse(**resp_data)

    def get_accepted_technical_evidence_report(self, evidence_report_id: str) -> dict:
        path = InternalPath.TECHNICAL_EVIDENCE_REPORT.format(
            evidence_report_id=evidence_report_id
        )
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Technical evidence report response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status != "accepted":
            raise WorkerCallbackError("Technical evidence report is not accepted.")
        return data

    def post_ai_usage_flow_callback(
        self, payload: AIUsageFlowCallbackPayload
    ) -> CallbackResponse:
        path = CallbackPath.AI_USAGE_FLOW
        resp_data = self._post_with_retry(path, payload.model_dump(exclude_none=True))
        return CallbackResponse(**resp_data)

    def post_reconciliation_conflict_callback(
        self, payload: ConflictDetectionCallbackPayload
    ) -> CallbackResponse:
        path = CallbackPath.RECONCILIATION_CONFLICT
        resp_data = self._post_with_retry(path, payload.model_dump(exclude_none=True))
        return CallbackResponse(**resp_data)

    def get_accepted_ai_usage_flow(self, ai_usage_flow_id: str) -> dict:
        path = InternalPath.AI_USAGE_FLOW.format(ai_usage_flow_id=ai_usage_flow_id)
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("AIUsageFlow response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status not in {"accepted", "ready", "ai_usage_flow_ready"}:
            raise WorkerCallbackError("AIUsageFlow is not accepted.")
        return data

    def get_accepted_technical_profile(self, technical_profile_id: str) -> dict:
        path = InternalPath.TECHNICAL_PROFILE.format(
            technical_profile_id=technical_profile_id
        )
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Technical profile response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status != "accepted":
            raise WorkerCallbackError("Technical profile is not accepted.")
        return data

    def get_wizard_profile_for_assessment(self, assessment_id: str) -> dict | None:
        path = InternalPath.WIZARD_PROFILE.format(assessment_id=assessment_id)
        try:
            data = self._get_with_retry(path)
        except WorkerCallbackError as exc:
            if "client error 404" in str(exc):
                return None
            raise
        if data is None:
            return None
        if not isinstance(data, dict):
            raise WorkerCallbackError("Wizard profile response was invalid.")
        return data

    def get_verified_profile_reconciliation_context(
        self,
        assessment_id: str,
        ai_usage_flow_id: str | None = None,
    ) -> dict:
        path = InternalPath.VERIFIED_PROFILE_CONTEXT.format(
            assessment_id=assessment_id
        )
        if ai_usage_flow_id:
            path = f"{path}?{urlencode({'ai_usage_flow_id': ai_usage_flow_id})}"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError(
                "VerifiedProfile reconciliation context response was invalid."
            )
        return data

    def post_verified_profile_callback(
        self, payload: VerifiedProfileCallbackPayload
    ) -> CallbackResponse:
        path = CallbackPath.VERIFIED_PROFILE
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)

    def get_verified_profile_by_id(self, verified_profile_id: str) -> dict:
        path = f"/internal/reconciliation/verified-profiles/{verified_profile_id}"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Verified profile response was invalid.")
        return data

    def get_legal_rule_match_by_id(self, legal_rule_match_id: str) -> dict:
        path = InternalPath.LEGAL_RULE_MATCH.format(
            legal_rule_match_id=legal_rule_match_id
        )
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal rule match response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status != "accepted":
            raise WorkerCallbackError("Legal rule match is not accepted.")
        return data

    def get_active_legal_rule_catalog(self) -> dict:
        path = "/internal/legal-rule-catalog/active"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal rule catalog response was invalid.")
        return data

    def get_active_legal_corpus(self) -> dict:
        path = "/internal/legal-rule-catalog/corpus/active"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus response was invalid.")
        return data

    def get_legal_corpus_chunks(self, corpus_version_id: str) -> dict:
        path = f"/internal/legal-rule-catalog/corpus/{corpus_version_id}/chunks"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus chunks response was invalid.")
        return data

    def post_legal_rule_match_callback(
        self, payload: LegalRuleMatchCallbackPayload
    ) -> CallbackResponse:
        path = CallbackPath.LEGAL_RULE_MATCH
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)

    def post_classification_callback(
        self, payload: ClassificationCallbackPayload
    ) -> CallbackResponse:
        path = CallbackPath.CLASSIFICATION
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)

    def get_audit_events(
        self, organization_id: str, from_date: str, to_date: str
    ) -> list[dict]:
        path = InternalPath.AUDIT_EVENTS.format(organization_id=organization_id)
        params = {"from_date": from_date, "to_date": to_date}
        data = self._get_with_retry(path, params=params)
        if not isinstance(data, list):
            raise WorkerCallbackError("Audit events response was invalid.")
        return [entry for entry in data if isinstance(entry, dict)]

    def post_audit_export_callback(
        self, export_request_id: str, payload: AuditExportCallbackPayload
    ) -> CallbackResponse:
        path = CallbackPath.AUDIT_EXPORT.format(export_request_id=export_request_id)
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)
