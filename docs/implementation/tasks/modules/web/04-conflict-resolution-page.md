---
task_id: MW-web-004
module: web
runtime: nextjs
priority: P0
status: READY_FOR_DEV
epic_story: 5.3
depends_on:
  - reconciliation/02-list-conflicts-endpoint.md
  - reconciliation/03-resolve-conflict-endpoint.md
  - web/02-workspace-dashboard-page.md
---

# Conflict Resolution Page

## Outcome

Show Manager the list of pending reconciliation conflicts with Conflict Score, explanation, and evidence references. Manager can resolve or dismiss each conflict. Resolution is audited. No raw source code shown. No technical implementation terms.

## Course-Corrected Scope

This task implements the current reconciliation API surface for Story 5.3. The active web page uses:

- `conflict:read` to open/list conflicts through `GET /assessments/:id/conflicts`.
- `conflict:resolve` to submit both `RESOLVED` and `DISMISSED` through `PATCH /assessments/:assessmentId/conflicts/:conflictId/resolve`.

Do not gate this page or its actions with `conflict:finalize`. `conflict:finalize` is not part of the active LCSP-141 page flow; progression after the last conflict is handled by the API outbox event `event.reconciliation.all-conflicts-resolved`.

Story 5.3's richer guided-resolution behavior (choose/correct/mark unknown, stale-version rejection, downstream impact preview) remains a follow-up contract/API scope unless the reconciliation API is expanded before this task starts.

## Module Files

| File                                                                    | Action | Notes                                  |
| ----------------------------------------------------------------------- | ------ | -------------------------------------- |
| `apps/web/app/(workspace)/assessments/[id]/conflicts/page.tsx`          | Create | Conflict list page                     |
| `apps/web/app/(workspace)/assessments/[id]/conflicts/conflict-card.tsx` | Create | Per-conflict card with resolution form |
| `apps/web/lib/api/conflict-client.ts`                                   | Create | List + resolve API wrappers            |

## UI Components

| Component                | Notes                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Conflict card            | Type (business label), score (progress bar 0–100%), explanation, evidence refs (IDs only) |
| Conflict score indicator | Visual bar: 0% = low tension, 100% = high tension                                         |
| Resolution buttons       | "Mark as Resolved" + "Dismiss"                                                            |
| Resolution note          | Optional for `RESOLVED`; required for `DISMISSED`; max 2000 chars                         |
| "All resolved" banner    | Shown when no more PENDING conflicts                                                      |

## Conflict Type Labels (business language)

| API value                | UI label               |
| ------------------------ | ---------------------- |
| `evidence_contradiction` | Evidence Contradiction |
| `scope_mismatch`         | Scope Mismatch         |
| `unverifiable`           | Unverifiable Finding   |

## Business Rules

1. Fetch `GET /assessments/:id/conflicts?status=PENDING` on page load.
2. Page access requires `conflict:read`; submit action requires `conflict:resolve`.
3. Conflict score shown as percentage (0–100) with color: 0–40% green, 41–70% amber, 71–100% red.
4. `evidence_refs` shown as IDs only — no raw source or finding content.
5. Resolution form: dropdown `RESOLVED / DISMISSED` plus resolution note.
6. `DISMISSED` means the Manager intentionally clears this conflict for the current reconciliation version. It is not a "handle later" state. If the user wants to postpone, keep the conflict `PENDING`.
7. `DISMISSED` requires a business-language reason before submit. `RESOLVED` note remains optional unless backend contract changes.
8. After each submit: show a per-item success state/toast and refresh conflict list.
9. If the refreshed list is empty: show an all-resolved banner and keep the user on the page while the API outbox advances the assessment asynchronously. Do not force redirect immediately. If a downstream status/artifact becomes available, show a CTA to continue.
10. Primary navigation entry: Manager opens this route from the Workspace assessment list/card when an assessment has pending reconciliation conflicts. Assessment detail can link here later as a secondary entry. Do not add a separate global Conflict page for MVP.
11. Unauthorized UX:
    - `401`: redirect to sign-in with return URL.
    - `403`: show localized friendly copy: user does not have permission to resolve conflicts for this assessment; include CTA back to assessment list.
    - `404`: show generic not-found/out-of-organization state.
    - Do not render raw backend error codes such as `RBAC_DENIED` as customer-facing copy.
12. Non-Manager subjects cannot access this page (RBAC gated — will show 403).

## Test Cases

| ID  | Scenario                     | Expected                                                                        |
| --- | ---------------------------- | ------------------------------------------------------------------------------- |
| T01 | PENDING conflicts exist      | Cards shown with score and explanation                                          |
| T02 | Resolve a conflict           | Card disappears, list refreshes                                                 |
| T03 | All conflicts resolved       | "All Resolved" banner shown                                                     |
| T04 | Conflict score 0.9           | Red indicator shown                                                             |
| T05 | `evidence_refs` shown as IDs | No source code shown                                                            |
| T06 | Non-Manager accesses page    | 403 shown                                                                       |
| T07 | Dismiss without reason       | Submit blocked with localized validation message                                |
| T08 | Last conflict submitted      | Page stays open, shows all-resolved state and next-step CTA only when available |

## Definition of Done

- Conflict list with score and business-language explanation.
- Resolution form functional with audit trail.
- "All resolved" state handled.
- No raw source code or technical terms in UI.
- Navigation entry added from Manager workspace assessment list/card.
- `DISMISSED` reason required in UI.
- Unauthorized and validation copy resolved from `@lcsp/i18n`.
