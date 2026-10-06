# W3 native Root checkpoint/interrupt/resume preparation

## Verdict

**Preparation PASS.** The new offline probe runs the installed native
`create_deep_agent` Root graph with `InMemorySaver`, pauses in a synthetic
Root-only tool, resumes with native `Command(resume=...)` on the same thread,
and proves that a second thread has separate saved checkpoint IDs and marker
state. It also records the native replay boundary: the tool body before
`interrupt()` runs once before the pause and again during resume, so native
LangGraph does not provide idempotency for pre-interrupt side effects.

Only these new files were added:

- `deepagents/tests/test_native_root_checkpoint_preparation.py`
- `reports/w3-native-checkpoint-preparation.md`

No production, entrypoint, tool, wrapper, API, contract, Prisma, web, i18n,
lifecycle, existing test/fixture/shared model helper, database, server,
provider, or durable checkpointer file was changed by this probe.

## Installed runtime and source evidence

The probe ran in the checked-in `deepagents/.venv` with the following resolved
versions:

```text
deepagents==0.7.17
langchain==1.4.2
langchain-core==1.6.4
langgraph==1.2.11
langgraph-checkpoint==4.2.0
langgraph-checkpoint-postgres==3.1.0
pytest==8.4.2
```

The project declares `deepagents>=0.7.16,<0.8.0` and the lock resolves 0.7.17
(`deepagents/pyproject.toml:16`, `deepagents/uv.lock:635-649`). Relevant
installed source paths were:

```text
/home/khovan/orca/workspaces/LCSP/agentic-prod-integration/deepagents/.venv/lib64/python3.11/site-packages/deepagents/graph.py
/home/khovan/orca/workspaces/LCSP/agentic-prod-integration/deepagents/.venv/lib64/python3.11/site-packages/langgraph/types.py
/home/khovan/orca/workspaces/LCSP/agentic-prod-integration/deepagents/.venv/lib64/python3.11/site-packages/langgraph/checkpoint/memory/__init__.py
```

Source/API facts read from that installed runtime:

| Installed source | Evidence | Probe implication |
| --- | --- | --- |
| `deepagents/graph.py:271-301,958-970` | `create_deep_agent` assembles a native `CompiledStateGraph` and forwards the caller's `checkpointer` to `create_agent`; the resulting graph uses the native model/tool loop. | The probe calls `create_deep_agent` directly with a scripted `BaseChatModel`; it does not add a dispatcher, wrapper, or parallel Root authority. |
| `langgraph/types.py:798-825` | `Command.resume` is the supported resume value for `interrupt()` and can carry one value for the next interrupt. | Resume uses `Command(resume={"approved": thread_id})` and the original `thread_id` config. |
| `langgraph/types.py:851-890` | `interrupt()` first raises a resumable graph interruption, requires a checkpointer, and resumes from the start of the node, re-executing its logic. | The tool's pre-interrupt event is intentionally counted twice; this is observed behavior, not a guard added by the probe. |
| `langgraph/checkpoint/memory/__init__.py:33-70,312-340` | `InMemorySaver` stores checkpoints under `thread_id`; its source describes it as a debugging/testing saver and recommends Postgres for production. | Public `list(config)` snapshots and pending interrupt writes are used only for in-process evidence. |
| `deepagents/agent.py:74-102` | The current LCSP wrapper also builds its production root with native `create_deep_agent`, but resolves provider models and production tools/backends. | The probe does not invoke that provider-dependent wrapper; W3/W4 must integrate the native behavior only after their owning gates. |

The existing `ScriptedModel` from
`deepagents/tests/test_native_researcher_task_preparation.py` is imported
read-only. No second scripted-model framework or shared helper was added.

## Probe evidence

The single test
`test_native_root_interrupt_resume_replays_tool_and_isolates_threads` uses
four scripted model responses (two turns per thread) and one synthetic tool:

1. Thread A calls `root_interrupt_probe`; the tool records one `entered` event
   and raises the native interrupt with a thread-specific `private_marker`.
   The returned interrupt value and the public in-memory checkpoint pending
   write contain only Thread A's marker.
2. `Command(resume=...)` is sent with the exact Thread A config. LangGraph
   re-enters the tool: the `entered` event occurs a second time, then the
   `resumed` event occurs, the tool result is returned to Root, and the scripted
   Root final result is `ROOT_DONE_THREAD_A`. The pending interrupt write is
   gone from the latest Thread A state.
3. Thread B repeats the same native flow with a different marker. Thread A's
   saved payloads remain empty of Thread B's marker, Thread B's payload contains
   only its own marker, and final message state does not cross-contain the other
   thread marker.
4. The two public checkpoint-ID sets are non-empty and disjoint; the in-memory
   saver reports exactly the two expected thread IDs. The scripted model has
   exactly four prompts and no remaining scripted turns, which bounds turns and
   loops. The custom interrupt tool is supplied only in Root `tools`; the
   explicitly configured but uninvoked child spec has `tools=[]`, and no
   Researcher task is constructed or invoked by this probe.

The `private_marker` is deliberately a synthetic value inside the interrupt
payload. It proves that the saved pending write and resumed message lineage
retain the same thread marker; it is not a framework authorization/private-state
guard. Declarative child middleware remains a separate future read-only backend
question and is not proven by this Root-only run.

Observed event order is exact:

```text
entered(A), entered(A), resumed(A),
entered(B), entered(B), resumed(B)
```

The first `entered(A)`/`entered(B)` is before the interrupt. The second entry
is native node replay during `Command(resume=...)`; it is not evidence of an
idempotency guard. A future Root write/tool boundary must make side effects
idempotent or transactional outside this native probe.

## Verification

| Command | Exit/result |
| --- | --- |
| `rtk uv run --project deepagents pytest -q deepagents/tests/test_native_root_checkpoint_preparation.py` | `0`; 1 passed (final run) |
| `rtk uv run --project deepagents pytest -q deepagents/tests/test_native_researcher_task_preparation.py deepagents/tests/test_native_root_checkpoint_preparation.py` | `0`; 5 passed |
| `rtk uv run --project deepagents python -m py_compile deepagents/tests/test_native_root_checkpoint_preparation.py` | `0` |
| `rtk git diff --check` | `0` |
| `rtk ruff check deepagents/tests/test_native_root_checkpoint_preparation.py` | Not run: `ruff` is not installed in this environment |

The command is offline and provider-free: the model is the existing scripted
test model, the only checkpointer is in-memory, and no API, network, database,
server, credential, PostgreSQL, process-restart, compaction, or physical
Stop/Continue path is exercised. An in-memory graph rebuild is not OS restart
or durable PostgreSQL proof.

## Limits and future W3/W4 boundary requirements

Native thread-key filtering demonstrates LangGraph checkpoint scoping only. A
caller knowing another thread ID is not authorization and is not tenant or
assessment isolation. The future server-owned Root boundary must derive and
authorize tenant/assessment/actor/thread identity, map persisted runtime rows
to native threads, and reject caller-supplied identity overrides.

The native interrupt replay also does not supply server idempotency or
concurrency control. Future W3/W4 writes need persisted runtime mapping,
expected-revision CAS, durable event/outbox ordering, replay/idempotency keys,
and authorization checks around every write. Those guards are deliberately
not faked in this preparation. HumanResolution API, Root registration, live
auth/tenant proof, physical Stop/Continue, process restart, database-backed
checkpoints, and production vertical proof remain out of scope.
