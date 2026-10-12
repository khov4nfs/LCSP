from types import SimpleNamespace

from assessment_root.runner import _root_telemetry
from middleware.usage_metering import AgentRunState, activate_agent_run_state, active_agent_run_state
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream, active_agent_stream, publish_agent_stream_event


def test_root_telemetry_uses_claimed_execution_and_lease_and_restores_transport_scope():
    delivered = []
    api = SimpleNamespace(post_agent_stream_event=lambda payload, **headers: delivered.append((payload, headers)))
    state = AgentRunState(run_id="transport-run", agent_role="assessment_root_requested", api_client=api)
    parent = AgentStreamSession("assessment", "transport-run", "correlation", "assessment_root_requested", lambda _: None)
    claim = {"assessmentId": "assessment", "executionId": "canonical-execution", "leaseToken": "canonical-lease"}
    with activate_agent_run_state(state), activate_agent_stream(parent):
        with _root_telemetry(claim):
            assert active_agent_run_state().run_id == "canonical-execution"
            publish_agent_stream_event("MODEL_CALL_STARTED", status="RUNNING")
        assert active_agent_run_state() is state
        assert active_agent_stream.get() is parent
    assert [event["event_type"] for event, _ in delivered] == ["BOUNDARY_STARTED", "MODEL_CALL_STARTED", "BOUNDARY_COMPLETED"]
    assert all(event["run_id"] == claim["executionId"] for event, _ in delivered)
    assert all(headers == {"lease_token": claim["leaseToken"]} for _, headers in delivered)
