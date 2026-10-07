from hashlib import sha256
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from langchain.agents.middleware import ModelRequest, ModelResponse
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI

from middleware.failure_policy import TerminalCredentialError, is_terminal_task_error
from middleware.token_fallback import TokenFallbackMiddleware, model_provider, model_with_token
from provider_credentials import provider_tokens, credential_init_kwargs


class QuotaError(Exception):
    status_code = 429


class CapacityError(Exception):
    status_code = 402
    code = "insufficient_balance"


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


def test_inception_credentials_are_isolated_from_openai(monkeypatch):
    monkeypatch.setenv("INCEPTION_API_KEY", "inception-one,inception-two")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-must-not-be-used")

    assert provider_tokens("inception") == ("inception-one", "inception-two")
    assert credential_init_kwargs("inception") == {
        "api_key": "inception-one",
        "max_retries": 0,
    }


def test_apx_credentials_are_isolated_from_openai(monkeypatch):
    monkeypatch.setenv("APX_API_KEY", "apx-one,apx-two")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-must-not-be-used")

    assert provider_tokens("apx") == ("apx-one", "apx-two")
    assert credential_init_kwargs("apx") == {"api_key": "apx-one", "max_retries": 0}


def test_apx_chat_openai_is_detected_and_rotates_with_its_gateway(monkeypatch):
    monkeypatch.setenv("APX_API_KEY", "apx-first,apx-second")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-must-not-be-used")
    model = ChatOpenAI(
        model="gpt-5.6-luna",
        base_url="https://api.apmix.ai/v1",
        use_responses_api=False,
        **credential_init_kwargs("apx"),
    )
    assert model_provider(model) == "apx"

    handler = MagicMock(side_effect=[QuotaError(), ModelResponse(result=[])])
    TokenFallbackMiddleware().wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), handler)

    fallback = handler.call_args.args[0].model
    assert fallback.openai_api_key.get_secret_value() == "apx-second"
    assert str(fallback.openai_api_base).rstrip("/") == "https://api.apmix.ai/v1"
    assert fallback.use_responses_api is False


def test_llm7_chat_openai_rotation_preserves_gateway_policy(monkeypatch):
    monkeypatch.setenv("LLM7_API_KEY", "llm7-first,llm7-second")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-must-not-be-used")
    model = ChatOpenAI(
        model="minimax-m2.7",
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


def test_inception_chat_openai_rotation_preserves_gateway_policy(monkeypatch):
    monkeypatch.setenv("INCEPTION_API_KEY", "inception-first,inception-second")
    monkeypatch.setenv("OPENAI_API_KEY", "openai-must-not-be-used")
    model = ChatOpenAI(
        model="mercury-2.5",
        base_url="https://api.inceptionlabs.ai/v1",
        temperature=0.75,
        use_responses_api=False,
        **credential_init_kwargs("inception"),
    )
    assert model_provider(model) == "inception"

    request = ModelRequest(model=model, messages=[], tools=[])
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[QuotaError(), response])
    result = TokenFallbackMiddleware().wrap_model_call(request, handler)

    assert result is response
    assert handler.call_count == 2
    fallback = handler.call_args.args[0].model
    assert fallback.openai_api_key.get_secret_value() == "inception-second"
    assert str(fallback.openai_api_base).rstrip("/") == "https://api.inceptionlabs.ai/v1"
    assert fallback.temperature == 0.75
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


@pytest.fixture(autouse=True)
def forbid_real_cooldown_sleep(monkeypatch):
    """Fail loudly instead of sleeping for a production cooldown (30-120s)."""
    from middleware import token_fallback

    def real_sleep(seconds: float) -> None:
        raise AssertionError(f"real cooldown sleep of {seconds}s; install the fake clock")

    async def real_asleep(seconds: float) -> None:
        raise AssertionError(f"real cooldown sleep of {seconds}s; install the fake clock")

    monkeypatch.setattr(token_fallback, "_sleep", real_sleep)
    monkeypatch.setattr(token_fallback, "_asleep", real_asleep)


