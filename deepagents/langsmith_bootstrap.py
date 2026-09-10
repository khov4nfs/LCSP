"""LangSmith bootstrap controls for LCSP worker runtimes."""

from __future__ import annotations

import os


def disable_langsmith_tracing_by_default() -> None:
    """Keep LangSmith tracing off unless explicitly re-enabled for a run."""
    if os.getenv("LCSP_LANGSMITH_TRACING", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
        return

    os.environ["LANGSMITH_TRACING"] = "false"
    os.environ["LANGCHAIN_TRACING_V2"] = "false"


__all__ = ["disable_langsmith_tracing_by_default"]
