---
runbook_id: RUNBOOK-w6-forward-migration-and-traffic-cutover
status: READY_FOR_REVIEW
related_tasks:
  - LCSP-356
  - LCSP-357
evidence:
  - tests/w6-cutover-rehearsal.mjs
  - tests/run-w6-gate.sh
  - reports/w6-cutover-reconciliation.md
---

# W6 — Forward migration, archive and atomic traffic cutover

> **Authorization.** Everything in this runbook that touches non-disposable or production data requires a
> separate, explicit authorization from the data owner for that specific environment. The rehearsal
> (`tests/w6-cutover-rehearsal.mjs`) runs only on disposable databases. Do **not** run any command
> below against a shared or production database without that authorization.

> **The cutover spends no AI budget.** Migrating, archiving, switching traffic, booting the API or
> restarting a worker **never** starts an Assessment Root, calls a model or touches billing/usage
> accounting. Migrated in-progress assessments are *prepared* (fresh Root thread, canonical state
> `PREPARING` with validated pins/coverage, or `WAITING_FOR_REQUIRED_INPUT` when repository input is missing). AI re-evaluation is a **separate, explicitly authorized,
> bounded, canary-first** operator action: [§ Re-evaluation](#re-evaluation-separate-explicit-spends-ai-budget).
> The default cutover therefore performs **zero model calls and consumes zero AI/customer credits**.

## What the cutover does

| Step | Effect | Reversible? |
|---|---|---|
| expand migrations (`prisma migrate deploy`) | Adds the W1–W6 tables/columns. Nothing V1 is changed. | yes (restore) |
| **QUIESCE** | Cancels undelivered retired V1 commands/events: archived first, audited, moved to the terminal, non-replayable `OutboxStatus.CANCELLED`. Retained, V2-bound and unknown types are never touched. | until first V2 write |
| **ARCHIVE** | Copies every V1 table into immutable `LegacyArchiveRecord` rows (byte-exact `to_jsonb`, sha256, deterministic ids); classifies every report-related record; copies only report bytes that really exist; then closes in-flight V1 work (rows move to a terminal state with marker `LEGACY_CUTOVER_CANCELLED`, never deleted); writes a read-only summary per terminal V1 assessment. | until first V2 write |
| **BACKFILL** | Each non-terminal keeps its identity and one server-owned Root thread/case. An owned READY snapshot with a valid commit and matching live repository connection is pinned with canonical coverage; the case stays `PREPARING`. Missing/restorable repository input becomes `WAITING_FOR_REQUIRED_INPUT`, without a fabricated pin, evidence or coverage. Rerunning also dispositions older unstarted/unpinned `PREPARING` backfills without creating another case/thread. No V1 semantic output/checkpoint is promoted and no Root command is enqueued. | until first V2 write |
| **VALIDATE** | Counts, hashes, FKs, pins, revisions, closure, outbox, blob bytes, sampled independent comparison, V2 artifact isolation, restore point, **and that the migration enqueued no Root command and left no AI/accounting effect on any unstarted assessment**. Exit code `3` = blocking failures. | read-only |

Every phase is idempotent and restartable. A second run changes nothing: it allocates no second Root thread, enqueues no command, restarts no re-evaluation and creates no billing effect.

Repository-input reconciliation must account for every migrated non-terminal: pinned + waiting for required input + `BLOCKED` with `REPOSITORY_SNAPSHOT_UNAVAILABLE` = total. Revoked access or a malformed/missing commit alone does not establish permanent loss: retain the private source records, snapshot IDs and original thread for later forward repair. Waiting/blocked cases are excluded from re-evaluation and cannot claim Root execution. The validator rejects unexplained unpinned-ready cases and any unpinned Root command/lease/execution. A genuinely irrecoverable dependency is recorded only through the canonical lifecycle authority with the exact existing blocker reason and reference.

## Preconditions (all must hold)

1. The new release is built (`pnpm --filter @lcsp/api build`) and **not yet serving traffic**.
2. Exactly one `ACTIVE` legal portfolio with engineering rules exists (W2).
3. No unsettled V1 billing reservation (`BillingReservation.status = 'RESERVED'` on a V1-origin assessment). Preflight reports `UNSETTLED_V1_BILLING_RESERVATIONS`; settle or release them first.
4. **Report storage decision recorded.** The V1 uploader was a placeholder that returned a mock URL and never persisted bytes. If your production ever used a different uploader or object store, supply that location (`--report-file-root DIR` or `--report-http-host HOST`). If a host never retained bytes, attest it (`--attest-non-persisting-host HOST`). An unconfigured location blocks the cutover (`UNRESOLVED_REPORT_LOCATIONS`); it is never guessed.
5. The customer wording for a report that was not retained is approved (`pages.legacyArchive.availabilityDetail.NOT_RETAINED`, en/vi).
6. A maintenance window is announced; V1 producers and consumers can be stopped.
7. You can take and test a database snapshot (below).

## Procedure

Run all CLI commands from the API package (`apps/api`) with `DATABASE_URL` **exported explicitly** (the tool never reads `.env`) and `--confirm-database <database name>` (must equal the database in `DATABASE_URL`).

```bash
export DATABASE_URL='postgresql://…/<db>'
CLI="pnpm run legacy-migration --"      # = node dist/src/modules/legacy-migration/presentation/cli/legacy-migration.cli.js
DB="--confirm-database <db>"
REPORTS="--report-file-root /data/legacy-reports"   # plus --report-http-host / --attest-non-persisting-host as decided
```

### 0. Read-only preflight

```bash
$CLI preflight $DB $REPORTS > preflight.json ; cat preflight.json
```

`blockers` must be empty before a CUTOVER can start. `reportReferences.unresolvedHosts` lists hosts that need a decision. `inFlight` and `outbox.undelivered` show the work QUIESCE/ARCHIVE will close.

### 1. Stop all V1 writers and delivery (outside the tool)

1. Stop every API instance and worker of the **previous** release. Do not start the new API yet.
2. Verify no V1 consumer remains (RabbitMQ management):

   ```bash
   rabbitmqadmin list queues name messages consumers | grep -E 'lcsp\.agent_runtime\.boundary\.(scan_requested|targeted_reanalysis_requested|engineering_assessment_requested|assessment_interview_(resume|pause)_requested|legal_rule_triage_requested|gap_analysis_requested|final_report_requested)'
   ```

   `consumers` must be `0`. Messages still sitting in those queues were already published and cannot be processed any more: record their counts in the evidence, then purge and delete the queues (and any `.retry.<N>ms` siblings) **after** the archive phase finished.

### 2. Expand the schema, then take and prove the restore point

```bash
pnpm --filter @lcsp/api prisma:migrate:deploy                      # expand-only
pg_dump -Fc -d <db> -f restore-point.dump && sha256sum restore-point.dump
createdb <db>_drill && pg_restore --no-owner -d <db>_drill restore-point.dump   # drill: row counts must match
$CLI start --kind CUTOVER $DB $REPORTS                               # prints { runId, preflight }
$CLI restore-point --run <runId> --ref <where the dump is kept> --digest <sha256> --verified $DB
```

The restore point is cutover-wide: later runs (repair/idempotency) reuse it.

### 3. Execute

```bash
$CLI execute --run <runId> $REPORTS $DB --out execute-1.json         # QUIESCE, ARCHIVE, BACKFILL, VALIDATE (starts NO re-evaluation)
echo $?                                                               # 0 = no blocking failure; 3 = read validation checks; 1 = error
```

Options: `--phases A,B` to run a subset (`QUIESCE,ARCHIVE,BACKFILL,VALIDATE`), `--batch-size`, `--sample-size`, `--max-report-bytes`, `--http-timeout-ms`, `--fs-artifact-dir DIR` (inventories rule cache/bundle export files with real hashes).

Run it a **second time** (new `start` + `execute`): every counter must be `0` and the validation must stay clean.

### 4. Review and keep the evidence

`execute-*.json` contains the phase results and the validation report (`artifactReconciliation` carries the five-class report accounting, the uploader source evidence and the explicit limitation). Keep `preflight.json`, the dump digest and both execute files with the release evidence.

### 5. Switch traffic atomically

1. Deploy the new API, Web/BFF and worker (15 boundaries) together. The new API registers 111 routes; the retired V1 routes answer **410 `LEGACY_ROUTE_RETIRED`**.
2. Confirm: `GET /health`; RabbitMQ shows consumers only on the 15 live `lcsp.agent_runtime.boundary.*` queues.
3. The first accepted V2 write ends the rollback path. After the cutover that is a customer action or the first **explicit re-evaluation start** — never the migration. Close the boundary explicitly once traffic is switched (the re-evaluation commands refuse to start anything while it is open):

   ```bash
   $CLI close-boundary --run <runId> $DB
   ```

   From here on a restore would discard accepted V2 work: **forward repair only**.

### 6. Post-cutover monitoring (first 24 h)

* Log event `LEGACY_ROUTE_RETIRED` must be **0**. Any hit names the straggler (route, correlation id, user agent): an old BFF, worker or pod is still running.
* `OUTBOX_EVENT_TYPE_RETIRED` errors must be **0** (a code path attempted to create retired traffic).
* Re-validate at will (read-only): `$CLI validate --run <runId> $DB`.
* Verify retrieval: sign in as a customer with an archived assessment → open it → the archive panel lists its reports with honest availability.

## Re-evaluation (separate, explicit, spends AI budget)

> **Authorization.** Re-evaluation spends model/provider budget for real customers. Run it **only with
> separate, explicit authorization** (a named person or ticket, passed as `--authorized-by`). Never run a
> bulk start against real data without that authorization; a broader model-spending batch needs a fresh one.

Flow: `migrate/archive/cut over → reconcile → canary → explicit re-evaluation start → bounded execution`.
The scheduler **only coordinates starts**; the Assessment Root remains the sole semantic authority and every
state below is read from canonical lifecycle/runtime/accounting rows (no second workflow state exists).

```bash
RE="--cutover-run <runId>"                   # the completed, validated cutover run
ROUTE="--model-route <provider>/<model>"      # the route the workers will really use (declared, then verified)
WHO="--authorized-by <person-or-ticket>"
```

### R0. What every start enforces

| Guard | Refusal code |
|---|---|
| the cutover run validates with zero blocking failures (re-checked on every start) | `LEGACY_REEVALUATION_CUTOVER_NOT_VALIDATED` |
| the rollback boundary is closed (a Root start is an accepted V2 write) | `LEGACY_REEVALUATION_RESTORE_BOUNDARY_OPEN` |
| `--authorized-by` and at least one declared `--model-route` | `…_NOT_AUTHORIZED`, `…_MODEL_ROUTE_REQUIRED` |
| a canary names 1–5 explicit, startable, migrated assessments | `…_SELECTION_INVALID` (nothing starts) |
| a batch needs `--confirm-bulk` **and** a verified canary | `…_BULK_NOT_CONFIRMED`, `…_CANARY_REQUIRED` |

### R1. Preflight (read-only budget picture)

```bash
$CLI reevaluation-preflight $RE $ROUTE --max-total 5 $DB --out reeval-preflight.json
```

Reports: migrated assessments; eligible vs not-ready (with the exclusion reason); eligible per tenant; assessments
already scheduled or finished and who started them; the declared model route vs routes observed in policy/usage;
the configured concurrency; current in-flight and queued load; the usage policy (provider usage is **telemetry only**:
a model invocation never reserves or debits wallet credits); and the **upper-bound number of Root executions** the
invocation can start. It deliberately does **not** estimate model calls per execution.

### R2. Canary first (very small, authorized set)

Pick 1–5 synthetic or explicitly authorized assessments (`reevaluation-preflight` lists eligible ones per tenant).

```bash
$CLI reevaluation-start $RE --mode CANARY --assessment-id <id> [--assessment-id <id>] $WHO $ROUTE $DB
```

This enqueues exactly one Root command per canary and records the start in the immutable ledger
(`LegacyReevaluation`) and the audit trail. Running it again for the same ids starts nothing and enqueues nothing.
Wait for the worker to execute them, then verify from canonical state:

```bash
$CLI reevaluation-verify-canary $DB --out reeval-canary.json ; echo $?     # 0 = verified, 3 = not yet / failed
```

| check | passes when |
|---|---|
| `THREAD_UNIQUE` | one runtime row owns the fresh V2 thread; it equals the migration summary; no V1 thread was reused |
| `CHECKPOINT_RECORDED` | the runtime recorded a checkpoint, or the LangGraph checkpointer in this database holds the thread. If the checkpointer lives in another database the check is `UNOBSERVABLE`: verify it there and pass `--attest-unobservable CHECKPOINT_RECORDED` |
| `EVENTS_RECORDED` | the Root emitted a gap-free event stream on that one thread |
| `MODEL_USAGE_RECORDED` | usage exists and every `provider/model` is one the operator **declared** |
| `ACCOUNTING_CONSISTENT` | usage is attributed to the owner; no credit charge, no reservation, no foreign owner |
| `DECISIONS_RECORDED` | every pinned rule is resolved with a decision (when the canary completed) |
| `ARTIFACT_FLOW` | exactly one sealed final report (when the canary completed) |
| `NO_V1_AUTHORITY` | no in-flight V1 row and no deliverable retired V1 command anywhere |

`PENDING` means the Root has not produced that evidence yet; anything else than `PASS` blocks bulk.

### R3. Bounded batch (only after a verified canary and a fresh authorization)

```bash
$CLI reevaluation-start $RE --mode BATCH --max-total <N> --confirm-bulk $WHO $ROUTE \
  [--global-concurrency 2] [--tenant-concurrency 1] [--max-backlog 2] [--min-start-interval-ms 5000] [--max-failures 3] $DB
```

One invocation is **one bounded pass, never a loop or a background job**: it starts at most `--max-total`, one at a
time, paced by `--min-start-interval-ms`. Before **each** start it re-reads the canonical load inside the starting
transaction (serialized by a database advisory lock, so concurrent operators cannot exceed a cap):

| bound | default | stops the pass when |
|---|---|---|
| global concurrency | 2 | ACTIVE + FINALIZING assessments (started by anyone), excluding terminal FAILED executions, reach the cap → `GLOBAL_CAP_REACHED` |
| per-tenant concurrency | 1 | that tenant is at its cap → the candidate is deferred, other tenants continue → `TENANT_CAP_REACHED` |
| queue back-pressure | 2 | started-but-unclaimed Root runs reach the cap → `BACKPRESSURE` |
| failure budget | 3 | failed starts reach the budget → `FAILURE_BUDGET_EXCEEDED`, **exit code 4**, no further start, no mass retry |
| size | required | `--max-total` reached → `MAX_TOTAL_REACHED` |

Repeat the command to continue; progress and remaining work are always visible and never stored twice:

```bash
$CLI reevaluation-status $DB        # derived: NOT_READY, READY_NOT_STARTED, STARTED_QUEUED, RUNNING, RETRYABLE_FAILURE, WAITING, PAUSED, COMPLETE, FAILED, BLOCKED, CANCELLED
```

### R4. Failure and credit behavior

* One failed **start** rolls back only itself, is audited against that assessment (`LEGACY_REEVALUATION_START_FAILED`) and
  never blocks other tenants or earlier starts.
* One failed **execution** releases its capacity slot and stays the Root's canonical failure (shown as `RETRYABLE_FAILURE` while the lifecycle is still `ACTIVE`): the scheduler never restarts it, never resurrects V1 authority and
  never lets it affect another assessment.
* Rerun, retry, process restart, API restart or a duplicate cutover command change nothing: the Root command id is
  deterministic per assessment, the ledger has one row per assessment and starts are idempotent.
* Usage is recorded only when a Root really executes and a worker posts it (idempotent per invocation). Starting, migrating,
  rerunning and restarting never create a usage, reservation, wallet or ledger row.

## Rollback

| Situation | Action |
|---|---|
| Before any accepted V2 write (boundary open) | Stop the new stack, restore `restore-point.dump` into the database, start the previous release. The restore drill (step 2) proves this returns every V1 table to its pre-cutover state. Re-running the whole procedure afterwards converges to identical archive digests. |
| After the first accepted V2 write (boundary closed) | **Do not restore.** Fix forward: re-run `execute` (idempotent), `validate`, repair data with a reviewed migration. `restore-point` refuses once the boundary is closed. |

## Failure handling

| Signal | Meaning | Action |
|---|---|---|
| `LEGACY_MIGRATION_PREFLIGHT_BLOCKED` | CUTOVER refused: a blocker is open | read `blockers`; fix and re-run preflight |
| `LEGACY_MIGRATION_NO_ACTIVE_LEGAL_PORTFOLIO` | backfill needs exactly one ACTIVE portfolio with rules | activate the portfolio (W2) |
| `LEGACY_MIGRATION_ARCHIVE_INCOMPLETE` | a report location could not be inspected (unreachable/unauthorised) or a persisted artifact exists but could not be copied and verified (I/O error, `--max-report-bytes` exceeded, hash mismatch) | fix connectivity/credentials/limit and re-run the **same** run; nothing was closed, summarised or recorded for the failed items |
| validation `OUTBOX_NO_UNCLASSIFIED_UNDELIVERED_MESSAGE` | an undelivered message type nobody classified | classify it (add to the Freeze lists) — it is deliberately **not** cancelled by guess |
| validation `ARCHIVE_COVERAGE.*` | a V1 row appeared after the archive (a V1 writer survived) | find and stop the writer, re-run ARCHIVE |
| validation `NO_ACCEPTED_V2_WRITES_WHILE_RESTORE_BOUNDARY_OPEN` | V2 wrote while a restore is still the rollback path | decide: restore now, or `close-boundary` |
| `LEGACY_ARCHIVE_ARTIFACT_INTEGRITY_FAILED` (HTTP 500) | a stored copy no longer matches its recorded hash | never served; restore the blob from backup; investigate |
| `LEGACY_REEVALUATION_*` | a re-evaluation guard refused the start (see R0) | fix the named precondition; nothing was started |
| validation `UNSTARTED_ASSESSMENTS_HAVE_NO_AI_EFFECT` / `MIGRATION_ENQUEUED_NO_ROOT_COMMAND` | something started AI work outside the explicit re-evaluation path | stop; find the producer; this must never be non-zero |

## What survives for W7

W7 physically deletes the now-unreachable V1 code and tables. The cutover leaves these for it:

* unregistered V1 controllers and their handlers (API); the `RETIRED_API_ROUTES` list (410 stubs) can go once no traffic was seen for a full retention window;
* dead Web/BFF routes and the dead hook/client chain (`assessment-queries.ts`, evidence-graph drawer, document/classification/interview BFF routes);
* worker branches gated on removed boundaries (consumer scan claim/terminal-failure, system-event scan callbacks, scan run observer, sandbox evidence-report loader, agentic V1 tool adapters, `resume_waiting_runs`);
* V1 tables (archived read-only here) and the retired `OutboxStatus` history;
* the re-evaluation CLI group (`reevaluation-*`) and the `LegacyReevaluation` ledger stay until every migrated assessment has either been re-evaluated, deleted or explicitly retired;
* **Release evidence must carry the legacy-report limitation**: the V1 uploader never persisted report bytes, so historical V1 reports are archived as classified metadata; no historical artifact was regenerated or fabricated.
