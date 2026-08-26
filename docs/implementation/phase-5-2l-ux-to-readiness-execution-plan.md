# Phase 5.2L UX-to-Readiness Execution Plan

## Status

AUTHORITATIVE COORDINATION PLAN — DOCUMENTATION AND PLANNING ONLY

```text
UX_REBASE_PENDING_AFTER_DOC_PRUNING
CANONICAL_EPICS_AND_STORIES_MISSING
IMPLEMENTATION_READINESS_NOT_CERTIFIED
IMPLEMENTATION_NOT_AUTHORIZED
```

## Purpose

Define the ordered plan for moving LCSP from the pruned Phase 5.2L authority set to canonical UX, canonical epics/stories, implementation readiness, and later sprint execution.

This document does not authorize application code, tests, CI/CD, Docker, deployment, or sprint execution.

## Template Basis

This plan follows the active BMAD/WDS documentation guidance researched from:

- `_bmad/_config/bmad-help.csv`: BMAD phase order and required gates.
- `_bmad/wds/data/agent-guides/saga/resources/project-brief.template.md`: strategic foundation and next-step structure.
- `_bmad/wds/data/agent-guides/saga/strategic-documentation.md`: purpose, evidence, naming, quality checklist, and living-document rules.
- `_bmad/wds/data/agent-guides/freya/agentic-development.md`: traceable implementation handoff and fresh-context task design.

LCSP project constraints override generic WDS archive guidance: active history is not kept in a repository archive directory; git history is the historical record.

## Current Position

LCSP has completed Phase 5.2L active-document consolidation and authority pruning. The active documentation set is limited to product, specs, architecture/ADR, implementation, and `docs-vn`.

The previous UX artifact was removed from the active documentation set during pruning. UX must be rebased or regenerated from the current authority set before epics/stories can be created.

## Required BMAD Sequence

| Order | Gate | Skill | Menu | Required | Output |
|---:|---|---|---|---|---|
| 1 | Rebase or regenerate UX | `bmad-ux` | `[CU] Create UX` | Recommended before stories | canonical UX artifact |
| 2 | Create epics and stories | `bmad-create-epics-and-stories` | `[CE] Create Epics and Stories` | Yes | canonical epics/stories |
| 3 | Check implementation readiness | `bmad-check-implementation-readiness` | `[IR] Check Implementation Readiness` | Yes | readiness report |
| 4 | Start sprint planning only after readiness | `bmad-sprint-planning` | `[SP] Sprint Planning` | Yes for implementation | sprint status |

Recommended: run each BMAD skill in a fresh context window and load this plan plus the task list before starting.

## Authority Inputs

| Input Area | Required Active Docs |
|---|---|
| Product strategy | `docs/product/system-context.md`, `docs/product/product-brief.md`, `docs/product/prd.md` |
| Business rules | `docs/product/business-rules.md` |
| UC/FR/NFR/AC | `docs/specs/use-cases.md`, `docs/specs/functional-requirements.md`, `docs/specs/non-functional-requirements.md`, `docs/specs/acceptance-criteria-catalog.md` |
| Domain behavior | `docs/specs/assessment-lifecycle-spec.md`, `docs/specs/domain-state-machines.md`, `docs/specs/event-catalog.md`, domain specs |
| Architecture | `docs/architecture/architecture.md`, `docs/architecture/adr/architecture-decision-records.md`, active ADRs |
| Implementation boundaries | `docs/implementation/README.md`, implementation workstream specs |
| Traceability | `docs/specs/requirements-traceability-summary.md`, `docs/specs/requirements-traceability-matrix.md` |

## Workstream Plan

### 1. UX Rebase

Goal: produce canonical UX from the pruned authority set without reintroducing removed flows.

Required UX constraints:

- Manager golden path from assessment creation to audit export.
- Optional Developer task path with no structured attestation.
- Citation UX must distinguish `PRIMARY_MATCH`, `PARENT_CONTEXT`, and `REFERENCED_CONTEXT`.
- Corpus version and effective-date warnings must be visible where legally relevant.
- Citation references outside the retrieved allowlist must not be shown as valid citations.
- No customer-facing legal corpus administration screens in MVP.
- No manual technical evidence JSON upload, Local/CI report upload, structured attestation, direct regulator submission, formal legal opinion, or compliance certification flow.

Exit criteria:

- UX artifact exists in an approved active location.
- UX states map to UC, FR, AC, NFR, domain states, and implementation boundaries.
- Traceability summary can replace `UX_REBASE_PENDING_AFTER_DOC_PRUNING` with a reviewed UX marker.

### 2. Epics and Stories

Goal: create implementation-sized stories only after UX is canonical.

Required story properties:

- Each story traces to UC, FR, AC, relevant NFR, UX state, domain state, implementation area, and failure/recovery behavior.
- Each story states non-goals and removed concepts it must not reintroduce.
- Each story has verification notes suitable for future code/test work.
- Technical decisions that remain open must be explicit dependencies, not hidden assumptions.

Exit criteria:

- Canonical epics/stories exist.
- Story traceability is assessable.
- No story references deleted/pruned docs as authority.

### 3. Implementation Readiness

Goal: certify alignment before any implementation sprint.

Readiness must check:

- PRD, UX, architecture, ADRs, epics/stories, specs, and implementation docs are mutually consistent.
- RBAC, automatic trusted scan initiation, Python Worker Platform, ChromaDB vectorless legal retrieval, and scanner toolchain decisions are reflected in story scope.
- Open technical decisions are either closed or carried as explicit pre-implementation dependencies.
- Story coverage is not inferred from implementation docs alone.

Exit criteria:

- `bmad-check-implementation-readiness` produces a ready result.
- `IMPLEMENTATION_NOT_AUTHORIZED` can be replaced only by an explicit readiness-approved marker.

### 4. Sprint Planning

Goal: create sprint execution state after readiness is certified.

Sprint planning must not begin while:

- UX is missing or unreviewed.
- Canonical epics/stories are missing.
- Story traceability is not assessable.
- Implementation readiness is not certified.

## Open Decision Dependencies

| Dependency | Required Before |
|---|---|
| RBAC engine/topology, policy storage, cache, invalidation, and fail-closed behavior | story ready / implementation readiness |
| Automatic scan trigger idempotency, retry/DLQ, replay authority, and operator recovery | story ready / implementation readiness |
| Scanner tool failure severity and tool version/config/ruleset hash policy | story ready / implementation readiness |

## Quality Checklist

- [ ] Uses specific filenames and active doc paths.
- [ ] Does not reference pruned directories as authority.
- [ ] Separates planning from implementation authorization.
- [ ] Preserves Phase 5.2L removed/superseded boundaries.
- [ ] Provides clear gate order and exit criteria.
- [ ] Can be used in a fresh BMAD context window.
