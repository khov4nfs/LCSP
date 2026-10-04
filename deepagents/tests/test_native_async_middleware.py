"""Exercise native async execution with production LCSP middleware, offline."""

import asyncio
from threading import Event, Thread
from time import monotonic

import pytest
from conftest import use_model_routes
from deepagents import create_deep_agent
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.structured_output import ToolStrategy
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field

from contracts.handoffs import InterviewResult
from middleware.interview_runtime_context import inject_interview_runtime_context
from middleware.runtime_context import inject_lcsp_runtime_context
from middleware.specialist_handoff_validation import validate_lcsp_specialist_task_handoff
from middleware.triage_progress import require_triage_progress
from middleware.triage_singleton import guard_triage_singleton_task
from orchestration.agent_stream import (
    AgentStreamInterrupted, active_agent_stream_cancel, invoke_with_stream,
)
from orchestration.context import LCSPRunContext
from subagents.interview.definition import SUBAGENT


@pytest.mark.parametrize("middleware,slot", [
    (inject_interview_runtime_context, "model"),
    (inject_lcsp_runtime_context, "model"),
    (require_triage_progress, "model"),
    (validate_lcsp_specialist_task_handoff, "tool"),
    (guard_triage_singleton_task, "tool"),
])
def test_production_middleware_supports_both_execution_modes(middleware, slot):
    assert getattr(type(middleware), f"wrap_{slot}_call") is not getattr(AgentMiddleware, f"wrap_{slot}_call")
    assert getattr(type(middleware), f"awrap_{slot}_call") is not getattr(AgentMiddleware, f"awrap_{slot}_call")


class OfflineInterviewModel(BaseChatModel):
    provider: str = "openai"
    model_name: str = "offline-interview"
    calls: int = 0
    prompts: list = Field(default_factory=list)
    started: Event = Field(default_factory=Event)
    cancelled: Event = Field(default_factory=Event)
    hold: bool = False

    @property
    def _llm_type(self):
        return "offline-interview"

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, *args, **kwargs):
        raise AssertionError("Native execution must use the async provider")

    async def _agenerate(self, messages, **kwargs):
        self.calls += 1
        self.prompts.append(messages)
        self.started.set()
        if self.hold:
            try:
                await asyncio.wait_for(asyncio.Event().wait(), timeout=5)
            finally:
                self.cancelled.set()
        result = InterviewResult(expectedContextRevision=1, outcome="FAILED", rationale="Offline regression response")
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="", tool_calls=[{
            "name": "InterviewResult", "args": result.model_dump(), "id": "handoff",
        }]))])


def interview_agent(monkeypatch, *, hold=False):
    use_model_routes(monkeypatch, {
        "routes": {"offline": {"provider": "openai", "model": "offline-interview"}},
        "roles": {"default": "offline", "interview": "offline"},
    })
    monkeypatch.setenv("OPENAI_API_KEY", "offline-test-key")
    model = OfflineInterviewModel(hold=hold)
    agent = create_deep_agent(
        model=model, tools=SUBAGENT["tools"], system_prompt=SUBAGENT["system_prompt"],
        middleware=SUBAGENT["middleware"], response_format=ToolStrategy(InterviewResult),
        context_schema=LCSPRunContext, checkpointer=InMemorySaver(),
    )
    return model, agent


def test_complete_interview_middleware_stack_runs_on_native_async_path(monkeypatch):
    model, agent = interview_agent(monkeypatch)
    token = active_agent_stream_cancel.set(Event())
    try:
        result = invoke_with_stream(agent, {"messages": [{"role": "user", "content": "Evaluate the answer"}]},
            config={"configurable": {"thread_id": "async-interview"}},
            context=LCSPRunContext(assessment_id="assessment-safe", workflow_run_id="private-workflow-marker",
                checkpoint_id="private-checkpoint-marker", artifact_versions={"guidanceVersion": "guidance-safe"}))
        assert isinstance(result["structured_response"], InterviewResult)
        assert model.calls == 1
        prompt = str(model.prompts[0][0].content)
        assert "assessment_id=assessment-safe" in prompt
        assert "guidanceVersion=guidance-safe" in prompt
        assert "private-workflow-marker" not in prompt
        assert "private-checkpoint-marker" not in prompt
    finally:
        active_agent_stream_cancel.reset(token)


def test_complete_interview_middleware_stack_cancels_provider_without_fallback(monkeypatch):
    model, agent = interview_agent(monkeypatch, hold=True)
    cancel = Event()
    stop_requested_at = []
    def stop():
        if model.started.wait(2):
            stop_requested_at.append(monotonic())
            cancel.set()
    stopping = Thread(target=stop, daemon=True)
    stopping.start()
    token = active_agent_stream_cancel.set(cancel)
    try:
        with pytest.raises(AgentStreamInterrupted):
            invoke_with_stream(agent, {"messages": [{"role": "user", "content": "Evaluate the answer"}]},
                config={"configurable": {"thread_id": "cancel-interview"}}, context=LCSPRunContext())
        assert model.cancelled.is_set()
        assert model.calls == 1
        assert stop_requested_at and monotonic() - stop_requested_at[0] < 1
    finally:
        cancel.set()
        active_agent_stream_cancel.reset(token)
        stopping.join(timeout=2)
