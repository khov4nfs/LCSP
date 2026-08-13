---
title: "MW-web-008 Developer Scoped Task Workspace"
type: "feature"
created: "2026-07-19T00:00:00+07:00"
status: "blocked"
review_loop_iteration: 0
followup_review_recommended: false
context:
  - "{project-root}/docs/project-context.md"
  - "{project-root}/docs/implementation-artifacts/epic-1-context.md"
  - "{project-root}/docs/implementation/tasks/modules/web/08-developer-scoped-task-workspace.md"
warnings: []
---

<intent-contract>

## Intent

**Problem:** Developers need a safe invitation-acceptance flow and a task-scoped workspace that exposes only assigned redacted technical findings. The current Web application has neither surface, while the active brief requires pre-acceptance scope disclosure and immediate, understandable revocation behavior.

**Approach:** Reuse the centered Auth Surface and standard workspace shell, place session-token handling behind Next.js BFF routes, and render only whitelisted Developer actions plus location-free finding view models. Resume implementation only after the missing backend metadata contracts are explicitly defined and authorized.

## Boundaries & Constraints

**Always:** Keep the invitation token confined to the acceptance request; keep the session token in the existing `lcsp_session` httpOnly cookie; treat API capabilities as hints and PBAC as authority; whitelist only `DEVELOPER_ALLOWED_ACTIONS`; remove `file_path` and `line_number` from the UI view model; distinguish revoked session `401 SESSION_INVALID` from narrowed scope `403 PBAC_DENIED`; localize all customer-facing copy in English and Vietnamese.

**Block If:** No safe API contract provides organization, assessment, and granted-scope metadata before acceptance; acceptance cannot identify the scoped assessment for redirect; the post-acceptance workspace cannot obtain organization and assessment labels plus current granted actions; or a protected Next.js BFF route is not authorized to exchange the httpOnly session cookie for the API Bearer header.

**Never:** Decode or infer claims from the opaque invitation token; expose the session token to client JavaScript or a URL; fabricate organization/assessment labels; render arbitrary action strings; show source, file paths, line numbers, Manager-only actions, or inaccessible findings; broaden a Web-scoped task into backend contract changes without explicit authority.

## I/O & Edge-Case Matrix

| Scenario           | Input / State                                                                 | Expected Output / Behavior                                                                                           | Error Handling                             |
| ------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Valid invitation   | Valid token, 1-100 character display name, password of at least 12 characters | Preview exact organization/assessment/scope, accept once, set httpOnly session cookie, redirect to scoped assessment | No error expected                          |
| Invalid invitation | Unknown, expired, consumed, or non-approved token                             | Show one non-leaking invalid-link message                                                                            | Do not distinguish invalid causes          |
| Existing account   | Invitation email already belongs to a user                                    | Offer sign-in link                                                                                                   | Map `EMAIL_ALREADY_EXISTS` only            |
| No evidence        | Authorized scope with no accepted report                                      | Show localized empty state                                                                                           | Treat `EVIDENCE_NOT_FOUND` as empty        |
| Revoked session    | Evidence request returns `401 SESSION_INVALID`                                | Remove protected content and redirect to sign-in                                                                     | Never retain findings                      |
| Narrowed scope     | Evidence request returns `403 PBAC_DENIED`                                    | Show inline revoked banner with no findings                                                                          | Do not redirect or expose policy internals |

</intent-contract>

## Code Map

- `apps/web/src/features/auth/components/organisms/sign-in-form.tsx` -- canonical React Hook Form, loading, root-error, and redirect behavior.
- `apps/web/src/app/api/auth/sign-in/route.ts` -- canonical BFF token stripping and session-cookie handling.
- `apps/web/src/features/workspace/components/organisms/workspace-dashboard.tsx` -- reusable workspace shell and protected-load state pattern.
- `apps/web/src/lib/api/workspace-client.ts` -- status-aware API outcome normalization.
- `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/accept-invitation.contract.ts` -- current accept response contract; lacks assessment/scope metadata.
- `apps/api/src/modules/evidence/application/contracts/evidence/evidence-detail.contract.ts` -- current evidence contract; lacks scope-summary metadata.
- `packages/contracts/src/pbac/developer-policy.ts` -- authoritative Developer action whitelist.

