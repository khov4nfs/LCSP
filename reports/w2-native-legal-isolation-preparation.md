# W2 native Legal Preparation isolation preparation

## Verdict

**Preparation PASS — offline native wiring only.** The new probe runs the
installed Deep Agents graph with one accepted synthetic V1 legal source, reads
that source through the native filesystem tool, and rejects scripted attempts
to use another corpus path, mutation/shell tools, `task`, HITL, decision, or
shared-memory tools. It does not prove W2 semantic quality, portfolio
submission/activation, production authorization, or any frozen integration
gate.

Only these two new files are owned by this lane:

- `deepagents/tests/test_legal_preparation_native_isolation_preparation.py`
- `reports/w2-native-legal-isolation-preparation.md`

The existing `ScriptedModel` from
`deepagents/tests/test_native_researcher_task_preparation.py` and the accepted
source fixtures under `deepagents/tests/fixtures/legal_portfolio_context/` were
read-only inputs. No production prompt, skill, entrypoint, registration,
fixture, API, contract, Prisma, web, i18n, lifecycle, provider, database,
network, or service code was changed.

## Freeze boundary

| Freeze authority | Probe boundary |
| --- | --- |
| §1: one Legal Corpus -> Legal Preparation -> portfolio path; Legal Preparation has no assessment/customer/repository context | The input contains only the accepted V1 corpus/document/source pin and a source-grounded instruction; no assessment, customer, repository, runtime, or prior-result payload is supplied. |
| §2: the agent owns legal interpretation; deterministic checks enforce identity/provenance/security, not legal meaning | Assertions cover only accepted source identity/bytes, native read output, tool names/statuses, and unchanged bytes. No legal proposition or semantic judgment is asserted. |
| §5: procedural skills/instructions are separate and assessment memory is private | The graph receives no `skills`, `memory`, `store`, `checkpointer`, or domain context. The initial model prompt is exactly the legal-only system and user messages. |
| §11 W2: replace Triage with one isolated Legal Preparation agent; no assessment/customer/repository context or human review handoff | The test creates one native agent with no synchronous subagents, no `task` surface, no HITL/decision/shared-memory tools, and only one pinned read path. |

This is preparation only. W1.4 and the existing integration gate retain
priority; this result cannot unblock W2 or any frozen downstream gate.

## Native probe

The test selects `SYNTHETIC-CORPUS-V1` from the accepted `pins.json`, verifies
the source byte length and SHA-256, and stages those exact bytes in pytest's
temporary directory. The native graph then:

1. successfully calls `read_file` for `/synthetic-notice-v1.txt` and returns
   the complete emitted source body;
2. attempts `/synthetic-notice-v2.txt`, which is rejected by the path rule;
3. attempts `write_file`, `execute`, `task`, `ask_human`,
   `submit_rule_decision`, and `write_shared_memory`, each of which is absent
   from the bound tool set and returns a native invalid-tool error;
4. returns the scripted terminal message, with the staged source unchanged.

The model-facing tool set is asserted to be exactly `{read_file}` on every
native bind. `GeneralPurposeSubagentProfile(enabled=False)` plus
`subagents=[]` disables Deep Agents' auto-added general-purpose subagent, so
the probe does not construct or invoke a Researcher task. The custom native
`FilesystemMiddleware(tools=["read_file"])` replaces the default filesystem
middleware by its installed middleware name; no second orchestration layer or
custom tool registry was added.

## Installed runtime and API trace

The final checks used the installed `deepagents/.venv` environment on
2026-10-06:

```text
Python==3.11.16
deepagents==0.7.17
langchain==1.4.2
langchain-core==1.6.4
langgraph==1.2.11
pytest==8.4.2
```

The project declares `deepagents>=0.7.16,<0.8.0` and the lock resolves
`deepagents` to `0.7.17` (`deepagents/pyproject.toml:16-20`,
`deepagents/uv.lock:635-649`). The installed source was inspected before the
probe:

| Installed source | Observed native behavior used here |
| --- | --- |
| `deepagents/graph.py:271-302` | `create_deep_agent` normally assembles native filesystem and `task` tools; `execute` requires a sandbox-capable backend. |
| `deepagents/graph.py:204-238,861-890,928-938` | Caller middleware with the same name replaces the base middleware; the replacement remains native required scaffolding. |
| `deepagents/profiles/harness/harness_profiles.py:298-318` | Disabling the default general-purpose subagent and passing no synchronous subagents removes the `task` tool. |
| `deepagents/middleware/filesystem.py:1822-1836` | `tools=[...]` is a model-facing allowlist, and `_permissions` is explicitly private and may move to the backend layer. |
| `deepagents/middleware/filesystem.py:2163-2171,2182-2210` | Native read/write wrappers check filesystem permissions before calling the backend. |
| `deepagents/backends/filesystem.py:91-137,182-215` | `FilesystemBackend(virtual_mode=True)` anchors virtual paths and blocks traversal, but is direct host filesystem access, not process isolation or a sandbox. |

The probe therefore uses the current installed native API deliberately, while
recording the private `_permissions` dependency as a version-specific test
limitation rather than treating it as a stable production contract.

## Verification

| Command | Result |
| --- | --- |
| `rtk uv run --project deepagents --extra dev --no-sync pytest -q deepagents/tests/test_legal_preparation_native_isolation_preparation.py` | PASS; 1 passed in 3.04s |
| `rtk uv run --project deepagents --extra dev --no-sync pytest -q deepagents/tests/test_legal_preparation_native_isolation_preparation.py deepagents/tests/test_native_researcher_task_preparation.py deepagents/tests/test_native_researcher_capability_preparation.py deepagents/tests/test_legal_preparation_eval_fixtures.py` | PASS; 11 passed in 3.62s |
| `rtk proxy python3 -m py_compile deepagents/tests/test_legal_preparation_native_isolation_preparation.py` | PASS; exit 0 |
| `rtk proxy git diff --check -- deepagents/tests/test_legal_preparation_native_isolation_preparation.py reports/w2-native-legal-isolation-preparation.md` | PASS; exit 0 |
| `rtk proxy bash -lc 'awk length/trailing-whitespace checks on the new test'` | PASS; no lines over 119 characters and no trailing whitespace |
| `rtk git status --short --untracked-files=all` scoped to the owned names | PASS; only the new test and this report are new in this lane; all pre-existing dirty worktree changes were preserved |

The combined run also re-exercised the existing native ScriptedModel/task,
read-only capability, backend-escape limitation, and accepted legal-fixture
checks. No provider, network, API, database, server, browser, checkpoint, or
production-agent call was made.

## Limits and required future boundary

This is not a prompt-only security claim. The invalid-tool observations prove
only the in-process model-facing native graph surface. The existing combined
capability probe demonstrates that a direct `FilesystemBackend.write()` can
succeed even when a read-only filesystem middleware instance has deny-write
rules; code holding the backend can bypass middleware permissions. `virtual_mode`
is path containment/traversal handling, not tenant authorization, sandboxing,
network isolation, or process isolation.

The future W2 owner must replace this disposable backend with a server-owned
read-only corpus view and enforce source/version/hash identity, worker
authorization, path scope, bounded output, and audit/idempotency at that
boundary. The future agent eval must separately review definitions, scope,
qualifiers, exceptions, cross-references, non-repository duties, coverage,
stale/repealed references, and portfolio activation. None of those semantic or
production behaviors is claimed here.
