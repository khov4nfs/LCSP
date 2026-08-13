import structlog
from lcsp_workers.platform.correlation import get_correlationId
from lcsp_workers.platform.redaction import redact_dict


def _inject_correlationId(logger, method_name, event_dict):
    event_dict["correlationId"] = get_correlationId()
    return event_dict


def _redact_secrets(logger, method_name, event_dict):
    return redact_dict(event_dict)


def configure_logging(level: str = "INFO") -> None:
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
    return structlog.get_logger(name)
