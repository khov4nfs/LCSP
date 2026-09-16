from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI

from middleware.failure_policy import TerminalCredentialError, is_terminal_task_error
from middleware.token_fallback import TokenFallbackMiddleware, model_provider, model_with_token
from provider_credentials import provider_tokens, credential_init_kwargs


class QuotaError(Exception):
    status_code = 429


class AuthError(Exception):
    status_code = 401


class ServerError(Exception):
    status_code = 503


class _FakeLogger:
    def __init__(self):
        self.events = []

    def warning(self, event, **kwargs):
        self.events.append((event, kwargs))


def test_parse_tokens_and_empty_list(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", " one, two,one, ,")
    assert provider_tokens("openai") == ("one", "two")
    assert credential_init_kwargs("openai") == {"api_key": "one", "max_retries": 0}
    monkeypatch.setenv("OPENAI_API_KEY", ", ,")
    with pytest.raises(ValueError, match="at least one"):
        provider_tokens("openai")


def test_llm7_credentials_are_isolated_from_openai(monkeypatch):
    monkeypatch.setenv("LLM7_API_KEY", "llm7-one,llm7-two")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-must-not-be-used")

    assert provider_tokens("llm7") == ("llm7-one", "llm7-two")
    assert credential_init_kwargs("llm7") == {
        "api_key": "llm7-one",
        "max_retries": 0,
    }


def test_llm7_chat_openai_rotation_preserves_gateway_policy(monkeypatch):
    monkeypatch.setenv("LLM7_API_KEY", "llm7-first,llm7-second")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-must-not-be-used")
    model = ChatOpenAI(
        model="gemini-3.1-flash-lite",
        base_url="https://api.llm7.io/v1",
        use_responses_api=False,
        **credential_init_kwargs("llm7"),
    )
    assert model_provider(model) == "llm7"

    request = ModelRequest(model=model, messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[QuotaError(), response])
    result = TokenFallbackMiddleware().wrap_model_call(request, handler)

    assert result is response
    assert handler.call_count == 2
    fallback = handler.call_args.args[0].model
    assert fallback.openai_api_key.get_secret_value() == "llm7-second"
    assert str(fallback.openai_api_base).rstrip("/") == "https://api.llm7.io/v1"
    assert fallback.use_responses_api is False
    assert fallback.max_retries == 0


@pytest.fixture(autouse=True)
def clear_dead_credential_slots():
    from middleware import token_fallback

    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()
    yield
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    token_fallback._RATE_LIMITED_UNTIL.clear()


@pytest.mark.parametrize("provider", ["openai", "google_genai", "llm7"])
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_token_fallback_preserves_model_policy(monkeypatch, provider, asynchronous):
    name = {
        "openai": "OPENAI_API_KEY",
        "google_genai": "GOOGLE_API_KEY",
        "llm7": "LLM7_API_KEY",
    }[provider]
    monkeypatch.setenv(name, "first-test-token,second-test-token,")
    if provider == "openai":
        model = ChatOpenAI(
            model="gpt-5-nano",
            reasoning={"effort": "low"},
            use_responses_api=True,
            **credential_init_kwargs(provider),
        )
    elif provider == "llm7":
        model = ChatOpenAI(
            model="gemini-3.1-flash-lite",
            base_url="https://api.llm7.io/v1",
            use_responses_api=False,
            **credential_init_kwargs(provider),
        )
    else:
        model = ChatGoogleGenerativeAI(
            model="gemini-3.5-flash-lite",
            thinking_level="minimal",
            **credential_init_kwargs(provider),
        )
    request = ModelRequest(model=model, messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = AsyncMock(side_effect=[QuotaError(), response]) if asynchronous else MagicMock(side_effect=[QuotaError(), response])
    middleware = TokenFallbackMiddleware()
    result = await middleware.awrap_model_call(request, handler) if asynchronous else middleware.wrap_model_call(request, handler)
    assert result is response
    assert handler.call_count == 2
    fallback = handler.call_args.args[0].model
    key = fallback.openai_api_key if provider in {"openai", "llm7"} else fallback.google_api_key
    assert key.get_secret_value() == "second-test-token"
    assert fallback is not model
    if provider == "openai":
        assert fallback.reasoning == {"effort": "low"}
        assert fallback.use_responses_api is True
        assert fallback.root_client is not model.root_client
    elif provider == "llm7":
        assert str(fallback.openai_api_base).rstrip("/") == "https://api.llm7.io/v1"
        assert fallback.use_responses_api is False
        assert fallback.max_retries == 0
        assert fallback.root_client is not model.root_client
    else:
        assert fallback.reasoning_effort == "minimal"
        assert fallback.thinking_budget is None
        # langchain_google_genai treats 0 as "Google default retries"; 1 is one attempt.
        assert fallback.max_retries == 1
        assert fallback.client is not model.client


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_exhaustion_stops_without_restarting_list(monkeypatch, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    request = ModelRequest(model=model, messages=[], tools=[])
    handler = AsyncMock(side_effect=QuotaError()) if asynchronous else MagicMock(side_effect=QuotaError())
    middleware = TokenFallbackMiddleware()
    with pytest.raises(TerminalCredentialError) as caught:
        if asynchronous:
            await middleware.awrap_model_call(request, handler)
        else:
            middleware.wrap_model_call(request, handler)
    assert handler.call_count == 2
    assert is_terminal_task_error(caught.value)
    assert "test-token" not in str(caught.value)


def test_schema_failure_does_not_try_next_token(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    handler = MagicMock(side_effect=TypeError("bad schema"))
    with pytest.raises(TypeError):
        TokenFallbackMiddleware().wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), handler)
    assert handler.call_count == 1


@pytest.mark.parametrize("status", [429, 500, 503])
@pytest.mark.parametrize("attribute", ["status_code", "code"])
def test_transient_errors_are_recognized_through_wrappers(status, attribute):
    from middleware.token_fallback import credential_failure
    source = RuntimeError("provider failure")
    setattr(source, attribute, status)
    wrapper = RuntimeError("model failure")
    wrapper.__cause__ = source
    assert credential_failure(wrapper)


@pytest.mark.parametrize("status", [401, 403])
@pytest.mark.parametrize("attribute", ["status_code", "code"])
def test_auth_errors_do_not_start_credential_rotation(status, attribute):
    from middleware.token_fallback import credential_failure
    source = RuntimeError("provider auth failure")
    setattr(source, attribute, status)
    wrapper = RuntimeError("model failure")
    wrapper.__cause__ = source
    assert not credential_failure(wrapper)


def _gemini_model():
    return ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite",
        thinking_level="minimal",
        **credential_init_kwargs("google_genai"),
    )


def _llm7_model():
    return ChatOpenAI(
        model="gemini-3.1-flash-lite",
        base_url="https://api.llm7.io/v1",
        use_responses_api=False,
        **credential_init_kwargs("llm7"),
    )


def _api_key(request_call) -> str:
    return request_call.args[0].model.google_api_key.get_secret_value()


def test_primary_auth_failure_marks_primary_dead_and_is_not_retried_on_later_calls(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "primary-test-token,secondary-test-token")
    model = _gemini_model()
    response = ModelResponse(result=[])
    middleware = TokenFallbackMiddleware()
    first = MagicMock(side_effect=[AuthError(), response])
    second = MagicMock(side_effect=[response])

    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), first) is response
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), second) is response

    assert [_api_key(call) for call in first.call_args_list] == [
        "primary-test-token",
        "secondary-test-token",
    ]
    assert [_api_key(call) for call in second.call_args_list] == ["secondary-test-token"]


