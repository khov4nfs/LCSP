# Sprint Change Proposal - LCSP-141 Conflict Resolution

Date: 2026-07-22
Project: LCSP — Legal Compliance Support Platform
Change scope: Minor / Direct Adjustment

## 1. Issue Summary

LCSP-141 (`MW-web-004: Conflict Resolution Page`) exposed a mismatch across implementation artifacts:

- The web task needs to know whether authorization should use `conflict:read` + `conflict:resolve` or `conflict:finalize`.
- The current API implementation uses `conflict:read` for listing conflicts and `conflict:resolve` for resolving/dismissing conflicts.
- `conflict:finalize` exists in RBAC contracts/Manager policy but has no active reconciliation endpoint in the current page flow.
- Story 5.3 describes richer guided resolution behavior than the current binary API supports.

## 2. Impact Analysis

Epic impact: Epic 5 remains valid. No epic reordering or MVP rollback is required.

Story impact:

- Story 5.3 remains `ready-for-dev`, but its immediate web task must be scoped to the active API contract.
- Rich guided-resolution behavior is a follow-up API/contract expansion unless added before implementation.

Artifact impact:

- `docs/implementation/tasks/modules/web/04-conflict-resolution-page.md` must clarify authorization, navigation, dismiss semantics, all-resolved UX and unauthorized UX.
- `docs/implementation/tasks/modules/reconciliation/03-resolve-conflict-endpoint.md` must clarify that dismiss requires a reason.
- `docs/implementation-artifacts/5-3-manager-conflict-resolution.md` must record the course-correction boundary.

Technical impact:

- Current backend already uses `RBAC_ACTIONS.conflictRead` for `GET /assessments/:assessmentId/conflicts`.
- Current backend already uses `RBAC_ACTIONS.conflictResolve` for `PATCH /assessments/:assessmentId/conflicts/:conflictId/resolve`.
- Backend currently allows missing `resolution_note`; implementing the corrected API contract requires adding validation for `DISMISSED`.

## 3. Recommended Approach

Use Direct Adjustment.

Decisions:

- Use `conflict:read` for view/list access.
- Use `conflict:resolve` for both resolve and dismiss submits.
- Do not use `conflict:finalize` for LCSP-141.
- Manager opens conflict resolution from the Workspace assessment list/card.
- After the last conflict is cleared, show an all-resolved state and let the backend async event advance the workflow.
- Treat `DISMISSED` as final for the current conflict/reconciliation version; require a reason.
- Use localized friendly unauthorized copy for 401/403/404 states.

Rationale: This keeps LCSP-141 implementable against the active API while preserving Story 5.3's richer behavior as an explicit follow-up instead of silently overpromising it in the page task.

## 4. Detailed Change Proposals

Web task `MW-web-004`:

- Add explicit RBAC mapping for `conflict:read` and `conflict:resolve`.
- Mark `conflict:finalize` out of scope for this page.
- Add Workspace assessment list/card as the primary navigation entry.
- Require a reason for `DISMISSED`.
- Define all-resolved behavior as in-place status plus optional next-step CTA when downstream state is available.
- Define friendly localized unauthorized UX.

API task `MW-rec-003`:

- Require non-empty `resolution_note` for `DISMISSED`.
- Keep `RESOLVED` note optional.
- Document that `DISMISSED` is not a defer action.

Story artifact `5-3-manager-conflict-resolution`:

- Record this course correction at the top of the story.
- Keep guided choices/stale-version/downstream impact as an explicit follow-up unless the API is expanded.

## 5. Implementation Handoff

Route to: Developer agent.

Required follow-up implementation:

- Update API validation so `DISMISSED` without a non-empty trimmed reason returns `422 SCHEMA_INVALID`.
- Implement LCSP-141 web page against `conflict:read` and `conflict:resolve`.
- Add i18n keys for conflict page labels, validation, unauthorized states, and all-resolved state.
- Add tests for Developer/unauthorized access, dismiss reason validation, all-resolved UX, and no raw source display.

Success criteria:

- LCSP-141 can be implemented without ambiguity about RBAC action choice.
- Dismiss semantics are auditable and not confused with defer.
- Page navigation and post-resolution behavior match the active MVP workflow gate.
