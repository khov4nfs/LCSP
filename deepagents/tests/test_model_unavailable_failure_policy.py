"""A model route outage is a provider failure, not a broken task.

Providers report a withdrawn, overloaded or not-yet-live model as a 400/404
``invalid_request_error``, which is indistinguishable by status from a genuinely
malformed request:

    Error code: 400 - {'error': {'message': "Model 'X' is currently unavailable.",
                       'type': 'invalid_request_error', 'code': 'model_unavailable'}}

Classifying it by status alone made the Scanner boundary mark the scan job
terminally FAILED — no provider fallback, no redelivery, and the assessment left
with no evidence and an EVIDENCE_BUILD_FAILED overview. The agent turn was fine;
only the route was down.
"""

from __future__ import annotations

import httpx
import pytest

from middleware.failure_policy import (
    is_provider_capacity_failure,
    is_provider_model_unavailable,
    is_terminal_boundary_error,
    is_terminal_task_error,
    retry_model_error,
)
from middleware.provider_fallback import (
    provider_circuit_breaker_failure,
    provider_fallback_failure,
)


class _ProviderError(Exception):
    """Shaped like the OpenAI-compatible SDK error the provider actually raises."""

    def __init__(self, message: str, status_code: int, body: dict | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _model_unavailable(
    model: str = "minimax-m2.7", code: str = "model_unavailable", status: int = 400
) -> _ProviderError:
    body = {
        "error": {
            "message": f"Model '{model}' is currently unavailable.",
            "type": "invalid_request_error",
            "param": None,
            "code": code,
        }
    }
    return _ProviderError(f"Error code: {status} - {body}", status, body)


def _malformed_request() -> _ProviderError:
    body = {
        "error": {
            "message": "Invalid schema for function 'read_file'.",
            "type": "invalid_request_error",
            "code": "invalid_request_error",
        }
    }
    return _ProviderError(f"Error code: 400 - {body}", 400, body)


# -- classification --------------------------------------------------------


@pytest.mark.parametrize(
    "code",
    [
        "model_unavailable",
        "model_not_found",
        "model_not_available",
        "model_overloaded",
        "model_decommissioned",
    ],
)
def test_every_model_route_outage_code_is_recognized(code: str) -> None:
    assert is_provider_model_unavailable(_model_unavailable(code=code))


def test_recognized_from_the_message_when_no_code_is_supplied() -> None:
    """Some providers put the reason only in the message text."""
    error = _ProviderError(
        "Error code: 400 - model_unavailable: Model 'X' is currently unavailable.",
        400,
        None,
    )
    assert is_provider_model_unavailable(error)


def test_a_model_outage_is_not_a_terminal_task_error() -> None:
    assert not is_terminal_task_error(_model_unavailable())


@pytest.mark.parametrize("status", [400, 404])
def test_the_outage_stays_non_terminal_on_either_status(status: int) -> None:
    assert not is_terminal_task_error(_model_unavailable(status=status))


def test_a_genuinely_malformed_request_is_still_terminal() -> None:
    """The narrow carve-out must not make every provider 400 retryable."""
    malformed = _malformed_request()
    assert not is_provider_model_unavailable(malformed)
    assert is_terminal_task_error(malformed)


def test_a_model_outage_is_not_mistaken_for_a_capacity_failure() -> None:
    """Quota and rate limits have their own cooldown behaviour; this is not that."""
    assert not is_provider_capacity_failure(_model_unavailable())


def test_the_outage_is_found_through_a_wrapped_exception_chain() -> None:
    try:
        raise _model_unavailable()
    except _ProviderError as provider_error:
        wrapped = RuntimeError("agent turn failed")
        wrapped.__cause__ = provider_error
        assert is_provider_model_unavailable(wrapped)
        assert not is_terminal_task_error(wrapped)


# -- routing ---------------------------------------------------------------


def test_provider_fallback_runs_for_a_model_outage() -> None:
    """The point of the fix: the same request goes to the next provider."""
    assert provider_fallback_failure(_model_unavailable())


def test_the_dead_route_is_taken_out_for_the_rest_of_the_run() -> None:
    """A withdrawn model does not come back mid-run; stop re-selecting it."""
    assert provider_circuit_breaker_failure(_model_unavailable())


def test_the_same_route_is_not_retried_with_the_same_request() -> None:
    """Retrying a model the provider just called unavailable burns the budget."""
    assert not retry_model_error(_model_unavailable())


def test_provider_fallback_is_still_refused_for_a_malformed_request() -> None:
    assert not provider_fallback_failure(_malformed_request())


# -- the Scanner boundary --------------------------------------------------
