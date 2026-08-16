# Program Evidence Graph Specification

## Status
AUTHORITATIVE — LCSP-999

## Purpose
`ProgramEvidenceGraph` is the immutable, source-grounded representation used for technical investigation. It is built for the whole statically resolvable repository before law-guided LLM investigation.

## Invariants

1. Scanner reads the selected commit-pinned snapshot only; customer code is never executed and dependencies are never installed.
2. Graph construction is independent of any legal rule and does not stop at an AI invocation.
3. Raw source/full AST/full prompt/secrets/literal personal data are not persisted. Source evidence is anchored by snapshot, commit, file, symbol, line range and source hash.
4. Dynamic/reflection/runtime-only behavior is represented as an explicit unresolved frontier; scanner never invents a target.
5. Graph artifacts are immutable per snapshot/schema/config and carry a deterministic graph hash.
6. Python Worker owns graph construction and traversal. TS/JS `ts-morph` runs only as a Python-owned subprocess.

## Semantic model

Required structural/data/control concepts include repository/file/module/package/dependency, class/interface/function/method, parameter/return, variable/property/DTO field, assignment/alias, call/argument, parser/serializer/validator/transform, branch/loop, HTTP route/request/response, event/queue/CQRS, persistence, external API/service, AI provider/invocation/input/output, business action/state change, human review/override, personal/sensitive data and explicit coverage gaps.

Canonical vocabulary is code-owned by `scanner/program_graph/vocabulary.py`. New node/edge values require schema/test updates; free-form LLM graph vocabulary is prohibited.

## Full repository scan

The scan first inventories and semantically extracts the repository. AI, sensitive data, external APIs and consequential actions are annotations/nodes discovered inside that graph, not triggers that decide whether the surrounding program will be scanned.

## Cross-boundary linkage

Static identifiers should connect client route → server route/handler; event producer → event → consumer; queue producer → queue → consumer; CQRS command/query publish → handler; import → dependency; value source → assignment/alias → parameter/return → transform → sink. Unresolved dynamic boundaries terminate certainty with a coverage limitation.

## Sensitive data

Identifiers retain semantics (`Applicant.cccd` -> `PII.GOVERNMENT_ID`) while literal values are redacted/not persisted. Semantic categories propagate through value-flow edges. `SECRET` is distinct from personal/sensitive human data.

## Query behavior

Python graph tools support forward/backward traversal, data paths, decision paths, human-control paths, symbol context, provider invocation discovery and bounded subgraphs. Query outputs include `truncated`, unresolved frontiers and evidence refs. Search hints/keywords locate candidates; they never prove a claim by themselves.

## Persistence

`TechnicalEvidenceReport.evidencePayload` may carry the sanitized Program Evidence Graph artifact or a future immutable artifact reference. Downstream code consumes the graph contract, not raw scanner implementation details.
