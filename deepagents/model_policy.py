"""Model identity is configuration, not code.

Single authority: one YAML file (default ``config/model_routes.yaml`` next to this module,
override with ``LCSP_MODEL_ROUTES_FILE``; no env-JSON path). Shape and validation live in
``model_routes_config``::

    version: 1
    routes:    {<routeId>: {provider: <exact transport id>, model: <any string>, options: {...}}}
    roles:     {default: <routeId>, <role>: <routeId>}
    fallbacks: {<routeId>: [<routeId>, ...]}

The file is read and validated once per resolved path (``load_model_routes.cache_clear()``
for tests); nothing is resolved at import time. Public API: ``load_model_routes``,
``resolve_role``, ``resolve_agent_model`` / ``build_model``, ``fallback_routes``,
``route_for_model``, ``resolved_policy_snapshot`` / ``config_snapshot``,
``effective_model_configs``, ``distinct_runtime_identities``, ``canonical_provider``,
``provider_client``, ``provider_init_kwargs``.

Providers are transport adapters only (LangChain key, base_url, timeout, API protocol,
credential source), matched by exact id, and accept arbitrary case-preserved model strings;
no model catalog or alias table exists. ``options`` are trusted inference options passed to
``init_chat_model``; unknown options are not interpreted (LangChain/the provider fails closed).
Protected keys (credentials, base_url, headers, endpoint, transport, client, ...) are rejected
at load time, and adapter transport kwargs win over options at construction time.
``context_window_tokens`` / ``max_output_tokens`` build the ModelProfile for context management.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from langsmith_bootstrap import disable_langsmith_tracing_by_default

disable_langsmith_tracing_by_default()

from langchain.chat_models import init_chat_model
from model_routes_config import read_model_routes
from provider_credentials import (
    credential_init_kwargs,
    inception_base_url,
    llm7_base_url,
    llm_provider_timeout_seconds,
)

ROUTES_FILE_ENV = "LCSP_MODEL_ROUTES_FILE"
DEFAULT_ROUTES_FILE = Path(__file__).resolve().parent / "config" / "model_routes.yaml"
RESPONSES_OUTPUT_VERSION = "responses/v1"
SNAPSHOT_EFFECTIVE_AT = "1970-01-01T00:00:00.000Z"
PROFILE_OPTIONS = ("context_window_tokens", "max_output_tokens")

# canonical provider -> (LangChain provider key, client label, transport kwargs)
_PROVIDERS: dict[str, tuple[str, str, Any]] = {
    "openai": (
        "openai",
        "responses_api",
        lambda: {
            "use_responses_api": True,
            "output_version": RESPONSES_OUTPUT_VERSION,
            "timeout": llm_provider_timeout_seconds(),
        },
    ),
    "anthropic": ("anthropic", "anthropic", lambda: {}),
    "google_genai": (
        "google_genai",
        "google_genai",
        lambda: {"request_timeout": llm_provider_timeout_seconds()},
    ),
    "llm7": (
        "openai",
        "openai_compatible_chat_completions",
        lambda: {
            "base_url": llm7_base_url(),
            "use_responses_api": False,
            "timeout": llm_provider_timeout_seconds(),
        },
    ),
    "inception": (
        "openai",
        "openai_compatible_chat_completions",
        lambda: {
            "base_url": inception_base_url(),
            "use_responses_api": False,
            "timeout": llm_provider_timeout_seconds(),
        },
    ),
}


@dataclass(frozen=True)
class ResolvedModelConfig:
    role: str
    route_id: str
    provider: str
    model: str
    options: dict[str, Any] = field(default_factory=dict)
    fallback_route_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class ModelRoutes:
    routes: dict[str, dict[str, Any]]
    roles: dict[str, str]
    fallbacks: dict[str, tuple[str, ...]]

    def config(self, route_id: str, role: str = "") -> ResolvedModelConfig:
        route = self.routes[route_id]
        return ResolvedModelConfig(
            role=role,
            route_id=route_id,
            provider=route["provider"],
            model=route["model"],
            options=route["options"],
            fallback_route_ids=self.fallbacks.get(route_id, ()),
        )


def canonical_provider(provider: str) -> str:
    """Exact-match a supported transport id; no aliasing or normalization."""
    if provider not in _PROVIDERS:
        raise RuntimeError(f"unsupported model provider {provider!r}; supported: {', '.join(_PROVIDERS)}")
    return provider


def provider_client(provider: str) -> str:
    """Return non-secret telemetry describing the provider client."""
    return _PROVIDERS[canonical_provider(provider)][1]


def provider_init_kwargs(provider: str) -> dict[str, object]:
    """Return transport-only constructor kwargs for one provider (no model facts)."""
    return dict(_PROVIDERS[canonical_provider(provider)][2]())


@lru_cache(maxsize=8)
def _load(path: Path) -> ModelRoutes:
    routes, roles, fallbacks = read_model_routes(path, tuple(_PROVIDERS), ROUTES_FILE_ENV)
    return ModelRoutes(routes, roles, fallbacks)


def load_model_routes() -> ModelRoutes:
    """Validated route config of the active file, cached per resolved path; fails closed."""
    override = (os.environ.get(ROUTES_FILE_ENV) or "").strip()
    return _load(Path(override).resolve() if override else DEFAULT_ROUTES_FILE)


load_model_routes.cache_clear = _load.cache_clear  # type: ignore[attr-defined]


def resolve_role(role: str) -> ResolvedModelConfig:
    routes = load_model_routes()
    return routes.config(routes.roles.get(role, routes.roles["default"]), role)


def fallback_routes(route_id_or_role: str) -> tuple[ResolvedModelConfig, ...]:
    """Return the ordered configured fallback chain of a route id (or role)."""
    routes = load_model_routes()
    route_id = (
        route_id_or_role
        if route_id_or_role in routes.routes
        else routes.roles.get(route_id_or_role, routes.roles["default"])
    )
    return tuple(routes.config(item) for item in routes.fallbacks.get(route_id, ()))


def route_for_model(provider: str, model: str) -> ResolvedModelConfig | None:
    """Map a runtime provider/model back to its (first) configured route."""
    routes = load_model_routes()
    for route_id, route in routes.routes.items():
        if route["provider"] == provider and route["model"] == model:
            return routes.config(route_id)
    return None


def _init_kwargs(config: ResolvedModelConfig) -> dict[str, object]:
    options = dict(config.options)
    context = options.pop("context_window_tokens", None)
    output = options.pop("max_output_tokens", None)
    kwargs = provider_init_kwargs(config.provider)
    if context is not None:
        profile: dict[str, object] = {"name": config.model, "max_input_tokens": context}
        if output is not None:
            profile["max_output_tokens"] = output
        kwargs["profile"] = profile
    return {**options, **kwargs}  # precedence: options < adapter transport (< credentials, see build_model)


def build_model(config: ResolvedModelConfig):
    """Build the chat model for one resolved route: adapter kwargs, options, credentials."""
    langchain_provider = _PROVIDERS[config.provider][0]
    return init_chat_model(
        f"{langchain_provider}:{config.model}",
        **{**_init_kwargs(config), **credential_init_kwargs(config.provider)},  # one merge: no duplicate-kwarg TypeError
    )


def resolve_agent_model(role: str):
    """Build the chat model for one role."""
    return build_model(resolve_role(role))


def config_snapshot(config: ResolvedModelConfig, role: str) -> dict[str, str]:
    """Deterministic, secret-free audit identity of one route config as used by ``role``."""
    canonical = json.dumps(
        {
            "role": role,
            "routeId": config.route_id,
            "provider": config.provider,
            "model": config.model,
            "options": config.options,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "role": role,
        "provider": config.provider.upper(),
        "model": config.model,
        "policyVersion": "cfg-" + hashlib.sha256(canonical.encode()).hexdigest()[:16],
        "effectiveAt": SNAPSHOT_EFFECTIVE_AT,
    }


def resolved_policy_snapshot(role: str) -> dict[str, str]:
    """Audit identity of the config a role resolves to."""
    return config_snapshot(resolve_role(role), role)


def effective_model_configs() -> tuple[dict[str, Any], ...]:
    """Safe startup telemetry: option keys only, never values."""
    routes = load_model_routes()
    return tuple(
        {
            "role": role,
            "routeId": config.route_id,
            "provider": config.provider,
            "model": config.model,
            "client": provider_client(config.provider),
            "optionKeys": tuple(sorted(config.options)),
            "fallbackRouteIds": config.fallback_route_ids,
        }
        for role in routes.roles
        for config in (routes.config(routes.roles[role], role),)
    )


def distinct_runtime_identities() -> frozenset[tuple[str, str]]:
    """(PROVIDER_UPPER, model) of every route reachable from a role or a fallback chain."""
    routes = load_model_routes()
    reachable: set[str] = set()
    pending = list(routes.roles.values())
    while pending:
        route_id = pending.pop()
        if route_id not in reachable:
            reachable.add(route_id)
            pending.extend(routes.fallbacks.get(route_id, ()))
    return frozenset(
        (routes.routes[i]["provider"].upper(), routes.routes[i]["model"]) for i in reachable
    )
