"""Ordered provider credentials; never expose key material in diagnostics."""
from __future__ import annotations

import os


PROVIDER_KEY_ENV = {
    "openai": ("OPENAI_API_KEY",),
    "google_genai": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
}


def provider_tokens(provider: str) -> tuple[str, ...]:
    for name in PROVIDER_KEY_ENV.get(provider, ()):
        value = os.getenv(name, "").strip()
        if value:
            tokens = tuple(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))
            if not tokens:
                raise ValueError(f"{name} must contain at least one API token")
            return tokens
    return ()


def credential_init_kwargs(provider: str) -> dict[str, object]:
    tokens = provider_tokens(provider)
    if not tokens:
        return {}
    # Explicitly pass one key: SDKs must never receive the comma-separated list.
    kwargs: dict[str, object] = {"api_key": tokens[0]}
    if len(tokens) > 1:
        kwargs["max_retries"] = 1 if provider == "google_genai" else 0
    return kwargs
