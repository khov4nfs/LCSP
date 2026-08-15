"""Propagate correlation identifiers across worker execution contexts."""

import contextvars
import uuid

_cid: contextvars.ContextVar[str] = contextvars.ContextVar(
    "correlationId", default="unknown"
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
