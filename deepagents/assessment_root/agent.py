"""``create_assessment_root_agent``: the ONLY assessment reasoning entrypoint.

One Deep Agent per assessment, bound to the server-owned Root thread. It plans natively, may
delegate to the bounded read-only ``repository-researcher`` via native ``task()``, and reaches the
assessment domain only through the governed tools of :mod:`assessment_root.tools`.
"""

from __future__ import annotations

from runtime_instruction_bundle import runtime_instruction

from pathlib import Path
import os
from typing import Any, Sequence

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend
from deepagents.middleware.filesystem import FilesystemPermission
from langchain.agents.middleware import AgentMiddleware, AgentState, TodoListMiddleware, TracePolicy, hook_config, omit_payload
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import BaseTool
from langgraph.runtime import Runtime

from assessment_root.researcher import RESEARCHER_NAME, researcher_prompt_for_locale, researcher_subagent
from assessment_root.skills import ALLOWED as ASSESSMENT_SKILLS
from evals.run_manifest import build_runtime_manifest, checked_in_skill_hashes
from assessment_root.tool_contracts import describe_tool
from assessment_root.tools import RootRun, build_root_tools
from rule_set_preparation.agent import _lookup_profile_key, _without_general_purpose_subagent
from orchestration.graph_execution import agent_graph_config
from tools.common.capabilities.platform.logging import get_logger

ROOT_INSTRUCTIONS = (Path(__file__).with_name("instructions.md")).read_text(encoding="utf-8")
ROOT_INSTRUCTIONS_VI = (Path(__file__).with_name("instructions.vi.md")).read_text(encoding="utf-8")
ASSESSMENT_ROOT_ROLE = "assessment-root"
# Graph tools search; governed Root tools mint accepted source references.
_GRAPH_TOOL_NAMES = {"search_code_graph", "trace_call_path", "search_code_text", "get_repository_architecture"}
logger = get_logger(__name__)


_ROOT_PLANNING_INSTRUCTIONS = (
    "Use write_todos for actionable steps in complex work; skip trivial work. Revise future steps "
    "as evidence changes and mark each completed step immediately. Never call it in parallel. "
    "After the last update, send the substantive result in a separate message; a completed list is not the answer."
)

# Model-facing operational instructions; registered implementations and schemas remain native.
_ROOT_TOOL_DESCRIPTIONS = {
    "ls": "List a directory to discover paths before read_file or edit_file.",
    "read_file": "Read a file; missing paths error and empty files return a warning. Text defaults to 100 lines; page with offset/limit. The @@ status header is metadata, not file content; exclude it when editing. Read files before editing. Independent reads may be batched. Read offloaded results at the returned path. Images/audio/video/PDFs return multimodal blocks; images/PDFs use file_path only, without text pagination.",
    "write_file": "Create a file or replace its whole contents; no prior read required. Prefer edit_file for existing-file changes. Respect write permissions.",
    "edit_file": "Replace exact strings in a previously read file. Preserve indentation and omit the @@ read header. Prefer editing existing files. Use emojis only if requested. Respect write permissions.",
    "delete": "Permanently delete an absolute file path or a directory recursively. This cannot be undone; delete only paths no longer needed, within write permissions.",
    "glob": "Find absolute file paths using *, **, ?, [abc], {a,b}. Without /, match basenames at any depth; with /, match search-root-relative paths; leading / anchors the root. Dot-names require a pattern segment starting with .; ** does not descend into dot-directories, so *.yml is broader than **/*.yml.",
    "grep": "Search literal text, never regex; use separate calls for alternatives. Returns files/content per output_mode. Search offloaded results at their returned artifact path (/large_tool_results/ by default).",
    "task": "Run one repository-researcher task at a time. It is stateless: supply a complete bounded source question and desired output. It only reads/searches and returns candidate findings with file/line ranges and gaps; it cannot accept evidence or decide. The report is not shown to the user; Root verifies sources and relays supported findings.",
    "write_todos": "Manage actionable steps for complex work or an explicit list request; skip trivial/conversational tasks. Use pending, in_progress, completed. Mark work in_progress before starting, retaining one active step until finished; independent work may share that status. Mark completed immediately only when fully done, without errors/blockers; otherwise retain in_progress and add a blocker task. Revise/remove future tasks, preserve completed tasks. Never call write_todos in parallel. After the final update, deliver the substantive answer in a later message; the list itself is not the answer.",
    "retrieve_shared_heuristics": "Read bounded generic investigation tips from the learning Store. NON_AUTHORITATIVE_HEURISTIC only: never law, evidence, accepted facts, decision provenance or authenticated search coverage. Missing Store returns an empty warning; failures propagate.",
}