def test_every_slot_dead_stops_with_terminal_credential_error(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "primary-test-token,secondary-test-token")
    model = _gemini_model()
    middleware = TokenFallbackMiddleware()
    handler = MagicMock(side_effect=AuthError())

    with pytest.raises(TerminalCredentialError) as caught:
        middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), handler)
    assert handler.call_count == 2
    assert is_terminal_task_error(caught.value)

    later = MagicMock(side_effect=AssertionError("dead slots must not be called"))
    with pytest.raises(TerminalCredentialError):
        middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), later)
    assert later.call_count == 0


def test_auth_401_slot_then_429_slot_then_successful_later_slot(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "slot-a-test-token,slot-b-test-token,slot-c-test-token")
    clock = {"now": 1_000.0}
    from middleware import token_fallback

    monkeypatch.setattr(token_fallback, "_monotonic", lambda: clock["now"])
    model = _gemini_model()
    response = ModelResponse(result=[])
    middleware = TokenFallbackMiddleware()

    first = MagicMock(side_effect=[AuthError(), QuotaError(), response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), first) is response
    assert [_api_key(call) for call in first.call_args_list] == [
        "slot-a-test-token",
        "slot-b-test-token",
        "slot-c-test-token",
    ]

    # A is dead and skipped; B is cooling down so the healthy slot C goes first.
    second = MagicMock(side_effect=[response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), second) is response
    assert [_api_key(call) for call in second.call_args_list] == ["slot-c-test-token"]

    # A rate limit is temporary: once the cooldown expires B is healthy again, A never is.
    clock["now"] += token_fallback._DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS + 1
    third = MagicMock(side_effect=[response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), third) is response
    assert [_api_key(call) for call in third.call_args_list] == ["slot-b-test-token"]
    assert token_fallback._DEAD_CREDENTIAL_SLOTS[("google_genai", "GEMINI_API_KEY")] == {0}


