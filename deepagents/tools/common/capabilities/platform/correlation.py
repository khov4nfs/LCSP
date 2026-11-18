"""Propagate correlation identifiers across worker execution contexts."""

import contextvars
from contextlib import contextmanager
import uuid

_cid: contextvars.ContextVar[str] = contextvars.ContextVar(
    "correlationId", default="unknown"
)
_user_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "user_id", default="unknown_user"
)
_assessment_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "assessment_id", default="unknown_assessment"
)


def set_correlationId(cid: str) -> None:
    """Store the active correlation identifier in the current context.

    Args:
        cid: Correlation identifier to attach to subsequent worker operations.
    """
    _cid.set(cid)


def get_correlationId() -> str:
    """Return the correlation identifier associated with the current context."""
    return _cid.get()


@contextmanager
def activate_correlation_id(correlation_id: str):
    """Business purpose: Trace the callbacks for one selected preparation to its dispatch.

    Business rules:
    - Nested worker calls inherit the dispatch identity for the duration of that run.
    Execution flow:
    1. Set the current dispatch identity.
    2. Restore the previously active identity when the run exits.
    Failure cases:
    - A failed or cancelled run still restores the prior identity.
    Side effects:
    - Updates the context-local correlation used for callback headers and diagnostics.
    """
    token = _cid.set(correlation_id)
    try:
        yield
    finally:
        _cid.reset(token)


def set_user_id(uid: str) -> None:
    """Store the active user identifier in the current context."""
    _user_id.set(uid)


def get_user_id() -> str:
    """Return the user identifier associated with the current context."""
    return _user_id.get()


def set_assessment_id(aid: str) -> None:
    """Store the active assessment identifier in the current context."""
    _assessment_id.set(aid)


def get_assessment_id() -> str:
    """Return the assessment identifier associated with the current context."""
    return _assessment_id.get()


def extract_from_amqp_headers(headers: dict | None) -> str:
    """Extract a correlation identifier from AMQP headers.

    A new UUID is generated when the publisher did not provide a supported
    correlation header so every worker execution remains traceable.

    Args:
        headers: Optional AMQP message headers.

    Returns:
        The supplied correlation identifier or a newly generated UUID string.
    """
    if headers:
        for key in ("correlationId", "x-correlation-id"):
            if key in headers:
                return str(headers[key])
    return str(uuid.uuid4())
