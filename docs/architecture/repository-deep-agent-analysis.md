# Repository Analysis with LCSP Deep Agents

## Status

AUTHORITATIVE ACTIVE ARCHITECTURE

## Purpose

LCSP repository analysis no longer uses a language-specific static-scanner
pipeline. Each assessment runs in a durable LangGraph thread whose LCSP-owned
Docker sandbox contains the commit-pinned repository as the agent working
database.

## Runtime model

1. NestJS creates and tracks the repository scan job and immutable snapshot.
2. The local Agent Runtime resolves the durable LangGraph thread and hydrates
   the snapshot into
   /workspace/repository.
3. The repository-rooted Deep Agents backend exposes native filesystem, search,
   shell, planning, and subagent capabilities against that working tree.
4. The scan job runs ONE bounded AI-discovery Deep Agent task with the LCSP
   repository sandbox backend. It is an independent prerequisite: failure yields
   AI gate `AI_UNKNOWN` with a failure limitation, never an all-or-nothing scan.
   Per-rule analysis is not part of the scan job (see below).
5. Codebase Memory MCP 0.11.0 is available inside the Docker sandbox as an
   optional structural index and relationship memory.
6. Direct repository source is authoritative. Graph-memory results accelerate
   discovery but never replace source verification.
7. The scan job records technical coverage and the AI-discovery gate
   (`ai_discovery`), with source anchors for AI findings.
8. Existing scan-job and TechnicalEvidenceReport APIs persist the result for
   downstream TechnicalProfile, investigation, reconciliation, and legal flows.

## Per-rule assessment

After the scan, a deterministic per-rule loop resolves pinned READY EngineeringRules,
evaluates legal applicability, and runs one `repository-analyst` Deep Agent task per eligible
rule in the same sandbox. Results are validated by the governed `submit_rule_assessment`
tool and persisted per rule (`EngineeringRuleAssessment`). See `deepagents/FLOW.md`.

## Thread and sandbox lifecycle

The RabbitMQ event bridge maps each assessment event to the same durable
LangGraph thread identity. The repository sandbox manager resolves a
deterministic Docker container for that thread:

```text
assessment/thread starts
  -> resolve lcsp-repository-sandbox-<thread-hash>
  -> reuse the same thread-owned container when its image/security spec matches
  -> recreate only when the container runtime spec has drifted
  -> hydrate the immutable snapshot under /workspace/repository
```

The agent sees `/` as the repository root, while the container filesystem keeps
the source under `/workspace/repository`. LCSP metadata remains under
`/workspace/repository/.lcsp/repository.json` and
`/workspace/repository/.lcsp/agent/`. When a later event for the same durable
thread carries a different repository snapshot, LCSP keeps the sandbox identity
but clears the repository mount contents and rehydrates from the new immutable
snapshot marker.

## Local startup

`pnpm dev` starts the API, Web app, LangGraph local server, RabbitMQ event
bridge, Docker sandbox runtime support, and Phoenix tracing UI. `pnpm dev:app`
continues to start only API and Web. LangSmith tracing is optional and disabled
unless `LCSP_LANGSMITH_TRACING=true`; LangSmith sandboxes are not required.

Production deployments must run the exported `lcsp-agent` graph in a supported
LangGraph server deployment with durable checkpoint/storage configuration and
the LCSP RabbitMQ event bridge beside it. The local `langgraph dev` entrypoint is
for development and smoke validation only; it is not the production authority
for persistence, auth, or scaling. Fogewise production deploys the graph through
the `agent-runtime-server` service built from `deepagents-langgraph/Dockerfile`.
The generic RabbitMQ bridge runs in the separate `agent-runtime` service with
`LCSP_AGENT_RUNTIME_ROLE=bridge` and dispatches to
`http://agent-runtime-server:8000`. Manual PM2 repair tooling uses the same
LCSP-owned local Agent Server entrypoint rather than `langgraph dev` or
`langgraph up`.

## Docker sandbox security model

The repository sandbox runs without privileged mode, without the host Docker
socket, without host networking, without arbitrary host mounts, and without
host credentials. Containers run as a non-root user where practical, drop Linux
capabilities, set `no-new-privileges`, enforce CPU/memory/PID limits, and use
tmpfs writable areas for `/tmp`, `/workspace/runtime`, and
`/workspace/repository`.

The trusted Agent Server container may receive the host Docker socket only to
create and manage sibling repository sandbox containers. That is an
infrastructure control-plane capability, not part of the sandbox contract; the
created sandbox containers must still receive no Docker socket, no privileged
mode, no arbitrary host mounts, and no host credentials.

The default network policy is offline repository analysis (`--network none`).
Restricted outbound analysis or approved research connectors require explicit
configuration and must not receive arbitrary host secrets.

## Evidence and coverage rules

- Evidence citations use repository-relative paths and bounded line ranges.
- Customer source, secrets, credentials, and full prompts are never copied into
  audit/runtime metadata.
- AI_CONFIRMED requires an observed concrete AI/model invocation or outbound AI call.
- AI_ABSENT_CONFIRMED requires READY global and AI coverage plus broad
  inventory/search with no material unresolved generated, dynamic, configured,
  binary, or runtime frontier.
- Any material coverage gap keeps the result PARTIAL/UNKNOWN rather than
  manufacturing absence.
- Codebase Memory check_index_coverage is best-effort and is combined with
  direct source inspection for exhaustive or negative claims.

## Codebase Memory boundary

The Docker sandbox setup pins codebase-memory-mcp 0.11.0 and exposes the native
binary as codebase-memory-graph. Its cache/database lives outside the
assessment repository so it cannot be recursively treated as customer source.
The Deep Agent may use index_repository, get_architecture, search_graph,
search_code, trace_path, query_graph, detect_changes, and check_index_coverage.

Codebase Memory is an index/memory aid, not an evidence authority.

## Compatibility terminology

The product still has a Repository Scan job and TechnicalEvidenceReport domain
contract. Those names describe the product workflow, not a static scanner
implementation. Program/evidence graph schemas may remain as downstream
compatibility contracts even though graph construction is now agent-derived.

## Retired architecture

The following are not active repository-analysis runtime dependencies:

- retired externally managed Deep Agents platform services;
- LangSmith-managed sandboxes;
- external context-hub platform services as a runtime requirement;
- Semgrep scanner rules;
- Syft scanner inventory;
- Knip/Deptry scanner orchestration;
- Python AST/CST scanner stages;
- bounded ts-morph scanner bridge;
- tree-sitter scanner augmentation;
- language-specific scanner adapters;
- standalone scanner-worker graph assembly.

Historical documents describing that architecture are retained under
