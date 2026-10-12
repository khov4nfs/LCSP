"""Validate the configured native checkpoint database URL."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def checkpoint_database_url(value: object) -> str | None:
    """Return a configured Postgres checkpoint URL or disable checkpointing.

    Raises:
        ValueError: If a non-empty URL does not use a Postgres scheme.
    """
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if not cleaned.startswith(("postgresql://", "postgres://")):
        raise ValueError(
            "LANGGRAPH_CHECKPOINT_DATABASE_URL must use postgres:// or postgresql://"
        )
    return _without_prisma_schema_query_param(cleaned)


def _without_prisma_schema_query_param(value: str) -> str:
    parsed = urlsplit(value)
    query_items = [
        (key, item_value)
        for key, item_value in parse_qsl(parsed.query, keep_blank_values=True)
        if key != "schema"
    ]
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urlencode(query_items),
            parsed.fragment,
        )
    )
