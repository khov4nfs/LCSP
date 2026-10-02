"""Ordered provider credentials; never expose key material in diagnostics."""
from __future__ import annotations

import os

LLM7_DEFAULT_BASE_URL = "https://api.llm7.io/v1"
INCEPTION_DEFAULT_BASE_URL = "https://api.inceptionlabs.ai/v1"

PROVIDER_KEY_ENV = {
    "openai": ("OPENAI_API_KEY",),
    "google_genai": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "llm7": ("LLM7_API_KEY",),
    "inception": ("INCEPTION_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
}
# One request timeout for every provider. Large Interview/Investigator prompts on
# slower routes (e.g. LLM7) exceeded shorter per-provider limits on every slot.
DEFAULT_LLM_PROVIDER_TIMEOUT_SECONDS = 300.0
# SDK value that disables SDK-internal retries when credential rotation owns retries.
# langchain_google_genai maps max_retries to HttpRetryOptions(attempts=...): 0 means
# "Google default" (5 retries), so a single attempt is 1 there and 0 for OpenAI.
NO_SDK_RETRY_MAX_RETRIES = {
    "openai": 0,
    "google_genai": 1,
    "llm7": 0,
    "inception": 0,
    "anthropic": 0,
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


def llm7_base_url() -> str:
    """Return the configured LLM7 OpenAI-compatible endpoint."""
    configured = (os.getenv("LLM7_BASE_URL") or "").strip()
    return (configured or LLM7_DEFAULT_BASE_URL).rstrip("/")


def inception_base_url() -> str:
    """Return the configured Inception Labs OpenAI-compatible endpoint."""
    configured = (os.getenv("INCEPTION_BASE_URL") or "").strip()
    return (configured or INCEPTION_DEFAULT_BASE_URL).rstrip("/")


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
        return {}
    # Explicitly pass one key: SDKs must never receive the comma-separated list.
    return {
        "api_key": tokens[0],
        "max_retries": NO_SDK_RETRY_MAX_RETRIES[provider],
    }
