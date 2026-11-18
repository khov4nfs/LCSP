"""Keep reported start usage when an Anthropic-compatible stream omits final fields."""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from langchain.chat_models import init_chat_model as native_init_chat_model
from langchain_anthropic import ChatAnthropic
from langchain_core.messages.ai import UsageMetadata, subtract_usage
from middleware.failure_policy import ProviderFirstOutputTimeout


@dataclass
class _StreamUsage:
    reported: dict[str, Any] = field(default_factory=dict)
    emitted: UsageMetadata | None = None


_stream_usage: ContextVar[_StreamUsage | None] = ContextVar("anthropic_stream_usage", default=None)
_first_output_timeout: ContextVar[float | None] = ContextVar("anthropic_first_output_timeout", default=None)


@contextmanager
def anthropic_first_output_timeout(seconds: float):
    """Business purpose: Give selected-rule inference a scoped deadline for the first generated output.

    Business rules:
    - Only the current async context inherits this deadline; unrelated model roles retain their configured transport policy.
    Execution flow:
    1. Bind the startup timeout for this inference scope.
    2. Restore the preceding scope after success, failure or cancellation.
    Failure cases:
    - Exceptions propagate without leaving a timeout override on another invocation.
    Side effects:
    - Sets and restores one context variable; no model calls or persistence.
    """
    token = _first_output_timeout.set(seconds)
    try:
        yield
    finally:
        _first_output_timeout.reset(token)


class UsagePreservingChatAnthropic(ChatAnthropic):
    # The context belongs to one stream, including concurrent calls on a shared model.
    def _stream(self, *args, **kwargs):
        """Business purpose: Preserve complete provider usage while streaming one synchronous Anthropic response.

        Business rules:
        - Usage accumulation belongs to the current stream and is isolated from concurrent streams on the same model.

        Execution flow:
        1. Bind a new stream usage accumulator, yield native response chunks, then restore the previous context.

        Failure cases:
        - Native streaming failures propagate; the stream context is restored even on failure or cancellation.

        Side effects:
        - Sets and resets a context variable while the native client performs provider I/O.
        """
        token = _stream_usage.set(_StreamUsage())
        try:
            yield from super()._stream(*args, **kwargs)
        finally:
            _stream_usage.reset(token)

    async def _astream(self, *args, **kwargs):
        """Business purpose: Preserve complete provider usage while streaming one asynchronous Anthropic response.

        Business rules:
        - Each asynchronous stream receives its own usage accumulator; usage must not leak across concurrent calls.
        - A scoped startup deadline ignores empty metadata/usage chunks and stops applying once model content or tool-call output begins.

        Execution flow:
        1. Bind the stream accumulator, yield native asynchronous chunks, and restore context when the iterator closes.

        Failure cases:
        - A silent startup raises ProviderFirstOutputTimeout for bounded retry; provider failures and cancellation retain context cleanup.

        Side effects:
        - Sets and restores stream-local context and delegates provider I/O to the native client.
        """
        token = _stream_usage.set(_StreamUsage())
        stream = super()._astream(*args, **kwargs)
        try:
            async with asyncio.timeout(_first_output_timeout.get()) as startup:
                async for chunk in stream:
                    if startup.when() is not None and (chunk.message.content or chunk.message.tool_call_chunks):
                        startup.reschedule(None)
                    yield chunk
        except TimeoutError as error:
            if startup.expired():
                raise ProviderFirstOutputTimeout("Provider stream produced no model output before its startup deadline") from error
            raise
        finally:
            try:
                await stream.aclose()
            finally:
                _stream_usage.reset(token)

    def _make_message_chunk_from_anthropic_event(self, event, **kwargs):
        """Business purpose: Retain Anthropic input/cache usage across partial events and emit additive usage deltas for accounting.

        Business rules:
        - Accumulate start and delta usage when stream usage is enabled; subtract previously emitted cumulative usage to prevent double counting.

        Execution flow:
        1. Merge reported usage fields into the stream accumulator and enrich delta events.
        2. Convert the event through the native implementation, then replace cumulative chunk usage with its unreported delta.

        Failure cases:
        - Native event conversion or usage validation errors propagate; absent usage/context leaves native conversion in place.

        Side effects:
        - Updates the stream accumulator and returned chunk metadata without settling billing or changing model content.
        """
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
    """Business purpose: Select the usage-preserving Anthropic client while retaining native initialization for other model specifications.

    Business rules:
    - Only an anthropic: prefix selects the specialized client; pass constructor options through unchanged.

    Execution flow:
    1. Strip the Anthropic prefix for the specialized client or delegate the original specification to native initialization.

    Failure cases:
    - Constructor and unsupported native specification errors propagate to the caller.

    Side effects:
    - Constructs a configured model client; the wrapper itself does not invoke inference.
    """
    if spec.startswith("anthropic:"):
        return UsagePreservingChatAnthropic(model=spec.removeprefix("anthropic:"), **kwargs)
    return native_init_chat_model(spec, **kwargs)