class _FakeCooldownClock:
    def __init__(self, start: float):
        self.now = start
        self.sleeps: list[float] = []
        self.async_sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds

    async def asleep(self, seconds: float) -> None:
        self.async_sleeps.append(seconds)
        self.now += seconds


def _install_fake_cooldown_clock(monkeypatch, *, start: float = 1_000.0):
    from middleware import token_fallback

    clock = _FakeCooldownClock(start)
    monkeypatch.setattr(token_fallback, "_monotonic", clock.monotonic)
    monkeypatch.setattr(token_fallback, "_sleep", clock.sleep)
    monkeypatch.setattr(token_fallback, "_asleep", clock.asleep)
    return clock, token_fallback


@pytest.mark.parametrize(
    "provider", ["openai", "google_genai", "llm7", "inception", "apx", "anthropic"]
)
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_token_fallback_preserves_model_policy(monkeypatch, provider, asynchronous):
    name = {
        "openai": "OPENAI_API_KEY",
        "google_genai": "GOOGLE_API_KEY",
        "llm7": "LLM7_API_KEY",
        "inception": "INCEPTION_API_KEY",
        "apx": "APX_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
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
            model="minimax-m2.7",
            base_url="https://api.llm7.io/v1",
            use_responses_api=False,
            **credential_init_kwargs(provider),
        )
    elif provider == "inception":
        model = ChatOpenAI(
            model="mercury-2.5",
            base_url="https://api.inceptionlabs.ai/v1",
            temperature=0.75,
            use_responses_api=False,
            **credential_init_kwargs(provider),
        )
    elif provider == "apx":
        model = ChatOpenAI(
            model="gpt-5.6-luna",
            base_url="https://api.apmix.ai/v1",
            use_responses_api=False,
            **credential_init_kwargs(provider),
        )
    elif provider == "anthropic":
        model = ChatAnthropic(
            model="claude-sonnet-5",
            temperature=0.2,
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
    key = (
        fallback.openai_api_key
        if provider in {"openai", "llm7", "inception", "apx"}
        else fallback.anthropic_api_key
        if provider == "anthropic"
        else fallback.google_api_key
    )
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
    elif provider == "inception":
        assert str(fallback.openai_api_base).rstrip("/") == "https://api.inceptionlabs.ai/v1"
        assert fallback.temperature == 0.75
        assert fallback.use_responses_api is False
        assert fallback.max_retries == 0
        assert fallback.root_client is not model.root_client
    elif provider == "apx":
        assert model_provider(model) == "apx"
        assert str(fallback.openai_api_base).rstrip("/") == "https://api.apmix.ai/v1"
        assert fallback.use_responses_api is False
        assert fallback.max_retries == 0
        assert fallback.root_client is not model.root_client
    elif provider == "anthropic":
        assert model_provider(model) == "anthropic"
        assert fallback.model == "claude-sonnet-5"
        assert fallback.temperature == 0.2
        assert fallback.max_retries == 0
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
    _install_fake_cooldown_clock(monkeypatch)
    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    request = ModelRequest(model=model, messages=[], tools=[])
    handler = AsyncMock(side_effect=QuotaError()) if asynchronous else MagicMock(side_effect=QuotaError())
    middleware = TokenFallbackMiddleware()
    with pytest.raises(TerminalCredentialError) as caught:
        if asynchronous:
            await middleware.awrap_model_call(request, handler)
        else:
            middleware.wrap_model_call(request, handler)
    assert handler.call_count == 3
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


def test_sdk_timeout_errors_are_transient_credential_failures():
    from middleware.token_fallback import credential_failure

    wrapper = RuntimeError("model failure")
    wrapper.__cause__ = httpx.ReadTimeout("provider timed out")

    assert credential_failure(wrapper)
    assert not is_terminal_task_error(wrapper)


@pytest.mark.parametrize("attribute", ["status_code", "code"])
def test_provider_capacity_errors_are_credential_failures(attribute):
    from middleware.failure_policy import is_provider_capacity_failure
    from middleware.token_fallback import credential_failure
    source = RuntimeError("insufficient_balance")
    setattr(source, attribute, 402)
    wrapper = RuntimeError("model failure")
    wrapper.__cause__ = source
    assert is_provider_capacity_failure(wrapper)
    assert credential_failure(wrapper)


def test_provider_capacity_error_codes_are_recognized_without_status():
    from middleware.failure_policy import is_provider_capacity_failure
    from middleware.token_fallback import credential_failure
    source = RuntimeError("provider rejected request")
    source.code = "insufficient_quota"
    wrapper = RuntimeError("model failure")
    wrapper.__cause__ = source
    assert is_provider_capacity_failure(wrapper)
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
        model="minimax-m2.7",
        base_url="https://api.llm7.io/v1",
        use_responses_api=False,
        **credential_init_kwargs("llm7"),
    )


