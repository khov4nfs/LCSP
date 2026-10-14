"""The single Rule Set Preparation Deep Agent (native ``create_deep_agent``)."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from deepagents.backends import FilesystemBackend
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission
from deepagents.profiles.harness import harness_profiles
from langchain.agents.middleware import (
    AgentMiddleware,
    AgentState,
    TracePolicy,
    hook_config,
    omit_payload,
)
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.messages import ToolMessage
from langgraph.runtime import Runtime
from middleware.failure_policy import AgentRunBudgetExceeded
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.usage_metering import AgentRoleMiddleware
from orchestration.agent_stream import publish_agent_stream_event
from orchestration.graph_execution import agent_graph_config
from tools.common.capabilities.platform.logging import get_logger

from deepagents import GeneralPurposeSubagentProfile, HarnessProfile, create_deep_agent
from rule_set_preparation.draft_history import DraftHistoryMiddleware
from rule_set_preparation.legal_source_files import LEGAL_SOURCE_ROOT
from rule_set_preparation.legal_source_reader import legal_source_reader_subagent
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools

INSTRUCTIONS = (Path(__file__).with_name("instructions.md")).read_text(encoding="utf-8")
RULE_SET_PREPARATION_ROLE = "rule-set-preparation"
READ_ONLY_TOOLS = ["ls", "glob", "grep", "read_file"]
_PROFILE_LOCK = threading.Lock()
logger = get_logger(__name__)


class PreparationObservationMiddleware(AgentMiddleware):
    """Return useful source observations and escalate only a cycle that ignores feedback."""

    def __init__(self, context: RuleSetPreparationContext) -> None:
        self.context = context

    def wrap_tool_call(self, request, handler):
        return self._observe(request, handler(request))

    async def awrap_tool_call(self, request, handler):
        return self._observe(request, await handler(request))

    def _observe(self, request, result):
        call = getattr(request, "tool_call", None)
        if not isinstance(call, dict) or call.get("name") not in READ_ONLY_TOOLS:
            return result
        if not isinstance(result, ToolMessage):
            return result

        name = call["name"]
        args = call.get("args", {})
        content = result.content
        source_version = self.context.pinned_source_version_id or "UNKNOWN"
        signature = _observation_hash({
            "tool": name,
            "arguments": args,
            "pinnedSourceVersionId": source_version,
        })
        result_hash = _observation_hash(content)
        terminal = False
        with self.context.observation_lock:
            revision = self.context.progress_revision
            previous = self.context.observations.get(signature)
            changed = previous is not None and previous["result"] != result_hash
            advanced = previous is not None and previous["revision"] != revision
            if previous is None or changed:
                novelty = "NEW" if previous is None else "CHANGED"
                self.context.progress_revision += 1
                self.context.observations[signature] = {
                    "result": result_hash,
                    "revision": self.context.progress_revision,
                    "stage": 0,
                }
            elif advanced:
                novelty = "NONE"
                previous.update(revision=revision, stage=0)
            elif previous["stage"] == 0:
                novelty = "NONE"
                previous["stage"] = 1
            elif previous["stage"] == 1:
                novelty = "NONE"
                previous["stage"] = 2
            else:
                novelty = "NONE"
                terminal = True

        feedback: dict[str, Any] = {
            "pinnedLegalSourceVersionId": source_version,
            "previouslyObserved": previous is not None,
            "novelty": novelty,
            "progressStateAdvanced": advanced,
            "progressState": self.context.progress_state,
        }
        if novelty == "NONE":
            feedback["guidance"] = (
                "This exact observation at this pinned source version was already obtained. "
                "Novel information: NONE. Reuse existing evidence, inspect another location or "
                "source, change strategy, or submit completion if no material work remains."
            )
        if previous is not None and previous["stage"] == 2 and not terminal and not advanced:
            feedback["NO_PROGRESS"] = (
                "The previous action produced no new evidence and did not advance preparation "
                "state. Re-evaluate strategy; choose a different investigation action, reuse the "
                "existing observation, or submit completion if no material work remains."
            )

        publish_agent_stream_event(
            "CUSTOM_PROGRESS",
            status="RUNNING",
            data={"activity_kind": "SOURCE_OBSERVATION", "tool_name": name,
                  "novelty": novelty, "previously_observed": feedback["previouslyObserved"]},
        )
        if terminal:
            publish_agent_stream_event(
                "CUSTOM_PROGRESS",
                status="FAILED",
                data={"activity_kind": "NO_PROGRESS_DETECTED", "tool_name": name},
            )
            raise AgentRunBudgetExceeded("NO_PROGRESS_DETECTED")
        return result.model_copy(update={"content": _with_observation_feedback(content, feedback)})


def _observation_hash(value: Any) -> str:
    try:
        normalized = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    except (TypeError, ValueError):
        normalized = repr(type(value))
    return hashlib.sha256(normalized.encode("utf-8", errors="replace")).hexdigest()


def _with_observation_feedback(content: Any, feedback: dict[str, Any]) -> Any:
    marker = "[Pinned source observation metadata]\n" + json.dumps(feedback, ensure_ascii=False)
    if isinstance(content, str):
        return content + "\n\n" + marker
    if isinstance(content, list):
        return [*content, {"type": "text", "text": marker}]
    return content


class PreparationCompletionMiddleware(AgentMiddleware):
    """A normal model stop is not the preparation's governed terminal action."""

    # Native response_format cannot prove governed submission; native hooks enforce the domain predicate.

    trace_policy = TracePolicy(process_inputs=omit_payload, process_outputs=omit_payload)

    def __init__(self, context: RuleSetPreparationContext) -> None:
        self.context = context

    @hook_config(can_jump_to=["end"])
    def before_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        if self.context.submission is not None or self.context.source_blocked is not None:
            return {"jump_to": "end"}
        return None

    @hook_config(can_jump_to=["model"])
    def after_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        response = state["messages"][-1]
        if not isinstance(response, AIMessage) or response.tool_calls:
            return None
        context = self.context
        if context.submission is not None or context.source_blocked is not None:
            return None
        outcome = (context.last_validation or {}).get("outcome")
        context.trace.append({
            "event": "NORMAL_STOP_BEFORE_TERMINAL",
            "validationCalls": context.validation_calls,
            "validationOutcome": outcome,
            "submissionAttempted": any(t.get("tool") == "submit" for t in context.trace),
        })
        text = response.content if isinstance(response.content, str) else "".join(
            block.get("text", "") if isinstance(block, dict) else str(block) for block in response.content
        )
        metadata = response.response_metadata or {}
        logger.info("RULE_SET_PREPARATION_CONTINUING", run_id=context.run_id,
                    validation_calls=context.validation_calls, validation_outcome=outcome,
                    stop_reason=metadata.get("stop_reason") or metadata.get("finish_reason"),
                    output_tokens=(response.usage_metadata or {}).get("output_tokens"),
                    text_chars=len(text), text_head=" ".join(text.split())[:300])
        return {
            "messages": [HumanMessage(content=(
                "Preparation is not finished. Continue the same pinned-source work and preserve "
                "your existing reading and draft. Use actual tool calls, not tool-call text in "
                "an assistant response: add_to_packet_draft for the next part, "
                "validate_compliance_rule_set until PASSED, then submit_compliance_rule_set once "
                "for the exact validated draft. There is no length limit. If the pinned source "
                "is truly unreadable or its pins inconsistent, use report_rule_set_source_blocked "
                "instead."
            ))],
            "jump_to": "model",
        }


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

    ``legal_source_root`` holds only the pinned legal_source (see ``materialize_legal_source``). The
    parent gets read-only filesystem tools, the governed preparation tools, and one native
    ``legal-source-reader`` subagent. That child is read-only and cannot validate or submit.
    """
    if model is None:
        from model_policy import resolve_agent_model

        model = resolve_agent_model(RULE_SET_PREPARATION_ROLE)

    backend = FilesystemBackend(root_dir=legal_source_root, virtual_mode=True)
    observation_middleware = PreparationObservationMiddleware(context)
    read_only = FilesystemMiddleware(
        backend=backend,
        tools=READ_ONLY_TOOLS,
        _permissions=[
            FilesystemPermission(["read"], [LEGAL_SOURCE_ROOT, f"{LEGAL_SOURCE_ROOT}/**"], mode="allow"),
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
                observation_middleware,
                PreparationCompletionMiddleware(context),
                DraftHistoryMiddleware(),
                AgentRoleMiddleware(RULE_SET_PREPARATION_ROLE),
                *MODEL_GOVERNANCE_MIDDLEWARE,
            ],
            subagents=[
                legal_source_reader_subagent(
                    model=model,
                    backend=backend,
                    observation_middleware=observation_middleware,
                )
            ],
            # False, not None: None would inherit the Agent Server run's Postgres checkpointer, and
            # nothing resumes this claim-once run from those checkpoints. Each superstep of every
            # middleware hook queued a put on an 8-thread pool whose first put waits on writes queued
            # behind it, which deadlocked the whole run silently (py-spy: all 8 workers in
            # _checkpointer_put_after_previous) and filled the database with 100k-token states.
            checkpointer=False if checkpointer is None else checkpointer,
            store=store,
        ).with_config(agent_graph_config())
