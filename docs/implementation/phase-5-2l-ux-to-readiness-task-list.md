# Phase 5.2L UX-to-Readiness Task List

## Status

ACTIONABLE PLANNING TASK LIST — NOT SPRINT EXECUTION

## Purpose

Track the concrete documentation and BMAD tasks needed to move LCSP from pruned active docs to implementation readiness.

Task IDs are stable for coordination. Completing this checklist does not itself authorize implementation; readiness certification is still required.

## Task Status Legend

| Status | Meaning |
|---|---|
| `TODO` | Not started |
| `IN_PROGRESS` | Being worked |
| `BLOCKED` | Cannot continue without an upstream artifact or decision |
| `DONE` | Completed and validated |

## Current Task Board

| ID | Status | Task | Owner/Skill | Inputs | Output |
|---|---|---|---|---|---|
| UX-001 | TODO | Rebase or regenerate canonical UX from pruned authority set | `bmad-ux` `[CU]` | product, specs, architecture, implementation docs | canonical UX artifact |
| UX-002 | TODO | Validate UX excludes removed/superseded flows | UX review | `FR-045`, `FR-046`, `FR-051`, `FR-052`, BR removed/superseded rows | UX exclusion checklist |
| UX-003 | TODO | Map UX states to UC/FR/AC/NFR/domain states | UX + traceability | UX artifact, traceability matrix | UX traceability rows |
| UX-004 | TODO | Review citation and legal provenance UX | UX + legal domain review | legal matching, corpus source, ChromaDB retriever docs | citation UX notes |
| ST-001 | BLOCKED | Create canonical epics and stories | `bmad-create-epics-and-stories` `[CE]` | approved UX | epics/stories |
| ST-002 | BLOCKED | Add story-level traceability | story planning | epics/stories, requirements matrix | UC -> FR -> AC -> NFR -> UX -> domain -> implementation map |
| ST-003 | BLOCKED | Mark story dependencies for open technical decisions | story planning | ADRs, architecture, implementation docs | explicit dependency notes |
| RD-001 | BLOCKED | Run implementation readiness check | `bmad-check-implementation-readiness` `[IR]` | PRD, UX, architecture, epics/stories | readiness report |
| RD-002 | BLOCKED | Resolve readiness findings | relevant BMAD skill | readiness report | corrected docs |
| SP-001 | BLOCKED | Start sprint planning | `bmad-sprint-planning` `[SP]` | ready result | sprint status |

## UX Task Details

### UX-001 — Rebase or Regenerate Canonical UX

Required scope:

- Manager assessment workspace.
- WizardProfile creation and submission.
- Repository connection and trusted scan initiation.
- Scan status, evidence review, and rerun states.
- Reconciliation and conflict resolution.
- VerifiedProfile review/approval.
- Legal matching and classification result review.
- Gap analysis and document generation.
- Audit export.
- Optional Developer task and redacted finding review.

Required exclusions:

- No structured attestation screen.
- No manual technical evidence JSON upload.
- No Local/CI scanner report upload.
- No direct regulator submission.
- No formal legal opinion or certification workflow.
- No customer-facing legal corpus administration.

### UX-004 — Citation and Legal Provenance UX

The UX must show:

- legal document title;
- article/clause/point locator;
- corpus version;
- effective date/status;
- `PRIMARY_MATCH`, `PARENT_CONTEXT`, and `REFERENCED_CONTEXT` distinction;
- warning/degraded state for expired or unavailable legal source context;
- rejection or blocked state for citations outside retrieved allowlist.

## Story Task Details

### ST-002 — Story-Level Traceability

Each story must include:

```text
UC:
FR:
AC:
NFR:
UX state:
Domain state:
Command/event:
Implementation doc:
Failure/recovery behavior:
Removed concepts guarded:
```

### ST-003 — Technical Decision Dependencies

Stories must not silently assume decisions for:

- RBAC engine and policy topology;
- trusted scan trigger retry/DLQ/idempotency;
- scanner tool failure severity and tool version/config/ruleset hash policy.

If unresolved, mark as `TECHNICAL_DECISION_REQUIRED_BEFORE_READY`.

## Verification Tasks

Run these checks after updating active docs:

```text
rg stale active references
rg old UX draft markers and deleted planning paths
git diff --check
```

Expected result:

```text
NO_STALE_ACTIVE_REFERENCES
NO_OLD_UX_MARKER_RESIDUE
DIFF_CHECK_CLEAN
```

## Completion Criteria

```text
UX_CANONICAL_AND_REVIEWED
CANONICAL_EPICS_AND_STORIES_CREATED
STORY_TRACEABILITY_ASSESSABLE
IMPLEMENTATION_READINESS_CERTIFIED
SPRINT_PLANNING_AUTHORIZED
```
