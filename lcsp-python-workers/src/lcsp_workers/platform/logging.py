"""Configure structured worker logging with correlation and secret redaction."""

import structlog
from lcsp_workers.platform.correlation import get_correlationId
from lcsp_workers.platform.redaction import redact_dict


def _inject_correlationId(logger, method_name, event_dict):
    """Attach the active correlation identifier to a structured log event.

    Args:
        logger: Structlog logger invoking the processor.
        method_name: Logging method name supplied by structlog.
        event_dict: Mutable structured event payload.

    Returns:
        The event payload enriched with ``correlationId``.
    """
    event_dict["correlationId"] = get_correlationId()
    return event_dict


def _redact_secrets(logger, method_name, event_dict):
    """Remove configured secret values before a log event is rendered.

    Args:
        logger: Structlog logger invoking the processor.
        method_name: Logging method name supplied by structlog.
        event_dict: Structured event payload to sanitize.

    Returns:
        A redacted copy of the event payload.
    """
    return redact_dict(event_dict)


def configure_logging(level: str = "INFO") -> None:
    """Configure JSON logging for worker processes.

    Correlation enrichment and secret redaction run before log-level and
    rendering processors so downstream logs remain traceable without exposing
    sensitive values.

    Args:
        level: Minimum log level accepted by the bound logger.
    """
    structlog.configure(
        processors=[
            _inject_correlationId,
            _redact_secrets,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(structlog.stdlib.logging, level.upper(), structlog.stdlib.logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str):
    """Return a named structlog logger.

    Args:
        name: Logical logger/component name.

    Returns:
        A structlog bound logger for the requested component.
    """
    return structlog.get_logger(name)