def _api_key(request_call) -> str:
    return request_call.args[0].model.google_api_key.get_secret_value()


def _fingerprint(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()[:12]


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
    _, token_fallback = _install_fake_cooldown_clock(monkeypatch)

    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    response = ModelResponse(result=[])
    middleware = TokenFallbackMiddleware()
    first = MagicMock(side_effect=[QuotaError(), QuotaError(), response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), first) is response
    assert first.call_count == 3
    assert token_fallback._DEAD_CREDENTIAL_SLOTS.get(("openai", "OPENAI_API_KEY"), set()) == set()
    assert [call.args[0].model.openai_api_key.get_secret_value() for call in first.call_args_list] == [
        "first-test-token",
        "second-test-token",
        "first-test-token",
    ]

    second = MagicMock(side_effect=[response])
    assert middleware.wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), second) is response
    assert second.call_count == 1


class RetryAfterQuotaError(QuotaError):
    def __init__(self, retry_after: str):
        super().__init__()
        self.response = type("Response", (), {"headers": {"retry-after": retry_after}})()


def _openai_request() -> ModelRequest:
    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    return ModelRequest(model=model, messages=[], tools=[])


def _openai_keys(handler) -> list[str]:
    return [call.args[0].model.openai_api_key.get_secret_value() for call in handler.call_args_list]


async def _call(middleware, request, handler, asynchronous: bool):
    if asynchronous:
        return await middleware.awrap_model_call(request, handler)
    return middleware.wrap_model_call(request, handler)


def _handler(side_effect, asynchronous: bool):
    return AsyncMock(side_effect=side_effect) if asynchronous else MagicMock(side_effect=side_effect)


def _waits(clock, asynchronous: bool) -> list[float]:
    # Each path must use its own sleep hook; the other must stay untouched.
    used, unused = (clock.async_sleeps, clock.sleeps) if asynchronous else (clock.sleeps, clock.async_sleeps)
    assert unused == []
    return used


def test_credential_health_state_is_clean_at_test_start():
    from middleware import token_fallback

    assert token_fallback._DEAD_CREDENTIAL_SLOTS == {}
    assert token_fallback._RATE_LIMITED_UNTIL == {}


def test_fake_clock_helper_is_not_a_generator_and_fixture_owns_cleanup():
    import inspect

    # A stray `yield` once turned the helper into a generator: it never installed the
    # clock and the fixture never cleaned up after the test.
    assert not inspect.isgeneratorfunction(_install_fake_cooldown_clock)
    assert inspect.isgeneratorfunction(clear_dead_credential_slots.__wrapped__)


def test_leaves_dirty_credential_health_for_the_fixture_to_clear(monkeypatch):
    from middleware import token_fallback

    # The autouse fixture's teardown must clear this; the next test asserts it did.
    token_fallback._DEAD_CREDENTIAL_SLOTS[("openai", "OPENAI_API_KEY")] = {0, 1}
    token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")] = {0: 9e9}


