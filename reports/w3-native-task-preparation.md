# W3 native Deep Agents `task()` preparation

## Verdict

The smallest offline native harness passes the installed Deep Agents task
contract in this checkout. It proves the supported task input shape, isolated
child prompt construction, one child result returned through the parent task
tool, a bounded read-only probe tool, and deterministic child-tool failure
propagation. It does **not** prove semantic research quality, live tenant or
assessment isolation, backend enforcement, provider behavior, checkpoint or
restart survival, API persistence, or the W3 production vertical.

Only these preparation files were added:

- `deepagents/tests/test_native_researcher_task_preparation.py`
- `reports/w3-native-task-preparation.md`

No production, existing test/fixture, API, contract, Prisma, web, i18n,
lifecycle, entrypoint, provider, database, checkpointer, or shared fixture file
was changed.

## Installed runtime evidence

The probe ran in the checked-in `deepagents/.venv`:

```text
deepagents==0.7.17
langchain==1.4.2
langchain-core==1.6.4
langgraph==1.2.11
pytest==8.4.2
```

The project declares `deepagents>=0.7.16,<0.8.0` and the lock resolves
`deepagents` to `0.7.17` (`deepagents/pyproject.toml:16`,
`deepagents/uv.lock:635-649`). Runtime source paths were:

```text
/home/khovan/orca/workspaces/LCSP/agentic-prod-integration/deepagents/.venv/lib64/python3.11/site-packages/deepagents/graph.py
/home/khovan/orca/workspaces/LCSP/agentic-prod-integration/deepagents/.venv/lib64/python3.11/site-packages/deepagents/middleware/subagents.py
```

The installed `create_deep_agent` signature accepts `model`, `tools`,
`system_prompt`, `middleware`, `subagents`, `permissions`, `backend`,
`response_format`, `context_schema`, `checkpointer`, `store`, `name`, and
related native options. The installed `TaskToolSchema` has exactly two
required fields: `description: str` and `subagent_type: str`.

Relevant local introspection output was:

```text
create_deep_agent_signature=(model: str | BaseChatModel | None = None, tools: Sequence[BaseTool | Callable | dict[str, Any]] | None = None, *, system_prompt: str | SystemMessage | None = None, middleware: Sequence[AgentMiddleware] = (), subagents: Sequence[SubAgent | CompiledSubAgent | AsyncSubAgent] | None = None, ..., name: str | None = None, cache: BaseCache | None = None) -> CompiledStateGraph
task_fields=['description', 'subagent_type']
task_schema.required=['description', 'subagent_type']; properties=['description', 'subagent_type']; additionalProperties is unset
```

## Source/API evidence

Evidence was read from the installed source, not inferred from a newer online
version:

| Installed source | Evidence | Probe implication |
| --- | --- | --- |
| `middleware/subagents.py:66-109` | `SubAgent` is a declarative typed spec; isolated mode is the default and receives only the delegated task description. | The harness uses a declarative `SubAgent` with `mode="isolated"`. |
| `middleware/subagents.py:209-217` | `mode="isolated"` only sees the delegated task; `mode="fork"` continues parent conversation/state and mirrors prompt middleware. | Parent system/user markers must be absent from the isolated child; fork must not be treated as isolation. |
| `middleware/subagents.py:417-428` | Native task input is `TaskToolSchema(description, subagent_type)`. | The test inspects the actual bound `task` tool and its installed args schema. |
| `middleware/subagents.py:430-441` | The task tool advertises available subagent types and says invocations are stateless by default with one final report. | The test keeps advertisement and prompt isolation as separate observations. |
| `middleware/subagents.py:581-620,837-843` | `_build_task_tool` creates a native `StructuredTool` named `task` with `TaskToolSchema`. | No custom dispatcher or task schema was added. |
| `middleware/subagents.py:757-768` | Isolated invocation strips excluded/private state and sets child `messages` to one `HumanMessage(description)`; fork uses inherited messages/state. | The child prompt assertion is directly aligned with the installed implementation. |
| `middleware/subagents.py:783-798` | Native task invokes the selected child runnable and wraps the returned final/structured content in one parent `ToolMessage`; no error-swallowing fallback is present. | One child result and deterministic tool failure are both exercised. |
| `graph.py:271-301,659-685,872-885` | `create_deep_agent` accepts declarative subagents and assembles filesystem/subagent middleware for them. | The harness uses `create_deep_agent`; it does not construct a second orchestration layer. |

