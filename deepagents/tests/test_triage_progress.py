import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from langchain.messages import ToolMessage

from middleware.triage_progress import GET, PERSIST, FINISH, require_triage_progress


def receipt(name, data, status="success"):
    return ToolMessage(name=name, content=json.dumps(data), tool_call_id=name, status=status)


def allowed(messages):
    request = MagicMock()
    request.messages = messages
    request.tools = [SimpleNamespace(name=name) for name in (GET, PERSIST, FINISH)]
    require_triage_progress.wrap_model_call(request, MagicMock())
    return request.override.call_args.kwargs


def test_triage_requires_read_persist_next_page_finish_before_handoff():
    assert {tool.name for tool in allowed([])["tools"]} == {GET}
    messages = [receipt(GET, {"status": "READY", "pendingRuleCount": 6,
        "workItems": [{"legalRuleId": "R1", "readyForTriage": True}]})]
    args = allowed(messages)
    assert {tool.name for tool in args["tools"]} == {PERSIST}
    assert args["response_format"] is None
    assert args["tool_choice"] == "any"
    # Failed persistence must not unlock finish or the next page.
    messages.append(receipt(PERSIST, {"status": "READY", "legalRuleId": "R1"}, "error"))
    assert {tool.name for tool in allowed(messages)["tools"]} == {PERSIST}
    messages.append(receipt(PERSIST, {"status": "READY", "legalRuleId": "R1"}))
    assert {tool.name for tool in allowed(messages)["tools"]} == {GET}
    messages.append(receipt(GET, {"status": "READY", "pendingRuleCount": 0, "workItems": []}))
    assert {tool.name for tool in allowed(messages)["tools"]} == {FINISH}
    messages.append(receipt(FINISH, {"status": "COMPLETE"}))
    args = allowed(messages)
    assert args["tools"] == []
    assert "response_format" not in args


def test_missing_source_fails_closed():
    with pytest.raises(RuntimeError, match="unavailable legal evidence"):
        allowed([receipt(GET, {"status": "READY", "pendingRuleCount": 1,
            "workItems": [{"legalRuleId": "R1", "readyForTriage": False}]})])


def test_real_agent_loop_cannot_bind_finish_or_handoff_before_persistence():
    from langchain.agents import create_agent
    from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
    from langchain.messages import AIMessage
    from langchain.tools import tool
    from pydantic import BaseModel, Field

    class Handoff(BaseModel):
        complete: bool

    class Model(FakeMessagesListChatModel):
        bindings: list[list[str]] = Field(default_factory=list)

        def bind_tools(self, tools, **kwargs):
            self.bindings.append([t.name if hasattr(t, "name") else t["function"]["name"] for t in tools])
            return self

    saved = []

    @tool(GET)
    def get_page() -> dict:
        """Read remaining work."""
        return {"status": "READY", "pendingRuleCount": 0 if saved else 1,
            "workItems": [] if saved else [{"legalRuleId": "R1", "readyForTriage": True}]}

    @tool(PERSIST)
    def persist() -> dict:
        """Persist the current rule."""
        saved.append("R1")
        return {"status": "READY", "legalRuleId": "R1"}

    @tool(FINISH)
    def finish() -> dict:
        """Release only after persistence."""
        assert saved == ["R1"]
        return {"status": "COMPLETE"}

    model = Model(responses=[AIMessage(content="", tool_calls=[{
        "id": str(index), "name": name, "args": {"complete": True} if name == "Handoff" else {},
    }]) for index, name in enumerate([GET, PERSIST, GET, FINISH, "Handoff"])])
    result = create_agent(model, tools=[get_page, persist, finish], response_format=Handoff,
        middleware=[require_triage_progress]).invoke({"messages": [{"role": "user", "content": "Process scope"}]})
    assert result["structured_response"].complete
    assert model.bindings == [[GET], [PERSIST], [GET], [FINISH], ["Handoff"]]
