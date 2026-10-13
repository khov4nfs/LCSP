from __future__ import annotations

import ast
import re
from pathlib import Path

import logging
from threading import Event
from time import monotonic

from langchain_core.messages import AIMessageChunk, ToolMessage

import pytest

from orchestration.agent_stream import (
    AgentStreamInterrupted,
    AgentStreamSession,
    BufferedAgentStreamEmitter,
    active_agent_stream_cancel,
    activate_agent_stream,
    publish_agent_stream_event,
    _should_forward_stream_log,
)


def test_buffered_emitter_preserves_order_and_flushes_on_close():
    received = []
    emitter = BufferedAgentStreamEmitter(received.append)
    emitter({"sequence": 1})
    emitter({"sequence": 2})
    emitter.close()
    assert received == [{"sequence": 1}, {"sequence": 2}]

def test_buffered_emitter_never_blocks_agent_on_backpressure():
    delivery_started = Event()
    release_delivery = Event()

    def blocked_delivery(_payload):
        delivery_started.set()
        release_delivery.wait(timeout=1.0)

    emitter = BufferedAgentStreamEmitter(
        blocked_delivery,
        max_pending=1,
        close_timeout_seconds=0.01,
    )
    emitter({"sequence": 1})
    assert delivery_started.wait(timeout=0.5)
    emitter({"sequence": 2})

    started = monotonic()
    emitter({"sequence": 3})
    elapsed = monotonic() - started
    assert elapsed < 0.05

    started = monotonic()
    emitter.close()
    elapsed = monotonic() - started
    assert elapsed < 0.1
    release_delivery.set()


def test_buffered_emitter_drops_excess_deltas_before_the_next_model_turn():
    delivery_started = Event()
    release_delivery = Event()
    delivered_turn = Event()
    received = []

    def deliver(payload):
        if payload["sequence"] == 1:
            delivery_started.set()
            release_delivery.wait(timeout=1.0)
        received.append(payload["sequence"])
        if payload["sequence"] == 4:
            delivered_turn.set()

    emitter = BufferedAgentStreamEmitter(deliver, max_pending=2)
    emitter({"sequence": 1, "event_type": "BOUNDARY_STARTED"})
    assert delivery_started.wait(timeout=0.5)
    emitter({"sequence": 2, "event_type": "MODEL_CONTENT_DELTA"})
    emitter({"sequence": 3, "event_type": "MODEL_CONTENT_DELTA"})
    emitter({"sequence": 4, "event_type": "MODEL_RESULT", "data": {"durability": "DURABLE"}})
    release_delivery.set()

    assert delivered_turn.wait(timeout=0.5)
    emitter.close()
    assert received == [1, 2, 4]


def test_buffered_emitter_keeps_pending_turn_after_bounded_close():
    delivery_started = Event()
    release_delivery = Event()
    delivered_turn = Event()

    def deliver(payload):
        if payload["sequence"] == 1:
            delivery_started.set()
            release_delivery.wait(timeout=1.0)
        if payload["sequence"] == 2:
            delivered_turn.set()

    emitter = BufferedAgentStreamEmitter(
        deliver,
        max_pending=1,
        close_timeout_seconds=0.01,
    )
    emitter({"sequence": 1, "event_type": "BOUNDARY_STARTED"})
    assert delivery_started.wait(timeout=0.5)
    emitter({"sequence": 2, "event_type": "MODEL_RESULT", "data": {"durability": "DURABLE"}})
    emitter.close()
    release_delivery.set()

    assert delivered_turn.wait(timeout=0.5)


def test_stream_log_filter_hides_framework_noise_but_keeps_failures():
    noisy_info = logging.LogRecord(
        "httpx",
        logging.INFO,
        __file__,
        1,
        "HTTP Request: POST /internal/scan-jobs",
        (),
        None,
    )
    private_info = logging.LogRecord(
        "lcsp.agent",
        logging.INFO,
        __file__,
        1,
        "PIIMiddleware[email].before_model",
        (),
        None,
    )
    useful_info = logging.LogRecord(
        "lcsp.repository",
        logging.INFO,
        __file__,
        1,
        "Repository index completed",
        (),
        None,
    )
    framework_error = logging.LogRecord(
        "httpx",
        logging.ERROR,
        __file__,
        1,
        "Provider request failed",
        (),
        None,
    )

    assert _should_forward_stream_log(noisy_info) is False
    assert _should_forward_stream_log(private_info) is False
    assert _should_forward_stream_log(useful_info) is True
    assert _should_forward_stream_log(framework_error) is True


def test_literal_agent_stream_event_types_match_shared_typescript_contract() -> None:
    """Prevent Python emitters from inventing event types the API will reject."""
    repo_root = Path(__file__).resolve().parents[2]
    contract_path = repo_root / "packages/contracts/src/evidence/assessment-runtime.ts"
    contract_text = contract_path.read_text()
    block = re.search(
        r"export const ASSESSMENT_AGENT_STREAM_EVENT_TYPES = \{(.*?)\} as const;",
        contract_text,
        re.S,
    )
    assert block is not None
    supported = set(re.findall(r':\s*"([A-Z0-9_]+)"', block.group(1)))

    emitted: set[str] = set()
    for path in (repo_root / "deepagents").rglob("*.py"):
        if set(path.parts) & {".mda", ".venv", "__pycache__", ".uv-cache"}:
            continue
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "publish_agent_stream_event"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
            ):
                emitted.add(node.args[0].value)

    assert emitted <= supported, sorted(emitted - supported)


def test_agent_stream_emits_only_the_active_boundary_identifier():
    assessment_events = []
    assessment = AgentStreamSession(
        assessment_id="assessment-1",
        run_id="transport-1",
        correlation_id="correlation-1",
        boundary_name="assessment_root_requested",
        emit_payload=assessment_events.append,
    )
    assessment.emit("CUSTOM_PROGRESS", status="RUNNING")

    preparation_events = []
    preparation = AgentStreamSession(
        assessment_id=None,
        run_id="transport-preparation-1",
        correlation_id="correlation-preparation-1",
        boundary_name="rule_set_preparation_requested",
        emit_payload=preparation_events.append,
        boundary_type="RULE_SET_PREPARATION",
        boundary_id="preparation-1",
        preparation_run_id="preparation-1",
    )
    preparation.emit("CUSTOM_PROGRESS", status="RUNNING")

    assert assessment_events[0]["assessment_id"] == "assessment-1"
    assert "preparation_run_id" not in assessment_events[0]
    assert preparation_events[0]["preparation_run_id"] == "preparation-1"
    assert preparation_events[0]["boundary_id"] == "preparation-1"
    assert "assessment_id" not in preparation_events[0]
