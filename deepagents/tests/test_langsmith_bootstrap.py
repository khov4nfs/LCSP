from __future__ import annotations

import os

from langsmith_bootstrap import disable_langsmith_tracing_by_default


def test_langsmith_tracing_is_disabled_by_default(monkeypatch) -> None:
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "true")
    monkeypatch.delenv("LCSP_LANGSMITH_TRACING", raising=False)

    disable_langsmith_tracing_by_default()

    assert os.environ["LANGSMITH_TRACING"] == "false"
    assert os.environ["LANGCHAIN_TRACING_V2"] == "false"


def test_langsmith_tracing_can_be_explicitly_enabled(monkeypatch) -> None:
    monkeypatch.setenv("LCSP_LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "true")

    disable_langsmith_tracing_by_default()

    assert os.environ["LANGSMITH_TRACING"] == "true"
    assert os.environ["LANGCHAIN_TRACING_V2"] == "true"
