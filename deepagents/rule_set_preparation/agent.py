"""The single Rule Set Preparation Deep Agent (native ``create_deep_agent``)."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import os
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
    ModelCallLimitMiddleware,
    AgentState,
    TracePolicy,
    TodoListMiddleware,
    hook_config,
    omit_payload,
)
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.messages import ToolMessage
from langgraph.runtime import Runtime
from middleware.failure_policy import NoProgressDetected
from middleware.agent_run_budget import AgentRunBudgetMiddleware, _positive_env
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE, governed_summarization_middleware
from middleware.usage_metering import AgentRoleMiddleware
from orchestration.agent_stream import publish_agent_stream_event
from orchestration.graph_execution import agent_graph_config
from tools.common.capabilities.platform.logging import get_logger

from deepagents import GeneralPurposeSubagentProfile, HarnessProfile, create_deep_agent
from rule_set_preparation.authoring_recorder import AuthoringToolCallRecorder
from rule_set_preparation.draft_history import DraftHistoryMiddleware
from rule_set_preparation.legal_source_files import LEGAL_SOURCE_ROOT
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from rule_set_preparation.source_graph import GRAPH_TOOL_NAMES, build_source_graph_tools

RULE_SET_PREPARATION_ROLE = "rule-set-preparation"
CLAIM_AUTHOR_ROLE = "claim-author"
CLAIM_AUTHOR_MODEL_CALLS = 16
READ_ONLY_TOOLS = ["ls", "glob", "grep", "read_file"]
_PROFILE_LOCK = threading.Lock()
logger = get_logger(__name__)


class PreparationObservationMiddleware(AgentMiddleware):
    """Return useful source observations and escalate only a cycle that ignores feedback."""

    def __init__(self, context: RuleSetPreparationContext) -> None:
        self.context = context

    def wrap_tool_call(self, request, handler):
        """Business purpose: Return the result of a synchronous Preparation tool call with its pinned-source observation checked and, when appropriate, attached as feedback.

        Business rules:
        - Only the observer's existing phase and tool allowlist can produce observation feedback; the tool result remains the source of the observation.
        - A no-progress terminal state is raised by the shared observer so the run cannot silently loop on the same evidence.

        Execution flow:
        1. Execute the requested synchronous handler once.
        2. Pass the returned result and request metadata to the shared observation policy.
        3. Return its annotated result or propagate its terminal no-progress failure.

        Failure cases:
        - Handler errors propagate without being converted into legal findings; repeated non-progress observations raise NoProgressDetected.

        Side effects:
        - Observation bookkeeping and stream events may be updated; no source text or legal decision is changed.
        """
        return self._observe(request, handler(request))

    async def awrap_tool_call(self, request, handler):
        """Business purpose: Apply the same pinned-source observation feedback to an asynchronous Preparation tool call.

        Business rules:
        - Preserve asynchronous handler behavior and the same phase, tool and no-progress rules used by the synchronous path.

        Execution flow:
        1. Await the requested handler once.
        2. Send its result to the shared observation policy.
        3. Return the annotated result or propagate a terminal no-progress failure.

        Failure cases:
        - Handler and NoProgressDetected exceptions propagate to the runner; they are not turned into legal findings.

        Side effects:
        - Updates run-local observation state and may publish progress events; it does not alter source or assessment authority.
        """
        return self._observe(request, await handler(request))

    def _observe(self, request, result):
        """Business purpose: Tell the Preparation agent whether an allowed pinned-source observation adds evidence or repeats prior work.

        Business rules:
        - Compare the tool, arguments and exact pinned LegalSourceVersion together with the result; errors are fingerprinted without rejected argument values.
        - Parallel calls from one model decision do not trigger premature stagnation feedback, and observation feedback never decides legal meaning.

        Execution flow:
        1. Ignore observations outside the active phase, allowlist, or ToolMessage result contract.
        2. Fingerprint the observation and update novelty, progress revision and repetition stage under the observation lock.
        3. Publish source-inspection progress and attach bounded guidance to the result.
        4. Raise NoProgressDetected when the same observation persists through the terminal stage without progress.

        Failure cases:
        - Unsupported result shapes pass through unchanged; terminal repetition fails the run instead of returning another identical result.

        Side effects:
        - Mutates run-local observation counters and publishes progress events; it does not mutate the pinned graph or authored legal content.
        """
        if not self.context.direct_draft and self.context.inventory is not None and not self.context.inventory.frozen:
            return result
        call = getattr(request, "tool_call", None)
        if not isinstance(call, dict) or call.get("name") not in {*READ_ONLY_TOOLS, *GRAPH_TOOL_NAMES, "get_claim_inventory", "get_rule_authoring_context", "get_semantic_closure", "commit_claims", "get_next_legal_analysis_package", "get_rule_set_draft_candidate"}:
            return result
        if not isinstance(result, ToolMessage):
            return result

        name = call["name"]
        args = call.get("args", {})
        content = result.content
        state = getattr(request, "state", None)
        messages = state.get("messages", []) if isinstance(state, dict) else []
        decision = next((message for message in reversed(messages) if isinstance(message, AIMessage) and message.tool_calls), None)
        decision_id = (decision.id or _observation_hash(decision.tool_calls)) if decision is not None else None
        source_version = self.context.pinned_source_version_id or "UNKNOWN"
        signature = _observation_hash({
            "tool": name,
            "arguments": args if result.status != "error" else {"argumentValidationRejected": True},
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
            elif decision_id is not None and previous.get("decision") == decision_id:
                # Parallel calls from one answer cannot react to feedback until their whole batch returns.
                novelty = "NONE"
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
            self.context.observations[signature]["decision"] = decision_id

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
            raise NoProgressDetected("NO_PROGRESS_DETECTED " + json.dumps({"tool": name,
                "observationFingerprint": signature, "resultFingerprint": result_hash,
                "progressRevision": revision}, separators=(",", ":")))
        return result.model_copy(update={"content": _with_observation_feedback(content, feedback)})


def _observation_hash(value: Any) -> str:
    """Business purpose: Produce a stable identifier for source observations and model decisions.

    Business rules:
    - Use sorted compact JSON with default=str for non-JSON values; fall back to the value's type representation only if serialization still raises TypeError or ValueError.

    Execution flow:
    1. Serialize the supplied value deterministically where possible.
    2. Hash the encoded representation with SHA-256 and return its hexadecimal digest.

    Failure cases:
    - Remaining JSON type/value errors use the type fallback; encoding replaces invalid Unicode rather than failing the observation path.

    Side effects:
    - None: pure fingerprint calculation with no persistence or external calls.
    """
    try:
        normalized = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    except (TypeError, ValueError):
        normalized = repr(type(value))
    return hashlib.sha256(normalized.encode("utf-8", errors="replace")).hexdigest()


def _with_observation_feedback(content: Any, feedback: dict[str, Any]) -> Any:
    """Business purpose: Add the shared pinned-source observation notice to a tool result format that the agent can read.

    Business rules:
    - Strings receive a textual suffix and list content receives one text block; unsupported content types are returned unchanged.

    Execution flow:
    1. Serialize the feedback into the observation marker.
    2. Append the marker according to the supported content shape.
    3. Preserve all existing content and return the resulting value.

    Failure cases:
    - Non-string/non-list content is left untouched rather than coerced or replaced.

    Side effects:
    - None: constructs returned content in memory without changing the original source or tool state.
    """
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
        """Business purpose: Stop model execution once Preparation has reached a terminal state or discovery-only work has frozen its claim inventory.

        Business rules:
        - Discovery-only work ends at CLAIM_INVENTORY_READY; submission, verified source-blocking and accepted no-operative-obligation conclusion also end the agent turn.

        Execution flow:
        1. Inspect the run phase and terminal outcome markers.
        2. Return the framework end directive when the lifecycle is complete, otherwise allow the model call.

        Failure cases:
        - No separate business failure is created; an unfinished run continues to the model.

        Side effects:
        - None: reads run state and returns middleware routing metadata.
        """
        if (self.context.discovery_only and self.context.inventory and self.context.inventory.phase == "CLAIM_INVENTORY_READY") or self.context.submission is not None or self.context.source_blocked is not None or self.context.concluded is not None:
            return {"jump_to": "end"}
        return None

    @hook_config(can_jump_to=["model"])
    def after_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        """Business purpose: Continue the existing Preparation lifecycle when the model stops without completing its authorized work.

        Business rules:
        - A terminal discovery, submission, source-blocked or no-obligation state is never restarted.
        - Discovery-only, direct-draft and full Preparation receive distinct continuation instructions; legal interpretation remains with the agent.

        Execution flow:
        1. Ignore tool-calling responses and already terminal states.
        2. Record and log a normal stop with the last validation and model response metadata.
        3. Add the phase-specific next-action message and route the graph back to the model.

        Failure cases:
        - Provider/runtime exceptions are handled by the runner; this hook only reacts to a normal non-terminal stop.

        Side effects:
        - Appends a run trace entry and logger record, then returns a continuation HumanMessage; it does not author or persist legal decisions.
        """
        response = state["messages"][-1]
        if not isinstance(response, AIMessage) or response.tool_calls:
            return None
        context = self.context
        if (context.discovery_only and context.inventory and context.inventory.phase == "CLAIM_INVENTORY_READY") or context.submission is not None or context.source_blocked is not None or context.concluded is not None:
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
        if context.discovery_only:
            workflow = "Use write_todos and task(claim-author), commit_claims, then discovery_status"
            return {"messages": [HumanMessage(content="Continue the SAME discovery session. " + workflow + " until discoveryCompleteEligible=true. Then finalize_semantic_claim_inventory and STOP at CLAIM_INVENTORY_READY. No Rule authoring, validation or submission is authorized.")], "jump_to": "model"}
        if context.direct_draft:
            return {"messages": [HumanMessage(content="Continue the persisted Rule Set Draft. Get the next legal analysis package, submit source-backed candidates and dispositions, correct specific errors, then validate_compliance_rule_set and submit_compliance_rule_set. Accepted candidates are durable; do not recreate them.")], "jump_to": "model"}
        return {
            "messages": [HumanMessage(content=(
                "Preparation is not finished. Continue the same pinned-source work and preserve "
                "your existing reading and inventory. Use actual tool calls, not tool-call text in "
                "an assistant response: get_claim_inventory to inspect the current phase, "
                "commit claim files and finalize_semantic_claim_inventory before Rule authoring; "
                "validate_compliance_rule_set until PASSED, then submit_compliance_rule_set once "
                "for the exact validated draft. There is no length limit. If every unit is reviewed and "
                "complete and the source states no obligation, conclude_no_operative_obligations ends the "
                "run; never register an obligation the source does not state. If the pinned source "
                "is truly unreadable or its pins inconsistent, use report_rule_set_source_blocked "
                "instead."
            ))],
            "jump_to": "model",
        }


# The parent only coordinates discovery: it cannot read source or write/commit claim files itself. Measured: a parent that did the
# authors' work (read 6 articles, write 6 files, commit) carried a context growing from 6k to 155k tokens per turn and spent 75% of a
# run's tokens; the claim-author children hold small, per-assignment contexts.
DISCOVERY_TOOLS = frozenset({"write_todos", "task", "discovery_status", "finalize_semantic_claim_inventory", "conclude_no_operative_obligations",
    "report_rule_set_source_blocked", "record_preparation_progress", "get_applicable_legal_state"})
AUTHORING_TOOLS = frozenset({"ls", "glob", "grep", "read_file", "write_todos", "start_rule_authoring", "reopen_semantic_claim_inventory",
    "get_claim_inventory", "get_rule_authoring_context", "get_rule_authoring_status", "get_semantic_closure", "get_applicable_legal_state",
    "author_legal_requirement", "author_assessment_rule", "remove_rule_candidate", "validate_compliance_rule_set", "submit_compliance_rule_set",
    "report_rule_set_source_blocked", "record_preparation_progress"})


def phase_instructions(context):
    """Business purpose: Select the system instructions matching the current Rule Set Preparation lifecycle.

    Business rules:
    - Direct drafting uses its dedicated prompt; otherwise prompt selection follows whether the claim inventory is frozen and whether discovery-only mode forbids authoring.

    Execution flow:
    1. Read the direct-draft mode and inventory freeze state.
    2. Load the common prompt plus the correct discovery or authoring instructions.
    3. Append the discovery-only stop condition when that lifecycle flag is active.

    Failure cases:
    - Missing prompt files or read errors propagate so Preparation cannot run with partial instructions.

    Side effects:
    - Reads local instruction files and returns text; it does not mutate run or legal-source state.
    """
    if context.direct_draft:
        return Path(__file__).with_name("instructions-direct.md").read_text()
    part = "authoring" if context.inventory and context.inventory.frozen else "discovery"
    base = Path(__file__).parent
    prompt = (base / "instructions-common.md").read_text() + "\n" + (base / f"instructions-{part}.md").read_text()
    if context.discovery_only:
        prompt += "\nDISCOVERY ONLY: finalize then STOP at CLAIM_INVENTORY_READY. No Rule authoring, validation or submission."
    return prompt


class PreparationPhaseMiddleware(AgentMiddleware):
    def __init__(self, context):
        self.context = context

    def _request(self, request):
        """Business purpose: Present only the tool set authorized for the active Preparation phase and refresh the phase-specific system instructions.

        Business rules:
        - Direct draft, frozen-inventory authoring and discovery each use a separate allowlist; tool availability is a server-side runtime boundary, not a legal judgment.
        - The post-phase system prompt suffix is preserved while the phase instructions are refreshed.

        Execution flow:
        1. Select the allowed tool names from the current lifecycle state.
        2. Retain only matching tools in the model request.
        3. Replace the phase prefix while preserving the existing suffix and return the overridden request.

        Failure cases:
        - Tools outside the selected phase are omitted; malformed request objects or prompt loading errors propagate.

        Side effects:
        - Constructs an in-memory model request; it does not execute tools or change persisted state.
        """
        allowed = ({*READ_ONLY_TOOLS, *GRAPH_TOOL_NAMES, "write_todos", "get_next_legal_analysis_package", "get_rule_set_draft_candidate", "submit_rule_set_draft_candidates", "correct_rule_set_draft_submission", "get_applicable_legal_state", "validate_compliance_rule_set", "submit_compliance_rule_set", "record_preparation_progress", "report_rule_set_source_blocked"}
                   if self.context.direct_draft else AUTHORING_TOOLS if self.context.inventory and self.context.inventory.frozen else DISCOVERY_TOOLS)
        from langchain_core.messages import SystemMessage
        system = request.system_message.content if request.system_message else ""
        suffix = system.partition("<LCSP_PHASE_END>")[2] if isinstance(system, str) else ""
        return request.override(tools=[t for t in request.tools if (t.get("name") if isinstance(t, dict) else t.name) in allowed],
            system_message=SystemMessage(content=phase_instructions(self.context) + "\n<LCSP_PHASE_END>" + suffix))

    def wrap_model_call(self, request, handler):
        """Business purpose: Apply the Preparation phase's tool and instruction boundary to synchronous model requests.

        Business rules:
        - The handler receives only the request produced by the shared phase filter.

        Execution flow:
        1. Build the phase-constrained request.
        2. Invoke the synchronous model handler with it and return the response.

        Failure cases:
        - Request filtering and model errors propagate to the run controller.

        Side effects:
        - Performs one model invocation through the supplied handler; no legal decision is made by the middleware.
        """
        return handler(self._request(request))

    async def awrap_model_call(self, request, handler):
        """Business purpose: Apply the Preparation phase's tool and instruction boundary to asynchronous model requests.

        Business rules:
        - The handler receives only the request produced by the shared phase filter.

        Execution flow:
        1. Build the phase-constrained request.
        2. Await the asynchronous model handler and return its response.

        Failure cases:
        - Request filtering and model errors propagate to the run controller.

        Side effects:
        - Performs one model invocation through the supplied handler; no legal decision is made by the middleware.
        """
        return await handler(self._request(request))


def preparation_filesystem(backend, *, files):
    """Business purpose: Give the Preparation agent a filesystem limited to pinned legal source and its authorized work area.

    Business rules:
    - Legal-source files are read-only; `/work` is writable only when claim-file work is enabled, and all other paths are denied.
    - Full filesystem editing tools are exposed only in the enabled claim-file phase; otherwise only read-only tools are available.

    Execution flow:
    1. Build ordered allow/deny path permissions from the requested phase.
    2. Construct the filesystem middleware over the supplied backend.
    3. Attach bounded error formatting to each native filesystem tool.

    Failure cases:
    - Middleware/backend construction errors propagate; rejected operations return the native tool's bounded error text.

    Side effects:
    - Constructs middleware and changes tool validation handlers in memory; it does not itself read or write source files.
    """
    permissions = [FilesystemPermission(["read"], [LEGAL_SOURCE_ROOT, f"{LEGAL_SOURCE_ROOT}/**"], mode="allow")]
    if files:
        permissions += [FilesystemPermission(["read", "write"], ["/work", "/work/**"], mode="allow")]
    permissions += [FilesystemPermission(["read", "write"], ["/**"], mode="deny")]
    filesystem = FilesystemMiddleware(backend=backend, tools=["ls", "grep", "read_file", "write_file", "edit_file"] if files else READ_ONLY_TOOLS, _permissions=permissions)
    for native in filesystem.tools:
        native.handle_validation_error = lambda error, name=native.name: f"Error invoking tool '{name}': {str(error)[:600]}"
    return filesystem


def claim_author_subagent(context, model, backend, budget):
    """Business purpose: Configure one native child agent to complete exactly one assigned Article claim file.

    Business rules:
    - The prompt assigns one claims subtree and forbids sibling edits; filesystem permissions allow writes throughout /work rather than enforcing that per-Article boundary. The only governed domain tool exposed is `commit_claims`.
    - It must not delegate, finalize, validate or submit; the configured model-call limit ends a stuck child for coordinator reassignment.

    Execution flow:
    1. Bind the claim-author model, run context, filesystem and budget middleware.
    2. Supply phase instructions plus the one-Article assignment contract.
    3. Return the subagent specification for the parent coordinator.

    Failure cases:
    - Middleware/model configuration errors propagate during agent construction; the configured run limit terminates repeated child calls.

    Side effects:
    - Creates an in-memory subagent configuration; the child may later write its assigned claim file and commit it through governed tools.
    """
    return {"name": "claim-author", "description": "Read one whole assigned Article, write its claim file and commit it; return one summary line.",
        "model": model, "tools": [t for t in build_rule_set_tools(context) if t.name == "commit_claims"],
        "system_prompt": phase_instructions(context) + "\nYou own exactly one Article assignment (one source file and its claim file) given by the parent. Read source only under /legal-source and existing work only under /work. Write only your assigned /work/claims subtree. Never delegate, finalize, validate or submit. Return exactly ONE line: done: X articles, Y claims, Z waiting reference.",
        # A child stuck in a fix loop re-sends its whole history every turn (measured: one child spent 3.9M tokens on two Articles). After
        # this many model calls it ends; the coordinator's next discovery_status reassigns the Article to a fresh, small context.
        "middleware": [preparation_filesystem(backend, files=True), budget, ModelCallLimitMiddleware(run_limit=CLAIM_AUTHOR_MODEL_CALLS, exit_behavior="end"),
            governed_summarization_middleware(model, backend=backend, role=RULE_SET_PREPARATION_ROLE),
            AgentRoleMiddleware(CLAIM_AUTHOR_ROLE), *MODEL_GOVERNANCE_MIDDLEWARE, AuthoringToolCallRecorder(context)]}


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
    parent coordinates native ``claim-author`` tasks. Each child reads one whole Article, writes
    its claim file and commits it through deterministic checks.

    Business purpose: Build the native agent graph that prepares one Rule Set from its pinned source and durable run context.

    Business rules:
    - The supplied LegalSourceVersion is the only legal source; phase middleware limits tools, claim-author children own one Article, and only governed validation/submission tools can complete the run.
    - Direct draft and discovery use their separate lifecycle; the default checkpoint is disabled so an unrelated Agent Server Postgres saver is not inherited.
    - The graph concurrency is one for direct draft and two for full Preparation.

    Execution flow:
    1. Resolve the preparation and claim-author model routes, then bind phase instructions and source root.
    2. Initialize claim work storage, filesystem, observation and budget middleware.
    3. Build the tools and lifecycle middleware, and attach the native claim-author child only outside direct-draft mode.
    4. Create and configure the agent graph with the supplied optional checkpoint and store.

    Failure cases:
    - Model resolution, prompt access, backend, tool or graph construction errors propagate; they are not converted into a fabricated submission.

    Side effects:
    - Creates the local work directory and agent objects and updates the run context's source root; actual model/tool execution occurs only when the caller invokes the graph.
    """
    author_model = model
    if model is None:
        from model_policy import resolve_agent_model

        model = resolve_agent_model(RULE_SET_PREPARATION_ROLE)
        # The claim-author is its own role: model_routes.yaml may route it apart from the parent (default: the same route).
        author_model = model if context.direct_draft else resolve_agent_model(CLAIM_AUTHOR_ROLE)
    author_model = author_model or model
    instructions = phase_instructions(context) + "\n<LCSP_PHASE_END>"
    context.source_root = legal_source_root
    (legal_source_root / "work/claims").mkdir(parents=True, exist_ok=True)
    backend = FilesystemBackend(root_dir=legal_source_root, virtual_mode=True)
    observation_middleware = PreparationObservationMiddleware(context)
    read_only = preparation_filesystem(backend, files=not context.direct_draft)
    budget = AgentRunBudgetMiddleware(run_quotas={name: _positive_env(env, 1) for name, env in
        [("model_calls", "LCSP_RSP_MAX_MODEL_CALLS"), ("input_tokens", "LCSP_RSP_MAX_INPUT_TOKENS")] if os.environ.get(env)})
    with _without_general_purpose_subagent(_lookup_profile_key(model)):
        return create_deep_agent(
            name="lcsp-rule-set-preparation",
            model=model,
            backend=backend,
            system_prompt=instructions,
            tools=[*[t for t in build_rule_set_tools(context) if t.name != "commit_claims"], *(build_source_graph_tools(context.source_graph) if context.source_graph else [])],
            middleware=[
                read_only,
                TodoListMiddleware(), PreparationPhaseMiddleware(context), budget,
                observation_middleware,
                PreparationCompletionMiddleware(context),
                DraftHistoryMiddleware(context),
                *(
                    []
                    if context.direct_draft
                    else [
                        governed_summarization_middleware(
                            model, backend=backend, role=RULE_SET_PREPARATION_ROLE
                        )
                    ]
                ),
                AgentRoleMiddleware(RULE_SET_PREPARATION_ROLE),
                *MODEL_GOVERNANCE_MIDDLEWARE,
                # Innermost: sees the raw model response and tool result before governance can raise on them.
                AuthoringToolCallRecorder(context),
            ],
            subagents=[] if context.direct_draft else [claim_author_subagent(context, author_model, backend, budget)],
            # False, not None: None would inherit the Agent Server run's Postgres checkpointer, and
            # nothing resumes this claim-once run from those checkpoints. Each superstep of every
            # middleware hook queued a put on an 8-thread pool whose first put waits on writes queued
            # behind it, which deadlocked the whole run silently (py-spy: all 8 workers in
            # _checkpointer_put_after_previous) and filled the database with 100k-token states.
            checkpointer=False if checkpointer is None else checkpointer,
            store=store,
        # Native task parallelism must fit the provider's request capacity.
        ).with_config(agent_graph_config({"max_concurrency": 1 if context.direct_draft else 2}))