The current LCSP production root remains unchanged. `deepagents/agent.py:74-102`
still builds the native root with `create_deep_agent`, while its comment keeps
assessment repository-analyst/interview work on `RootSubagentDispatcher`; the
existing dispatcher remains a separate direct-specialist wrapper. This probe
does not register or replace either path.

## What the probe proves

`deepagents/tests/test_native_researcher_task_preparation.py` contains one
provider-free scripted `BaseChatModel` and four focused tests:

1. `test_native_task_schema_and_tool_advertisement` (`:111-125`) invokes a
   native graph, finds the actual bound `task` tool, asserts its installed
   `TaskToolSchema`, and confirms `task` is advertised to the parent model.
2. `test_native_task_isolates_parent_prompt_and_returns_one_child_result`
   (`:128-154`) puts private markers in the parent system and user messages,
   delegates only `TASK_DESCRIPTION`, and asserts the child sees its own prompt
   plus that description but neither parent marker. It then asserts exactly one
   child result arrives as one parent `ToolMessage` and the parent terminates
   with its scripted final response.
3. `test_native_task_runs_one_bounded_read_only_child_tool` (`:157-190`) gives
   the child one custom tool that only records a request and returns a bounded
   value. It asserts that tool is advertised, called once, and its result is
   delivered to the child before the child returns.
4. `test_native_task_surfaces_child_tool_failure_without_parent_result`
   (`:193-218`) gives the child a deterministic failing read probe. The native
   invocation raises the same `RuntimeError`, the child was called once, and the
   parent receives no fabricated final result.

The native Deep Agents filesystem middleware still advertises its built-in
filesystem surface for a declarative child. The custom probe therefore treats
tool advertisement as a fact separate from backend/tenant enforcement; hiding
or naming a tool is not evidence that a future backend is read-only. W3 must
still supply a server-owned read-only backend/command policy, identity and
tenant checks, repository pin verification, lineage, idempotency, and accepted
evidence gates after W1/W3 contracts and production gates authorize that work.

## Verification

| Command | Exit/result |
| --- | --- |
| `rtk uv run --project deepagents pytest -q deepagents/tests/test_native_researcher_task_preparation.py` | `0`; 4 passed in 1.82s (final rerun; initial run was 1.29s) |
| `rtk deepagents/.venv/bin/python -m py_compile deepagents/tests/test_native_researcher_task_preparation.py` | `0` |
| `rtk git diff --check` | `0` for the current checkout diff |
| `rtk ruff check deepagents/tests/test_native_researcher_task_preparation.py` | Not run: `ruff` is not installed (`rtk` exit `1`, failed to spawn) |

The focused pytest run is deterministic and makes no provider, network, user
database, persistence, checkpointer, or production-agent calls. The fake model
only proves observable graph wiring and message/tool plumbing; it cannot prove
that a real provider would choose the task, return useful research, honor
instructions, or preserve isolation outside this in-process graph.

## Future W3 backend guards

Before any production Researcher registration, the owning W3 vertical must add
server-derived Root/task/thread/tenant/assessment identity, an immutable pinned
repository read view, source/hash/line verification, read-only shell/backend
enforcement, model/provider governance, bounded output and timeout/cancellation,
lineage/idempotency, and API-owned evidence acceptance. Native `task()` output
must remain a candidate result returned to Root; it cannot mint evidence, write
assessment/lifecycle state, submit a RuleDecision, request HITL, or write shared
memory. W1 integration and W3 production gates remain hard prerequisites, and
the draft domain-researcher interface report remains routing material rather than
a new production contract.
