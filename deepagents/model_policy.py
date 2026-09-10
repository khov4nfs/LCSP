"""Role-specific model policy for the LCSP Managed Deep Agents graph."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal

from langsmith_bootstrap import disable_langsmith_tracing_by_default

disable_langsmith_tracing_by_default()

from langchain.agents import create_agent as _langchain_create_agent
from langchain.chat_models import init_chat_model
from provider_credentials import credential_init_kwargs


DEFAULT_ROOT_MODEL_SPEC = "openai:gpt-5-nano"
DEFAULT_TRIAGE_MODEL_SPEC = "openai:gpt-5-nano"
DEFAULT_PLANNER_MODEL_SPEC = "openai:gpt-5-nano"
DEFAULT_INTERVIEW_MODEL_SPEC = "openai:gpt-5-nano"
DEFAULT_INVESTIGATOR_MODEL_SPEC = "openai:gpt-5-nano"
DEFAULT_NARRATOR_MODEL_SPEC = "openai:gpt-4.1-nano"

DEFAULT_REASONING_EFFORT = "low"
RESPONSES_OUTPUT_VERSION = "responses/v1"
OPENAI_REASONING_MODEL_PREFIXES = (
    "gpt-5.6-",
    "gpt-5.1",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-pro",
    "o1",
    "o3",
    "o4",
)
OPENAI_REASONING_MODEL_IDS = frozenset({"gpt-5"})
REASONING_AGENT_NAMES = frozenset(
    {
        "lcsp-agent",
        "triage",
        "lcsp-legal-chunk-triage",
        "lcsp-engineering-rule-compiler",
        "planner",
        "lcsp-engineering-rule-planner",
        "interview",
        "investigator",
        "law_guided_investigator",
        "lcsp-investigator-durable-execution",
    }
)
NON_REASONING_AGENT_NAMES = frozenset(
    {
        "lcsp-final-report-narrator",
        "lcsp-classification-rationale-narrator",
        "lcsp-classification-proposer",
        "lcsp-ai-usage-flow-proposer",
    }
)
SUPPORTED_REASONING_EFFORTS = frozenset(
    {
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
    }
)

# LangChain provider identifiers are canonical routing keys. Deployment-friendly
# aliases are normalized before Deep Agents resolves provider:model specs.
PROVIDER_ALIASES = {
    "google": "google_genai",
    "google_ai": "google_genai",
    "googleai": "google_genai",
    "gemini": "google_genai",
}

PROVIDER_CLIENTS = {
    "openai": "responses_api",
    "anthropic": "anthropic",
    "google_genai": "google_genai",
}


@dataclass(frozen=True)
class EffectiveModelConfig:
    role: str
    provider: str
    model: str
    source: str
    client: str
    tools: bool = True
    reasoning_effort: str = "provider_default"
    output_version: str = "provider_default"
    router: str = "langchain_init_chat_model"
    reasoning_policy: str = "provider_default"


def canonical_provider(provider: str) -> str:
    """Return the canonical LangChain provider key used for model routing."""
    normalized = provider.strip().lower().replace("-", "_")
    if not normalized:
        raise RuntimeError("model provider must not be blank")
    return PROVIDER_ALIASES.get(normalized, normalized)


@dataclass(frozen=True)
class ProviderPreset:
    reasoning_model: str
    narrator_model: str
    reasoning_effort: str = "low"


PROVIDER_PRESETS = {
    "openai": ProviderPreset("openai:gpt-5-nano", "openai:gpt-4.1-nano"),
    "google_genai": ProviderPreset(
        "google_genai:gemini-3.5-flash-lite",
        "google_genai:gemini-3.5-flash-lite",
    ),
}
GOOGLE_THINKING_LEVEL = "low"


def _selected_provider() -> str | None:
    value = (os.getenv("LCSP_MODEL_PROVIDER") or "").strip()
    if not value:
        return None
    provider = canonical_provider(value)
    if provider not in PROVIDER_PRESETS:
        raise RuntimeError(
            "LCSP_MODEL_PROVIDER must be one of: " + ", ".join(PROVIDER_PRESETS)
        )
    return provider


SELECTED_PROVIDER = _selected_provider()


def _reasoning_effort_status() -> str:
    """Resolve the OpenAI Responses API reasoning effort with fail-closed validation."""
    if SELECTED_PROVIDER:
        return PROVIDER_PRESETS[SELECTED_PROVIDER].reasoning_effort
    for env_name in (
        "LCSP_REASONING_EFFORT",
        "OPENAI_REASONING_EFFORT",
        "REASONING_EFFORT",
    ):
        value = (os.getenv(env_name) or "").strip().lower()
        if not value:
            continue
        if value not in SUPPORTED_REASONING_EFFORTS:
            supported = ", ".join(sorted(SUPPORTED_REASONING_EFFORTS))
            raise RuntimeError(
                f"{env_name} must be one of the supported reasoning efforts: {supported}"
            )
        return value
    return DEFAULT_REASONING_EFFORT


def normalize_model_spec(value: str, *, source_name: str = "model spec") -> str:
    """Normalize one ``provider:model`` spec to a canonical LangChain provider key."""
    provider, separator, model = value.strip().partition(":")
    if not separator or not provider.strip() or not model.strip() or ":" in model:
        raise RuntimeError(f"{source_name} must use LangChain provider:model format")
    return f"{canonical_provider(provider)}:{model.strip()}"


def _model_spec(env_name: str, default: str) -> tuple[str, str]:
    """Resolve one LangChain ``provider:model`` spec with a fail-closed shape check."""
    if SELECTED_PROVIDER:
        preset = PROVIDER_PRESETS[SELECTED_PROVIDER]
        return (
            preset.narrator_model if env_name == "LCSP_NARRATOR_MODEL" else preset.reasoning_model,
            "provider_preset",
        )
    env_value = (os.getenv(env_name) or "").strip()
    value = env_value or default
    return (
        normalize_model_spec(value, source_name=env_name),
        "env" if env_value else "default",
    )


def provider_from_model_spec(spec: str) -> str:
    """Return the canonical provider routing key from one model spec."""
    normalized = normalize_model_spec(spec)
    provider, _, _ = normalized.partition(":")
    return provider


def model_name_from_spec(spec: str) -> str:
    """Return the provider-local model name from one normalized model spec."""
    normalized = normalize_model_spec(spec)
    _, _, model = normalized.partition(":")
    return model


def supports_openai_reasoning(model_spec: str) -> bool:
    """Return whether one OpenAI model spec supports Responses API reasoning kwargs."""
    normalized = normalize_model_spec(model_spec)
    provider, _, model = normalized.partition(":")
    if provider != "openai":
        return False
    return model in OPENAI_REASONING_MODEL_IDS or model.startswith(
        OPENAI_REASONING_MODEL_PREFIXES
    )


def providers_for_model_specs(model_specs: tuple[str, ...]) -> tuple[str, ...]:
    """Return active provider routing keys in first-seen order."""
    return tuple(dict.fromkeys(provider_from_model_spec(spec) for spec in model_specs))


REASONING_EFFORT = _reasoning_effort_status()

ROOT_MODEL_SPEC, ROOT_MODEL_SOURCE = _model_spec(
    "LCSP_ROOT_AGENT_MODEL", DEFAULT_ROOT_MODEL_SPEC
)
TRIAGE_MODEL_SPEC, TRIAGE_MODEL_SOURCE = _model_spec(
    "LCSP_TRIAGE_MODEL", DEFAULT_TRIAGE_MODEL_SPEC
)
PLANNER_MODEL_SPEC, PLANNER_MODEL_SOURCE = _model_spec(
    "LCSP_PLANNER_MODEL", DEFAULT_PLANNER_MODEL_SPEC
)
INTERVIEW_MODEL_SPEC, INTERVIEW_MODEL_SOURCE = _model_spec(
    "LCSP_INTERVIEW_MODEL", DEFAULT_INTERVIEW_MODEL_SPEC
)
INVESTIGATOR_MODEL_SPEC, INVESTIGATOR_MODEL_SOURCE = _model_spec(
    "LCSP_INVESTIGATOR_MODEL", DEFAULT_INVESTIGATOR_MODEL_SPEC
)
NARRATOR_MODEL_SPEC, NARRATOR_MODEL_SOURCE = _model_spec(
    "LCSP_NARRATOR_MODEL", DEFAULT_NARRATOR_MODEL_SPEC
)

SUBAGENT_MODEL_SPECS = {
    "triage": TRIAGE_MODEL_SPEC,
    "planner": PLANNER_MODEL_SPEC,
    "interview": INTERVIEW_MODEL_SPEC,
    "investigator": INVESTIGATOR_MODEL_SPEC,
}

# Every model used by this graph receives the same LCSP harness restrictions.
ALL_LCSP_MODEL_SPECS = tuple(
    dict.fromkeys(
        (
            ROOT_MODEL_SPEC,
            TRIAGE_MODEL_SPEC,
            PLANNER_MODEL_SPEC,
            INTERVIEW_MODEL_SPEC,
            INVESTIGATOR_MODEL_SPEC,
            NARRATOR_MODEL_SPEC,
        )
    )
)


def openai_responses_base_init_kwargs() -> dict[str, object]:
    """Return the OpenAI Responses API construction contract without reasoning."""
    return {
        "use_responses_api": True,
        "output_version": RESPONSES_OUTPUT_VERSION,
    }


def openai_responses_init_kwargs(
    model_spec: str | None = None,
    *,
    reasoning: bool = True,
) -> dict[str, object]:
    """Return OpenAI Responses API kwargs, gated by model reasoning capability."""
    kwargs = openai_responses_base_init_kwargs()
    if reasoning and (model_spec is None or supports_openai_reasoning(model_spec)):
        kwargs["reasoning"] = {"effort": REASONING_EFFORT}
    return kwargs


def reasoning_policy_for_agent(
    *,
    agent_name: str,
    model_spec: str,
) -> Literal["enabled", "unsupported_model", "disabled_for_agent"]:
    """Resolve LCSP reasoning policy from agent purpose and model capability."""
    if agent_name in NON_REASONING_AGENT_NAMES:
        return "disabled_for_agent"
    if agent_name not in REASONING_AGENT_NAMES:
        return "disabled_for_agent"
    if not (supports_openai_reasoning(model_spec) or normalize_model_spec(model_spec) == "google_genai:gemini-3.5-flash-lite"):
        return "unsupported_model"
    return "enabled"


def model_init_kwargs_for_agent(*, agent_name: str, model_spec: str) -> dict[str, object]:
    """Return LangChain model kwargs for a specific LCSP agent construction."""
    normalized = normalize_model_spec(model_spec)
    provider, _, _ = normalized.partition(":")
    if normalized == "google_genai:gemini-3.5-flash-lite":
        return {"thinking_level": GOOGLE_THINKING_LEVEL if reasoning_policy_for_agent(
            agent_name=agent_name, model_spec=normalized
        ) == "enabled" else "minimal"}
    if provider != "openai":
        return provider_init_kwargs(provider)

    return openai_responses_init_kwargs(
        normalized,
        reasoning=reasoning_policy_for_agent(
            agent_name=agent_name,
            model_spec=normalized,
        )
        == "enabled",
    )


def resolve_agent_model(*, agent_name: str, model_spec: str):
    """Instantiate a LangChain chat model with LCSP agent-scoped reasoning policy."""
    return init_chat_model(
        normalize_model_spec(model_spec),
        **model_init_kwargs_for_agent(agent_name=agent_name, model_spec=model_spec),
        **credential_init_kwargs(provider_from_model_spec(model_spec)),
    )


def create_lcsp_agent(
    *,
    agent_name: str,
    model: Any,
    **kwargs: Any,
):
    """Create a LangChain agent with LCSP agent-scoped model policy applied."""
    resolved_model = (
        resolve_agent_model(agent_name=agent_name, model_spec=model)
        if isinstance(model, str)
        else model
    )
    langchain_name = kwargs.pop("name", agent_name)
    return _langchain_create_agent(
        model=resolved_model,
        name=langchain_name,
        **kwargs,
    )


def provider_init_kwargs(provider: str) -> dict[str, object]:
    """Return constructor kwargs scoped to one provider only.

    The provider:model prefix selects the LangChain integration. OpenAI additionally
    needs the LCSP Responses API client contract. Reasoning is decided per agent and
    per model capability so OpenAI-only kwargs never bleed across integrations and
    non-reasoning OpenAI agents do not inherit reasoning merely by provider prefix.
    """
    canonical = canonical_provider(provider)
    if canonical == "openai":
        return openai_responses_base_init_kwargs()
    return {}


def provider_client(provider: str) -> str:
    """Return non-secret telemetry describing the selected provider client."""
    canonical = canonical_provider(provider)
    return PROVIDER_CLIENTS.get(canonical, "langchain_provider_default")


def effective_model_configs() -> tuple[EffectiveModelConfig, ...]:
    """Return non-secret model telemetry for startup diagnostics."""
    role_specs = (
        ("root", ROOT_MODEL_SPEC, ROOT_MODEL_SOURCE),
        ("triage", TRIAGE_MODEL_SPEC, TRIAGE_MODEL_SOURCE),
        ("planner", PLANNER_MODEL_SPEC, PLANNER_MODEL_SOURCE),
        ("interview", INTERVIEW_MODEL_SPEC, INTERVIEW_MODEL_SOURCE),
        ("investigator", INVESTIGATOR_MODEL_SPEC, INVESTIGATOR_MODEL_SOURCE),
        ("narrator", NARRATOR_MODEL_SPEC, NARRATOR_MODEL_SOURCE),
    )
    configs: list[EffectiveModelConfig] = []
    for role, spec, source in role_specs:
        provider, model = spec.split(":", 1)
        is_openai = provider == "openai"
        agent_name = "lcsp-agent" if role == "root" else role
        reasoning_policy = reasoning_policy_for_agent(
            agent_name=agent_name,
            model_spec=spec,
        )
        configs.append(
            EffectiveModelConfig(
                role=role,
                provider=provider,
                model=model,
                source=source,
                client=provider_client(provider),
                reasoning_effort=(
                    REASONING_EFFORT
                    if is_openai and reasoning_policy == "enabled"
                    else "unset"
                    if is_openai
                    else str(model_init_kwargs_for_agent(agent_name=agent_name, model_spec=spec).get("thinking_level", "provider_default"))
                ),
                output_version=(
                    RESPONSES_OUTPUT_VERSION if is_openai else "provider_default"
                ),
                reasoning_policy=reasoning_policy,
            )
        )
    return tuple(configs)
