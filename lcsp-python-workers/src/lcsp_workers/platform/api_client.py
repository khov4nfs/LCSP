"""Provide secret-safe, retrying access to LCSP internal read/callback APIs."""

import time
from urllib.parse import urlencode
import httpx
from structlog import get_logger

from package.contract.api_client_contracts import (
    correlationId_HEADER,
    WORKER_API_KEY_HEADER,
    CallbackLogEvent,
    CallbackPath,
    InternalPath,
    client_error_message,
    network_error_message,
    server_error_message,
    unexpected_error_message,
)
from lcsp_workers.platform.correlation import get_correlationId
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
    """Raised when an internal API request permanently fails or violates its contract."""

    pass


class WorkerApiClient:
    """Internal API adapter used by workers for canonical reads and callbacks.

    Requests propagate worker credentials and correlation IDs, retry only network
    and server failures, fail fast for non-idempotent client errors, and redact
    callback payloads before they cross the process boundary.
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        """Create the client with the LCSP API base URL and worker credential."""
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = 30.0
        self._max_retries = 3

    def _post_with_retry(self, path: str, payload: dict) -> dict:
        """POST a sanitized payload with exponential retry for network/5xx failures.

        Known 409 duplicate codes are treated as idempotent success. Other 4xx
        responses fail immediately; transport and 5xx failures retry up to the
        configured attempt cap.
        """
        url = f"{self._base_url}{path}"
        cid = get_correlationId()
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: cid,
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
                            "correlationId": cid,
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
        """Extract a typed error code from supported API/problem response shapes."""
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
        """Unwrap the standard ``{ok: true, data: ...}`` API response envelope."""
        if isinstance(data, dict) and data.get("ok") is True:
            nested = data.get("data")
            if isinstance(nested, (dict, list)):
                return nested
        return data

    def _get_with_retry(self, path: str, params: dict = None) -> dict | list:
        """GET canonical internal data with exponential retry for network/5xx errors."""
        url = f"{self._base_url}{path}"
        cid = get_correlationId()
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: cid,
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
        """Strip source-like findings and redact secrets while preserving privacy flags."""
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
        for provenance_key in ("tools_version", "config_hash"):
            provenance = safe_payload.get(provenance_key)
            if isinstance(provenance, dict):
                redacted_payload[provenance_key] = {
                    str(key): str(value)
                    for key, value in provenance.items()
                    if str(key).strip() and str(value).strip()
                }
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
        """Submit a scan terminal callback, omitting an empty findings array."""
        import os
        import json
        path = CallbackPath.SCAN.format(scan_job_id=scan_job_id)
        request_payload = payload.model_dump(exclude_none=True)
        if request_payload.get("findings") == []:
            request_payload.pop("findings")

        serialized = json.dumps(request_payload, ensure_ascii=False)
        threshold = int(os.getenv("LCSP_SCAN_CALLBACK_THRESHOLD", str(40 * 1024 * 1024)))
        if len(serialized.encode("utf-8")) > threshold:
            from lcsp_workers.platform.artifact_storage import ArtifactStorage
            storage = ArtifactStorage()
            chunk_size = int(os.getenv("LCSP_SCAN_CALLBACK_CHUNK_SIZE", str(10 * 1024 * 1024)))
            manifest = storage.write_payload_chunks(request_payload, chunk_size=chunk_size)
            envelope = {
                "status": payload.status,
                "scan_job_id": scan_job_id,
                "privacy_flags": payload.privacy_flags,
                "schema_version": payload.schema_version,
                "is_artifact_reference": True,
                "artifact_manifest": manifest
            }
            resp_data = self._post_with_retry(path, envelope)
        else:
            resp_data = self._post_with_retry(path, request_payload)
        return CallbackResponse(**resp_data)

    def post_scan_runtime_event(self, scan_job_id: str, payload: dict) -> None:
        """Submit best-effort privacy-safe runtime progress for an active scan job."""
        path = CallbackPath.SCAN_RUNTIME_EVENT.format(scan_job_id=scan_job_id)
        url = f"{self._base_url}{path}"
        headers = {
            WORKER_API_KEY_HEADER: self._api_key,
            correlationId_HEADER: get_correlationId(),
        }
        try:
            response = httpx.post(
                url,
                json=redact_dict(payload),
                headers=headers,
                timeout=3.0,
            )
            if response.status_code >= 400:
                logger.warning(
                    "SCAN_RUNTIME_EVENT_REJECTED",
                    scan_job_id=scan_job_id,
                    status_code=response.status_code,
                    error_code=self._response_error_code(response),
                )
        except Exception as exc:
            logger.warning(
                "SCAN_RUNTIME_EVENT_POST_FAILED",
                scan_job_id=scan_job_id,
                error=type(exc).__name__,
            )

    def post_technical_profile_callback(
        self, payload: TechnicalProfileCallbackPayload
    ) -> CallbackResponse:
        """Persist a generated TechnicalProfile through the internal callback API."""
        import os
        import json
        path = CallbackPath.TECHNICAL_PROFILE
        request_payload = payload.model_dump(exclude_none=True)

        serialized = json.dumps(request_payload, ensure_ascii=False)
        threshold = int(os.getenv("LCSP_PROFILE_CALLBACK_THRESHOLD", str(800 * 1024)))
        if len(serialized.encode("utf-8")) > threshold:
            from lcsp_workers.platform.artifact_storage import ArtifactStorage
            storage = ArtifactStorage()
            chunk_size = int(os.getenv("LCSP_PROFILE_CALLBACK_CHUNK_SIZE", str(200 * 1024)))
            manifest = storage.write_payload_chunks(request_payload, chunk_size=chunk_size)
            envelope = {
                "evidence_report_id": payload.evidence_report_id,
                "assessment_id": payload.assessment_id,
                "schema_version": payload.schema_version,
                "provider_version": payload.provider_version,
                "privacy_flags": payload.privacy_flags,
                "scan_job_id": payload.scan_job_id,
                "profile_data": request_payload.get("profile_data"),
                "is_artifact_reference": True,
                "artifact_manifest": manifest
            }
            resp_data = self._post_with_retry(path, envelope)
        else:
            resp_data = self._post_with_retry(path, request_payload)
        return CallbackResponse(**resp_data)

    def get_accepted_technical_evidence_report(self, evidence_report_id: str) -> dict:
        """Fetch a canonical TechnicalEvidenceReport and require accepted status."""
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

    def get_targeted_reanalysis_request(self, request_id: str) -> dict:
        """Fetch one targeted-reanalysis lifecycle request by ID."""
        path = InternalPath.TARGETED_REANALYSIS_REQUEST.format(request_id=request_id)
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Targeted reanalysis request response was invalid.")
        return data

    def claim_targeted_reanalysis_request(self, request_id: str) -> bool:
        """Atomically claim a targeted-reanalysis request for worker execution."""
        path = CallbackPath.TARGETED_REANALYSIS_CLAIM.format(request_id=request_id)
        data = self._post_with_retry(path, {})
        return bool(data.get("claimed"))

    def complete_targeted_reanalysis_request(
        self,
        request_id: str,
        *,
        output_evidence_report_id: str,
    ) -> dict:
        """Mark targeted reanalysis COMPLETED and attach its output evidence artifact."""
        return self._post_targeted_reanalysis_terminal(
            request_id,
            {"state": "COMPLETED", "output_evidence_report_id": output_evidence_report_id},
        )

    def fail_targeted_reanalysis_request(
        self,
        request_id: str,
        *,
        state: str,
        safe_failure_code: str,
    ) -> dict:
        """Mark targeted reanalysis FAILED/DLQ using a safe failure code only."""
        if state not in {"FAILED", "DLQ"}:
            raise ValueError("Targeted reanalysis terminal state must be FAILED or DLQ.")
        return self._post_targeted_reanalysis_terminal(
            request_id,
            {"state": state, "safe_failure_code": safe_failure_code},
        )

    def requeue_targeted_reanalysis_request(self, request_id: str) -> bool:
        """Request requeue of a targeted-reanalysis lifecycle record."""
        path = CallbackPath.TARGETED_REANALYSIS_REQUEUE.format(request_id=request_id)
        data = self._post_with_retry(path, {})
        return bool(data.get("requeued"))

    def _post_targeted_reanalysis_terminal(self, request_id: str, payload: dict) -> dict:
        """Submit a terminal targeted-reanalysis state transition."""
        path = CallbackPath.TARGETED_REANALYSIS_TERMINAL.format(request_id=request_id)
        return self._post_with_retry(path, payload)

    def post_ai_usage_flow_callback(
        self, payload: AIUsageFlowCallbackPayload
    ) -> CallbackResponse:
        """Persist a governed AIUsageFlow callback."""
        path = CallbackPath.AI_USAGE_FLOW
        resp_data = self._post_with_retry(path, payload.model_dump(exclude_none=True))
        return CallbackResponse(**resp_data)

    def post_reconciliation_conflict_callback(
        self, payload: ConflictDetectionCallbackPayload
    ) -> CallbackResponse:
        """Persist deterministic reconciliation conflict candidates."""
        path = CallbackPath.RECONCILIATION_CONFLICT
        resp_data = self._post_with_retry(path, payload.model_dump(exclude_none=True))
        return CallbackResponse(**resp_data)

    def get_accepted_ai_usage_flow(self, ai_usage_flow_id: str) -> dict:
        """Fetch an AIUsageFlow and require an accepted/ready status."""
        path = InternalPath.AI_USAGE_FLOW.format(ai_usage_flow_id=ai_usage_flow_id)
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("AIUsageFlow response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status not in {"accepted", "ready", "ai_usage_flow_ready"}:
            raise WorkerCallbackError("AIUsageFlow is not accepted.")
        return data

    def get_accepted_technical_profile(self, technical_profile_id: str) -> dict:
        """Fetch a TechnicalProfile and require accepted status."""
        path = InternalPath.TECHNICAL_PROFILE.format(
            technical_profile_id=technical_profile_id
        )
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Technical profile response was invalid.")
        status = str(data.get("status", "")).lower()
        if status and status != "accepted":
            raise WorkerCallbackError("Technical profile is not accepted.")

        # Resolve reference file if present
        ref = data.get("profile_data_ref")
        if ref and isinstance(ref, str):
            import os
            import json
            if os.path.exists(ref):
                try:
                    with open(ref, "r") as f:
                        file_payload = json.load(f)
                        if isinstance(file_payload, dict):
                            def merge_dict(target: dict, source: dict) -> None:
                                for k, v in source.items():
                                    if k not in target or target[k] in ([], {}, None, ""):
                                        target[k] = v
                                    elif isinstance(target[k], dict) and isinstance(v, dict):
                                        merge_dict(target[k], v)
                            merge_dict(data, file_payload)
                except Exception:
                    pass
        return data

    def dispatch_agentic_tool(self, payload: dict) -> dict:
        """Dispatch one already validated/authorized agentic tool to the trusted API."""
        path = InternalPath.AGENTIC_TOOL_DISPATCH
        data = self._post_with_retry(path, payload)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Agentic tool dispatch response was invalid.")
        return data

    def create_targeted_reanalysis_request(self, payload: dict) -> dict:
        """Create a targeted-reanalysis lifecycle request through the runtime bridge."""
        path = InternalPath.TARGETED_REANALYSIS_CREATE
        data = self._post_with_retry(path, payload)
        if not isinstance(data, dict):
            raise WorkerCallbackError(
                "Targeted reanalysis runtime response was invalid."
            )
        return data

    def resume_waiting_runs(self, corpus_version_id: str, payload: dict) -> dict:
        """Ask the API to resume workflows waiting on a legal corpus version."""
        path = (
            f"/internal/legal-rule-catalog/corpus/{corpus_version_id}"
            "/resume-waiting-runs"
        )
        data = self._post_with_retry(path, payload)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Resume waiting runs response was invalid.")
        return data

    def ingest_validated_legal_corpus_draft(self, payload: dict) -> dict:
        """Submit a validated legal-corpus draft for server-side persistence."""
        data = self._post_with_retry(
            "/internal/legal-rule-catalog/corpus/validated-draft",
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus ingest response was invalid.")
        return data

    def recover_legal_rules_from_active_corpus(self, payload: dict) -> dict:
        """Create approved LegalRule source rows from active corpus candidate chunks."""
        data = self._post_with_retry(
            "/internal/legal-rule-catalog/rules/recover-from-active-corpus",
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal rule recovery response was invalid.")
        return data

    def register_validated_retrieval_index(
        self, corpus_version_id: str, payload: dict
    ) -> dict:
        """Register a validated retrieval index against its pinned corpus version."""
        data = self._post_with_retry(
            (
                f"/internal/legal-rule-catalog/corpus/{corpus_version_id}"
                "/retrieval-indexes/validated"
            ),
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Retrieval index response was invalid.")
        return data

    def activate_validated_corpus_version(
        self, corpus_version_id: str, payload: dict
    ) -> dict:
        """Activate a corpus version only after its validation/index pipeline succeeds."""
        data = self._post_with_retry(
            (
                f"/internal/legal-rule-catalog/corpus/{corpus_version_id}"
                "/activate-validated"
            ),
            payload,
        )
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus activation response was invalid.")
        return data

    def get_wizard_profile_for_assessment(self, assessment_id: str) -> dict | None:
        """Fetch an assessment wizard profile, treating 404 as an optional absence."""
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
        """Fetch canonical flow/wizard/conflict context used to finalize a verified profile."""
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
        """Persist a verified profile after reconciliation gates pass."""
        path = CallbackPath.VERIFIED_PROFILE
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)

    def get_verified_profile_by_id(self, verified_profile_id: str) -> dict:
        """Fetch a persisted verified profile by ID."""
        path = f"/internal/reconciliation/verified-profiles/{verified_profile_id}"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Verified profile response was invalid.")
        return data

    def get_legal_rule_match_by_id(self, legal_rule_match_id: str) -> dict:
        """Fetch a legal-rule-match artifact and require accepted status."""
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
        """Fetch the active legal rule catalog/version metadata."""
        path = "/internal/legal-rule-catalog/active"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal rule catalog response was invalid.")
        return data

    def get_active_legal_corpus(self) -> dict:
        """Fetch metadata for the currently active legal corpus version."""
        path = "/internal/legal-rule-catalog/corpus/active"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus response was invalid.")
        return data

    def get_legal_corpus_chunks(self, corpus_version_id: str) -> dict:
        """Fetch persisted text chunks for a specific legal corpus version."""
        path = f"/internal/legal-rule-catalog/corpus/{corpus_version_id}/chunks"
        data = self._get_with_retry(path)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Legal corpus chunks response was invalid.")
        return data

    def get_official_source_snapshot(
        self, *, snapshot_ref: str | None = None, snapshot_id: str | None = None
    ) -> dict:
        """Fetch an official legal-source snapshot by immutable ref or internal ID."""
        path = InternalPath.LEGAL_SOURCE_SNAPSHOTS
        params = {}
        if snapshot_ref:
            params["snapshot_ref"] = snapshot_ref
        if snapshot_id:
            params["snapshot_id"] = snapshot_id
        data = self._get_with_retry(path, params=params)
        if not isinstance(data, dict):
            raise WorkerCallbackError("Official source snapshot response was invalid.")
        return data

    def post_legal_rule_match_callback(
        self, payload: LegalRuleMatchCallbackPayload
    ) -> CallbackResponse:
        """Persist a guarded legal-rule-match result."""
        path = CallbackPath.LEGAL_RULE_MATCH
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)

    def post_classification_callback(
        self, payload: ClassificationCallbackPayload
    ) -> CallbackResponse:
        """Persist the final classification callback result."""
        path = CallbackPath.CLASSIFICATION
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)

    def get_audit_events(
        self, organization_id: str, from_date: str, to_date: str
    ) -> list[dict]:
        """Fetch organization audit events for an inclusive export date range."""
        path = InternalPath.AUDIT_EVENTS.format(organization_id=organization_id)
        params = {"from_date": from_date, "to_date": to_date}
        data = self._get_with_retry(path, params=params)
        if not isinstance(data, list):
            raise WorkerCallbackError("Audit events response was invalid.")
        return [entry for entry in data if isinstance(entry, dict)]

    def post_audit_export_callback(
        self, export_request_id: str, payload: AuditExportCallbackPayload
    ) -> CallbackResponse:
        """Persist READY/FAILED state for an audit export request."""
        path = CallbackPath.AUDIT_EXPORT.format(export_request_id=export_request_id)
        resp_data = self._post_with_retry(path, payload.model_dump())
        return CallbackResponse(**resp_data)
