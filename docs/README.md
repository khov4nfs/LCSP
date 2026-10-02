# LCSP Documentation Start Here

## Purpose

This is the starting point for developers, reviewers, UX, and story planning. Active documents describe the A-to-Z runnable MVP after Phase 5.2L correction, not production deployment, customer onboarding, legal certification, formal legal opinion, regulator submission, or completed implementation readiness.

## Current Planning Status

```text
CONSOLIDATION_PASS_APPLIED
PROJECT_OWNER_DOC_REMEDIATION_APPROVED
SCANNER_BEHAVIOR_AUTHORITY_CONSOLIDATED
CHROMADB_VECTORLESS_DOMAIN_CONTRACT_ALIGNED
UX_ARTIFACT_REMOVED_FROM_ACTIVE_DOC_SET
PYTHON_WORKER_PACKAGE_TOPOLOGY_LOCKED
AUDIT_EXPORT_SYNC_API_BOUNDARY_LOCKED
UX_REBASE_PENDING_AFTER_DOC_PRUNING
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
STORY_TRACEABILITY_PENDING
IMPLEMENTATION_NOT_AUTHORIZED
```

## Required Reading Order

1. [product/system-context.md](./product/system-context.md)
2. [product/product-brief.md](./product/product-brief.md)
3. [product/version-history.md](./product/version-history.md)
4. [product/prd.md](./product/prd.md)
5. [product/business-rules.md](./product/business-rules.md)
6. [specs/use-cases.md](./specs/use-cases.md)
7. [specs/functional-requirements.md](./specs/functional-requirements.md)
8. [specs/non-functional-requirements.md](./specs/non-functional-requirements.md)
9. [specs/acceptance-criteria-catalog.md](./specs/acceptance-criteria-catalog.md)
10. [architecture/architecture.md](./architecture/architecture.md)
11. [architecture/adr/architecture-decision-records.md](./architecture/adr/architecture-decision-records.md)
12. [implementation/README.md](./implementation/README.md)
13. [implementation/phase-5-2l-ux-to-readiness-execution-plan.md](./implementation/phase-5-2l-ux-to-readiness-execution-plan.md)
14. [implementation/phase-5-2l-ux-to-readiness-task-list.md](./implementation/phase-5-2l-ux-to-readiness-task-list.md)
15. [implementation/phase-5-2l-ux-to-readiness-implementation-guide.md](./implementation/phase-5-2l-ux-to-readiness-implementation-guide.md)
16. [docs-vn/README.md](../docs-vn/README.md)

UX review should focus on product, use cases, FR/NFR, acceptance criteria, domain specs and ADR constraints. Engineering work additionally reads architecture and implementation docs after implementation readiness is certified.

## Single Sources of Truth

| Concern                                  | Authoritative Document                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product scope and actors                 | `product/system-context.md`, `product/product-brief.md`, `product/prd.md`                                                                                                                    |
| Product / architecture evolution history | `product/version-history.md`                                                                                                                                                                 |
| Business rules                           | `product/business-rules.md`                                                                                                                                                                  |
| Canonical requirements                   | `specs/functional-requirements.md`, `specs/non-functional-requirements.md`                                                                                                                   |
| Use cases and user flows                 | `specs/use-cases.md`, `specs/user-task-flows.md`                                                                                                                                             |
| Acceptance criteria                      | `specs/acceptance-criteria-catalog.md`                                                                                                                                                       |
| Traceability                             | `specs/requirements-traceability-summary.md`, `specs/requirements-traceability-matrix.md`                                                                                                    |
| System components                        | `architecture/architecture.md`, active ADRs                                                                                                                                                  |
| End-to-end runtime                       | `specs/domain-state-machines.md`, `specs/event-catalog.md`, `implementation/`                                                                                                                |
| Assessment lifecycle                     | `specs/assessment-lifecycle-spec.md`                                                                                                                                                         |
| Repository analysis                     | architecture/repository-deep-agent-analysis.md, ../deepagents/instructions.md |
| Build details                            | `implementation/`                                                                                                                                                                            |
| UX-to-readiness coordination             | `implementation/phase-5-2l-ux-to-readiness-execution-plan.md`, `implementation/phase-5-2l-ux-to-readiness-task-list.md`, `implementation/phase-5-2l-ux-to-readiness-implementation-guide.md` |
| Physical persistence                     | `implementation/persistence-implementation.md`                                                                                                                                               |
| Queues/outbox                            | `implementation/queue-implementation.md`                                                                                                                                                     |

