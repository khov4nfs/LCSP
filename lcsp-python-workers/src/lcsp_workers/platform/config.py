import os
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerConfig:
    rabbitmq_url: str
    rabbitmq_exchange: str
    nestjs_api_base_url: str
    worker_api_key: str
    log_level: str
    max_retries: int
    legal_source_storage_root: str | None = None
    langgraph_checkpoint_database_url: str | None = None


def load_config() -> WorkerConfig:
    missing = [
        v
        for v in ["RABBITMQ_URL", "NESTJS_API_BASE_URL", "WORKER_API_KEY"]
        if not os.getenv(v)
    ]
    if missing:
        raise RuntimeError(f"Missing required env vars: {missing}")

    return WorkerConfig(
        rabbitmq_url=os.getenv("RABBITMQ_URL"),
        rabbitmq_exchange=os.getenv("RABBITMQ_EXCHANGE", "lcsp.events"),
        nestjs_api_base_url=os.getenv("NESTJS_API_BASE_URL"),
        worker_api_key=os.getenv("WORKER_API_KEY"),
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        max_retries=int(os.getenv("MAX_RETRIES", "3")),
        legal_source_storage_root=os.getenv("LEGAL_SOURCE_STORAGE_ROOT"),
        langgraph_checkpoint_database_url=os.getenv(
            "LANGGRAPH_CHECKPOINT_DATABASE_URL"
        ),
    )
