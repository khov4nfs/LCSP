# W1.4 API browser-verification preparation

Status: PREPARED / CLOSURE-VERIFIED; LIVE STARTUP NOT AUTHORIZED

This is setup evidence for the W1.4 web/browser worker, not production
acceptance. The production GET and workspace runtime SSE paths remain the
authority; the fixture below creates only synthetic local rows in a new,
task-owned database. No database, API, web, broker, or provider process was
started in this closure. HTTP, SSE, and browser proof are NOT_PROVEN.

## Scope and authority

- W1.3 API GET and workspace runtime SSE projections read persisted ALS/AES.
  Activity is secondary and `stage_lifecycles` is empty; no V1 activity or
  artifact state may synthesize lifecycle state.
- The fixture has one canonical-present assessment (`PAUSED`, revision `7`,
  runtime `PAUSED`, checkpoint namespace equal to the assessment ID), one
  all-null V1 assessment (canonical lifecycle and runtime unavailable), and
  one deliberately conflicting `RUNNING` secondary activity event. Expected
  proof: activity remains visible as activity while persisted canonical state
  remains `PAUSED`.
- The customer owner guard remains in force. This checkout has no organization
  table in the current schema; authenticated owner ID is the tenant/assessment
  scope used by the existing route.

## New task-owned fixture

`apps/api/test/w1-canonical-browser-support.ts` is the only source file
added. It uses the existing Prisma client and auth password hasher, and does
not alter production registration, migrations, contracts, schemas, or
existing helpers.

The script hard-rejects every `DATABASE_URL` except this exact fresh target:

```text
postgresql://postgres:postgres@127.0.0.1:55439/lcsp_w14_browser?schema=public
```

It aborts if any fixture UUID already exists and seeds in one transaction:

| purpose                      | exact value                            |
| ---------------------------- | -------------------------------------- |
| owner/auth user              | `1fef0c88-0c6c-4d5d-9f50-4e52fef0c714` |
| auth email                   | `w1-4-browser-owner@invalid.test`      |
| auth password                | `W1CanonicalBrowserFixture!2026`       |
| canonical-present assessment | `2e8b6fc8-2cb0-4b74-9b9e-8b1a7c0af8c1` |
| all-null V1 assessment       | `3d9c7ad9-3dc1-4c85-a1c0-9f7df4d0d2a7` |
| persisted root thread        | `4a7b2e6d-28a7-4b0d-a3c4-9c24a4e9d2f2` |
| conflicting activity run     | `5bf4c6b0-faf2-4b2f-a542-7e6f2d0ec1aa` |
| conflicting activity event   | `6c1e2f53-55bf-4f8b-bfa7-5efebd4c0d77` |

The `blockerReference` value is explicitly `Prisma.DbNull` for both rows.
This is required by the accepted W1.3 R2 repair: PostgreSQL JSON null is not
the accepted SQL NULL for `Assessment_blocker_check`. The auth values are
synthetic test-only credentials, not real accounts, providers, secrets, or
external credentials.

Direct inspection of the final migration confirms the guard uses SQL null
semantics: `Assessment_blocker_check` requires `blockerReference IS NULL` for
every non-`BLOCKED` row and requires `blockerReference IS NOT NULL` plus
`jsonb_typeof(...) = 'object'` only for `BLOCKED`. The fixture deliberately
does not seed a blocker state.

## Port and target validation

Read-only validation on 2026-10-06:

- An initial broad `rtk ss -ltn` snapshot transiently included
  `127.0.0.1:3311` among other listeners. The immediate exact candidate
  filter later returned no listener on either `3311` or `55439`; this
  worker did not claim or take over `3311`.
- Exact proposed container name
  `lcsp-api-test-postgres-55439-lcsp_w14_browser` was absent from
  `docker ps -a`. Existing ports `55432` and `55437` and their containers
  were not used or modified. Older exited containers on port `55439` have
  different names and were not reused.

This was a point-in-time availability check, not a live service handoff.
Proposed API base URL (reservation only; not usable or proven live):

```text
http://127.0.0.1:3311
```

## Coordination and ownership

Before any startup, this exact target proposal was sent to web worker
`ctx_8a631f184aa3` and the Coordinator:

```text
I validated fresh task-owned targets: API http://127.0.0.1:3311 and Postgres
127.0.0.1:55439 / lcsp_w14_browser; no listeners or exact container name were
present at validation. I prepared apps/api/test/w1-canonical-browser-support.ts
with owner 1fef0c88-0c6c-4d5d-9f50-4e52fef0c714, canonical-present assessment
2e8b6fc8-2cb0-4b74-9b9e-8b1a7c0af8c1 (ALS PAUSED rev 7, AES PAUSED), and
all-null V1-unavailable assessment 3d9c7ad9-3dc1-4c85-a1c0-9f7df4d0d2a7;
activity run 5bf4c6b0-faf2-4b2f-a542-7e6f2d0ec1aa is deliberately RUNNING so
browser proof can show activity cannot override persisted ALS/AES. Confirm
ownership before I create the new DB/API process; existing servers and
55432/55437 remain untouched.
```