## Tasks & Acceptance

**Execution:**

- [ ] `docs/implementation/tasks/modules/auth-workspace/15-preview-developer-invitation-endpoint.md` -- complete MW-auth-015 and verify safe preview plus acceptance scope parity.
- [ ] `docs/implementation/tasks/modules/auth-workspace/16-developer-scoped-workspace-context-endpoint.md` -- complete MW-auth-016 and verify current labels/actions plus revocation behavior.
- [ ] `apps/web/src/app/api/auth/accept-invitation/route.ts` and protected assessment BFF route -- proxy API calls, set/read `lcsp_session`, and never serialize the session token to the browser.
- [ ] `apps/web/src/lib/api/auth-client.ts` and `apps/web/src/lib/api/evidence-client.ts` -- add typed, status-aware outcomes for acceptance, preview, evidence, empty, denied, and invalid-session states.
- [ ] `apps/web/src/app/(auth)/invite/accept/page.tsx` and auth feature files -- implement localized preview plus centered acceptance form with validation and safe errors.
- [ ] `apps/web/src/app/(workspace)/developer/assessments/[id]/page.tsx` and developer-task feature files -- implement scope summary, action whitelist, sanitized findings, empty, revoked, and loading states.
- [ ] `packages/i18n/src/types.ts` and English/Vietnamese page catalogs -- add strict message keys for both surfaces and all errors/states.
- [ ] `tests/story-1-5.web.test.ts` -- cover the complete matrix, token boundaries, redaction, action whitelist, and absence of Manager-only controls.

**Acceptance Criteria:**

- Given an unconsumed scoped invitation, when a Developer opens it, then organization, assessment, allowed scope, and expiry are visible before any account or membership mutation.
- Given successful acceptance, when the BFF receives the API result, then only the httpOnly cookie is persisted and navigation targets the exact scoped assessment.
- Given Developer-scoped evidence, when findings render, then location keys and Manager-only actions are absent from both the view model and DOM.
- Given revocation or policy narrowing, when the next protected request completes, then no stale finding remains visible and the correct 401-versus-403 experience is shown.

## Spec Change Log

## Review Triage Log

## Design Notes

The Web must consume display-safe metadata from an authoritative backend projection. IDs may be used for routing, but they are not acceptable substitutes for the organization and assessment labels promised by the task brief.

## Verification

**Commands:**

- `rtk pnpm exec node --test tests/story-1-5.web.test.ts` -- expected: invitation, redaction, revocation, and action-boundary cases pass.
- `rtk pnpm test:web` -- expected: all Web behavior tests pass.
- `rtk pnpm run typecheck` -- expected: Web, contracts, and i18n compile without errors.
- `rtk pnpm run lint` -- expected: lint and import-boundary checks pass.
- `rtk pnpm --filter @lcsp/web build` -- expected: Next.js production build succeeds.

## Auto Run Result

Status: blocked

Blocking condition: intent gaps in the authoritative backend/Web boundary. The current public acceptance API cannot preview an invitation or return its assessment scope, the evidence API cannot supply the required scope-summary labels/actions, and no protected evidence BFF route exists.

Evidence gathered:

- `AcceptInvitationResponse` contains `user_id`, `session_token`, `expires_at`, `organization_id`, `allowed_actions`, and `correlationId`, but no `assessment_id` or scope.
- `AcceptInvitationHandler` looks up the token directly as `authInvitation.id`; it is opaque and cannot be decoded safely.
- `EvidenceDetailDto` returns evidence data and `assessment_id`, but no organization name, assessment label, or granted actions.
- `GET /assessments/:id` requires `assessment:read`, which is not a Developer-allowed action.
- The browser cannot use the httpOnly session token for the NestJS Bearer header without a BFF/server-side proxy.

Resolution recorded 2026-07-19: backend expansion must ship as prerequisite tasks, not inside MW-web-008. MW-auth-015 defines the safe preview and acceptance-scope contracts; MW-auth-016 defines the authoritative post-acceptance scoped context. MW-web-008 remains blocked until both are done, then owns the protected Next.js BFF routes for preview, context, and evidence.
