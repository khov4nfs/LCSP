"""Shared terminal failure classification for model calls and queue delivery."""
from langchain_anthropic.chat_models import AnthropicModelNotFoundError
from langchain.agents.structured_output import StructuredOutputError
from langchain_core.exceptions import (
    ModelAuthenticationError,
    ModelError,
    ModelPermissionDeniedError,
)
from pydantic import ValidationError


_AUTH_FAILURE_STATUSES = frozenset({401, 403})
# Typed provider rejections of the credential, not of the request. They are
# non-retryable for the same credential, yet another credential or provider may succeed.
_CREDENTIAL_MODEL_ERRORS = (ModelAuthenticationError, ModelPermissionDeniedError)
_PROVIDER_CAPACITY_STATUSES = frozenset({402, 429})
_PROVIDER_QUOTA_EXHAUSTION_CODES = frozenset(
    {
        "allowance_exhausted",
        "billing_hard_limit_reached",
        "insufficient_balance",
        "insufficient_quota",
        "quota_exceeded",
    }
)
_PROVIDER_CAPACITY_CODES = _PROVIDER_QUOTA_EXHAUSTION_CODES | {"rate_limit_exceeded"}
_PROVIDER_ROUTE_INCOMPATIBILITY_CODES = frozenset(
    {
        "upstream_unprocessable_request",
    }
)
# The route is down, not the request. Providers report a withdrawn, overloaded or
# not-yet-live model as a 400/404 "invalid request", which reads exactly like a
# malformed payload but is the opposite: the request is fine and the same request
# succeeds on another provider. Classified separately so provider fallback runs
# instead of the task dying on a route outage.
_PROVIDER_MODEL_UNAVAILABLE_CODES = frozenset(
    {
        "model_decommissioned",
        "model_not_available",
        "model_not_found",
        "model_overloaded",
        "model_unavailable",
    }
)


# A provider route's model declined to answer one sample ("I can't help with that request"). Some
# gateways report it as a mid-stream error carrying a 400-like code, which reads exactly like a
# rejected request but is the opposite: the request is fine and another sample or route answers it.
_PROVIDER_REFUSAL_PHRASES = (
    "can't help with that",
    "cannot help with that",
    "can't assist with that",
    "cannot assist with that",
    "unable to help with that",
    "unable to assist with that",
    # Inception's wording for a safety refusal of legal text that merely describes prohibited conduct.
    "can't help with this because it involves",
    "cannot help with this because it involves",
    "potentially dangerous or harmful content",
)


class TerminalCredentialError(RuntimeError):
    """Every configured credential has failed; do not retry the list."""


class TerminalSchemaError(ValueError):
    """Structured output repair would repeat a failed task."""


class MalformedToolCallSample(RuntimeError):
    """One model sample emitted tool calls that cannot execute as written.

    Covers arguments cut off at the output-token cap and arguments that fail the
    tool's own schema. Retryable: the rejected sample is discarded before any tool
    runs and the same request is sampled again, so no error text is fed back as a
    repair prompt. A failure that survives the bounded retries stays terminal.
    """


class AgentRunBudgetExceeded(RuntimeError):
    """One agent run used its whole model-call budget without finishing.

    Terminal for retry, credential rotation and queue delivery: replaying the same
    run would walk the same unbounded loop and spend the same budget again.
    """


class PaidAdmissionError(AgentRunBudgetExceeded):
    """Terminal bounded-inference denial; safe metadata only, never a provider fault."""

    def __init__(self, reason: str, run_id: str, attempt_id: str | None = None):
        """Business purpose: Expose a terminal paid-admission refusal to existing governance and capacity telemetry.

        Business rules:
        - A denial never authorizes retry/fallback or implies zero provider exposure.
        Execution flow:
        1. Keep the established safe error identity and observe an aggregate budget-pressure event.
        Failure cases:
        - The constructed exception remains terminal under existing provider/broker policy.
        Side effects:
        - Records a bounded process-local denial counter; performs no paid call or settlement.
        """
        self.reason, self.run_id, self.attempt_id = reason, run_id, attempt_id
        super().__init__(f"Paid inference admission stopped: {reason}")
        from tools.common.capabilities.agent_runtime.root_capacity import observe_provider_pressure
        observe_provider_pressure(self)


def is_paid_admission_error(error: BaseException) -> bool:
    """Business purpose: Keep a paid-call admission denial from being treated as a provider failure that can trigger another paid attempt.

    Business rules:
    - Only a PaidAdmissionError in the explicit cause/context chain establishes this classification.
    - Traverse chained exceptions once so a cyclic chain cannot loop indefinitely.

    Execution flow:
    1. Follow each exception's cause, falling back to its context.
    2. Return true on the first PaidAdmissionError; otherwise return false at the end of the chain.

    Failure cases:
    - An unrelated exception chain returns false; this classifier does not infer admission denial from status codes.

    Side effects:
    - Pure classification; it does not log, persist state, or invoke a provider.
    """
    seen: set[int] = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        if isinstance(error, PaidAdmissionError):
            return True
        error = error.__cause__ or error.__context__
    return False


