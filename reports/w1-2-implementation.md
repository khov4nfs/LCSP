# W1.2 persistence implementation

**PASS — implementation and isolated migration checks; coordinator acceptance pending.**

Authority: architecture freeze §§3/4/6/8/11; accepted W1.1 HEAD `988e51f4d307343f49a0facbcc66aed9e95ae772`. Continued the same task's prior schema/migration draft under exclusive Prisma ownership; all changes remain uncommitted. Coordinator explicitly authorized the durable verifier/report and superseded routine independent-review and `/tmp` handoff requirements.

Owned files: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261005140000_assessment_canonical_persistence/migration.sql`, `tests/assessment-canonical-persistence.mjs`, this report. No API/web/Python/contracts, W2/W3 domain schema, historical migrations, user documents, or coordinator ledger changed.

The ordered expand migration adds nullable canonical Assessment lifecycle/revision/blocker fields; the lifetime Runtime mapping with assessment primary key, unique UUID thread, execution/lease identity and transactional event counter; and Event identity, per-assessment sequence uniqueness, lineage/JSON checks and same-assessment Runtime/Outbox composite FKs. All five new persisted enums use uppercase members. Existing status/history remain intact; V1 lifecycle fields remain NULL and no thread, event or semantic completion is backfilled.

**Root cause:** the inherited blocker CHECK used SQL `=` on nullable lifecycle state, allowing malformed V1 blocker metadata through a NULL check result.

**Fix:** `IS NOT DISTINCT FROM 'BLOCKED'` makes that branch null-safe; the durable test rejects the exact malformed V1 record on both migration paths.

Reproduce from repository root:

```sh
rtk proxy node tests/assessment-canonical-persistence.mjs
```

The verifier creates/removes its own randomly named Docker `postgres:16-alpine` container on a dynamic localhost-only port, builds its own disposable URLs and never reads an environment DB URL as its target. PostgreSQL baseline comes from every historical migration before W1.2 and the accepted W1.1 schema. Final run used `127.0.0.1:32772`, databases `w12_clean` and `w12_upgrade`; all test containers were removed. Prior abandoned container/data were left untouched.

| Actual command/check | Exit | Result |
|---|---:|---|
| `rtk proxy node tests/assessment-canonical-persistence.mjs /tmp/lcsp-w1-2-ctx9140/final-run` | 0 | 152 assertions; clean install and populated upgrade PASS. |
| `rtk proxy pnpm --dir /home/khovan/orca/workspaces/LCSP/agentic-prod-integration/apps/api exec prisma validate` | 0 | PASS; explicit disposable DATABASE_URL. |
| Same prefix, `prisma generate` | 0 | PASS; Prisma Client 7.8.0 generated outside tracked source. |
| Same prefix, `prisma migrate deploy --config /tmp/lcsp-w1-2-ctx9140/final-run/baseline.config.mjs` | 0 | Historical baseline deployed before seeding V1. |
| Same prefix, `prisma migrate deploy` on clean and upgrade DBs, then repeat on each | 0 each | Both paths and migration-ledger replay PASS. |
| Same prefix, `prisma migrate diff --from-config-datasource --to-schema /home/khovan/orca/workspaces/LCSP/agentic-prod-integration/apps/api/prisma/schema.prisma --script --exit-code` on clean and upgrade DBs | 2 each | Whole-schema drift remains; SQL byte-identical to separately measured V1 baseline diff. Scoped W1.2 drift PASS; whole-schema conformance NOT PASS. |
| `rtk proxy git diff --check` | 0 | PASS. |
| `rtk proxy pnpm exec prettier --check tests/assessment-canonical-persistence.mjs` | 0 | PASS. |
| `rtk proxy graphify update .` | 0 | AST graph refreshed; ignored graph artifacts add no owned source diff. SQL parser is unavailable, so graph output is not migration proof. |

Exact per-command argv, disposable DATABASE_URL, exit status and stdout/stderr: `/tmp/lcsp-w1-2-ctx9140/final-run/commands.json` and adjacent logs. Catalog constraints/indexes, preserved-table counts and machine result are in the same directory. A first enum probe failed because `pg_enum.enumlabel` aggregated to PostgreSQL `name[]`, which the installed pg driver returns as text; casting each label to `text` fixed the verifier, and the final run passed with expectations derived from generated Prisma enums.

Upgrade reconciled **all 55 existing tables and 21 seeded rows** row-for-row as JSON, including seven Assessment statuses, V1 turn/checkpoint/event, Interview, semantic rule result, outbox, billing reservation/usage and legal approval history. All seven V1 canonical lifecycle/revision pairs remained NULL; canonical Runtime/Event tables remained empty before synthetic V2 checks. Both paths verify exact enum/client identity and uppercase values, catalog FKs/indexes, unique Root/thread mapping, foreign-thread/aggregate rejection, malformed record rejection, 12 concurrent event allocations, eight replay deliveries, stale CAS rejection, state/counter/event/outbox rollback, sequence isolation, matching persisted event/outbox envelopes, predecessor ordering lookup and migration replay without data changes.

**NOT CHANGED:** pre-existing WizardProfile/VerifiedProfile, enum/index/FK and naming drift; none of the generated drift SQL was applied. **Remaining gates:** W1.3 owns authenticated lifecycle CAS and same-transaction event/domain/outbox writes, idempotent replay, typed payload/reference validation and immutable lifetime mapping; W5 owns actual ordered publishing/retry. The verifier proves the persistence protocol and predecessor query, not production API/SSE/publisher behavior, browser flows, tenant authorization, provider execution or production release. No compatibility writer/fallback or semantic authority was added; no W1.2 blocker remains.