def test_llm7_roll_key_uses_same_dead_and_cooldown_semantics(monkeypatch):
    monkeypatch.setenv(
        "LLM7_API_KEY",
        "slot-a-test-token,slot-b-test-token,slot-c-test-token",
    )
    clock = {"now": 1_000.0}
    from middleware import token_fallback

    monkeypatch.setattr(token_fallback, "_monotonic", lambda: clock["now"])
    model = _llm7_model()
    response = ModelResponse(result=[])
    middleware = TokenFallbackMiddleware()

    first = MagicMock(side_effect=[AuthError(), QuotaError(), response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), first) is response
    assert [
        call.args[0].model.openai_api_key.get_secret_value()
        for call in first.call_args_list
    ] == [
        "slot-a-test-token",
        "slot-b-test-token",
        "slot-c-test-token",
    ]

    second = MagicMock(side_effect=[response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), second) is response
    assert second.call_args.args[0].model.openai_api_key.get_secret_value() == "slot-c-test-token"

    clock["now"] += token_fallback._DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS + 1
    third = MagicMock(side_effect=[response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), third) is response
    assert third.call_args.args[0].model.openai_api_key.get_secret_value() == "slot-b-test-token"
    assert token_fallback._DEAD_CREDENTIAL_SLOTS[("llm7", "LLM7_API_KEY")] == {0}


def test_rate_limited_slots_are_cooled_not_marked_dead_and_still_tried_last(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    from middleware import token_fallback

    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    response = ModelResponse(result=[])
    middleware = TokenFallbackMiddleware()
    first = MagicMock(side_effect=QuotaError())
    with pytest.raises(TerminalCredentialError):
        middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), first)
    assert first.call_count == 2
    assert token_fallback._DEAD_CREDENTIAL_SLOTS.get(("openai", "OPENAI_API_KEY"), set()) == set()

    second = MagicMock(side_effect=[response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), second) is response
    assert second.call_count == 1


def test_retry_after_header_sets_bounded_cooldown(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    from middleware import token_fallback

    monkeypatch.setattr(token_fallback, "_monotonic", lambda: 50.0)

    class RetryAfterQuotaError(QuotaError):
        def __init__(self, retry_after: str):
            super().__init__()
            self.response = type("Response", (), {"headers": {"retry-after": retry_after}})()

    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    handler = MagicMock(side_effect=[RetryAfterQuotaError("7"), RetryAfterQuotaError("9999")])
    with pytest.raises(TerminalCredentialError):
        TokenFallbackMiddleware().wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), handler)

    assert token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")] == {
        0: 57.0,
        1: 50.0 + token_fallback._MAX_RATE_LIMIT_COOLDOWN_SECONDS,
    }


def test_outer_model_retry_does_not_resend_auth_failures(monkeypatch):
    from langchain.agents.middleware import ModelRetryMiddleware
    from middleware.failure_policy import retry_model_error

    monkeypatch.setenv("GOOGLE_API_KEY", "only-test-token")
    model = _gemini_model()
    handler = MagicMock(side_effect=AuthError())
    retry = ModelRetryMiddleware(max_retries=2, retry_on=retry_model_error, on_failure="error", initial_delay=0)

    with pytest.raises(AuthError):
        retry.wrap_model_call(
            ModelRequest(model=model, messages=[], tools=[]),
            lambda r: TokenFallbackMiddleware().wrap_model_call(r, handler),
        )
    assert handler.call_count == 1
    assert not is_terminal_task_error(AuthError())


def test_multi_token_primary_disables_sdk_internal_retries(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "primary-test-token,secondary-test-token")
    monkeypatch.setenv("OPENAI_API_KEY", "primary-test-token,secondary-test-token")
    monkeypatch.setenv("LLM7_API_KEY", "primary-test-token,secondary-test-token")

    assert credential_init_kwargs("google_genai")["max_retries"] == 1
    assert credential_init_kwargs("openai")["max_retries"] == 0
    assert credential_init_kwargs("llm7")["max_retries"] == 0