class AssessmentToolDescriptionsMiddleware(AgentMiddleware):
    """Keep the Root's native tool catalog concise without changing executable capabilities."""

    trace_policy = TracePolicy(process_inputs=omit_payload, process_outputs=omit_payload)

    def _compact_request(self, request):
        """Business purpose: Avoid repeating long framework examples in every governed model request.

        Business rules:
        - Only reviewed descriptions for known native tools and generic learning are replaced.
        - Tool names, ordering, schemas, callables, validation, permissions and registered execution stay unchanged.
        - Unknown or provider-native dictionary tools retain their original representation.

        Execution flow:
        1. Shallow-copy supported tool objects with concise operational descriptions.
        2. Return a request override so downstream governance measures exactly the model-facing catalog.

        Failure cases:
        - Unsupported tool shapes pass through unchanged; request-copy failures stop before dispatch.

        Side effects:
        - In-memory request copies only; no global profile mutation, domain write or provider call.
        """
        tools = [
            tool.model_copy(update={"description": _ROOT_TOOL_DESCRIPTIONS[tool.name]})
            if isinstance(tool, BaseTool) and tool.name in _ROOT_TOOL_DESCRIPTIONS else tool
            for tool in request.tools
        ]
        return request.override(tools=tools)

    def wrap_model_call(self, request, handler):
        """Business purpose: Apply concise native tool guidance before synchronous governed inference.

        Business rules:
        - The downstream handler retains all admission, usage, source and lifecycle controls.

        Execution flow:
        1. Copy the request's descriptions without altering its executable tool contracts.
        2. Invoke the governed downstream handler with the resulting request.

        Failure cases:
        - Transformation or downstream errors propagate; no alternate dispatch is attempted.

        Side effects:
        - The governed handler may invoke the model; this layer adds no independent request.
        """
        return handler(self._compact_request(request))

    async def awrap_model_call(self, request, handler):
        """Business purpose: Apply the same concise tool catalog to asynchronous governed inference.

        Business rules:
        - Async execution uses the identical description projection and unchanged downstream governance.

        Execution flow:
        1. Copy model-facing descriptions using the shared request projection.
        2. Await the governed downstream handler once.

        Failure cases:
        - Copy or downstream errors propagate without retries or fallback bypasses.

        Side effects:
        - The governed handler may invoke the model; this layer adds no independent request.
        """
        return await handler(self._compact_request(request))


class AssessmentCompletionMiddleware(AgentMiddleware):
    """Only API-owned COMPLETE ends the persistent workflow without an interrupt."""

    # Native response_format validates response shape, not API lifecycle; native hooks route on that predicate.

    trace_policy = TracePolicy(process_inputs=omit_payload, process_outputs=omit_payload)

    def __init__(self, run: RootRun) -> None:
        self.run = run

    @hook_config(can_jump_to=["end"])
    def before_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        """Business purpose: Stop reasoning once the server has completed the authorized audit scope or paused execution.

        Business rules:
        - Only a durable full assessment or selected request completion or paused state ends Root work.
        Execution flow:
        1. Reload canonical context.
        2. End the graph for a completed or paused scope.
        Failure cases:
        - API context failures propagate; incomplete work continues to the model.
        Side effects:
        - Reads API context and may end native graph execution; no decision is written.
        """
        context = self.run.client.context()
        if context["lifecycleState"] in {"COMPLETE", "PAUSED", "FAILED"} or (context.get("auditRequest") or {}).get("status") == "COMPLETED":
            return {"jump_to": "end"}
        return None

    @hook_config(can_jump_to=["model"])
    def after_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        """Business purpose: Keep Root working until the API accepts the requested audit scope.

        Business rules:
        - A model final message cannot substitute for selected-scope or full-report completion.
        - Paused, failed, or stop-requested states must end reasoning without continuation loops or blocker exceptions.
        Execution flow:
        1. Inspect the model response.
        2. Reload canonical status and check for pause or completion.
        3. Request another tool-using turn if unfinished.
        Failure cases:
        - Open human blockers without native interrupt reject completion when not paused.
        Side effects:
        - Reads API context and adds a native continuation message; no legal decision is persisted.
        """
        response = state["messages"][-1]
        if not isinstance(response, AIMessage) or response.tool_calls:
            return None
        context = self.run.client.context()
        if context["lifecycleState"] in {"COMPLETE", "PAUSED", "FAILED"} or (context.get("auditRequest") or {}).get("status") == "COMPLETED":
            return None
        try:
            control = self.run.client.root_control()
            if control and control.get("state") == "STOP_REQUESTED":
                return None
        except Exception:
            pass
        if context["openHumanRequestIds"]:
            raise RuntimeError("open human blockers without a native interrupt")
        logger.info("ASSESSMENT_ROOT_CONTINUING", assessment_id=self.run.assessment_id,
                    execution_id=self.run.execution_id, lifecycle_state=context["lifecycleState"])
        return {
            "messages": [HumanMessage(content=(
                (runtime_instruction("assessment-root.continuation"))
            ))],
            "jump_to": "model",
        }


