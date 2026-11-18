"""Recover streamed gateway overloads without replaying tools or hiding credential failures."""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from anthropic import APIConnectionError, APIStatusError
from conftest import use_model_routes
from langchain.agents.middleware import ModelRequest, ModelResponse, ModelRetryMiddleware
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk

from anthropic_stream_usage import anthropic_async_client_scope, anthropic_first_output_timeout, init_chat_model, _first_output_timeout, _stream_usage
from middleware.failure_policy import ProviderFirstOutputTimeout, retry_model_error
from middleware.provider_fallback import ProviderFallbackMiddleware
from middleware.token_fallback import TokenFallbackMiddleware
from model_policy import resolve_agent_model


def overloaded():
    return APIStatusError("gateway overloaded", response=httpx.Response(200, request=httpx.Request("POST", "https://provider.invalid/v1/messages")), body={"error": {"type": "overloaded_error"}})


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.parametrize("failure", [
    overloaded,
    lambda: ProviderFirstOutputTimeout("silent stream"),
    lambda: APIConnectionError(request=httpx.Request("POST", "https://provider.invalid/v1/messages")),
])
@pytest.mark.parametrize("recovers", [False, True])
@pytest.mark.asyncio
async def test_interruption_reaches_bounded_model_retry(monkeypatch, asynchronous, failure, recovers):
    import middleware.token_fallback as slots
    monkeypatch.setattr(slots, "_DEAD_CREDENTIAL_SLOTS", {})
    monkeypatch.setattr(slots, "_RATE_LIMITED_UNTIL", {})
    monkeypatch.setattr(slots, "_CREDENTIAL_POOL_FINGERPRINTS", {})
    monkeypatch.setenv("ANTHROPIC_API_KEY", "offline-key")
    use_model_routes(monkeypatch, {"routes": {"primary": {"provider": "anthropic", "model": "fixture"}}, "roles": {"default": "primary"}})
    request = ModelRequest(model=resolve_agent_model("default"), messages=[], tools=[])
    success = ModelResponse(result=[AIMessage(content="prepared")])
    attempts = [failure(), success] if recovers else [failure(), failure(), failure()]
    handler = AsyncMock(side_effect=attempts) if asynchronous else MagicMock(side_effect=attempts)
    retry = ModelRetryMiddleware(max_retries=2, initial_delay=0, jitter=False, retry_on=retry_model_error, on_failure="error")
    routes, tokens = ProviderFallbackMiddleware(), TokenFallbackMiddleware()

    async def through_tokens(r):
        return await tokens.awrap_model_call(r, handler)

    async def through_routes(r):
        return await routes.awrap_model_call(r, through_tokens)

    if recovers:
        result = await retry.awrap_model_call(request, through_routes) if asynchronous else retry.wrap_model_call(request, lambda r: routes.wrap_model_call(r, lambda r: tokens.wrap_model_call(r, handler)))
        assert result is success
        assert handler.call_count == 2
    else:
        with pytest.raises(type(attempts[0])):
            if asynchronous:
                await retry.awrap_model_call(request, through_routes)
            else:
                retry.wrap_model_call(request, lambda r: routes.wrap_model_call(r, lambda r: tokens.wrap_model_call(r, handler)))
        assert handler.call_count == 3
    assert all(not dead for dead in slots._DEAD_CREDENTIAL_SLOTS.values())


def test_selected_async_client_pool_closes_before_its_event_loop():
    peers = []

    class KeepAliveHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            peers.append(self.client_address)
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), KeepAliveHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"

    async def run():
        model = init_chat_model("anthropic:fixture", api_key="offline-key", base_url=base_url, timeout=10)
        async with anthropic_async_client_scope():
            client = model._async_client
            assert client is model._async_client
            assert not client.is_closed()
            assert client.timeout == 10
            for _ in range(2):
                assert (await client.get("/", cast_to=httpx.Response)).status_code == 200
        assert client.is_closed()
        return client

    try:
        assert asyncio.run(run()) is not asyncio.run(run())
        assert peers[0] == peers[1]
        assert peers[2] == peers[3]
        assert peers[0] != peers[2]
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


@pytest.mark.asyncio
async def test_cancelled_selected_scope_closes_client():
    model = init_chat_model("anthropic:fixture", api_key="offline-key")
    entered = asyncio.Event()
    clients = []

    async def run():
        async with anthropic_async_client_scope():
            clients.append(model._async_client)
            entered.set()
            await asyncio.Future()

    task = asyncio.create_task(run())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert clients[0].is_closed()


@pytest.mark.asyncio
async def test_empty_stream_metadata_cannot_reset_first_output_deadline(monkeypatch):
    closed = []

    async def silent_stream(*args, **kwargs):
        try:
            while True:
                yield ChatGenerationChunk(message=AIMessageChunk(content=""))
                await asyncio.sleep(0.005)
        finally:
            closed.append(True)

    monkeypatch.setattr(ChatAnthropic, "_astream", silent_stream)
    client = init_chat_model("anthropic:fixture", api_key="offline-key")
    with anthropic_first_output_timeout(0.02), pytest.raises(ProviderFirstOutputTimeout):
        async for _ in client._astream([]):
            pass
    assert closed == [True]
    assert _stream_usage.get() is None and _first_output_timeout.get() is None


@pytest.mark.parametrize("tool_output", [False, True])
@pytest.mark.asyncio
async def test_generated_output_disables_startup_deadline(monkeypatch, tool_output):
    async def responding_stream(*args, **kwargs):
        yield ChatGenerationChunk(message=AIMessageChunk(content=""))
        yield ChatGenerationChunk(message=AIMessageChunk(content="" if tool_output else "analysis", tool_call_chunks=[{"name": "SelectedPreparationRuleResult", "args": "{", "id": "call-1", "index": 0}] if tool_output else []))
        await asyncio.sleep(0.04)
        yield ChatGenerationChunk(message=AIMessageChunk(content="complete"))

    monkeypatch.setattr(ChatAnthropic, "_astream", responding_stream)
    client = init_chat_model("anthropic:fixture", api_key="offline-key")
    with anthropic_first_output_timeout(0.02):
        chunks = [chunk async for chunk in client._astream([])]
    assert len(chunks) == 3
    assert _stream_usage.get() is None and _first_output_timeout.get() is None


@pytest.mark.asyncio
async def test_other_roles_have_no_selected_rule_startup_deadline(monkeypatch):
    async def responding_stream(*args, **kwargs):
        await asyncio.sleep(0.04)
        yield ChatGenerationChunk(message=AIMessageChunk(content="complete"))

    monkeypatch.setattr(ChatAnthropic, "_astream", responding_stream)
    client = init_chat_model("anthropic:fixture", api_key="offline-key")
    assert len([chunk async for chunk in client._astream([])]) == 1
