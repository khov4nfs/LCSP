from __future__ import annotations

import pytest

from tools.common.platform import dev_unsafe_trace
from tools.common.platform import logging as worker_logging


@pytest.fixture(autouse=True)
def enable_dev_trace(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LCSP_DEV_UNSAFE_TRACE", "true")
    monkeypatch.setenv("NODE_ENV", "development")


def test_large_binary_payload_is_omitted_entirely() -> None:
    archive = b"\x1f\x8b" + (b"\x00" * (128 * 1024))

    assert dev_unsafe_trace._json_safe(archive) is dev_unsafe_trace._OMIT_TRACE_FIELD


def test_binary_field_is_removed_from_nested_mapping() -> None:
    archive = b"\x1f\x8b" + (b"\x00" * 4096)
    payload = {
        "scan_job_id": "scan-1",
        "snapshot_id": "snapshot-1",
        "archive": archive,
    }

    rendered = dev_unsafe_trace._json_safe(payload)

    assert rendered == {
        "scan_job_id": "scan-1",
        "snapshot_id": "snapshot-1",
    }
    assert "archive" not in rendered


def test_oversized_utf8_bytes_are_omitted_entirely() -> None:
    payload = b"x" * (dev_unsafe_trace._MAX_INLINE_UTF8_BYTES + 1)

    assert dev_unsafe_trace._json_safe(payload) is dev_unsafe_trace._OMIT_TRACE_FIELD


def test_large_structured_tool_result_is_collection_bounded() -> None:
    payload = {
        "entries": [
            {"name": f"package-{index}", "version": "1.0.0"}
            for index in range(5000)
        ]
    }

    rendered = dev_unsafe_trace._json_safe(payload)
    entries = rendered["entries"]

    assert entries["encoding"] == "collection-metadata"
    assert entries["collectionType"] == "list"
    assert entries["itemCount"] == 5000
    assert entries["truncated"] is True
    assert len(entries["items"]) == dev_unsafe_trace._MAX_TRACE_COLLECTION_ITEMS


def test_large_text_payload_is_summarized() -> None:
    value = "source-or-result:" + ("x" * (dev_unsafe_trace._MAX_INLINE_TRACE_STRING_CHARS + 100))

    rendered = dev_unsafe_trace._json_safe(value)

    assert rendered["encoding"] == "text-metadata"
    assert rendered["charLength"] == len(value)
    assert rendered["truncated"] is True
    assert len(rendered["preview"]) <= dev_unsafe_trace._TRACE_STRING_PREVIEW_CHARS


def test_small_utf8_bytes_remain_visible_for_debugging() -> None:
    payload = b'{"scanJobId":"scan-1"}'

    assert dev_unsafe_trace._json_safe(payload) == payload.decode("utf-8")


def test_stderr_backpressure_never_breaks_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    class NonBlockingStderr:
        def write(self, _value: str) -> int:
            raise BlockingIOError(11, "write could not complete without blocking")

        def flush(self) -> None:
            raise BlockingIOError(11, "write could not complete without blocking")

    monkeypatch.setattr(dev_unsafe_trace.sys, "stderr", NonBlockingStderr())

    # Regression: ``pnpm dev:trace 2>&1 | tee ...`` can put stderr behind a
    # non-blocking pipe. Diagnostic tracing must fail open instead of killing
    # ScanBoundary before materialize_snapshot executes.
    dev_unsafe_trace.emit_dev_unsafe_trace(
        "DEV_TOOL_DISPATCH_RAW",
        tool_name="materialize_snapshot",
        archive=b"\x1f\x8b" + (b"\x00" * (128 * 1024)),
    )


def test_structlog_writer_backpressure_is_non_fatal_in_trace_mode() -> None:
    class NonBlockingStdout:
        def write(self, _value: str) -> int:
            raise BlockingIOError(11, "write could not complete without blocking")

        def flush(self) -> None:
            raise BlockingIOError(11, "write could not complete without blocking")

    writer = worker_logging._FailOpenTraceWriter(NonBlockingStdout())

    assert writer.write("SCAN_TOOL_EXECUTED") == len("SCAN_TOOL_EXECUTED")
    writer.flush()


def test_production_guard_still_fails_fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NODE_ENV", "production")

    with pytest.raises(RuntimeError, match="must never be enabled"):
        dev_unsafe_trace.emit_dev_unsafe_trace("SHOULD_NOT_RUN")


def test_summarize_dispatcher_result_and_request(monkeypatch: pytest.MonkeyPatch) -> None:
    class MockStderr:
        def __init__(self):
            self.lines = []
        def write(self, data: str) -> int:
            if data.strip():
                self.lines.append(data.strip())
            return len(data)
        def flush(self) -> None:
            pass

    mock_stderr = MockStderr()
    monkeypatch.setattr(dev_unsafe_trace.sys, "stderr", mock_stderr)

    # 1. Dispatch request
    dev_unsafe_trace.emit_dev_unsafe_trace(
        "DEV_TOOL_DISPATCH_RAW",
        dispatcher="ScannerToolDispatcher",
        tool_name="materialize_snapshot",
        tool_input={"snapshot_id": "snap-123", "secret_token": "very-secret"},
    )
    assert len(mock_stderr.lines) == 1
    import json
    rec1 = json.loads(mock_stderr.lines[0])
    assert rec1["event"] == "DEV_TOOL_DISPATCH"
    assert rec1["dispatcher"] == "ScannerToolDispatcher"
    assert rec1["tool_name"] == "materialize_snapshot"
    assert rec1["snapshot_id"] == "snap-123"
    assert "tool_input_size" in rec1
    assert "secret_token" not in rec1

    # 2. Dispatch result
    mock_stderr.lines.clear()
    dev_unsafe_trace.emit_dev_unsafe_trace(
        "DEV_TOOL_DISPATCH_RESULT_RAW",
        dispatcher="ScannerToolDispatcher",
        tool_name="materialize_snapshot",
        result={
            "nodes": [{"id": "n1"}, {"id": "n2"}],
            "edges": [{"id": "e1"}],
            "node_count": 2,
            "edge_count": 1,
        },
    )
    assert len(mock_stderr.lines) == 1
    rec2 = json.loads(mock_stderr.lines[0])
    assert rec2["event"] == "DEV_TOOL_DISPATCH_RESULT"
    assert rec2["node_count"] == 2
    assert rec2["edge_count"] == 1
    assert "result" not in rec2
    assert rec2["result_size"] > 0


def test_summarize_http_callback_request(monkeypatch: pytest.MonkeyPatch) -> None:
    class MockStderr:
        def __init__(self):
            self.lines = []
        def write(self, data: str) -> int:
            if data.strip():
                self.lines.append(data.strip())
            return len(data)
        def flush(self) -> None:
            pass

    mock_stderr = MockStderr()
    monkeypatch.setattr(dev_unsafe_trace.sys, "stderr", mock_stderr)

    dev_unsafe_trace.emit_dev_unsafe_trace(
        "DEV_WORKER_HTTP_REQUEST_RAW",
        method="POST",
        path="/api/callback",
        url="http://api.internal/api/callback",
        worker_api_key="api-key-12345",
        payload={"scan_job_id": "job-abc", "findings": [{"secret": "xyz"}]},
    )

    assert len(mock_stderr.lines) == 1
    import json
    rec = json.loads(mock_stderr.lines[0])
    assert rec["event"] == "DEV_WORKER_HTTP_REQUEST"
    assert rec["method"] == "POST"
    assert rec["path"] == "/api/callback"
    assert rec["url"] == "http://api.internal/api/callback"
    assert rec["scan_job_id"] == "job-abc"
    assert rec["worker_api_key"] == "api-key-12345"
    assert "payload" not in rec
    assert rec["payload_size"] > 0
    assert rec["payload_limit"] == 52428800
    assert rec["payload_truncated"] is False


def test_summarize_amqp_retry_dlq(monkeypatch: pytest.MonkeyPatch) -> None:
    class MockStderr:
        def __init__(self):
            self.lines = []
        def write(self, data: str) -> int:
            if data.strip():
                self.lines.append(data.strip())
            return len(data)
        def flush(self) -> None:
            pass

    mock_stderr = MockStderr()
    monkeypatch.setattr(dev_unsafe_trace.sys, "stderr", mock_stderr)

    dev_unsafe_trace.emit_dev_unsafe_trace(
        "DEV_AMQP_RETRY_OR_DLQ_RAW",
        worker="ScanBoundary",
        boundary_source="scans-retry",
        attempts=3,
        max_retries=5,
        body=b"oversized amqp message body with secrets",
    )

    assert len(mock_stderr.lines) == 1
    import json
    rec = json.loads(mock_stderr.lines[0])
    assert rec["event"] == "DEV_AMQP_RETRY_OR_DLQ"
    assert rec["worker"] == "ScanBoundary"
    assert rec["boundary_source"] == "scans-retry"
    assert rec["attempts"] == 3
    assert rec["max_retries"] == 5
    assert "body" not in rec
    assert "body_size" in rec


def test_unfiltered_opt_in_toggle(monkeypatch: pytest.MonkeyPatch) -> None:
    class MockStderr:
        def __init__(self):
            self.lines = []
        def write(self, data: str) -> int:
            if data.strip():
                self.lines.append(data.strip())
            return len(data)
        def flush(self) -> None:
            pass

    mock_stderr = MockStderr()
    monkeypatch.setattr(dev_unsafe_trace.sys, "stderr", mock_stderr)
    monkeypatch.setenv("LCSP_DEV_UNSAFE_UNFILTERED", "true")

    dev_unsafe_trace.emit_dev_unsafe_trace(
        "DEV_WORKER_HTTP_REQUEST_RAW",
        method="POST",
        payload={"scan_job_id": "job-abc"},
        worker_api_key="keep-me",
    )

    assert len(mock_stderr.lines) == 1
    import json
    rec = json.loads(mock_stderr.lines[0])
    assert rec["event"] == "DEV_WORKER_HTTP_REQUEST_RAW"
    assert rec["payload"] == {"scan_job_id": "job-abc"}
    assert rec["worker_api_key"] == "keep-me"
