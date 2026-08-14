import contextvars
import uuid

_cid: contextvars.ContextVar[str] = contextvars.ContextVar(
    "correlationId", default="unknown"
)

def set_correlationId(cid: str) -> None:
    _cid.set(cid)

def get_correlationId() -> str:
    return _cid.get()

def extract_from_amqp_headers(headers: dict | None) -> str:
    """Extract correlationId from AMQP headers or generate a new one."""
    if headers:
        for key in ("correlationId", "x-correlation-id"):
            if key in headers:
                return str(headers[key])
    return str(uuid.uuid4())
