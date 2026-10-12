from __future__ import annotations

import logging

from tools.common.capabilities.platform.logging import suppress_langgraph_heartbeat_logs


def test_private_logs_use_assessment_stream_context_and_skip_unattributed_content(tmp_path, monkeypatch):
    from orchestration.agent_stream import AgentStreamSession, activate_agent_stream
    from tools.common.capabilities.platform import logging_path
    from tools.common.capabilities.platform.logging import PartitionedLogWriter

    monkeypatch.setattr(logging_path, "get_repo_root", lambda: str(tmp_path))
    rendered = '{"event":"synthetic activity"}\n'
    PartitionedLogWriter._persist_structured_event({"event": "synthetic activity"}, rendered)
    assert not (tmp_path / "tmp").exists()
    session = AgentStreamSession("owned", "run", "correlation", "assessment_root_requested", lambda _: None)
    with activate_agent_stream(session):
        PartitionedLogWriter._persist_structured_event({"assessmentId": "another"}, rendered)
    assert (tmp_path / "tmp/user_unknown_user/assessment_owned/run.log").read_text() == rendered
    assert not (tmp_path / "tmp/user_unknown_user/assessment_another").exists()
    logging_path.erase_assessment_logs("owner", "owned")
    assert not (tmp_path / "tmp/user_unknown_user/assessment_owned").exists()


def test_langgraph_heartbeat_loggers_are_suppressed() -> None:
    suppress_langgraph_heartbeat_logs()

    assert (
        logging.getLogger("langgraph_api.metrics_collector").level
        == logging.WARNING
    )
    assert (
        logging.getLogger("langgraph_runtime_inmem.queue").level
        == logging.WARNING
    )


def test_langgraph_format_exc_info_advisory_is_ignored() -> None:
    import warnings

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        suppress_langgraph_heartbeat_logs()
        warnings.warn(
            "Remove `format_exc_info` from your processor chain if you want pretty exceptions.",
            UserWarning,
        )
        warnings.warn("unrelated advisory", UserWarning)

    assert [str(item.message) for item in caught] == ["unrelated advisory"]
