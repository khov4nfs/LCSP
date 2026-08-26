---
task_id: MW-web-002
module: web
runtime: nextjs
priority: P0
status: DONE
epic_story: 1.4
depends_on:
  - auth-workspace/06-get-workspace-endpoint.md
  - web/01-auth-sign-in-page.md
---

# Workspace Dashboard Page

## Outcome

Show the Manager's organization workspace: org name, membership role, assessment list, and navigation. Uses `GET /workspace` for session context and `GET /assessments` for assessment list. `granted_actions` used to show/hide actions (UI hint — not authoritative).

## Module Files

| File | Action | Notes |
|---|---|---|
| `apps/web/src/app/workspace/page.tsx` | Create | Workspace dashboard page |
| `apps/web/src/features/workspace/components/organisms/workspace-sidebar.tsx` | Create | Dashboard sidebar composition using shadcn `Sidebar` |
| `apps/web/src/features/workspace/components/organisms/assessment-list.tsx` | Create | Assessment card list |
| `apps/web/src/features/workspace/components/molecules/workspace-header.tsx` | Create | Org name + role display |
| `apps/web/src/lib/api/workspace-client.ts` | Create | `GET /workspace` + `GET /assessments` wrappers |

## UI Components

| Component | Notes |
|---|---|
| shadcn `Sidebar` dashboard shell | Primary workspace navigation |
| Org name + Manager role badge | From `GET /workspace` response |
| Assessment work-object cards | Name, status, wizard_status, created_at |
| "Create Assessment" button | Visible if `assessment:create` in `granted_actions` |
| shadcn `Skeleton` loading state | While fetching assessments |
| shadcn `Empty` state | No-assessment state resolved through i18n keys |

## Business Rules

1. Fetch workspace context and assessment list on page mount.
2. Show `granted_actions` from workspace response to conditionally render "Create Assessment" button. This is UI-only hint — button click is still RBAC-gated at server.
3. Assessment cards: show `status` and `wizard_status` in business language (not enum values).
4. Status labels shown in business language per the Status Label Mapping table below (e.g. `WIZARD_IN_PROGRESS` → "In Progress", `WIZARD_SUBMITTED` → "Wizard Complete").
5. Redirect to `/sign-in` if workspace fetch returns 401.
6. Redirect to `/mfa/verify` if workspace fetch returns `MFA_REQUIRED`.

## Status Label Mapping

| API value | UI label |
|---|---|
| `WIZARD_IN_PROGRESS` | In Progress |
| `WIZARD_SUBMITTED` | Wizard Complete |
| `EVIDENCE_REQUIRED` | Evidence Needed |
| `SCAN_IN_PROGRESS` | Scan Running |
| `CLASSIFICATION_LOCKED` | Classification Locked |
| `READY_FOR_REVIEW` | Ready for Review |

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Manager with assessments | Cards rendered |
| T02 | No assessments | Empty state message |
| T03 | `assessment:create` in granted_actions | Create button visible |
| T04 | `assessment:create` not in granted_actions | Create button hidden |
| T05 | 401 from workspace | Redirect to sign-in |
| T06 | `MFA_REQUIRED` from workspace | Redirect to MFA verify |
| T07 | Status enum values not shown to user | UI label mapping verified |

## Definition of Done

- Workspace and assessment list rendered.
- Status labels use business language.
- Auth error redirects handled.
- `granted_actions` used for UI-only conditional rendering (server enforces RBAC independently).