## Documentation Layers

```text
product/                        product purpose, actors, business rules, version history
specs/                          canonical behavior and requirements
architecture/                   components and decisions
implementation/                 build/configuration specifications
docs-vn/                        Vietnamese summary and review notes
```

Historical material remains available through git history, not as active documentation authority, except for the curated architectural evolution summary in `product/version-history.md`.

## Active MVP Runtime Shape

```text
apps/api                 NestJS API synchronous control plane
apps/web                 Manager web UX
deepagents      native Deep Agents / LangGraph runtime for async workloads
LCSP Docker sandbox      durable repository-backed assessment runtime
PostgreSQL + ChromaDB legal index
RabbitMQ
S3-compatible object storage
real LLM provider for A-to-Z acceptance
```

Node.js downstream domain workers are `SUPERSEDED_FOR_ACTIVE_MVP`. Node.js remains valid for the NestJS API, web, tooling, and shared runtime packages; repository analysis is owned by the LCSP Repository Deep Agent.

## Phase 5.2L Locked Corrections

- RBAC is the authorization source of truth. Roles may remain only as subject attributes, grouping labels, or policy templates; roles are not the final authorization authority.
- Structured attestation is `SUPERSEDED_FOR_ACTIVE_MVP` and removed from active MVP use cases, requirements, UX, entities, events, audit/report dependencies, and delivery tasks.
- Compliance certification, formal legal opinion, direct regulator submission, and `FR-051` manual technical evidence JSON upload are `REMOVED_FROM_PRODUCT`.
- `FR-050` no longer means Local/CI scanner report upload. It is redefined as `AUTOMATIC_TRUSTED_SCAN_INITIATION`.
- All asynchronous domain workloads belong to the Python Worker Platform.
- Repository analysis uses the full Deep Agents filesystem/shell/subagent harness. Codebase Memory MCP is optional structural memory; direct repository source is authoritative.

## Repository Analysis Ownership

| Concern | Owner |
| --- | --- |
| Trusted scan trigger/job query | NestJS API synchronous control plane |
| Assessment repository working database | LCSP Docker sandbox keyed by durable LangGraph thread |
| Repository exploration and evidence derivation | Repository Deep Agent |
| Structural graph/index assistance | Codebase Memory MCP 0.11.0 |
| Evidence graph / source anchors / coverage / AI gate | Repository Deep Agent structured result |
| Persistence and downstream compatibility | Existing scan/evidence APIs |

## Legal Corpus UX Boundary

Corpus ingestion, review, approval, and index build are internal operations/API/CLI for MVP. `bmad-ux` designs the Manager product experience; it does not create customer-facing corpus administration screens.

## Planned Local Development Commands

These commands are contracts for the future implementation and are not evidence that code already exists:

```text
# infrastructure and Node services
npm install
npm run db:generate
npm run db:migrate
npm run dev:api
npm run dev:web

# Native Deep Agents / LangGraph local runtime
cd deepagents
uv sync --frozen
uv run --extra dev langgraph dev --no-browser --no-reload --allow-blocking
uv run pytest

# Node runtime
cd ..
pnpm install --frozen-lockfile
pnpm run build:runtime-packages
pnpm run typecheck

# integrated validation after implementation
npm run test
npm run smoke:a-to-z
```

An A-to-Z acceptance run additionally requires:

- real PostgreSQL/RabbitMQ;
- real S3-compatible object storage;
- validated official legal source snapshots and approved corpus version;
- completed ChromaDB vectorless legal index;
- configured real LLM provider/model;
- golden repository fixture;
- audit/export verification.

## Ready-to-Code Rule

Coding begins only after canonical UX and epics/stories exist and `bmad-check-implementation-readiness` certifies the remediated set. Until then:

```text
IMPLEMENTATION_NOT_AUTHORIZED
SPRINT_EXECUTION_NOT_AUTHORIZED
```