def test_credential_health_state_is_clean_after_a_dirty_test():
    from middleware import token_fallback

    assert token_fallback._DEAD_CREDENTIAL_SLOTS == {}
    assert token_fallback._RATE_LIMITED_UNTIL == {}


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_all_slots_429_waits_once_for_soonest_slot_then_succeeds(monkeypatch, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    response = ModelResponse(result=[])
    # Slot B cools for less time than slot A, so B is the slot waited for.
    handler = _handler([RetryAfterQuotaError("40"), RetryAfterQuotaError("10"), response], asynchronous)

    result = await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous)

    assert result is response
    assert _openai_keys(handler) == ["first-test-token", "second-test-token", "second-test-token"]
    assert _waits(clock, asynchronous) == [10.0]
    assert token_fallback._DEAD_CREDENTIAL_SLOTS.get(("openai", "OPENAI_API_KEY"), set()) == set()
    # B recovered; A is still cooling until its own expiry.
    assert token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")] == {0: 1_040.0}


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_second_429_after_the_single_wait_terminates(monkeypatch, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, _ = _install_fake_cooldown_clock(monkeypatch)
    handler = _handler(QuotaError(), asynchronous)

    with pytest.raises(TerminalCredentialError) as caught:
        await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous)

    # A, B, then only the awaited slot (A wins the equal-expiry tie by index), once.
    assert _openai_keys(handler) == ["first-test-token", "second-test-token", "first-test-token"]
    assert _waits(clock, asynchronous) == [30.0]
    assert isinstance(caught.value.__cause__, QuotaError)
    assert "test-token" not in str(caught.value)


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_healthy_slot_is_used_before_a_cooling_slot_without_waiting(monkeypatch, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")] = {0: clock.now + 25}
    response = ModelResponse(result=[])
    handler = _handler([response], asynchronous)

    assert await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous) is response

    assert _openai_keys(handler) == ["second-test-token"]
    assert _waits(clock, asynchronous) == []


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_all_slots_already_cooling_wait_until_soonest_expiry(monkeypatch, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token,third-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")] = {
        0: clock.now + 50,
        1: clock.now + 12,
        2: clock.now + 12,
    }
    invoked_at: list[float] = []
    response = ModelResponse(result=[])

    def record(_request):
        invoked_at.append(clock.now)
        return response

    handler = _handler(record, asynchronous)

    assert await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous) is response

    # No provider call before the soonest expiry; the lower index wins the tie.
    assert _waits(clock, asynchronous) == [12.0]
    assert invoked_at == [1_012.0]
    assert _openai_keys(handler) == ["second-test-token"]


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_after_the_wait_each_newly_eligible_slot_is_tried_once_in_index_order(monkeypatch, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token,third-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    # Slots 1 and 2 cool before this call; slot 0 is tried and 429s with a later expiry.
    token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")] = {
        1: clock.now + 5,
        2: clock.now + 5,
    }
    handler = _handler([RetryAfterQuotaError("60"), QuotaError(), QuotaError()], asynchronous)

    with pytest.raises(TerminalCredentialError):
        await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous)

    assert _waits(clock, asynchronous) == [5.0]
    assert _openai_keys(handler) == ["first-test-token", "second-test-token", "third-test-token"]


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_retry_after_header_sets_bounded_cooldown(monkeypatch, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch, start=50.0)
    logger = _FakeLogger()
    monkeypatch.setattr(token_fallback, "logger", logger)
    handler = _handler(
        [RetryAfterQuotaError("7"), RetryAfterQuotaError("9999"), RetryAfterQuotaError("3")],
        asynchronous,
    )

    with pytest.raises(TerminalCredentialError):
        await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous)

    # Waits exactly the provider's 7s for slot 0, never the capped 120s of slot 1.
    assert _waits(clock, asynchronous) == [7.0]
    assert token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")] == {
        0: 57.0 + 3.0,
        1: 50.0 + token_fallback._MAX_RATE_LIMIT_COOLDOWN_SECONDS,
    }
    rate_limited = [item[1] for item in logger.events if item[0] == "MODEL_CREDENTIAL_FALLBACK_SLOT_RATE_LIMITED"]
    assert [event["cooldown_seconds"] for event in rate_limited] == [
        7.0,
        token_fallback._MAX_RATE_LIMIT_COOLDOWN_SECONDS,
        3.0,
    ]
    assert rate_limited[0]["credential_fingerprint"] == _fingerprint("first-test-token")
    assert rate_limited[1]["credential_fingerprint"] == _fingerprint("second-test-token")
    waiting = [item[1] for item in logger.events if item[0] == "MODEL_CREDENTIAL_FALLBACK_WAITING_FOR_RATE_LIMIT"]
    assert waiting == [
        {
            "provider": "openai",
            "credential_source": "OPENAI_API_KEY",
            "credential_slot": 0,
            "credential_fingerprint": _fingerprint("first-test-token"),
            "fallback_enabled": True,
            "wait_seconds": 7.0,
        }
    ]
    assert "first-test-token" not in str(logger.events)
    assert "second-test-token" not in str(logger.events)