def root_permissions() -> list[FilesystemPermission]:
    """Business purpose: Give the Root investigation notes without granting changes to pinned source or runtime identity metadata.

    Business rules:
    - Only the dedicated /.lcsp/agent/ subtree is writable; the repository marker and source remain read-only.
    - Native first-match rules deny reserved metadata and visible source writes; the production backend enforces the complete source-write boundary.

    Execution flow:
    1. Allow scratch writes and repository reads, then deny all remaining writes.

    Failure cases:
    - Native filesystem tools reject writes outside the dedicated agent subtree.

    Side effects:
    - Pure permission configuration; does not read or modify files.
    """
    return [
        FilesystemPermission(["write"], ["/.lcsp/agent/**"], mode="allow"),
        FilesystemPermission(["read"], ["/**"], mode="allow"),
        FilesystemPermission(["write"], ["/.lcsp/**", "/**"], mode="deny"),
    ]


def _graph_tools(locale: str = "en") -> list[Any]:
    """Business purpose:
    Select approved read-only repository graph tools with decision-authority caveats.

    Business rules:
    - Only the existing four graph tools may be exposed; descriptions do not change capability.

    Execution flow:
    1. Select known tools and create copies with appended retrieval limitations.

    Failure cases:
    - Missing graph tools simply result in a smaller delegated search surface.

    Side effects:
    - Constructs tool specifications; cannot alter source, legal rules or decisions.
    """
    from tools.common.codebase_memory_graph import CODEBASE_MEMORY_GRAPH_TOOLS

    return [
        tool.model_copy(update={"description": describe_tool(tool.name, tool.description, locale=locale)})
        for tool in CODEBASE_MEMORY_GRAPH_TOOLS if tool.name in _GRAPH_TOOL_NAMES
    ]


