# Program Evidence Graph Specification

## Status
AUTHORITATIVE — LCSP-999

## Purpose
`ProgramEvidenceGraph` is LCSP's immutable, source-grounded technical evidence projection. It is authored by the Repository Deep Agent after broad exploration of the commit-pinned assessment repository. The graph is a persisted compatibility and downstream reasoning contract; it is not produced by a language-specific static-scanner pipeline.

## Invariants

1. The commit-pinned repository is materialized inside the LCSP Docker assessment sandbox and exposed as the agent filesystem root.
2. Repository analysis uses the native Deep Agents harness (`ls`, `glob`, `grep`, `read_file`, sandboxed `execute`, planning and forked subagents) rather than predefined language scanners.
3. Codebase Memory may be used inside the same sandbox as a structural index/memory aid. Its graph is not source authority and is not copied wholesale into LCSP evidence.
4. The Repository Deep Agent determines graph nodes, edges, source anchors, unresolved frontiers, global coverage and AI-discovery coverage from evidence it actually inspects.
5. `AI_ABSENT_CONFIRMED` is permitted only when both global and AI-discovery coverage are `READY` and no material generated/dynamic/configured/runtime frontier remains unresolved.
6. Dynamic, reflective, generated, unreadable or runtime-only behavior that cannot be resolved is represented as an explicit unresolved frontier. The agent must not invent a target.
7. Raw source, full prompts, secrets, credentials and literal personal data are never persisted in the graph. Evidence is anchored by snapshot, commit, repository-relative file, symbol, line range and source hash.
8. Graph construction is independent of any legal rule. Legal rules guide later investigation; they do not decide what repository evidence exists.
9. Graph artifacts are immutable per snapshot/schema/configuration and carry deterministic provenance/hash metadata.
10. Historical `STATIC_ANALYSIS` origin values remain readable for persisted legacy artifacts. New repository-analysis output uses `DEEP_AGENT`.

## Semantic model

Required structural/data/control concepts include repository/file/module/package/dependency, class/interface/function/method, parameter/return, variable/property/DTO field, assignment/alias, call/argument, parser/serializer/validator/transform, branch/loop, HTTP route/request/response, event/queue/CQRS, persistence, external API/service, AI provider/invocation/input/output, business action/state change, human review/override, personal/sensitive data and explicit coverage gaps.

Canonical vocabulary is code-owned by `deepagents/tools/common/capabilities/evidence/graph/schema/vocabulary.py`. Structured Deep Agent output must use that bounded vocabulary; unsupported or uncertain relationships are emitted as unresolved evidence instead of free-form graph types.

## Full repository analysis

The Repository Deep Agent starts from broad repository inventory and searches for actual languages, frameworks, build systems, generated code, configuration, AI SDKs, HTTP clients, persistence, queues, decision paths and human-review paths. It may delegate parallel exploration to forked subagents. It then inspects material source directly before grounding final graph evidence.

Repository analysis is not gated on finding AI first. AI usage, sensitive data, external APIs and consequential actions are findings within the broader repository model.

## Cross-boundary linkage

Grounded evidence may connect client route → server route/handler; event producer → event → consumer; queue producer → queue → consumer; CQRS command/query publish → handler; import → dependency; value source → assignment/alias → parameter/return → transform → sink. Where a material continuation cannot be resolved, coverage stays partial and the frontier remains explicit.

## Sensitive data

Identifiers may retain bounded semantics (`Applicant.cccd` -> `PII.GOVERNMENT_ID`) while literal values are redacted/not persisted. Semantic categories may propagate only when supported by grounded flow evidence. `SECRET` remains distinct from personal/sensitive human data.

## Investigation behavior

During repository analysis the agent uses the repository itself as the working database and may use Codebase Memory for navigation. After persistence, downstream per-rule analysis and display may consume the sanitized Program Evidence Graph as a compact compatibility artifact, but claims that require source grounding must preserve direct source anchors and coverage limitations.

Retired custom repository graph query tools are not model-callable runtime tools. Native Deep Agents filesystem/search/shell/subagent capabilities are the primary repository exploration surface.

## Persistence

`TechnicalEvidenceReport.evidencePayload` carries the sanitized agent-derived Program Evidence Graph and repository-analysis provenance. Current tool provenance includes Deep Agents, LCSP Agent Runtime, and `repository-analysis` version/config hash. Downstream code consumes this contract without depending on the removed static-scanner implementation.
