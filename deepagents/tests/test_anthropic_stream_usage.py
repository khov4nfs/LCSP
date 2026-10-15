from __future__ import annotations

import asyncio
from types import SimpleNamespace

from anthropic.types import Message, RawMessageStartEvent, RawMessageDeltaEvent, Usage
from anthropic.types.message_delta_usage import MessageDeltaUsage
from anthropic.types.raw_message_delta_event import Delta
from langchain_anthropic import ChatAnthropic
import pytest

from anthropic_stream_usage import UsagePreservingChatAnthropic, init_chat_model, _stream_usage
from middleware.usage_metering import extract_provider_usage, provider_usage_telemetry


def events(input_tokens=123, **final):
    return [
        RawMessageStartEvent(type="message_start", message=Message(
            id="msg_fixture", content=[], model="fixture", role="assistant", type="message",
            usage=Usage(input_tokens=input_tokens, output_tokens=0,
                        cache_read_input_tokens=7, cache_creation_input_tokens=11),
        )),
        RawMessageDeltaEvent(type="message_delta", delta=Delta(stop_reason="end_turn", stop_sequence=None),
                             usage=MessageDeltaUsage(output_tokens=41, **final)),
    ]


def model():
    return init_chat_model("anthropic:fixture", api_key="provider-free", streaming=True)


@pytest.mark.parametrize("final,expected", [({}, 141), ({"input_tokens": 200}, 218), ({"input_tokens": 0}, 18)])
def test_stream_preserves_reported_start_fields_and_respects_final_values(monkeypatch, final, expected):
    monkeypatch.setattr(UsagePreservingChatAnthropic, "_create", lambda *_: SimpleNamespace(parse=lambda: iter(events(**final))))
    client = model()
    assert isinstance(client, ChatAnthropic)
    response = client.invoke("fixture")
    assert response.usage_metadata["input_tokens"] == expected
    assert response.usage_metadata["output_tokens"] == 41
    assert response.usage_metadata["input_token_details"] == {"cache_read": 7, "cache_creation": 11}
    assert provider_usage_telemetry(response)["input_tokens"] == expected
    ledger = extract_provider_usage(response, SimpleNamespace(provider="apx", protocol="anthropic", model_name="fixture"))
    assert ledger["inputTokens"] == str(expected - 18)
    assert ledger["cachedInputTokens"] == "7" and ledger["cacheWriteTokens"] == "11"
    assert ledger["outputTokens"] == "41"
    assert _stream_usage.get() is None


def test_cumulative_delta_counts_are_not_added_twice(monkeypatch):
    stream = events()
    stream.insert(1, RawMessageDeltaEvent(type="message_delta", delta=Delta(stop_reason=None, stop_sequence=None),
                                        usage=MessageDeltaUsage(output_tokens=10)))
    monkeypatch.setattr(UsagePreservingChatAnthropic, "_create", lambda *_: SimpleNamespace(parse=lambda: iter(stream)))
    assert model().invoke("fixture").usage_metadata == {
        "input_tokens": 141, "output_tokens": 41, "total_tokens": 182,
        "input_token_details": {"cache_read": 7, "cache_creation": 11},
    }


def test_closed_stream_does_not_leak_usage_to_the_next_call(monkeypatch):
    streams = iter([events(123), events(456)])
    monkeypatch.setattr(UsagePreservingChatAnthropic, "_create", lambda *_: SimpleNamespace(parse=lambda: iter(next(streams))))
    client = model()
    first = client.stream("fixture")
    next(first)
    first.close()
    assert _stream_usage.get() is None
    assert client.invoke("fixture").usage_metadata["input_tokens"] == 474


@pytest.mark.asyncio
async def test_concurrent_async_streams_keep_separate_usage(monkeypatch):
    streams = iter([events(123), events(456)])

    async def create(*_):
        stream = next(streams)

        async def parsed():
            for event in stream:
                await asyncio.sleep(0)
                yield event

        async def parse():
            return parsed()

        return SimpleNamespace(parse=parse)

    monkeypatch.setattr(UsagePreservingChatAnthropic, "_acreate", create)
    client = model()
    responses = await asyncio.gather(client.ainvoke("one"), client.ainvoke("two"))
    assert [r.usage_metadata["input_tokens"] for r in responses] == [141, 474]
    assert _stream_usage.get() is None


def test_credential_rotation_retains_the_native_usage_fix(monkeypatch):
    from model_policy import ResolvedModelConfig, build_model
    from middleware.token_fallback import model_with_token, model_provider, model_protocol
    monkeypatch.setenv("APX_API_KEY", "fixture")
    client = build_model(ResolvedModelConfig("default", "primary", "apx", "anthropic", "fixture"))
    rotated = model_with_token(client, "apx", "rotated-fixture")
    assert isinstance(rotated, UsagePreservingChatAnthropic)
    assert model_provider(rotated) == "apx" and model_protocol(rotated) == "anthropic"
    assert rotated.anthropic_api_key.get_secret_value() == "rotated-fixture"


def test_other_protocols_still_use_the_native_factory(monkeypatch):
    import anthropic_stream_usage as module
    monkeypatch.setattr(module, "native_init_chat_model", lambda spec, **kw: (spec, kw))
    assert init_chat_model("openai:fixture", temperature=0) == ("openai:fixture", {"temperature": 0})


def test_raw_anthropic_usage_is_already_uncached():
    response = SimpleNamespace(response_metadata={"usage": {
        "input_tokens": 123, "output_tokens": 41, "cache_read_input_tokens": 7, "cache_creation_input_tokens": 11,
    }})
    client = SimpleNamespace(provider="apx", protocol="anthropic", model_name="fixture")
    assert extract_provider_usage(response, client)["inputTokens"] == "123"


def test_normalized_anthropic_usage_inside_a_model_response_is_disjoint():
    response = SimpleNamespace(result=[SimpleNamespace(usage_metadata={
        "input_tokens": 141, "output_tokens": 41,
        "input_token_details": {"cache_read": 7, "cache_creation": 11},
    })])
    client = SimpleNamespace(provider="apx", protocol="anthropic", model_name="fixture")
    assert extract_provider_usage(response, client)["inputTokens"] == "123"