def test_retry_after_without_header_uses_default_cooldown(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[QuotaError(), response])

    assert TokenFallbackMiddleware().wrap_model_call(_openai_request(), handler) is response

    assert token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")] == {
        0: clock.now + token_fallback._DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS,
    }
    assert clock.sleeps == []


@pytest.mark.parametrize("status", [401, 403])
@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_auth_failure_marks_dead_without_cooldown_or_sleep(monkeypatch, status, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    auth_error = RuntimeError("provider auth failure")
    auth_error.status_code = status
    response = ModelResponse(result=[])
    middleware = TokenFallbackMiddleware()

    first = _handler([auth_error, response], asynchronous)
    assert await _call(middleware, _openai_request(), first, asynchronous) is response
    assert token_fallback._DEAD_CREDENTIAL_SLOTS[("openai", "OPENAI_API_KEY")] == {0}
    assert token_fallback._RATE_LIMITED_UNTIL.get(("openai", "OPENAI_API_KEY"), {}) == {}

    # Even once every live slot has failed, a dead slot is never waited for or retried.
    second = _handler(ServerError(), asynchronous)
    with pytest.raises(TerminalCredentialError):
        await _call(middleware, _openai_request(), second, asynchronous)
    assert _openai_keys(second) == ["second-test-token"]
    assert clock.sleeps == []
    assert clock.async_sleeps == []


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_wrapped_sdk_timeout_rotates_without_marking_slot_dead(monkeypatch, asynchronous):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    timeout = RuntimeError("model failure")
    timeout.__cause__ = httpx.ReadTimeout("provider timed out")
    response = ModelResponse(result=[])
    middleware = TokenFallbackMiddleware()

    first = _handler([timeout, response], asynchronous)
    assert await _call(middleware, _openai_request(), first, asynchronous) is response
    assert _openai_keys(first) == ["first-test-token", "second-test-token"]

    # Neither dead nor cooling: the timed-out slot is first again on the next call.
    second = _handler([response], asynchronous)
    assert await _call(middleware, _openai_request(), second, asynchronous) is response
    assert _openai_keys(second) == ["first-test-token"]
    assert token_fallback._DEAD_CREDENTIAL_SLOTS.get(("openai", "OPENAI_API_KEY"), set()) == set()
    assert token_fallback._RATE_LIMITED_UNTIL.get(("openai", "OPENAI_API_KEY"), {}) == {}
    assert clock.sleeps == [] and clock.async_sleeps == []


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_transient_primary_retries_once_after_all_alternates_are_auth_dead(
    monkeypatch, asynchronous
):
    monkeypatch.setenv(
        "OPENAI_API_KEY",
        "primary-test-token,dead-test-token-a,dead-test-token-b",
    )
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    timeout = RuntimeError("model failure")
    timeout.__cause__ = httpx.ReadTimeout("provider timed out")
    first_auth = RuntimeError("provider auth failure")
    first_auth.status_code = 401
    second_auth = RuntimeError("provider auth failure")
    second_auth.status_code = 403
    response = ModelResponse(result=[])
    handler = _handler([timeout, first_auth, second_auth, response], asynchronous)

    assert (
        await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous)
        is response
    )

    assert _openai_keys(handler) == [
        "primary-test-token",
        "dead-test-token-a",
        "dead-test-token-b",
        "primary-test-token",
    ]
    assert token_fallback._DEAD_CREDENTIAL_SLOTS[("openai", "OPENAI_API_KEY")] == {
        1,
        2,
    }
    assert clock.sleeps == [] and clock.async_sleeps == []


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_transient_primary_recovery_is_bounded_to_one_extra_attempt(
    monkeypatch, asynchronous
):
    monkeypatch.setenv(
        "OPENAI_API_KEY",
        "primary-test-token,dead-test-token-a,dead-test-token-b",
    )
    clock, _ = _install_fake_cooldown_clock(monkeypatch)
    timeout = RuntimeError("model failure")
    timeout.__cause__ = httpx.ReadTimeout("provider timed out")
    retry_timeout = RuntimeError("model failure again")
    retry_timeout.__cause__ = httpx.ReadTimeout("provider timed out again")
    first_auth = RuntimeError("provider auth failure")
    first_auth.status_code = 401
    second_auth = RuntimeError("provider auth failure")
    second_auth.status_code = 403
    handler = _handler([timeout, first_auth, second_auth, retry_timeout], asynchronous)

    with pytest.raises(TerminalCredentialError):
        await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous)

    assert _openai_keys(handler) == [
        "primary-test-token",
        "dead-test-token-a",
        "dead-test-token-b",
        "primary-test-token",
    ]
    assert handler.call_count == 4
    assert clock.sleeps == [] and clock.async_sleeps == []


