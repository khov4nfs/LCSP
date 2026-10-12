# Phase 5.2L UX-to-Readiness Implementation Guide

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

## Status

IMPLEMENTATION-HANDOFF GUIDE — PRE-CODE

```text
IMPLEMENTATION_NOT_AUTHORIZED
SPRINT_EXECUTION_NOT_AUTHORIZED
```

## Purpose

Give future BMAD, UX, story, and engineering sessions a clean operating guide for using the pruned LCSP documentation set without reintroducing obsolete documents or superseded product behavior.

This guide is for documentation and planning implementation. It is not a code implementation guide and must not be used to start development before readiness certification.

## Operating Rules

1. Start from `docs/README.md`.
2. Use only active docs under:
   - `docs/product/`
   - `docs/specs/`
   - `docs/architecture/`
   - `docs/implementation/`
   - `docs-vn/`
3. Treat git history as historical evidence.
4. Do not recreate the deleted archive, planning, code-map, change-control, review, or execution-blueprint directories as active authority.
5. Use fresh context windows for major BMAD steps.
6. Keep every new document's purpose, status, inputs, outputs, and non-claims explicit.

## Fresh-Context Startup Packet

Every new BMAD session should load:

```text
docs/README.md
docs/product/system-context.md
docs/product/product-brief.md
docs/specs/requirements-traceability-summary.md
docs/implementation/phase-5-2l-ux-to-readiness-execution-plan.md
docs/implementation/phase-5-2l-ux-to-readiness-task-list.md
```

Add workstream-specific docs:

| Workstream | Add |
|---|---|
| UX | `docs/specs/use-cases.md`, `docs/specs/user-task-flows.md`, `docs/specs/acceptance-criteria-catalog.md`, domain specs |
| Stories | approved UX artifact, `docs/specs/requirements-traceability-matrix.md`, implementation docs |
| Readiness | PRD, UX, architecture, ADRs, epics/stories, specs, implementation docs |

## Document Creation Rules

### Required Header

Every new coordination document should start with:

```markdown
# [Specific Topic]

## Status

[AUTHORITY LEVEL OR COORDINATION ROLE]

## Purpose

[Why this file exists and what it does not authorize]
```

### Required Sections

Use these sections unless there is a clear reason not to:

```markdown
## Inputs
## Outputs
## Scope
## Non-Goals
## Traceability
## Tasks or Steps
## Verification
## Completion Criteria
```

### Naming Rules

Use specific names:

- `phase-5-2l-ux-to-readiness-execution-plan.md`
- `phase-5-2l-ux-to-readiness-task-list.md`
- `phase-5-2l-ux-to-readiness-implementation-guide.md`

Avoid generic names:

- `plan.md`
- `tasks.md`
- `implementation.md`
- `notes.md`

## BMAD Skill Routing

### Optional Review Before UX

`[CK] Checkpoint` — `bmad-checkpoint-preview`

Use if the team wants a human review of the pruned authority set before UX work.

### Next Recommended Required Flow

`[CU] Create UX` — `bmad-ux`

Use to rebase or regenerate UX from the pruned authority set.

### Required After UX

`[CE] Create Epics and Stories` — `bmad-create-epics-and-stories`

Use only after UX is reviewed and accepted.

### Required Before Implementation

`[IR] Check Implementation Readiness` — `bmad-check-implementation-readiness`

Use to certify PRD, UX, architecture, ADRs, epics/stories, specs, and implementation docs are aligned.

### Required To Start Execution

`[SP] Sprint Planning` — `bmad-sprint-planning`

Use only after readiness certification.

## Traceability Contract

Every downstream UX state and story must map to:

```text
UC
FR
AC
NFR
Domain state
Command/event where applicable
Implementation doc
Failure/recovery behavior
```

No story should rely only on a narrative PRD alias or implementation document. Canonical IDs live in `docs/specs/`.

## Removed Concept Guardrails

Do not reintroduce:

- structured technical attestation as active input;
- manual technical evidence JSON upload;
- Local/CI scanner report upload;
- role-based authorization as final authority;
- Node.js downstream domain workers;
- pgvector legal retrieval as active MVP path;
- customer-facing legal corpus administration;
- direct regulator submission;
- compliance certification;
- formal legal opinion product behavior.

## Verification Commands

Run from repository root:

```text
rtk rg -n "[deleted authority path pattern]" docs docs-vn -g "*.md"
rtk rg -n "[old UX draft marker pattern]" docs docs-vn -g "*.md"
rtk git diff --check
rtk git status --short --branch
```

Expected:

```text
No stale active-reference matches
No whitespace/check errors
Only intentional documentation changes
```

## Handoff Note

Until `bmad-check-implementation-readiness` returns ready, the authoritative implementation marker remains:

```text
IMPLEMENTATION_NOT_AUTHORIZED
SPRINT_EXECUTION_NOT_AUTHORIZED
```
