from __future__ import annotations

import json
from io import StringIO

from lcsp_workers.platform.logging import PartitionedLogWriter, configure_logging


def test_configure_logging_creates_root_llm_tool_log_eagerly(monkeypatch, tmp_path) -> None:
    from lcsp_workers.platform import logging_path

    monkeypatch.setattr(logging_path, "get_repo_root", lambda: str(tmp_path))

    configure_logging()

    log_path = tmp_path / "tmp" / "llm-tool-calls.log"
    assert log_path.exists()
    assert log_path.read_text() == ""


def test_safe_llm_and_tool_events_are_mirrored_to_root_tmp(monkeypatch, tmp_path) -> None:
    from lcsp_workers.platform import logging_path

    monkeypatch.setattr(logging_path, "get_repo_root", lambda: str(tmp_path))
    writer = PartitionedLogWriter(StringIO())

    events = [
        {"event": "LLM_REQUEST", "operation": "complete_with_tools"},
        {"event": "LLM_RESPONSE", "tool_call_count": 1},
        {
            "event": "ENGINEERING_INVESTIGATION_TOOL_CALL",
            "engineering_rule_id": "eng-1",
            "tool": "search_nodes",
            "call_id": "call-1",
            "arguments": {"node_types": ["HUMAN_REVIEW"], "max_results": 5},
        },
        {
            "event": "ENGINEERING_INVESTIGATION_TOOL_RESULT",
            "engineering_rule_id": "eng-1",
            "tool": "search_nodes",
            "call_id": "call-1",
            "result": [
                {
                    "node_id": "node-1",
                    "node_type": "HUMAN_REVIEW",
                    "evidence_refs": ["evidence:review-1"],
                }
            ],
        },
        {
            "event": "ENGINEERING_INVESTIGATION_FINISHED",
            "engineering_rule_id": "eng-1",
            "claim_types": ["RULE_REQUIREMENT_MET"],
        },
    ]
    for event in events:
        writer.write(json.dumps(event) + "\n")

    log_path = tmp_path / "tmp" / "llm-tool-calls.log"
    assert log_path.exists()
    persisted = [json.loads(line) for line in log_path.read_text().splitlines()]
    assert [row["event"] for row in persisted] == [row["event"] for row in events]
    tool_result = next(
        row
        for row in persisted
        if row["event"] == "ENGINEERING_INVESTIGATION_TOOL_RESULT"
    )
    assert tool_result["call_id"] == "call-1"
    assert tool_result["result"][0]["node_id"] == "node-1"
    assert tool_result["result"][0]["evidence_refs"] == ["evidence:review-1"]


def test_root_llm_tool_log_redacts_tool_result_even_when_writer_gets_raw_data(
    monkeypatch,
    tmp_path,
) -> None:
    from lcsp_workers.platform import logging_path

    monkeypatch.setattr(logging_path, "get_repo_root", lambda: str(tmp_path))
    writer = PartitionedLogWriter(StringIO())

    writer.write(
        json.dumps(
            {
                "event": "ENGINEERING_INVESTIGATION_TOOL_RESULT",
                "tool": "symbol_context",
                "result": {
                    "symbol": {"node_id": "node-1"},
                    "api_key": "SECRET_API_KEY_123456",
                    "authorization": "Bearer secret-token-value",
                },
            }
        )
        + "\n"
    )

    log_path = tmp_path / "tmp" / "llm-tool-calls.log"
    persisted = json.loads(log_path.read_text().strip())
    assert persisted["result"]["symbol"]["node_id"] == "node-1"
    assert persisted["result"]["api_key"] == "[REDACTED]"
    assert persisted["result"]["authorization"] == "[REDACTED]"
    assert "SECRET_API_KEY_123456" not in log_path.read_text()
    assert "secret-token-value" not in log_path.read_text()


def test_raw_dev_llm_trace_is_never_mirrored_to_safe_root_log(
    monkeypatch,
    tmp_path,
) -> None:
    from lcsp_workers.platform import logging_path

    monkeypatch.setattr(logging_path, "get_repo_root", lambda: str(tmp_path))
    configure_logging()
    writer = PartitionedLogWriter(StringIO())

    writer.write(
        json.dumps(
            {
                "event": "DEV_LLM_REQUEST_RAW",
                "api_key": "SECRET",
                "prompt": "raw repository source",
            }
        )
        + "\n"
    )

    log_path = tmp_path / "tmp" / "llm-tool-calls.log"
    assert log_path.exists()
    assert log_path.read_text() == ""


def test_llm_tool_log_path_can_be_overridden(monkeypatch, tmp_path) -> None:
    from lcsp_workers.platform import logging_path

    monkeypatch.setattr(logging_path, "get_repo_root", lambda: str(tmp_path))
    monkeypatch.setenv("LCSP_LLM_TOOL_LOG_PATH", "tmp/custom-llm.log")

    configure_logging()
    writer = PartitionedLogWriter(StringIO())
    writer.write(json.dumps({"event": "LLM_RESPONSE", "tool_call_count": 1}) + "\n")

    custom_log = tmp_path / "tmp" / "custom-llm.log"
    assert custom_log.exists()
    assert json.loads(custom_log.read_text().strip())["event"] == "LLM_RESPONSE"
