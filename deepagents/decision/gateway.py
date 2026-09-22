"""Reusable LCSP Decision Gateway for bounded typed decisions."""

from __future__ import annotations

from .contracts import (
    DECISION_PROVIDERS,
    POLICY_ACTIONS,
    DecisionGatewayOutcome,
    DecisionPolicyResult,
    DecisionRequest,
)
from .policy import DecisionGatewayConfig, DecisionPolicy
from .redaction import DecisionRedactionError, validate_outbound_request
from .telemetry import (
    TelemetrySink,
    build_fallback_event,
    build_request_event,
    build_result_event,
    build_threshold_event,
    emit_events,
)
from .typesafe_client import TypeSafeJevClient, TypeSafeJevError


class DecisionGateway:
    """Boundary object for all TypeSafe Jev decision-model invocations."""

    def __init__(
        self,
        *,
        config: DecisionGatewayConfig | None = None,
        policy: DecisionPolicy | None = None,
        client: TypeSafeJevClient | None = None,
        telemetry_sink: TelemetrySink | None = None,
    ) -> None:
        self._config = config or DecisionGatewayConfig.from_env()
        self._policy = policy or DecisionPolicy()
        self._client = client
        self._telemetry_sink = telemetry_sink

    def decide(self, request: DecisionRequest) -> DecisionGatewayOutcome:
        """Invoke Jev when safe; otherwise return an explicit fallback outcome."""

        config = self._config
        if config.provider == DECISION_PROVIDERS["disabled"]:
            return self._fallback(request, "DECISION_PROVIDER_DISABLED")
        if not self._policy.supports_decision_type(request.decision_type):
            return self._fallback(request, "UNKNOWN_DECISION_TYPE")
        if not config.api_key and self._client is None:
            return self._fallback(request, "MISSING_CREDENTIALS")

        try:
            provider_payload = validate_outbound_request(request)
        except DecisionRedactionError as exc:
            return self._fallback(request, exc.reason_code)

        request_event = build_request_event(
            request,
            provider=config.provider,
            model=config.requested_model_version,
        )

        try:
            client = self._client or TypeSafeJevClient(
                api_key=config.api_key or "",
                endpoint=config.endpoint,
                timeout_ms=request.timeout_ms or config.timeout_ms,
                max_retries=config.max_retries,
            )
            result = client.invoke(
                request=request,
                provider_payload=provider_payload,
                policy_version=request.policy_version or config.policy_version,
            )
        except TypeSafeJevError as exc:
            outcome = self._fallback(request, exc.reason_code, request_event=request_event)
            return outcome

        policy_result = self._policy.evaluate(
            request=request,
            result=result,
            config=config,
        )
        events = (
            request_event,
            build_result_event(request, result),
            build_threshold_event(request, policy_result),
        )
        if policy_result.action != POLICY_ACTIONS["accept_typed_decision"]:
            events = (*events, build_fallback_event(request, policy_result))
        emitted = emit_events(self._telemetry_sink, events)
        return DecisionGatewayOutcome(
            request=request,
            provider_result=result,
            policy_result=policy_result,
            telemetry_events=emitted,
        )

    def _fallback(
        self,
        request: DecisionRequest,
        reason_code: str,
        *,
        request_event: dict | None = None,
    ) -> DecisionGatewayOutcome:
        policy_result = self._policy.failure(
            request=request,
            config=self._config,
            reason_code=reason_code,
        )
        events = (
            *((request_event,) if request_event is not None else ()),
            build_threshold_event(request, policy_result),
            build_fallback_event(request, policy_result),
        )
        emitted = emit_events(self._telemetry_sink, events)
        return DecisionGatewayOutcome(
            request=request,
            provider_result=None,
            policy_result=policy_result,
            telemetry_events=emitted,
        )


__all__ = ["DecisionGateway"]
