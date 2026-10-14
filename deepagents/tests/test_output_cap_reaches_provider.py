"""The per-call output ceiling must reach the provider request, not only the route config.

Production: the cap was bound with ``model.bind(max_tokens=...)``, which LangChain's agent drops
when it calls ``bind_tools``; Sonnet answered with the SDK default of 4096 output tokens and every
rule-set packet was truncated mid-array.
"""

from __future__ import annotations

from typing import Any

import pytest
from langchain.agents import create_agent
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from middleware import usage_metering
from middleware.usage_metering import UsageMeteringMiddleware, output_cap_settings

CAP = 12345


class _RecordingModel(BaseChatModel):
    profile: dict[str, Any] | None = {"max_output_tokens": CAP}
    seen: list[dict[str, Any]] = []

    @property
    def _llm_type(self) -> str:
        return "recording"

    def bind_tools(self, tools, **kwargs):  # same shape as ChatAnthropic/ChatOpenAI.bind_tools
        return self.bind(tools=tools, **kwargs)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.seen.append(kwargs)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="done"))])


@tool
def read_thing(name: str) -> str:
    """Read a thing."""
    return name


def test_agent_with_tools_sends_the_route_output_cap_to_the_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda model, response=None: None)
    model = _RecordingModel(seen=[])
    agent = create_agent(model=model, tools=[read_thing], middleware=[UsageMeteringMiddleware()])
    agent.invoke({"messages": [{"role": "user", "content": "go"}]})
    assert model.seen[0].get("max_tokens") == CAP


def test_cap_parameter_is_accepted_by_each_native_chat_client() -> None:
    from langchain_anthropic import ChatAnthropic
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_openai import ChatOpenAI

    messages = [HumanMessage("hi")]
    anthropic = ChatAnthropic(model="claude-sonnet-4-6-free", api_key="k", profile={"max_output_tokens": CAP})
    settings = output_cap_settings(anthropic)
    assert settings == {"max_tokens": CAP}
    assert anthropic._get_request_payload(messages, **settings)["max_tokens"] == CAP
    assert anthropic._get_request_payload(messages)["max_tokens"] == 4096  # the silent default it replaces

    openai = ChatOpenAI(model="mercury-2.5", api_key="k", base_url="https://example.invalid/v1",
                        profile={"max_output_tokens": CAP})
    settings = output_cap_settings(openai)
    payload = openai._get_request_payload(messages, **settings)
    assert CAP in (payload.get("max_tokens"), payload.get("max_completion_tokens"))

    gemini = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", api_key="k", profile={"max_output_tokens": CAP})
    settings = output_cap_settings(gemini)
    assert settings == {"max_output_tokens": CAP}
    assert gemini._prepare_request(messages, **settings)["config"].max_output_tokens == CAP
