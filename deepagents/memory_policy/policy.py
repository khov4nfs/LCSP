"""Executable policy constants for LCSP agent memory boundaries."""

from __future__ import annotations

AUTHORITATIVE_MEMORY_NAMESPACES = (
    "lcsp/checkpoints",
    "lcsp/assessments",
    "lcsp/legal",
    "lcsp/episodes",
    "lcsp/procedures",
)

DISABLED_MANAGED_MEMORY_PATHS = (
    "memory.py",
    "orchestration/memory.py",
    "/memories/agent",
)

TRUST_LEVELS = (
    "AUTHORITATIVE_SOURCE",
    "AUTHORITATIVE_DERIVED",
    "VERIFIED",
    "USER_ASSERTED",
    "INFERRED_UNVERIFIED",
)


def is_managed_durable_memory_allowed(namespace: str) -> bool:
    """LCSP must not use deployment-shared MDA memory for domain facts."""
    normalized = namespace.strip().lower()
    return not (
        normalized == "/memories/agent"
        or normalized.startswith("/memories/agent/")
    )
