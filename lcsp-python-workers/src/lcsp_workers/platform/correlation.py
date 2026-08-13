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
    if headers and "correlationId" in headers:
        return str(headers["correlationId"])
    return str(uuid.uuid4())
