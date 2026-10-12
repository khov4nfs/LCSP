"""The single Rule Set Preparation Deep Agent (native ``create_deep_agent``)."""

from __future__ import annotations

import dataclasses
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from deepagents import GeneralPurposeSubagentProfile, HarnessProfile, create_deep_agent
from deepagents.profiles.harness import harness_profiles
from deepagents.backends import FilesystemBackend
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission

from rule_set_preparation.legal_source_files import LEGAL_SOURCE_ROOT
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.usage_metering import AgentRoleMiddleware
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools

INSTRUCTIONS = (Path(__file__).with_name("instructions.md")).read_text(encoding="utf-8")
RULE_SET_PREPARATION_ROLE = "rule-set-preparation"
READ_ONLY_TOOLS = ["ls", "glob", "grep", "read_file"]

_PROFILE_LOCK = threading.Lock()


@contextmanager
def _without_general_purpose_subagent(profile_key: str) -> Iterator[None]:
    """Disable the default general-purpose subagent for graphs built inside the block.

    Harness profiles are a process-global registry keyed by ``provider:model`` and
    ``register_harness_profile`` MERGES into an existing entry, so it cannot be undone.
    The entry is therefore swapped directly and restored to the exact previous object
    (or removed), keeping the Root agent in the same process unaffected. The profile is
    read at graph build time only. Pinned by ``test_rule_set_preparation_agent.py``.
    """
    registry = harness_profiles._HARNESS_PROFILES
    with _PROFILE_LOCK:
        harness_profiles._ensure_harness_profiles_loaded()
        previous = registry.get(profile_key)
        registry[profile_key] = dataclasses.replace(
            previous or HarnessProfile(),
            general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
        )
        try:
            yield
        finally:
            if previous is None:
                registry.pop(profile_key, None)
            else:
                registry[profile_key] = previous


def _lookup_profile_key(model: Any) -> str:
    """The harness-profile key deepagents resolves for this model object.

    It is derived from the model's reported provider/identifier (for example
    ``openai:GLM-5.3-Flash`` for an OpenAI-compatible route), not from the LCSP route id,
    so the profile must be registered under exactly this key to take effect.
    """
    from deepagents._models import get_model_identifier, get_model_provider

    provider, identifier = get_model_provider(model), get_model_identifier(model)
    if provider and identifier:
        return f"{provider}:{identifier}"
    key = identifier or provider
    if not key:
        raise ValueError("cannot derive a harness profile key for this model")
    return key


def create_rule_set_preparation_agent(
    *,
    context: RuleSetPreparationContext,
    legal_source_root: Path,
    model: Any | None = None,
    checkpointer: Any | None = None,
    store: Any | None = None,
):
    """Build the agent for one run.

    ``legal_source_root`` holds only the pinned legal_source (see ``materialize_legal_source``). The agent
    gets read-only filesystem tools over ``/legal-source`` plus the two governed rule_set tools;
    it has no write, shell, task/sub-agent, human, repository or memory tools.
    """
    if model is None:
        from model_policy import resolve_agent_model

        model = resolve_agent_model(RULE_SET_PREPARATION_ROLE)

    backend = FilesystemBackend(root_dir=legal_source_root, virtual_mode=True)
    read_only = FilesystemMiddleware(
        backend=backend,
        tools=READ_ONLY_TOOLS,
        _permissions=[
            FilesystemPermission(["read"], [f"{LEGAL_SOURCE_ROOT}/**"], mode="allow"),
            FilesystemPermission(["read"], ["/**"], mode="deny"),
            FilesystemPermission(["write"], ["/**"], mode="deny"),
        ],
    )
    with _without_general_purpose_subagent(_lookup_profile_key(model)):
        return create_deep_agent(
            name="lcsp-rule-set-preparation",
            model=model,
            backend=backend,
            system_prompt=INSTRUCTIONS,
            tools=build_rule_set_tools(context),
            middleware=[
                read_only,
                AgentRoleMiddleware(RULE_SET_PREPARATION_ROLE),
                *MODEL_GOVERNANCE_MIDDLEWARE,
            ],
            subagents=[],
            checkpointer=checkpointer,
            store=store,
        )
