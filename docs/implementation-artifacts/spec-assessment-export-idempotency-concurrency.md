---
title: 'Assessment export idempotency concurrency'
type: 'bugfix'
created: '2026-11-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '71961f197c7b037c0c01dddea6f3584bde54e366'
context:
  - 'docs/project-context.md'
  - 'apps/api/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Concurrent partial rule-audit export requests can both miss the initial lookup; the database commits one winner while the loser exposes Prisma `P2002` instead of replaying committed metadata.

**Approach:** Classify only the exact `(requestId, idempotencyKey)` unique collision, reload the durable winner outside the failed transaction, and return canonical metadata. Preserve unrelated integrity errors unchanged.

## Boundaries & Constraints

**Always:** Match `P2002` plus the exact export composite target; support current column-array, generated constraint-name, and Prisma adapter nested shapes; reload owner-scoped metadata for the exact request and idempotency key; parse through the shared metadata schema; rethrow the original error when unrelated or winnerless; preserve owner, audit, correlation, and immutable-export invariants.

**Ask First:** Any schema/migration, isolation-level, retry-policy, side-effect, or API-response change.

**Never:** Treat every `P2002` as replay, retry the whole export transaction, fabricate metadata, duplicate export/audit/outbox work, modify the audit report, or commit/push/create a PR.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Exact array target | `P2002`, target exactly names both columns | Reload and return committed winner | Original error if winner missing |
| Exact string target | `P2002`, target is the generated constraint name, optionally public-schema qualified | Reload and return committed winner | Original error if winner missing |
| Exact adapter target | `P2002`, nested violation fields exactly name both columns, with balanced identifier quotes allowed | Reload and return committed winner | Original error if malformed or winner missing |
| Wrong unique target | `P2002` for another/extra column | No reload or replay | Rethrow same error object |
| Non-unique failure | Any non-`P2002` error | No reload or transaction retry | Rethrow same error object |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.ts` -- transaction, immutable export create, and replay metadata boundary.
- `apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.spec.ts` -- ASM-EXPORT-01 and classifier regression matrix.
- `apps/api/prisma/schema.prisma` -- canonical composite unique declaration.
- `apps/api/prisma/migrations/20261030120000_selected_rule_audit_requests/migration.sql` -- generated constraint name.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.spec.ts` -- extend RED coverage for exact array/string, wrong target, missing winner, non-P2002, exact reload, and no transaction retry.
- [x] `apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.ts` -- add pure exact-conflict classifier and post-rollback winner reload.
- [x] `.agents/memory/lessons-learned.md` and `apps/api/AGENTS.md` -- persist the exact-constraint idempotency rule.

**Acceptance Criteria:**
- Given one exact concurrent collision, when the loser receives supported `P2002`, then it returns winner metadata from one exact reload.
- Given unrelated or malformed persistence failure, when export creation fails, then the same error object is rethrown without reload or retry.
- Given an exact collision with no visible winner, when reload returns null, then the original error is rethrown and no metadata is fabricated.
- Given replay convergence, no second export or side effect is created and canonical metadata formatting is unchanged.

## Spec Change Log

## Design Notes

Recovery uses the root Prisma client only after the interactive transaction rejects. This avoids an aborted transaction and exposes the concurrent winner's committed row without replaying validation or mutation work.

## Verification

**Commands:**
- `NODE_OPTIONS=--experimental-vm-modules pnpm --filter @lcsp/api exec jest --config ./jest.config.ts src/modules/assessment/application/services/assessment-rule-audit.service.spec.ts --runInBand --watchman=false`
- Adjacent assessment session-export specs with the same Jest flags.
- `pnpm run check:business-logic-docs`
- `pnpm run check:architecture`
- `pnpm run check:imports`
- Targeted TypeScript/ESLint checks for changed files.
- `graphify update .`

**Execution evidence:** The classifier matrix covers legacy targets plus the installed Prisma 7 adapter's source-derived nested shape, including quoted PostgreSQL field identifiers. Fast tests mock the adapter error deterministically; the repository currently has no disposable PostgreSQL concurrency harness, so a two-client database integration remains optional stronger evidence rather than a scoped gate.

## Suggested Review Order

**Exact conflict classification**

- Restricts replay to the intended public-schema composite constraint and adapter shape.
  [`assessment-rule-audit.service.ts:159`](../../apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.ts#L159)

**Post-rollback convergence**

- Rebinds owner and aggregate while loading only safe winner metadata.
  [`assessment-rule-audit.service.ts:930`](../../apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.ts#L930)

**Regression evidence**

- Covers the production quoted-field shape and malformed constraint variants.
  [`assessment-rule-audit.service.spec.ts:325`](../../apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.spec.ts#L325)

- Proves recovery query scope and sensitive-payload allowlisting.
  [`assessment-rule-audit.service.spec.ts:473`](../../apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.spec.ts#L473)

**Persistent safeguards**

- Records the concurrency invariant for later Assessment work.
  [`lessons-learned.md:175`](../../.agents/memory/lessons-learned.md#L175)

- Adds the exact-constraint check to the API verification checklist.
  [`AGENTS.md:121`](../../apps/api/AGENTS.md#L121)