class NoProgressDetected(RuntimeError):
    """The Agent repeated the same ineffective action after no-progress feedback."""


class StructuredOutputRejected(TerminalSchemaError):
    """A provider model's own structured output failed the contract.

    Still terminal for retry, credential rotation and queue delivery (repairing with the
    same model would repeat it), but provider-specific: another provider may succeed.
    """


def is_structured_output_rejection(error: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, StructuredOutputRejected):
            return True
        current = current.__cause__ or current.__context__
    return False


def error_status(error: BaseException) -> int | None:
    """Return the first integer HTTP-like status found on an exception chain."""
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        status = getattr(current, "status_code", None) or getattr(current, "code", None)
        if isinstance(status, int):
            return status
        current = current.__cause__ or current.__context__
    return None


def _error_codes(error: BaseException) -> set[str]:
    codes: set[str] = set()
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        for attr in ("error_code", "type", "code"):
            value = getattr(current, attr, None)
            if isinstance(value, str) and value.strip():
                codes.add(value.strip().lower())
        for payload in (
            getattr(current, "body", None),
            getattr(current, "response", None),
        ):
            if isinstance(payload, dict):
                error_payload = payload.get("error")
                if isinstance(error_payload, dict):
                    for key in ("code", "type"):
                        value = error_payload.get(key)
                        if isinstance(value, str) and value.strip():
                            codes.add(value.strip().lower())
                    message = error_payload.get("message")
                    if isinstance(message, str):
                        normalized_message = (
                            message.lower().replace("_", " ").replace("-", " ")
                        )
                        if (
                            "allowance exhausted" in normalized_message
                            or "insufficient quota" in normalized_message
                            or (
                                "monthly allowance" in normalized_message
                                and "used up" in normalized_message
                            )
                        ):
                            codes.add("allowance_exhausted")
        text = str(current).lower()
        for code in _PROVIDER_CAPACITY_CODES | _PROVIDER_MODEL_UNAVAILABLE_CODES:
            if code in text:
                codes.add(code)
        current = current.__cause__ or current.__context__
    return codes


def _is_credential_model_error(error: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, _CREDENTIAL_MODEL_ERRORS):
            return True
        current = current.__cause__ or current.__context__
    return False


def is_auth_failure(error: BaseException) -> bool:
    """Return whether the provider rejected the credential (401/403 or typed auth error).

    An auth failure is never retried with the same credential (see retry_model_error),
    but it is not a terminal task error: credential and provider fallback may continue.
    """
    return error_status(error) in _AUTH_FAILURE_STATUSES or _is_credential_model_error(error)


def is_provider_capacity_failure(error: BaseException) -> bool:
    if error_status(error) in _PROVIDER_CAPACITY_STATUSES:
        return True
    return bool(_error_codes(error) & _PROVIDER_CAPACITY_CODES)


def is_provider_quota_exhaustion(error: BaseException) -> bool:
    """A depleted allowance cannot recover during a short rate-limit cooldown."""
    return bool(_error_codes(error) & _PROVIDER_QUOTA_EXHAUSTION_CODES)


def is_provider_route_incompatibility(error: BaseException) -> bool:
    """Return whether an external provider route rejected a valid agent turn shape."""
    return (
        error_status(error) == 422
        and bool(_error_codes(error) & _PROVIDER_ROUTE_INCOMPATIBILITY_CODES)
    )


def is_provider_model_unavailable(error: BaseException) -> bool:
    """Business purpose: Distinguish an unavailable provider model route from a rejected task so another configured route can be considered.

    Business rules:
    - An Anthropic model-not-found exception or a recognized provider model-unavailable code establishes the condition.
    - Route unavailability is not terminal for the task, but retrying that same route within the turn is not useful.

    Execution flow:
    1. Search the cause/context chain for AnthropicModelNotFoundError, guarding against cycles.
    2. If none is present, check the error-code set for a recognized unavailable-model code.

    Failure cases:
    - Unrecognized errors return false and remain subject to the other retry classifiers.

    Side effects:
    - Pure classification with no provider calls or state changes.
    """
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, AnthropicModelNotFoundError):
            return True
        current = current.__cause__ or current.__context__
    return bool(_error_codes(error) & _PROVIDER_MODEL_UNAVAILABLE_CODES)


