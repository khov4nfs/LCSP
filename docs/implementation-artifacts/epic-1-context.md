# Epic 1 Context: Secure Workspace and RBAC-Scoped Collaboration

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable Managers and optional Developer collaborators to authenticate, enter the correct organization workspace, and act only within tenant-scoped RBAC policy boundaries. This epic establishes the identity, authorization, audit, event, and worker foundations required for every later assessment workflow while preserving a Manager-only golden path that never depends on Developer participation.

## Stories

- Story 1.1: Approved Account Entry and Workspace Access
- Story 1.2: MFA, Session, Recovery, and Profile Safety
- Story 1.3: OAuth/OIDC Login Without Repository Authorization
- Story 1.4: Organization Membership and Manager Policy Scope
- Story 1.5: Optional Developer Invitation and Scoped Task Acceptance
- Story 1.6: Manager-Only Action Enforcement
- Story 1.7: RBAC Policy Runtime and Deny-on-Failure Contract
- Story 1.8: Foundational Audit, Outbox, and Event Contract
- Story 1.9: Python Worker Command and Event Platform Contract
- Story 1.10: TypeScript Contract, Localization, and Import Boundary Governance

## Requirements & Constraints

- Support approved registration, credential and OAuth/OIDC sign-in, MFA, session expiry/revocation, account recovery, profile controls, organization membership, member management, and Manager policy templates. Workspace data must remain unavailable until authentication and organization membership are confirmed.
- MFA secrets and provider tokens must never be stored or logged in plaintext. Reject invalid, expired, replayed, or rate-limited authentication attempts; OAuth/OIDC callbacks must validate redirect URI, state, nonce, issuer, audience, expiry, and safe account linking.
- OAuth/OIDC establishes LCSP identity only. It must not create repository authorization, repository tokens, repository connections, or scan permission.
- RBAC is the authorization source of truth; roles are subject attributes or templates, not authority by themselves. Enforce tenant scope for every protected read, write, action, download, export, internal call, and worker-triggered transition. Deny by default when policy storage, cache, evaluation, or required attributes are unavailable.
- Developer access is optional, task-scoped, expiring, and revocable. Invitations must bind organization, assigned task or assessment scope, allowed actions, and policy version. Developers may see only assigned surfaces and redacted findings and must never gain Manager-only authority. Revocation or invalid scope must immediately prevent data access.
- Safe denied and blocked responses expose stable title, detail, and next-action keys, never internal policy details. No inaccessible workspace data may be returned.
- Material authentication, authorization, invitation, delegation, and domain transitions must be audited with actor or system identity, organization/workspace scope, resource, action, result, policy version where relevant, correlation ID, and timestamp. Secrets, raw source, full prompts, tokens, and cross-tenant data must be omitted or redacted. Required audit evidence must never be silently dropped.
- Include negative tests for protected reads, writes, actions, and exports; expired/revoked/wrong-organization invitations; unavailable RBAC dependencies; revoked Developer scope during task execution; unsafe event payloads; duplicate/retried/replayed worker commands; and required audit/outbox write failures.

## Technical Decisions

- Use the Web frontend for workspace interactions, the NestJS API as the synchronous control plane and RBAC enforcement boundary, and the Python Worker Platform for bounded asynchronous workloads. API and worker runtimes must remain separable.
- RBAC evaluation inputs include actor or system principal, organization, resource, action, subject attributes, policy ID/version, and applicable state gates. Record allow/deny outcome, stable reason code, policy version, and correlation ID; preserve historical policy versions and invalidate caches when versions change.
- Commit domain state, required audit records, and outbox events transactionally where supported. Events use versioned schemas and safe metadata including aggregate and organization identifiers, optional assessment identifier, correlation and causation IDs, actor, result, and redaction status.
- Worker commands use canonical inbox/outbox persistence, organization and assessment scope, idempotency keys, lease/lock timeouts, retry budgets, dead-letter handling, operator-recovery metadata, and replay-safe immutable result behavior.
- Shared authentication, workspace, blocked-state, and localization contracts must be typed public exports. Repository validation must reject direct source-path, forbidden self, and disallowed workspace-relative imports. Customer-facing copy is key-based and available in Vietnamese and English rather than hardcoded in Web.
- Web styling uses Tailwind CSS with the established token layer and shadcn/ui Base UI primitives. Reusable neutral components follow Atomic Design boundaries; component-level plain CSS, CSS Modules, CSS-in-JS, and avoidable inline styles are prohibited.

## UX & Interaction Patterns

- Sign-in, MFA, recovery, and invitation acceptance are centered, single-column operational forms with one primary action. Avoid marketing heroes, decorative gradients, and promotional copy; show failures through the standard inline blocked-state treatment.
- After authentication, provide an explicit organization/workspace context. Desktop uses a persistent sidebar and top workspace bar; smaller layouts collapse navigation into a sheet and stack content, with phone layouts prioritizing one task per screen.
- The Developer task workspace shows organization and assessment labels, granted action/resource scope, expiry or revocation state, hidden-data boundaries, and only assigned redacted findings. If access is revoked, hide the findings and present a safe recovery path.
- Permission-denied states hide inaccessible data where possible and communicate the denied action and next step without exposing policy internals. Statuses must include text/icons, be announced to assistive technology, remain keyboard reachable, and not rely on color alone.
- Use restrained operational styling: neutral surfaces, primary action color, amber for blocked/degraded states, red for denied/security failures, green only for completed gates, and blue for provenance or audit references. Reuse established design tokens.

## Cross-Story Dependencies

- Authentication, membership, and organization context precede all workspace authorization. MFA and session validity gate every protected route, while OAuth identity remains separate from later GitHub repository authorization.
- Manager and Developer workspace behavior depends on the canonical RBAC runtime, policy-version history, deny-on-failure reason codes, and auditable decisions. Manager-only enforcement must apply consistently to later conflict resolution, VerifiedProfile approval, classification, report, export, invitation, and assessment-setting actions.
- Invitations and scoped task acceptance establish the authorization boundary consumed by the later redacted technical-findings workspace; the Manager flow must remain functional before, during, and after Developer participation.
- Foundational audit/outbox and worker command contracts are prerequisites for later scan, profile, reconciliation, legal matching, classification, gap, document, and audit-export workloads. Those later stages must carry forward organization scope, actor/system identity, correlation, causation, idempotency, and redaction guarantees established here.