def create_assessment_root_agent(
    *,
    run: RootRun,
    model: Any | None = None,
    checkpointer: Any | None = None,
    store: Any | None = None,
    governance: Sequence[Any] | None = None,
    graph_tools: list[Any] | None = None,
    middleware: Sequence[Any] = (),
):
    """Business purpose: Build the native investigator for one execution on the Assessment's server-owned thread.

    Business rules:
    - Only the Root has governed fact, decision and human-resolution tools; its researcher returns read-only candidate findings.
    - Native planning state is checkpointed with the same graph; Root and delegated calls share governance, and each compaction call retains its investigator's own authority instructions.
    - Concise model-facing descriptions preserve native tool execution contracts and pass through the same downstream governance.
    - The backend exposes the pinned repository read-only with a separate writable scratch area; invoke using run.thread_id.
    - Native tool/research batches run one at a time until shared search and usage attribution is proven safe for parallel children; independent Roots have independent graphs.

    Execution flow:
    1. Resolve the configured model and default governance when callers do not supply them.
    2. Bind governed tools, native planning and the single read-only researcher to this Root run.
    3. Compile the native graph with the supplied checkpointer, Store and existing execution middleware.

    Failure cases:
    - Model, middleware or graph configuration failures propagate; construction does not fabricate an Assessment outcome.

    Side effects:
    - Constructs a native graph; later invocations persist its planning/checkpoint state and perform only the authorized tool effects.
    """
    from runtime_instruction_bundle import production_runtime_bundle
    from middleware.approved_instructions import ApprovedInstructionMiddleware
    bundle = production_runtime_bundle()
    if model is None:
        from model_policy import resolve_agent_model

        model = resolve_agent_model(ASSESSMENT_ROOT_ROLE)
    if governance is None:
        from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
        from middleware.usage_metering import AgentRoleMiddleware

        governance = [AgentRoleMiddleware(ASSESSMENT_ROOT_ROLE), *MODEL_GOVERNANCE_MIDDLEWARE]
    from middleware.localization import ResponseLocalizationMiddleware
    from middleware.model_governance import governed_summarization_middleware
    from orchestration.context import LCSPRunContext, resolve_response_language

    runtime_locale = resolve_response_language(run.response_language)
    root_prompt = bundle.instruction("assessment-root.system")
    researcher_prompt = researcher_prompt_for_locale(runtime_locale)
    tools = graph_tools if graph_tools is not None else _graph_tools(runtime_locale)
    root_tools = build_root_tools(run)
    run.prompt_manifest = build_runtime_manifest(
        run_id=run.execution_id, component=ASSESSMENT_ROOT_ROLE, locale=runtime_locale,
        model=model, prompts={"assessment_root": root_prompt, "repository_researcher": researcher_prompt},
        tools=[*root_tools, *tools],
        skill_hashes=checked_in_skill_hashes(
            ASSESSMENT_SKILLS, runtime_locale, Path(__file__).resolve().parents[1] / "skills"
        ),
        pins=run.pins or {"assessmentId": run.assessment_id},
        gold_revision=os.environ.get("LCSP_EVAL_GOLD_REVISION"),
    )
    summary_backend = CompositeBackend(default=run.backend, routes={}, artifacts_root="/.lcsp/agent")
    researcher_middleware = [*governance, governed_summarization_middleware(
        model, backend=summary_backend, role=RESEARCHER_NAME, governance=governance,
        system_prompt=researcher_prompt,
        receipt_context=lambda: {"run_id": run.execution_id, "component": RESEARCHER_NAME, "locale": run.response_language, "pins": run.pins or {"assessmentId": run.assessment_id}},
        receipt_sink=lambda manifest: run.internal_model_manifests.update({manifest["manifestSha256"]: manifest}),
    )]
    # The default general-purpose subagent would inherit the governed tools; disable it so the
    # researcher is the only delegate and it holds none of them.
    with _without_general_purpose_subagent(_lookup_profile_key(model)):
        return create_deep_agent(
            name="lcsp-assessment-root",
            model=model,
            backend=run.backend,
            system_prompt=root_prompt,
            tools=[*root_tools, *tools],
            subagents=[researcher_subagent(tools, middleware=researcher_middleware, locale=runtime_locale)],
            permissions=root_permissions(),
            middleware=[TodoListMiddleware(system_prompt=__import__("json").loads(bundle.instruction("framework.injected-policy"))["todo_system"], tool_description=__import__("json").loads(bundle.instruction("framework.injected-policy"))["tool.write_todos"]), ResponseLocalizationMiddleware(), *governance,
                        governed_summarization_middleware(model, backend=summary_backend, role=ASSESSMENT_ROOT_ROLE, governance=governance,
                            system_prompt=root_prompt,
                            receipt_context=lambda: {"run_id": run.execution_id, "component": ASSESSMENT_ROOT_ROLE, "locale": run.response_language, "pins": run.pins or {"assessmentId": run.assessment_id}},
                            receipt_sink=lambda manifest: run.internal_model_manifests.update({manifest["manifestSha256"]: manifest})),
                        AssessmentCompletionMiddleware(run), *middleware,
                        ApprovedInstructionMiddleware(["assessment-root.system", "runtime.response-language", "runtime.context-identifiers"],
                            receipt_context=lambda: {"run_id": run.execution_id, "component": ASSESSMENT_ROOT_ROLE, "locale": run.response_language,
                                "pins": run.pins or {"assessmentId": run.assessment_id}, "skill_names": ASSESSMENT_SKILLS, "selected_skills": run.used_skill_hashes},
                            receipt_sink=lambda manifest: setattr(run, "prompt_manifest", manifest),
                            presentation_context=lambda: {"response_language": run.response_language, "assessment_id": run.assessment_id})],
            context_schema=LCSPRunContext,
            checkpointer=checkpointer,
            store=store,
        ).with_config(agent_graph_config({"max_concurrency": 1}))