def is_provider_refusal(error: BaseException) -> bool:
    """Business purpose: Identify a provider refusal of one generated sample so retry policy can resample or use another route.

    Business rules:
    - A content_filter code or a recognized refusal phrase in the chained error text is treated as a sample refusal.
    - A refusal is not by itself a terminal task error because a later sample or route may answer.

    Execution flow:
    1. Check normalized provider error codes for content_filter.
    2. Traverse the cause/context chain once, normalize apostrophes and casing, and search for known refusal phrases.
    3. Return false when no refusal signal is found.

    Failure cases:
    - Unrecognized wording and codes return false; the classifier does not interpret arbitrary provider text as a refusal.

    Side effects:
    - Pure classification; it does not retry or change route state.
    """
    if "content_filter" in _error_codes(error):
        return True
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        text = str(current).lower().replace("\u2019", "'")
        if any(phrase in text for phrase in _PROVIDER_REFUSAL_PHRASES):
            return True
        current = current.__cause__ or current.__context__
    return False


def is_terminal_task_error(error: BaseException) -> bool:
    """Business purpose: Stop retries for failures that cannot converge by resending the same rejected task payload.

    Business rules:
    - Type, validation, structured-output, terminal credential, run-budget, and no-progress errors in the chain are terminal.
    - Callback-client rejection and provider 400/404/422 errors are terminal unless classified as model unavailability or a provider refusal.
    - Non-retryable ModelError is terminal except for credential-specific and unavailable-model errors, which other policies may route around.

    Execution flow:
    1. Walk the cause/context chain once and check the explicit terminal exception classes.
    2. Check callback-client rejection and request-level provider statuses with the model-unavailable and refusal exceptions.
    3. Apply ModelError retryability rules, then return false if the chain has no terminal signal.

    Failure cases:
    - A non-terminal result does not guarantee retry success; it leaves the decision to credential, provider-route, and model retry policies.

    Side effects:
    - Pure classification; it does not mutate task state or invoke a model.
    """
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TypeError, ValidationError, StructuredOutputError, TerminalSchemaError, TerminalCredentialError, AgentRunBudgetExceeded, NoProgressDetected)):
            return True
        # Our own API rejected this payload. The boundary re-runs the model on every
        # redelivery, so requeueing an identical rejected decision is an unbounded spend
        # that never converges; fail loudly instead. Duck-typed to keep the queue policy
        # independent of the API client module.
        if getattr(current, "callback_client_error", False):
            return True
        # Provider request/schema rejection cannot succeed with the same request.
        # A model-unavailability code arrives with the same status but means the
        # route is down, not the request, so it stays non-terminal and falls back.
        status = getattr(current, "status_code", None) or getattr(current, "code", None)
        if (
            status in (400, 404, 422)
            and not is_provider_model_unavailable(current)
            and not is_provider_refusal(current)
        ):
            return True
        # A non-retryable credential rejection only rules out the same credential; it is
        # classified by is_auth_failure so credential/provider fallback can continue.
        if (
            isinstance(current, ModelError)
            and not current.is_retryable
            and not isinstance(current, _CREDENTIAL_MODEL_ERRORS)
            and not is_provider_model_unavailable(current)
        ):
            return True
        current = current.__cause__ or current.__context__
    return False


def is_terminal_boundary_error(error: BaseException) -> bool:
    """Return whether a failure that escaped the model stack must stop the whole task.

    Inside the model stack an auth failure moves to another credential or provider. Once
    it escapes to a task boundary, every eligible route has already been tried, so
    redelivering the task would only resend a rejected credential. A non-retryable
    boundary failure is never redelivered either, so retrying is pointless.
    """
    return (
        is_terminal_task_error(error)
        or is_auth_failure(error)
        or _is_non_retryable_boundary_error(error)
    )


def _is_non_retryable_boundary_error(error: BaseException) -> bool:
    # Duck-typed to keep the failure policy independent of the Agent Runtime module.
    return any(
        cls.__name__ == "NonRetryableAgentBoundaryError" for cls in type(error).__mro__
    )


def retry_model_error(error: Exception) -> bool:
    # Re-sending the same request with the same rejected credential cannot succeed.
    # Queue redelivery policy lives in is_terminal_boundary_error.
    """Business purpose: Decide whether the model retry layer may resubmit a failed inference.

    Business rules:
    - Paid-call admission, terminal task, authentication, provider-capacity, and unavailable-model failures are not retried on the same model attempt.
    - Other errors remain eligible for the surrounding bounded model retry policy.

    Execution flow:
    1. Apply each exclusion classifier to the original error and its chained causes.
    2. Return true only when none of the excluded conditions applies.

    Failure cases:
    - Classification alone does not guarantee another attempt; outer retry limits and provider routing still govern execution.

    Side effects:
    - Pure classification with no scheduling, logging, or provider call.
    """
    return (
        not is_paid_admission_error(error)
        and not is_terminal_task_error(error)
        and not is_auth_failure(error)
        and not is_provider_capacity_failure(error)
        # Resending to a model the provider just called unavailable only burns
        # the retry budget that provider fallback needs.
        and not is_provider_model_unavailable(error)
    )
