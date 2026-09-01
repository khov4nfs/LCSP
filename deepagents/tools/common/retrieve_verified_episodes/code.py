"""Agent-facing read-only retrieval for verified execution episodes."""

from __future__ import annotations

from typing import Any

from langchain.tools import ToolRuntime, tool
from pydantic import BaseModel, ConfigDict, Field

from memory_policy.episodes import (
    episode_retrieval_enabled,
    retrieve_verified_episodes_from_gateway,
)
from orchestration.context import LCSPRunContext


class RetrieveVerifiedEpisodesRequest(BaseModel):
    """Exact owner filter; trusted runtime supplies assessment/rule/artifact scope."""

    model_config = ConfigDict(extra="forbid")

    owner_agent: str = Field(pattern="^(planner|investigator)$")
    limit: int = Field(default=5, ge=1, le=10)


def _runtime_context(runtime: ToolRuntime | None) -> LCSPRunContext | None:
    if runtime is None:
        return None
    if isinstance(runtime.context, LCSPRunContext):
        return runtime.context
    if isinstance(runtime.context, dict):
        try:
            return LCSPRunContext(**runtime.context)
        except TypeError:
            return None
    return None


@tool(args_schema=RetrieveVerifiedEpisodesRequest, parse_docstring=True)
def retrieve_verified_episodes(
    runtime: ToolRuntime | None = None,
    **request: Any,
) -> dict[str, Any]:
    """Return compatible verified episodes for Planner or Investigator.

    Args:
        request: Exact owner filter and result limit.
    """
    if not episode_retrieval_enabled():
        return {
            "status": "DISABLED",
            "episodes": [],
            "limitations": ["RETRIEVAL_DISABLED"],
        }

    value = RetrieveVerifiedEpisodesRequest.model_validate(request)
    context = _runtime_context(runtime)
    if context is None or not context.assessment_id or not context.user_id:
        return {
            "status": "UNAVAILABLE",
            "episodes": [],
            "limitations": ["TRUSTED_RUNTIME_CONTEXT_MISSING"],
        }

    episodes = retrieve_verified_episodes_from_gateway(
        assessment_id=context.assessment_id,
        user_id=context.user_id,
        workflow_run_id=context.workflow_run_id,
        owner_agent=value.owner_agent,
        engineering_rule_ids=tuple(context.engineering_rule_ids),
        artifact_versions=dict(context.artifact_versions),
        limit=value.limit,
    )
    return {
        "status": "READY",
        "episodes": [
            {
                "record_id": episode.record_id,
                "owner_agent": episode.owner_agent,
                "engineering_rule_ids": list(episode.engineering_rule_ids),
                "artifact_versions": episode.artifact_versions,
                "summary": episode.summary,
                "domain_key": episode.domain_key,
                "input_signature": episode.input_signature,
                "successful_strategy_summary": episode.successful_strategy_summary,
                "evidence_refs": list(episode.evidence_refs),
                "prompt_version": episode.prompt_version,
                "model_id": episode.model_id,
                "handoff": episode.handoff,
                "trust_level": episode.trust_level,
                "validation_status": episode.validation_status,
            }
            for episode in episodes
        ],
        "limitations": [],
    }
