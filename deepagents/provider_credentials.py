"""Ordered provider credentials; never expose key material in diagnostics."""
from __future__ import annotations

import os

INCEPTION_DEFAULT_BASE_URL = "https://api.inceptionlabs.ai/v1"
APX_DEFAULT_BASE_URL = "https://api.apmix.ai"
MIRAI_DEFAULT_BASE_URL = "https://api.miraiapi.com"

PROVIDER_KEY_ENV = {
    "openai": ("OPENAI_API_KEY",),
    "google_genai": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "inception": ("INCEPTION_API_KEY",),
    "apx": ("APX_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
    "miraiapi": ("MIRAI_API_KEY",),
}
# One request timeout for every provider, including slower routes with large prompts.
DEFAULT_LLM_PROVIDER_TIMEOUT_SECONDS = 300.0
# SDK value that disables SDK-internal retries when credential rotation owns retries.
# langchain_google_genai maps max_retries to HttpRetryOptions(attempts=...): 0 means
# "Google default" (5 retries), so a single attempt is 1 there and 0 for OpenAI.
NO_SDK_RETRY_MAX_RETRIES = {
    "openai": 0,
    "google_genai": 1,
    "inception": 0,
    "apx": 0,
    "anthropic": 0,
    "miraiapi": 0,
}


def _positive_timeout(raw: str, name: str) -> float:
    try:
        value = float(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a number") from error
    if value <= 0:
        raise RuntimeError(f"{name} must be > 0")
    return value


def llm_provider_timeout_seconds() -> float:
    """Return the governed request timeout in seconds, shared by all providers."""
    raw = os.getenv("LLM_PROVIDER_TIMEOUT_SECONDS")
    if raw is not None and raw.strip():
        return _positive_timeout(raw.strip(), "LLM_PROVIDER_TIMEOUT_SECONDS")
    return DEFAULT_LLM_PROVIDER_TIMEOUT_SECONDS


def apx_base_url(protocol: str = "anthropic") -> str:
    """Resolve the APX API root for one protocol without duplicating /v1."""
    configured = (os.getenv("APX_BASE_URL") or "").strip()
    root = (configured or APX_DEFAULT_BASE_URL).rstrip("/")
    while root.endswith("/v1"):
        root = root[:-3]
    if protocol == "anthropic":
        return root
    if protocol == "openai":
        return f"{root}/v1"
    raise ValueError(f"unsupported APX protocol {protocol!r}")


def inception_base_url() -> str:
    """Return the configured Inception Labs OpenAI-compatible endpoint."""
    configured = (os.getenv("INCEPTION_BASE_URL") or "").strip()
    return (configured or INCEPTION_DEFAULT_BASE_URL).rstrip("/")


def mirai_base_url(protocol: str = "openai") -> str:
    if protocol == "openai":
        return f"{MIRAI_DEFAULT_BASE_URL}/v1"
    if protocol == "anthropic":
        return MIRAI_DEFAULT_BASE_URL
    raise ValueError(f"unsupported Mirai protocol {protocol!r}")


def provider_token_source(provider: str) -> tuple[str, tuple[str, ...]] | None:
    for name in PROVIDER_KEY_ENV.get(provider, ()):
        value = os.getenv(name, "").strip()
        if value:
            tokens = tuple(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))
            if not tokens:
                raise ValueError(f"{name} must contain at least one API token")
            return name, tokens
    return None


def provider_tokens(provider: str) -> tuple[str, ...]:
    source = provider_token_source(provider)
    return source[1] if source is not None else ()


def credential_init_kwargs(provider: str) -> dict[str, object]:
    tokens = provider_tokens(provider)
    if not tokens:
        # Proxy credentials must never inherit a native SDK's environment key.
        if provider == "miraiapi":
            raise RuntimeError(f"{provider} requires {PROVIDER_KEY_ENV[provider][0]}")
        return {}
    # Explicitly pass one key: SDKs must never receive the comma-separated list.
    return {
        "api_key": tokens[0],
        "max_retries": NO_SDK_RETRY_MAX_RETRIES[provider],
    }