No web acknowledgement or API service ownership was established in this
closure. Coordinator packet `msg_a49cee2a7728` restricted this attempt to
closure and verification, forbade creating a database/API/web/broker or taking
over port `3311`, and confirmed that existing `55432`/`55437` resources remain
untouched.

## Future guarded setup recipe (not run in this closure)

The following is a future recipe only. It requires explicit Coordinator
authorization, web-worker acknowledgement, and fresh exact-target validation;
it was not executable during this closure:

```sh
LCSP_TEST_POSTGRES_PORT=55439 \
LCSP_TEST_POSTGRES_DB=lcsp_w14_browser \
LCSP_TEST_POSTGRES_USER=postgres \
LCSP_TEST_POSTGRES_PASSWORD=postgres \
node ./test/scripts/ensure-test-postgres.mjs

DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55439/lcsp_w14_browser?schema=public' \
pnpm run prisma:migrate:deploy

DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55439/lcsp_w14_browser?schema=public' \
pnpm exec tsx test/w1-canonical-browser-support.ts
```

The first command creates only the new exact task-owned container; it does not
stop, reset, or remove an existing container. `prisma migrate deploy` is used
against the empty target instead of existing destructive reset/push helpers.
The fixture command exits non-zero on a mismatched database or existing UUID.

Migration verification is deploy-only: this checkout contains exactly 96
ordered `migration.sql` files, from
`20260709061200_init/migration.sql` through
`20261005140000_assessment_canonical_persistence/migration.sql`. Do not use
`db push`, reset, backfill, or an existing database. After deploy, capture
the Prisma `migrate deploy` receipt showing all 96 applied migrations before
running the fixture.

No API entrypoint was started, and this closure does not authorize an API
start command. The future recipe must supply an isolated external
broker/provider edge; the proposed shared `127.0.0.1:5672` broker is unsafe
and must not be used as a startup target or proof.

Synthetic auth/configuration values above remain preparation-only. Coordinator
owns exact API/container cleanup and the web worker owns browser/web cleanup
after an authorized run; no cleanup is needed now because nothing was started.

## Direct API/SSE proof receipt (not run in this closure)

No HTTP or SSE request was executed in this closure. For a future
Coordinator-owned live run, the web worker should perform browser verification
through its real BFF while these direct API checks distinguish API proof from
UI proof:

1. `POST /auth/sign-in` with the synthetic credentials and capture the
   returned `session_token`.
2. `GET /assessments/2e8b6fc8-2cb0-4b74-9b9e-8b1a7c0af8c1` with the bearer
   token: expect success envelope, lifecycle `PAUSED` revision `7`, and
   runtime `PAUSED` with matching checkpoint namespace.
3. `GET /assessments/3d9c7ad9-3dc1-4c85-a1c0-9f7df4d0d2a7`: expect success
   envelope with `lifecycle: null` and `runtime: null`, not inferred V1
   lifecycle.
4. `GET /workspace/runtime-events?assessment_id=2e8b6fc8-2cb0-4b74-9b9e-8b1a7c0af8c1`
   with `Accept: text/event-stream`: expect a `workspace.runtime` frame
   whose `canonical_assessments` contains both projections, whose
   `stage_lifecycles` is `[]`, and whose secondary activity may contain
   synthetic `RUNNING` without changing canonical `PAUSED`.

Record HTTP status, envelope body shape, first SSE frame, and process/container
ownership separately. These checks do not prove browser rendering, web i18n,
real broker/provider execution, or production acceptance.

## Commands and exits

- `rtk pnpm exec prettier --check apps/api/test/w1-canonical-browser-support.ts`
  — exit 0.
- `rtk pnpm exec tsc -p apps/api/tsconfig.json --noEmit` — exit 0.
- Mismatched-target guard
  (`DATABASE_URL=postgresql://caller.example/forbidden pnpm exec tsx
apps/api/test/w1-canonical-browser-support.ts`) — exit 1 before any Prisma
  connection, with the exact-target refusal.
- `rtk rg --files apps/api/prisma/migrations | rtk rg '/migration\\.sql$' |
rtk wc -l` — exit 0, count `96`; sorted first/last migration inspection
  also exited 0 and matched the names recorded above.
- Final migration constraint inspection with `rtk rg -n
'Assessment_blocker_check|blockerReference IS NULL|jsonb_typeof|lifecycleState|assessment_canonical'
apps/api/prisma/migrations/20261005140000_assessment_canonical_persistence/migration.sql`
  — exit 0; the SQL-null blocker guard was present.
- `rtk ss -ltn '( sport = :3311 or sport = :55439 )'` — exit 0; no exact
  candidate listeners at closure.
- `rtk docker ps -a --filter
name=^/lcsp-api-test-postgres-55439-lcsp_w14_browser$ --format
'{{.Names}}\\t{{.Status}}\\t{{.Ports}}'` — exit 0; no exact target
  container.
- `rtk git diff --check -- reports/w1-4-api-browser-preparation.md` — exit
  0 after this report reconciliation.

No `prisma migrate deploy`, fixture seed, API/web/broker/provider startup,
HTTP/SSE request, or browser verification was run. Live service ownership and
browser acceptance therefore remain NOT_PROVEN and outside this closure.
