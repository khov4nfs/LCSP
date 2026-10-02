from __future__ import annotations

from threading import Event

from orchestration import agent_stream


def test_model_wait_heartbeat_emits_while_waiting_and_stops_after(monkeypatch) -> None:
    events: list[tuple[str, dict]] = []
    two_beats = Event()

    def record(event_type: str, **fields) -> None:
        events.append((event_type, fields))
        if len(events) >= 2:
            two_beats.set()

    monkeypatch.setattr(agent_stream, "publish_agent_stream_event", record)

    with agent_stream.model_wait_heartbeat("waiting", interval_seconds=0.01):
        assert two_beats.wait(timeout=5)

    emitted = len(events)
    assert emitted >= 2
    assert all(
        event == ("MODEL_CALL_HEARTBEAT", {"status": "RUNNING", "text": "waiting"})
        for event in events
    )
    two_beats.clear()
    assert not two_beats.wait(timeout=0.1) or len(events) == emitted


def test_model_wait_heartbeat_default_interval_is_well_under_stale_threshold() -> None:
    # The API marks a scan stale after 5 minutes without a runtime event.
    assert agent_stream.MODEL_WAIT_HEARTBEAT_SECONDS * 6 <= 60
