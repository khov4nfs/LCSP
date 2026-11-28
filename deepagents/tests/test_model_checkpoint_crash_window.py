"""Reproduce a terminal paid response lost before its model-node checkpoint."""

import pytest
from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from middleware.capability_recovery import CapabilityRecoveryStore
from middleware.envelope_encryption import WorkerEnvelopeKeyring

from middleware.usage_metering import (
    AgentRoleMiddleware, AgentRunState, UsageMeteringMiddleware,
    activate_agent_run_state, active_model_step_id,
)
from test_assessment_root_agent import RootScriptedModel


def test_crash_after_paid_response_before_checkpoint_never_redispatches_same_step():
    # Why: A settled physical call can be replayed if the graph crashes before committing its model response.
    # How: Crash the middleware after the provider response, then resume the exact checkpointed thread.
    # Invariant: A replay must not produce a second physical call for the already paid logical step.
    model = RootScriptedModel(responses=[AIMessage(content="paid answer"), AIMessage(content="duplicate")])
    logical_steps = []
    settled_steps = set()

    class CrashAfterPaidResponse(AgentMiddleware):
        crashed = False

        def wrap_model_call(self, request, handler):
            step_id = active_model_step_id()
            logical_steps.append(step_id)
            # Why: A real server must refuse a second physical attempt for a settled logical operation.
            # How: Model the server's terminal fence using the logical ID carried by this model node.
            # Invariant: The graph may replay the node, but a settled ID cannot dispatch the provider twice.
            if step_id in settled_steps:
                raise RuntimeError("settled admission replay blocked")
            result = handler(request)
            settled_steps.add(step_id)
            if not self.crashed:
                self.crashed = True
                raise RuntimeError("simulated crash after terminal settlement")
            return result

    agent = create_agent(
        model,
        tools=[],
        middleware=[AgentRoleMiddleware("assessment-root", operation_type="SYNTHESIS"), CrashAfterPaidResponse()],
        checkpointer=InMemorySaver(),
    )
    config = {"configurable": {"thread_id": "same-paid-step"}}

    with pytest.raises(RuntimeError, match="simulated crash"):
        agent.invoke({"messages": [HumanMessage(content="evaluate")]}, config=config)
    with pytest.raises(RuntimeError, match="settled admission replay blocked"):
        agent.invoke(None, config=config)

    assert len(model.prompts) == 1
    assert logical_steps == [logical_steps[0], logical_steps[0]]


def test_graph_replay_restores_paid_response_after_crash_with_one_provider_and_settlement(tmp_path, monkeypatch):
    # Why: The old terminal fence prevented double charging but lost the paid answer before checkpointing.
    # How: Crash after a governed response, then resume the same LangGraph task from its checkpoint.
    # Invariant: Server SETTLED replay and matching encrypted IDs restore the original answer with no second dispatch.
    store = CapabilityRecoveryStore(tmp_path / "recovery.db", WorkerEnvelopeKeyring("v1", b"a" * 32))
    model = RootScriptedModel(responses=[AIMessage(content="paid answer"), AIMessage(content="duplicate")])
    metering = UsageMeteringMiddleware(recovery_store=store)
    admissions = []
    settlements = []

    class CrashAfterSettlement(AgentMiddleware):
        crashed = False

        def wrap_model_call(self, request, handler):
            answer = handler(request)
            if not self.crashed:
                self.crashed = True
                raise RuntimeError("crash before model checkpoint")
            return answer

    def admit(request, model_instance):
        step = active_model_step_id()
        admissions.append(step)
        if len(admissions) == 1:
            return {
                "state": "ADMITTED", "admissionId": "adm-1", "invocationId": "inv-1",
                "_prepared_request": request, "_api_client": object(),
            }
        return {"state": "SETTLED", "admissionId": "adm-1", "invocationId": "inv-1"}

    def settle(request, admission, invocation_id, response, model=None):
        settlements.append(invocation_id)
        store.mark_model_response_terminal(admission["admissionId"])

    monkeypatch.setattr(metering, "_prepare", lambda request: (request, request.model))
    monkeypatch.setattr(metering, "_execute_server_admission", admit)
    monkeypatch.setattr(metering, "_record", lambda *args, **kwargs: None)
    monkeypatch.setattr(metering, "_log_response", lambda *args, **kwargs: None)
    monkeypatch.setattr(metering, "_settle_completed_invocation", settle)
    monkeypatch.setattr("middleware.usage_metering._ModelCallTelemetry.start", lambda self: None)
    monkeypatch.setattr("middleware.usage_metering._ModelCallTelemetry.complete", lambda self, *args, **kwargs: None)

    agent = create_agent(
        model, tools=[],
        middleware=[AgentRoleMiddleware("assessment-root", operation_type="SYNTHESIS"), CrashAfterSettlement(), metering],
        checkpointer=InMemorySaver(),
    )
    config = {"configurable": {"thread_id": "encrypted-paid-step"}}
    run_state = AgentRunState(run_id="run-1", agent_role="assessment-root")
    with activate_agent_run_state(run_state):
        with pytest.raises(RuntimeError, match="crash before model checkpoint"):
            agent.invoke({"messages": [HumanMessage(content="evaluate")]}, config=config)
        result = agent.invoke(None, config=config)

    assert result["messages"][-1].content == "paid answer"
    assert len(model.prompts) == 1
    assert settlements == ["inv-1"]
    assert admissions == [admissions[0], admissions[0]]
