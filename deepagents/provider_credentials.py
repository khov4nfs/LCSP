"""Ordered provider credentials; never expose key material in diagnostics."""
from __future__ import annotations

import os

LLM7_DEFAULT_BASE_URL = "https://api.llm7.io/v1"

PROVIDER_KEY_ENV = {
    "openai": ("OPENAI_API_KEY",),
    "google_genai": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "llm7": ("LLM7_API_KEY",),
}
# SDK value that disables SDK-internal retries when credential rotation owns retries.
# langchain_google_genai maps max_retries to HttpRetryOptions(attempts=...): 0 means
# "Google default" (5 retries), so a single attempt is 1 there and 0 for OpenAI.
NO_SDK_RETRY_MAX_RETRIES = {
    "openai": 0,
    "google_genai": 1,
    "llm7": 0,
}


def llm7_base_url() -> str:
    """Return the configured LLM7 OpenAI-compatible endpoint."""
    configured = (os.getenv("LLM7_BASE_URL") or "").strip()
    return (configured or LLM7_DEFAULT_BASE_URL).rstrip("/")


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
    kwargs: dict[str, object] = {"api_key": tokens[0]}
    if len(tokens) > 1:
        kwargs["max_retries"] = NO_SDK_RETRY_MAX_RETRIES[provider]
    return kwargs
