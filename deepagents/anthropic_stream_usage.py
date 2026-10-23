"""Keep reported start usage when an Anthropic-compatible stream omits final fields."""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from langchain.chat_models import init_chat_model as native_init_chat_model
from langchain_anthropic import ChatAnthropic
from langchain_core.messages.ai import UsageMetadata, subtract_usage


@dataclass
class _StreamUsage:
    reported: dict[str, Any] = field(default_factory=dict)
    emitted: UsageMetadata | None = None


_stream_usage: ContextVar[_StreamUsage | None] = ContextVar("anthropic_stream_usage", default=None)


class UsagePreservingChatAnthropic(ChatAnthropic):
    # The context belongs to one stream, including concurrent calls on a shared model.
    def _stream(self, *args, **kwargs):
        token = _stream_usage.set(_StreamUsage())
        try:
            yield from super()._stream(*args, **kwargs)
        finally:
            _stream_usage.reset(token)

    async def _astream(self, *args, **kwargs):
        token = _stream_usage.set(_StreamUsage())
        try:
            async for chunk in super()._astream(*args, **kwargs):
                yield chunk
        finally:
            _stream_usage.reset(token)

    def _make_message_chunk_from_anthropic_event(self, event, **kwargs):
        usage = _stream_usage.get()
        if usage is not None and kwargs.get("stream_usage", True):
            if event.type == "message_start":
                usage.reported.update(event.message.usage.model_dump(exclude_none=True))
            elif event.type == "message_delta":
                usage.reported.update(event.usage.model_dump(exclude_none=True))
                event = event.model_copy(update={
                    "usage": type(event.usage).model_validate(usage.reported),
                })
        chunk, block = super()._make_message_chunk_from_anthropic_event(event, **kwargs)
        if usage is not None and chunk is not None and chunk.usage_metadata is not None:
            cumulative = chunk.usage_metadata
            chunk.usage_metadata = subtract_usage(cumulative, usage.emitted)
            usage.emitted = cumulative
        return chunk, block


def init_chat_model(spec: str, **kwargs):
    if spec.startswith("anthropic:"):
        return UsagePreservingChatAnthropic(model=spec.removeprefix("anthropic:"), **kwargs)
    return native_init_chat_model(spec, **kwargs)
