"""Bounded credential fallback at the model-call boundary, never replaying tools."""
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.structured_output import StructuredOutputError
from pydantic import ValidationError

from middleware.failure_policy import TerminalCredentialError, TerminalSchemaError
from provider_credentials import provider_tokens


def credential_failure(error: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = error
    eligible = False
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TypeError, ValidationError, StructuredOutputError, TerminalSchemaError)):
            return False
        status = getattr(current, "status_code", None) or getattr(current, "code", None)
        if status in (400, 404, 422):
            return False
        if status in (401, 403, 429):
            eligible = True
        current = current.__cause__ or current.__context__
    return eligible


def model_provider(model) -> str | None:
    module = type(model).__module__
    if module.startswith("langchain_openai."):
        return "openai"
    if module.startswith("langchain_google_genai."):
        return "google_genai"
    return None


def model_with_token(model, provider: str, token: str):
    # Reconstruct SDK clients; model_copy would retain the previous key's clients.
    settings = model.model_dump(exclude={"openai_api_key", "google_api_key"})
    settings["api_key"] = token
    settings["max_retries"] = 1 if provider == "google_genai" else 0
    return type(model)(**settings)


class TokenFallbackMiddleware(AgentMiddleware):
    """Try each distinct token once for authentication/quota failures."""

    def wrap_model_call(self, request, handler):
        provider = model_provider(request.model)
        tokens = provider_tokens(provider) if provider else ()
        if len(tokens) < 2:
            return handler(request)
        for index, token in enumerate(tokens):
            model = request.model if index == 0 else model_with_token(request.model, provider, token)
            try:
                return handler(request.override(model=model))
            except Exception as error:
                if not credential_failure(error):
                    raise
                if index == len(tokens) - 1:
                    raise TerminalCredentialError("All configured provider tokens failed; task stopped") from None
        raise AssertionError("unreachable")

    async def awrap_model_call(self, request, handler):
        provider = model_provider(request.model)
        tokens = provider_tokens(provider) if provider else ()
        if len(tokens) < 2:
            return await handler(request)
        for index, token in enumerate(tokens):
            model = request.model if index == 0 else model_with_token(request.model, provider, token)
            try:
                return await handler(request.override(model=model))
            except Exception as error:
                if not credential_failure(error):
                    raise
                if index == len(tokens) - 1:
                    raise TerminalCredentialError("All configured provider tokens failed; task stopped") from None
        raise AssertionError("unreachable")