def test_fallback_auth_failure_marks_dead_and_continues_to_next_token(monkeypatch):
    monkeypatch.setenv(
        "GEMINI_API_KEY",
        "primary-test-token,dead-test-token,working-test-token",
    )
    logger = _FakeLogger()
    from middleware import token_fallback

    monkeypatch.setattr(token_fallback, "logger", logger)
    model = ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite",
        thinking_level="minimal",
        **credential_init_kwargs("google_genai"),
    )
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[QuotaError(), AuthError(), response])

    result = TokenFallbackMiddleware().wrap_model_call(
        ModelRequest(model=model, messages=[], tools=[]),
        handler,
    )

    assert result is response
    assert handler.call_count == 3
    dead_model = handler.call_args_list[1].args[0].model
    live_model = handler.call_args_list[2].args[0].model
    assert dead_model.google_api_key.get_secret_value() == "dead-test-token"
    assert live_model.google_api_key.get_secret_value() == "working-test-token"
    assert dead_model.max_retries == 1
    dead_events = [item for item in logger.events if item[0] == "MODEL_CREDENTIAL_FALLBACK_SLOT_DEAD"]
    assert dead_events[0][1]["provider"] == "google_genai"
    assert dead_events[0][1]["credential_source"] == "GEMINI_API_KEY"
    assert dead_events[0][1]["credential_slot"] == 1
    assert "dead-test-token" not in str(logger.events)
    assert "working-test-token" not in str(logger.events)


def test_dead_fallback_token_is_skipped_on_later_rotation(monkeypatch):
    monkeypatch.setenv(
        "GEMINI_API_KEY",
        "primary-test-token,dead-test-token,working-test-token",
    )
    logger = _FakeLogger()
    from middleware import token_fallback

    monkeypatch.setattr(token_fallback, "logger", logger)
    model = ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite",
        thinking_level="minimal",
        **credential_init_kwargs("google_genai"),
    )
    response = ModelResponse(result=[])
    middleware = TokenFallbackMiddleware()
    first_handler = MagicMock(side_effect=[QuotaError(), AuthError(), response])
    second_handler = MagicMock(side_effect=[response])

    middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), first_handler)
    middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), second_handler)

    # The dead slot is skipped and the still-cooling primary is deprioritized.
    assert second_handler.call_count == 1
    fallback_model = second_handler.call_args_list[0].args[0].model
    assert fallback_model.google_api_key.get_secret_value() == "working-test-token"
    skipped = [item for item in logger.events if item[0] == "MODEL_CREDENTIAL_FALLBACK_SLOT_SKIPPED"]
    assert skipped[-1][1]["credential_slot"] == 1


def test_outer_model_retry_does_not_restart_exhausted_tokens(monkeypatch):
    from langchain.agents.middleware import ModelRetryMiddleware
    from middleware.failure_policy import retry_model_error
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    request = ModelRequest(model=model, messages=[], tools=[])
    handler = MagicMock(side_effect=QuotaError())
    fallback = TokenFallbackMiddleware()
    retry = ModelRetryMiddleware(max_retries=2, retry_on=retry_model_error, on_failure="error", initial_delay=0)
    with pytest.raises(TerminalCredentialError):
        retry.wrap_model_call(request, lambda r: fallback.wrap_model_call(r, handler))
    assert handler.call_count == 2


def test_google_retired_model_never_retries_or_rotates_token(monkeypatch):
    from google.genai.errors import ClientError
    from langchain_google_genai.chat_models import GoogleModelNotFoundError
    from middleware.token_fallback import credential_failure
    from middleware.failure_policy import retry_model_error

    source = ClientError(404, {"error": {"code": 404, "message": "model no longer available", "status": "NOT_FOUND"}})
    error = GoogleModelNotFoundError("model no longer available")
    error.__cause__ = source
    assert is_terminal_task_error(source)
    assert is_terminal_task_error(error)
    assert not retry_model_error(error)
    assert not credential_failure(error)

    monkeypatch.setenv("GOOGLE_API_KEY", "first-test-token,second-test-token")
    model = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", thinking_level="low", **credential_init_kwargs("google_genai"))
    handler = MagicMock(side_effect=error)
    with pytest.raises(GoogleModelNotFoundError):
        TokenFallbackMiddleware().wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), handler)
    assert handler.call_count == 1
