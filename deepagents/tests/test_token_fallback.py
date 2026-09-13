from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI

from middleware.failure_policy import TerminalCredentialError, is_terminal_task_error
from middleware.token_fallback import TokenFallbackMiddleware, model_with_token
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


@pytest.fixture(autouse=True)
def clear_dead_credential_slots():
    from middleware import token_fallback

    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()
    yield
    token_fallback._DEAD_CREDENTIAL_SLOTS.clear()


@pytest.mark.parametrize("provider", ["openai", "google_genai"])
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_token_fallback_preserves_model_policy(monkeypatch, provider, asynchronous):
    name = "OPENAI_API_KEY" if provider == "openai" else "GOOGLE_API_KEY"
    monkeypatch.setenv(name, "first-test-token,second-test-token,")
    model = (ChatOpenAI(model="gpt-5-nano", reasoning={"effort": "low"}, use_responses_api=True,
                        **credential_init_kwargs(provider)) if provider == "openai" else
             ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", thinking_level="minimal",
                                    **credential_init_kwargs(provider)))
    request = ModelRequest(model=model, messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = AsyncMock(side_effect=[QuotaError(), response]) if asynchronous else MagicMock(side_effect=[QuotaError(), response])
    middleware = TokenFallbackMiddleware()
    result = await middleware.awrap_model_call(request, handler) if asynchronous else middleware.wrap_model_call(request, handler)
    assert result is response
    assert handler.call_count == 2
    fallback = handler.call_args.args[0].model
    key = fallback.openai_api_key if provider == "openai" else fallback.google_api_key
    assert key.get_secret_value() == "second-test-token"
    assert fallback is not model
    if provider == "openai":
        assert fallback.reasoning == {"effort": "low"}
        assert fallback.use_responses_api is True
        assert fallback.root_client is not model.root_client
    else:
        assert fallback.reasoning_effort == "minimal"
        assert fallback.thinking_budget is None
        assert fallback.max_retries == 0
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


def test_primary_auth_failure_does_not_try_fallback_token(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "primary-test-token,secondary-test-token")
    model = ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite",
        thinking_level="minimal",
        **credential_init_kwargs("google_genai"),
    )
    handler = MagicMock(side_effect=AuthError())

    with pytest.raises(AuthError):
        TokenFallbackMiddleware().wrap_model_call(
            ModelRequest(model=model, messages=[], tools=[]),
            handler,
        )

    assert handler.call_count == 1


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
    assert dead_model.max_retries == 0
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
    second_handler = MagicMock(side_effect=[QuotaError(), response])

    middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), first_handler)
    middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), second_handler)

    assert second_handler.call_count == 2
    fallback_model = second_handler.call_args_list[1].args[0].model
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
