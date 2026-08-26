---
task_id: MW-qa-001
module: qa
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.1
depends_on:
  - auth-workspace/14-audit-event-writer.md
  - platform/rbac/03-nestjs-guard.md
---

# Auth Integration Test Suite

## Outcome

End-to-end integration tests for all auth-workspace endpoints running against a real Prisma + PostgreSQL test database. Tests cover complete golden paths and all denial paths. No mocking of DB or RBAC.

## Module Files

| File                                                   | Action   | Notes                                                                                |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| `apps/api/test/auth-workspace.e2e-spec.ts`             | Complete | Sign-in, registration, MFA, session, profile, recovery, workspace, and decision logs |
| `apps/api/test/oauth-login.e2e-spec.ts`                | Complete | OAuth start, callback, replay protection, and no repository side effects             |
| `apps/api/test/sign-up.e2e-spec.ts`                    | Complete | Self-signup account, Manager workspace, and duplicate/invalid denial paths           |
| `apps/api/test/audit-trail.e2e-spec.ts`                | Complete | Audit and authorization decision log safety                                          |
| `apps/api/test/support/auth-workspace-test-helpers.ts` | Complete | Real PostgreSQL fixtures and auth factories                                          |

## Test Environment

- Real PostgreSQL (Docker in CI).
- Real Prisma migrations applied before tests.
- No external HTTP calls — OAuth providers mocked at HTTP client level only.
- Database state reset with deterministic fixtures before each test.

## Critical Test Scenarios

**Sign-in:**

- Valid credentials → session created
- 5 failed attempts → `ACCOUNT_LOCKED`
- `mfa_required = true` when enrolled

**Self-signup:**

- User signs up → Manager membership/session created
- Duplicate or invalid account input fails closed

**RBAC Guard:**

- Valid session + action → 200
- Any deny condition (revoked, expired, no policy) → 403
- `AuthDecisionLog` written for every decision

## Definition of Done

- Active auth-workspace endpoints covered by integration tests.
- Tests run against real DB (not mocked).
- RBAC guard deny paths all tested.
- `AuthDecisionLog` presence verified for all allow/deny decisions.

## Verification

```bash
pnpm --filter @lcsp/api test:auth-integration
```

Result: current focused auth and workspace suites pass against the PostgreSQL test database.
