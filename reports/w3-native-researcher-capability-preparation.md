# W3 native Researcher capability preparation

## Result

The installed Deep Agents runtime can expose a bounded generic Researcher through
native `task()` with a read-only model-facing filesystem surface:

- the child uses declarative `mode="isolated"` and receives only the approved
  `ls`, `read_file`, `glob`, and `grep` tools;
- child `write_file`, `edit_file`, `delete`, and `execute` attempts are rejected
  as unavailable tool calls before a backend mutation;
- a valid bounded `read_file` call succeeds against synthetic task-owned content;
- the child result is returned to the parent through native `task()`;
- the temporary content tree is byte-for-byte unchanged after the adversarial run.

This is Level 2 offline capability preparation only. It is not W3 acceptance,
production registration, tenant isolation, provider proof, checkpoint proof,
API persistence proof, or evidence/decision authority proof.

## Configuration and source proof

Installed versions from `deepagents/.venv` on 2026-10-06:

| Component | Version |
| --- | --- |
| Python | 3.11.16 |
| deepagents | 0.7.17 |
| langchain | 1.4.2 |
| langchain-core | 1.6.4 |
| langgraph | 1.2.11 |
| pytest | 8.4.2 |

The probe uses the existing `ScriptedModel` helper from
`deepagents/tests/test_native_researcher_task_preparation.py`; it adds no
provider, network, database, lifecycle, or custom orchestration harness.

The test passes the installed middleware's private `_permissions` constructor
argument because the custom read-only `FilesystemMiddleware` replaces the
default child middleware; in 0.7.17 that argument is explicitly marked private
(`deepagents/middleware/filesystem.py:1831-1836`). Public parent/child
`permissions` are also supplied to `create_deep_agent`. This is a
version-specific test observation, not a stable production extension point.

The installed source establishes the following behavior:

| Installed source | Observed contract used by the probe |
| --- | --- |
| `.venv/lib/python3.11/site-packages/deepagents/graph.py:271-302` | `create_deep_agent` normally has native filesystem and `task` tools; `execute` is only supported by a sandbox-capable backend. |
| `deepagents/graph.py:682-700` | A declarative child receives its own filesystem middleware and inherits or overrides `permissions`. |
| `deepagents/graph.py:726-770` | A child-supplied `FilesystemMiddleware` replaces the default middleware by name, while the child `tools` list is preserved. |
| `deepagents/middleware/filesystem.py:113-127` | `ls`, `read_file`, `glob`, and `grep` are read operations; `write_file`, `edit_file`, and `delete` are mutations. |
| `deepagents/middleware/filesystem.py:1787-1911` | The native filesystem `tools` allowlist omits tools entirely rather than merely hiding them from the model schema; `read_file` is required. |
| `deepagents/middleware/filesystem.py:425-472,2190-2211` | Native `FilesystemPermission` rules are path-pattern checks, and the write wrapper checks deny rules before calling the backend. |
| `deepagents/middleware/subagents.py:417-428,581-600,770-843` | Native `task` has only `description` and `subagent_type`, invokes the selected child, and wraps its final result in one parent `ToolMessage`. |
| `deepagents/backends/filesystem.py:91-137,182-215` | `FilesystemBackend(virtual_mode=True)` confines virtual paths to the temp root, but is a direct host filesystem backend and is not process isolation or sandboxing. |

The test deliberately uses `FilesystemBackend` only over pytest's temporary
directory so that a successful read is a real native backend read while any
unexpected mutation is observable and disposable. The child middleware uses
the installed read-only allowlist and a deny-write permission rule. The parent
uses native `task()`; no custom dispatcher or result adapter is introduced.

## Verification

| Command | Exit/result |
| --- | --- |
| `rtk proxy .venv/bin/python -m pytest tests/test_native_researcher_capability_preparation.py -q` | PASS; 2 passed |
| `rtk proxy .venv/bin/python -m pytest tests/test_native_researcher_task_preparation.py tests/test_native_researcher_capability_preparation.py -q` | PASS; 6 passed |
| `rtk proxy .venv/bin/python -m py_compile tests/test_native_researcher_capability_preparation.py` | PASS; exit 0 |
| `rtk ruff check tests/test_native_researcher_capability_preparation.py` | NOT VERIFIED; `ruff` is not installed in the environment |
| `rtk proxy git diff --check` | PASS; exit 0 (tracked worktree diff; the two owned files are new/untracked) |
| `rtk proxy awk 'length($0) > 119 ...; trailing-whitespace check' deepagents/tests/test_native_researcher_capability_preparation.py` | PASS; exit 0; no trailing whitespace or >119-character test lines |

The adversarial model emitted `write_file`, `edit_file`, `delete`, and `execute`
in four separate turns. The installed tool node independently returned an
invalid-tool error `ToolMessage` for each name; no result relied on the native
parallel-mutation collision check. It then accepted the bounded `read_file`
call and returned `SYNTHETIC_READ_ONLY_SOURCE`. The parent received
`CHILD_RESULT_MARKER` through the native task result. The only file in the temp
tree remained `source.txt` with its original bytes.

The second test is an intentional limitation probe: direct
`FilesystemBackend.write()` succeeds even when a read-only middleware instance
with deny-write permissions exists. That is the concrete reason this native
configuration cannot be treated as the production trust boundary; the model
cannot reach that method through the configured child tool surface, but code
that owns the backend can.

## Required W3 ownership and limitations

The probe proves the configured model-facing native surface, not a production
security boundary. The installed source explicitly warns that
`FilesystemBackend` grants direct host filesystem read/write access and that
`virtual_mode=True` does not provide sandboxing or process isolation. Its
permissions are enforced in the filesystem tool wrappers; they are not a
server-owned backend authorization policy. A future W3 owner must therefore
bind the Researcher to a server-owned read-only repository view/backend (or a
sandbox backend whose execution and write policy is independently enforced),
reject path escape, network, shell, secret, customer/domain, and shared-memory
access at that boundary, and preserve assessment/root/task lineage before
accepting any candidate finding.

Do not treat this test as proof that a production Researcher may use
`FilesystemBackend`, as proof of tenant or assessment isolation, or as proof
that prompt instructions alone prevent mutation. Do not register the Researcher
or delete the existing Repository Analyst until the W3 production owner proves
the required backend, lineage, source-pin, evidence-acceptance, restart/HITL,
and API persistence gates.
