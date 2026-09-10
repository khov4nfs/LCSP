"""LCSP Deep Agents harness boundary configuration.

This module configures the Deep Agents harness itself. LCSP application tools are
defined separately under ``tools/<node>/<tool-name>/code.py``.
"""

from __future__ import annotations

from deepagents import (
    FilesystemPermission,
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    ProviderProfile,
    register_harness_profile,
    register_provider_profile,
)

from provider_credentials import credential_init_kwargs

from model_policy import (
    ALL_LCSP_MODEL_SPECS,
    model_init_kwargs_for_agent,
    ROOT_MODEL_SPEC,
    canonical_provider,
    openai_responses_base_init_kwargs,
    openai_responses_init_kwargs,
    provider_init_kwargs,
    provider_from_model_spec,
    providers_for_model_specs,
    supports_openai_reasoning,
)


# Backward-compatible name used by the managed entrypoint/tests.
LCSP_MODEL_SPEC = ROOT_MODEL_SPEC

# OpenAI needs an explicit LCSP Responses API client contract. Reasoning is
# registered only for exact model specs that support it; it is not a provider-
# wide default because non-reasoning agents can share the same OpenAI provider.
LCSP_OPENAI_PROVIDER_PROFILE = ProviderProfile(
    init_kwargs=openai_responses_base_init_kwargs(),
)


def provider_profile_for(provider: str) -> ProviderProfile:
    """Return the LCSP construction profile for one canonical provider."""
    canonical = canonical_provider(provider)
    if canonical == "openai":
        return LCSP_OPENAI_PROVIDER_PROFILE
    return ProviderProfile(init_kwargs=provider_init_kwargs(canonical))


def model_provider_profile_for(model_spec: str) -> ProviderProfile:
    """Return the exact-model construction profile for LCSP reasoning-capable models."""
    provider = provider_from_model_spec(model_spec)
    if model_spec == "google_genai:gemini-3.5-flash-lite":
        return ProviderProfile(init_kwargs=model_init_kwargs_for_agent(
            agent_name="lcsp-agent", model_spec=model_spec
        ))
    if provider == "openai" and supports_openai_reasoning(model_spec):
        return ProviderProfile(init_kwargs=openai_responses_init_kwargs(model_spec))
    return ProviderProfile(init_kwargs=provider_init_kwargs(provider))


# Deep Agents injects filesystem tools in addition to authored tools. LCSP keeps
# only read_file visible because Managed Skills use it for progressive disclosure.
# All other filesystem / execution tools are outside the assessment flow.
HIDDEN_BUILTIN_TOOLS = frozenset(
    {
        "ls",
        "write_file",
        "edit_file",
        "delete",
        "glob",
        "grep",
        "execute",
    }
)

LCSP_HARNESS_PROFILE = HarnessProfile(
    excluded_tools=HIDDEN_BUILTIN_TOOLS,
    general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
)

# read_file remains visible only for Managed Skills. No repository/code access is
# granted through the Deep Agents filesystem; repository evidence must come from
# LCSP governed application tools.
LCSP_FILESYSTEM_PERMISSIONS = [
    FilesystemPermission(
        operations=["read"],
        paths=["/skills/**"],
        mode="allow",
    ),
    FilesystemPermission(
        operations=["read", "write"],
        paths=["/**"],
        mode="deny",
    ),
]


def configure_lcsp_harness() -> None:
    """Register active provider routes and identical LCSP harness restrictions.

    Deep Agents resolves each ``provider:model`` string through LangChain's
    ``init_chat_model`` router. Provider profiles are registered separately so
    provider-specific constructor kwargs never bleed across integrations.
    """
    for provider in providers_for_model_specs(ALL_LCSP_MODEL_SPECS):
        profile = provider_profile_for(provider)
        if credentials := credential_init_kwargs(provider):
            profile = ProviderProfile(init_kwargs={**profile.init_kwargs, **credentials})
        register_provider_profile(provider, profile)

    for model_spec in ALL_LCSP_MODEL_SPECS:
        profile = model_provider_profile_for(model_spec)
        if credentials := credential_init_kwargs(provider_from_model_spec(model_spec)):
            profile = ProviderProfile(init_kwargs={**profile.init_kwargs, **credentials})
        register_provider_profile(model_spec, profile)
        register_harness_profile(model_spec, LCSP_HARNESS_PROFILE)
