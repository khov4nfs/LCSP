"""The single Legal Preparation Deep Agent (native ``create_deep_agent``)."""

from __future__ import annotations

import dataclasses
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from deepagents import GeneralPurposeSubagentProfile, HarnessProfile, create_deep_agent
from langchain.agents.middleware import ModelRetryMiddleware
from deepagents.profiles.harness import harness_profiles
from deepagents.backends import FilesystemBackend
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission

from legal_preparation.corpus_files import CORPUS_ROOT
from middleware.failure_policy import (
    is_auth_failure,
    is_provider_model_unavailable,
    is_terminal_task_error,
)
from legal_preparation.tools import LegalPreparationContext, build_portfolio_tools

INSTRUCTIONS = (Path(__file__).with_name("instructions.md")).read_text(encoding="utf-8")
LEGAL_PREPARATION_ROLE = "legal-preparation"
READ_ONLY_TOOLS = ["ls", "glob", "grep", "read_file"]
# Transient provider failures (502/timeouts) and short rate limits (429) are execution-level:
# retried with exponential backoff. Auth and terminal errors are not retried (the same governed
# policy as every other LCSP agent). Unlike the Root, a single Legal Preparation run has no
# credential pool/provider fallback to absorb a 429, so backoff-retry is the right response.
MODEL_RETRIES = 6
MODEL_RETRY_INITIAL_DELAY_SECONDS = 2.0
MODEL_RETRY_MAX_DELAY_SECONDS = 30.0


def retry_legal_preparation_model_error(error: Exception) -> bool:
    """``retry_model_error`` minus its capacity (429) exclusion; auth/terminal stay terminal."""
    return (
        not is_terminal_task_error(error)
        and not is_auth_failure(error)
        and not is_provider_model_unavailable(error)
    )

_PROFILE_LOCK = threading.Lock()


@contextmanager
def _without_general_purpose_subagent(profile_key: str) -> Iterator[None]:
    """Disable the default general-purpose subagent for graphs built inside the block.

    Harness profiles are a process-global registry keyed by ``provider:model`` and
    ``register_harness_profile`` MERGES into an existing entry, so it cannot be undone.
    The entry is therefore swapped directly and restored to the exact previous object
    (or removed), keeping the Root agent in the same process unaffected. The profile is
    read at graph build time only. Pinned by ``test_legal_preparation_agent.py``.
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


def create_legal_preparation_agent(
    *,
    context: LegalPreparationContext,
    corpus_root: Path,
    model: Any | None = None,
    checkpointer: Any | None = None,
    store: Any | None = None,
):
    """Build the agent for one run.

    ``corpus_root`` holds only the pinned corpus (see ``materialize_corpus``). The agent
    gets read-only filesystem tools over ``/corpus`` plus the two governed portfolio tools;
    it has no write, shell, task/sub-agent, human, repository or memory tools.
    """
    if model is None:
        from model_policy import resolve_agent_model

        model = resolve_agent_model(LEGAL_PREPARATION_ROLE)

    backend = FilesystemBackend(root_dir=corpus_root, virtual_mode=True)
    read_only = FilesystemMiddleware(
        backend=backend,
        tools=READ_ONLY_TOOLS,
        _permissions=[
            FilesystemPermission(["read"], [f"{CORPUS_ROOT}/**"], mode="allow"),
            FilesystemPermission(["read"], ["/**"], mode="deny"),
            FilesystemPermission(["write"], ["/**"], mode="deny"),
        ],
    )
    with _without_general_purpose_subagent(_lookup_profile_key(model)):
        return create_deep_agent(
            name="lcsp-legal-preparation",
            model=model,
            backend=backend,
            system_prompt=INSTRUCTIONS,
            tools=build_portfolio_tools(context),
            middleware=[
                read_only,
                ModelRetryMiddleware(
                    max_retries=MODEL_RETRIES,
                    on_failure="error",
                    retry_on=retry_legal_preparation_model_error,
                    initial_delay=MODEL_RETRY_INITIAL_DELAY_SECONDS,
                    backoff_factor=2.0,
                    max_delay=MODEL_RETRY_MAX_DELAY_SECONDS,
                ),
            ],
            subagents=[],
            checkpointer=checkpointer,
            store=store,
        )
