"""Shared terminal failure classification for model calls and queue delivery."""
from langchain.agents.structured_output import StructuredOutputError
from langchain_core.exceptions import ModelError
from pydantic import ValidationError


_AUTH_FAILURE_STATUSES = frozenset({401, 403})


class TerminalCredentialError(RuntimeError):
    """Every configured credential has failed; do not retry the list."""


class TerminalSchemaError(ValueError):
    """Structured output repair would repeat a failed task."""


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


def is_auth_failure(error: BaseException) -> bool:
    return error_status(error) in _AUTH_FAILURE_STATUSES


def is_terminal_task_error(error: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TypeError, ValidationError, StructuredOutputError, TerminalSchemaError, TerminalCredentialError)):
            return True
        # Our own API rejected this payload. The boundary re-runs the model on every
        # redelivery, so requeueing an identical rejected decision is an unbounded spend
        # that never converges; fail loudly instead. Duck-typed to keep the queue policy
        # independent of the API client module.
        if getattr(current, "callback_client_error", False):
            return True
        # Provider request/schema rejection cannot succeed with the same request.
        status = getattr(current, "status_code", None) or getattr(current, "code", None)
        if status in (400, 404, 422):
            return True
        if isinstance(current, ModelError) and not current.is_retryable:
            return True
        current = current.__cause__ or current.__context__
    return False


def retry_model_error(error: Exception) -> bool:
    # Re-sending the same request with the same rejected credential cannot succeed.
    # Queue redelivery policy is intentionally unchanged (see is_terminal_task_error).
    return not is_terminal_task_error(error) and not is_auth_failure(error)