def test_server_errors_on_every_slot_terminate_without_waiting(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    handler = MagicMock(side_effect=ServerError())

    with pytest.raises(TerminalCredentialError):
        TokenFallbackMiddleware().wrap_model_call(_openai_request(), handler)

    assert handler.call_count == 2
    assert clock.sleeps == []
    assert token_fallback._DEAD_CREDENTIAL_SLOTS.get(("openai", "OPENAI_API_KEY"), set()) == set()


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


def test_outer_model_retry_does_not_resend_provider_capacity_failure(monkeypatch):
    from langchain.agents.middleware import ModelRetryMiddleware
    from middleware.failure_policy import retry_model_error

    monkeypatch.setenv("LLM7_API_KEY", "only-test-token")
    model = _llm7_model()
    handler = MagicMock(side_effect=CapacityError("insufficient balance"))
    retry = ModelRetryMiddleware(max_retries=2, retry_on=retry_model_error, on_failure="error", initial_delay=0)

    with pytest.raises(CapacityError):
        retry.wrap_model_call(
            ModelRequest(model=model, messages=[], tools=[]),
            lambda r: TokenFallbackMiddleware().wrap_model_call(r, handler),
        )
    assert handler.call_count == 1
    assert not retry_model_error(CapacityError("insufficient balance"))


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
    assert dead_events[0][1]["credential_fingerprint"] == _fingerprint(
        "dead-test-token"
    )
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
    # Logged once for the later call, not again on each re-plan.
    assert len(skipped) == 1
    assert skipped[-1][1]["credential_slot"] == 1
    assert skipped[-1][1]["credential_fingerprint"] == _fingerprint(
        "dead-test-token"
    )
    assert "dead-test-token" not in str(logger.events)


def test_outer_model_retry_does_not_restart_exhausted_tokens(monkeypatch):
    from langchain.agents.middleware import ModelRetryMiddleware
    from middleware.failure_policy import retry_model_error
    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    _install_fake_cooldown_clock(monkeypatch)
    model = ChatOpenAI(model="gpt-5-nano", **credential_init_kwargs("openai"))
    request = ModelRequest(model=model, messages=[], tools=[])
    handler = MagicMock(side_effect=QuotaError())
    fallback = TokenFallbackMiddleware()
    retry = ModelRetryMiddleware(max_retries=2, retry_on=retry_model_error, on_failure="error", initial_delay=0)
    with pytest.raises(TerminalCredentialError):
        retry.wrap_model_call(request, lambda r: fallback.wrap_model_call(r, handler))
    assert handler.call_count == 3


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


def _google_rate_limit(retry_delay: object) -> Exception:
    from google.genai.errors import ClientError
    from langchain_google_genai.chat_models import GoogleRateLimitError

    details = [{"@type": "type.googleapis.com/google.rpc.QuotaFailure"}]
    if retry_delay is not None:
        details.append({"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry_delay})
    error = GoogleRateLimitError("rate limited")
    error.__cause__ = ClientError(
        429,
        {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "Quota exceeded.", "details": details}},
    )
    return error


@pytest.mark.parametrize(
    ("retry_delay", "expected"),
    [("45s", 45.0), ("37.4s", 37.4), ("9999s", None), ("soon", 30.0), (None, 30.0)],
)
def test_google_retry_info_delay_sets_bounded_cooldown(monkeypatch, retry_delay, expected):
    # Google reports its 429 delay in the error body (google.rpc.RetryInfo), not a
    # Retry-After header; ignoring it made the single cooldown wait too short (scan 30321443).
    monkeypatch.setenv("GOOGLE_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch, start=100.0)
    model = ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite", thinking_level="minimal", **credential_init_kwargs("google_genai")
    )
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[_google_rate_limit(retry_delay), response])

    assert TokenFallbackMiddleware().wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), handler) is response

    cooldown = expected if expected is not None else token_fallback._MAX_RATE_LIMIT_COOLDOWN_SECONDS
    assert token_fallback._RATE_LIMITED_UNTIL[("google_genai", "GOOGLE_API_KEY")] == {0: 100.0 + cooldown}


