from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from tools.common.capabilities.platform.graph_runtime import (
    checkpoint_database_url,
    invoke_graph,
)


def test_checkpoint_database_url_accepts_postgres_and_rejects_other_schemes() -> None:
    assert (
        checkpoint_database_url(" postgresql://user:pass@db/lcsp ")
        == "postgresql://user:pass@db/lcsp"
    )
    assert (
        checkpoint_database_url("postgresql://user:pass@db/lcsp?schema=public")
        == "postgresql://user:pass@db/lcsp"
    )
    assert (
        checkpoint_database_url(
            "postgresql://user:pass@db/lcsp?sslmode=prefer&schema=public"
        )
        == "postgresql://user:pass@db/lcsp?sslmode=prefer"
    )
    assert checkpoint_database_url(None) is None
    assert checkpoint_database_url("") is None

    with pytest.raises(ValueError):
        checkpoint_database_url("sqlite:///tmp/checkpoints.db")


def test_invoke_graph_without_checkpoint_uses_initial_state() -> None:
    app = MagicMock()
    app.invoke.return_value = {"result": "completed"}
    build_graph = MagicMock(return_value=app)

    result = invoke_graph(
        build_graph=build_graph,
        initial_state={"input": "value"},
        workflow_run_id="wf-1",
        checkpoint_url=None,
    )

    assert result == {"result": "completed"}
    build_graph.assert_called_once_with(None)
    app.invoke.assert_called_once_with({"input": "value"})


def test_invoke_graph_resumes_incomplete_postgres_thread() -> None:
    saver = MagicMock()
    saver.__enter__.return_value = saver
    saver.__exit__.return_value = False
    app = MagicMock()
    app.get_state.return_value = SimpleNamespace(
        next=("persist",),
        values={"result": "checkpointed"},
    )
    app.invoke.return_value = {"result": "resumed"}
    build_graph = MagicMock(return_value=app)

    with patch(
        "langgraph.checkpoint.postgres.PostgresSaver.from_conn_string",
        return_value=saver,
    ) as from_conn_string:
        result = invoke_graph(
            build_graph=build_graph,
            initial_state={"input": "value"},
            workflow_run_id="wf-resume",
            checkpoint_url="postgresql://user:pass@db/lcsp",
        )

    assert result == {"result": "resumed"}
    from_conn_string.assert_called_once_with("postgresql://user:pass@db/lcsp")
    saver.setup.assert_called_once_with()
    build_graph.assert_called_once_with(saver)
    app.get_state.assert_called_once_with(
        {"configurable": {"thread_id": "wf-resume"}}
    )
    app.invoke.assert_called_once_with(
        None,
        {"configurable": {"thread_id": "wf-resume"}},
    )


def test_invoke_graph_reuses_completed_postgres_thread_without_side_effects() -> None:
    saver = MagicMock()
    saver.__enter__.return_value = saver
    saver.__exit__.return_value = False
    terminal_state = {"result": "already-completed"}
    app = MagicMock()
    app.get_state.return_value = SimpleNamespace(next=(), values=terminal_state)
    build_graph = MagicMock(return_value=app)

    with patch(
        "langgraph.checkpoint.postgres.PostgresSaver.from_conn_string",
        return_value=saver,
    ):
        result = invoke_graph(
            build_graph=build_graph,
            initial_state={"input": "must-not-run-again"},
            workflow_run_id="wf-complete",
            checkpoint_url="postgresql://user:pass@db/lcsp",
        )

    assert result == terminal_state
    app.invoke.assert_not_called()
