"""Regression proof for a customer wallet denial before an Assessment model call."""

from deepagents.backends import FilesystemBackend
from langchain.agents.middleware import AgentMiddleware
from langgraph.checkpoint.memory import InMemorySaver

from assessment_root.runner import run_assessment_root
from middleware.usage_metering import AgentRunState, activate_agent_run_state
from test_assessment_root_agent import ASSESSMENT, FakeClient, RootScriptedModel, complete_root_messages
from tools.common.capabilities.platform.api_client import WorkerCallbackError


def test_payment_required_pauses_root_without_dispatching_provider(tmp_path):
    # Why: A 402 from billable admission is a recoverable wallet condition, not an Assessment failure.
    # How: Deny at the real graph's model middleware boundary before the scripted provider is invoked.
    # Invariant: A durable checkpoint and explicit reason permit only customer Continue after a top-up.
    class DenyPaidAdmission(AgentMiddleware):
        blocked = True

        def wrap_model_call(self, request, handler):
            if self.blocked:
                raise WorkerCallbackError(
                    "BILLING_PAYMENT_REQUIRED",
                    status_code=402,
                    error_code="BILLING_PAYMENT_REQUIRED",
                )
            return handler(request)

    class CapturingClient(FakeClient):
        def __init__(self):
            super().__init__()
            self.finishes = []
            self.resume_checkpoint = None

        def claim(self, assessment_id):
            return {**super().claim(assessment_id), "resumeCheckpointId": self.resume_checkpoint}

        def finish(self, state, **metadata):
            self.finishes.append((state, metadata))
            return super().finish(state, **metadata)

    client = CapturingClient()
    model = RootScriptedModel(responses=complete_root_messages())
    saver = InMemorySaver()
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    denial = DenyPaidAdmission()
    result = run_assessment_root(
        client,
        ASSESSMENT,
        backend_factory=lambda *_: (backend, None),
        model=model,
        checkpointer=saver,
        governance=[denial],
    )

    assert model.prompts == []
    assert result["checkpointId"]
    assert result["state"] == "PAUSED"
    assert result["errorType"] is None
    assert client.finishes[-1][1]["reason"] == "PAYMENT_REQUIRED"

    # Customer Continue binds the same checkpoint; the model may execute once funds are available.
    denial.blocked = False
    client.resume_checkpoint = result["checkpointId"]
    resumed = run_assessment_root(
        client, ASSESSMENT, backend_factory=lambda *_: (backend, None),
        model=model, checkpointer=saver, governance=[denial],
    )
    assert resumed["state"] == "SUCCEEDED"
    assert model.prompts


def test_last_call_settlement_depletion_pauses_root_after_provider_receipt(tmp_path):
    """A terminal depleted settlement must checkpoint after the model step, without redispatch on Continue."""

    class DepleteAfterCall(AgentMiddleware):
        provider_calls = 0

        def wrap_model_call(self, request, handler):
            response = handler(request)
            self.provider_calls += 1
            if self.provider_calls == 1:
                # Why: This simulates a crash that cleared process-local run state after the model checkpoint.
                # How: Carry only the server-owned marker on the returned message into after_model.
                # Invariant: Root must pause from persisted graph state without replaying the paid model node.
                for message in response.result:
                    message.response_metadata["_lcsp_payment_required_after_settlement"] = True
            return response

    class CapturingClient(FakeClient):
        def __init__(self):
            super().__init__()
            self.finishes = []
            self.resume_checkpoint = None

        def claim(self, assessment_id):
            return {**super().claim(assessment_id), "resumeCheckpointId": self.resume_checkpoint}

        def finish(self, state, **metadata):
            self.finishes.append((state, metadata))
            return super().finish(state, **metadata)

    client = CapturingClient()
    model = RootScriptedModel(responses=complete_root_messages())
    depletion = DepleteAfterCall()
    saver = InMemorySaver()
    # Why: A paid response must enter graph state before the payment pause is checkpointed.
    # How: Set the server-depletion flag during the model step and pause in after_model.
    # Invariant: Customer Continue must not repeat the settled provider call.
    with activate_agent_run_state(AgentRunState(run_id="transport-run", agent_role="assessment-root")):
        result = run_assessment_root(
            client,
            ASSESSMENT,
            backend_factory=lambda *_: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
            model=model,
            checkpointer=saver,
            governance=[depletion],
        )

    assert len(model.prompts) == 1
    assert result["checkpointId"]
    assert result["state"] == "PAUSED"
    assert result["errorType"] is None
    assert client.finishes[-1][1]["reason"] == "PAYMENT_REQUIRED"

    # Why: The paid provider response was already settled; resuming the saved checkpoint must not buy the same call again.
    # How: Continue from the exact checkpoint and verify the first model step is not redispatched.
    # Invariant: A customer top-up permits forward progress only, never duplicate settlement exposure.
    client.resume_checkpoint = result["checkpointId"]
    with activate_agent_run_state(AgentRunState(run_id="transport-run", agent_role="assessment-root")):
        resumed = run_assessment_root(
            client,
            ASSESSMENT,
            backend_factory=lambda *_: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
            model=model,
            checkpointer=saver,
            governance=[depletion],
        )
    # The scripted workflow legitimately needs a second, distinct model call after finalization.
    # A replay of the first paid call would skip finalization and fail the report's server lifecycle guard.
    assert len(model.prompts) == 2
    assert depletion.provider_calls == 2
    assert [name for name, _ in client.calls].count("finalization") == 1
    assert [name for name, _ in client.calls].count("final_report") == 1
    assert resumed["state"] == "SUCCEEDED"