def test_google_retry_info_governs_the_single_cooldown_wait(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "first-test-token,second-test-token")
    clock, _ = _install_fake_cooldown_clock(monkeypatch, start=100.0)
    model = ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite", thinking_level="minimal", **credential_init_kwargs("google_genai")
    )
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[_google_rate_limit("50s"), _google_rate_limit("40s"), response])

    assert TokenFallbackMiddleware().wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), handler) is response

    # Waits the provider-requested 40s for the soonest slot, not the 30s default.
    assert clock.sleeps == [40.0]


def test_cooldown_wait_runs_under_liveness_heartbeat(monkeypatch):
    from contextlib import contextmanager

    monkeypatch.setenv("GOOGLE_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch, start=100.0)
    inside: list[bool] = []
    active = {"on": False}

    @contextmanager
    def fake_heartbeat(text):
        active["on"] = True
        try:
            yield
        finally:
            active["on"] = False

    real_sleep = clock.sleep
    monkeypatch.setattr(token_fallback, "model_wait_heartbeat", fake_heartbeat)
    monkeypatch.setattr(token_fallback, "_sleep", lambda s: (inside.append(active["on"]), real_sleep(s)))
    model = ChatGoogleGenerativeAI(
        model="gemini-3.5-flash-lite", thinking_level="minimal", **credential_init_kwargs("google_genai")
    )
    response = ModelResponse(result=[])
    handler = MagicMock(side_effect=[_google_rate_limit("50s"), _google_rate_limit("40s"), response])

    assert TokenFallbackMiddleware().wrap_model_call(ModelRequest(model=model, messages=[], tools=[]), handler) is response

    assert inside == [True]


@pytest.mark.parametrize("asynchronous", [False, True])
@pytest.mark.asyncio
async def test_cooling_pool_defers_to_a_later_provider_route_without_waiting(monkeypatch, asynchronous):
    from middleware.token_fallback import further_provider_route

    monkeypatch.setenv("OPENAI_API_KEY", "first-test-token,second-test-token")
    clock, token_fallback = _install_fake_cooldown_clock(monkeypatch)
    handler = _handler([QuotaError(), QuotaError()], asynchronous)

    with further_provider_route(True), pytest.raises(TerminalCredentialError):
        await _call(TokenFallbackMiddleware(), _openai_request(), handler, asynchronous)

    # No cooldown sleep: the provider route takes over, and both slots stay cooling.
    assert clock.sleeps == [] and clock.async_sleeps == []
    assert _openai_keys(handler) == ["first-test-token", "second-test-token"]
    assert set(token_fallback._RATE_LIMITED_UNTIL[("openai", "OPENAI_API_KEY")]) == {0, 1}

    # A later call while the pool is still cooling defers immediately, without a request.
    later = _handler([], asynchronous)
    with further_provider_route(True), pytest.raises(TerminalCredentialError):
        await _call(TokenFallbackMiddleware(), _openai_request(), later, asynchronous)
    assert later.call_count == 0
    assert clock.sleeps == [] and clock.async_sleeps == []
