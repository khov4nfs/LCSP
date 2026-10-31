# Adaptive Assessment Root capacity (LCSP-364)

The API/PostgreSQL capacity row is the admission authority. One Agent Server owns
native execution; several RabbitMQ bridges may use it. Never start a second Agent
Server or change its lock path to bypass a running instance. Native researcher
concurrency remains one. No capacity setting bypasses legal, budget or report gates.

The LCSP SDK integration uses run create/poll/cancel. The unsupported synchronous
`POST /threads/{thread_id}/runs/wait` compatibility route has been removed in all
modes and returns HTTP 405. It had no tracked Future, physical slot or drain check.
Do not route graph execution through an untracked synchronous call; use the
existing bounded asynchronous lifecycle, including global admission for Roots.

## Configuration

`LCSP_ROOT_CAPACITY_POLICY` seeds **only the first database row**, as validated JSON.
After initialization use the authenticated administrator control API. An environment
edit alone deliberately cannot overwrite an audited operator decision.

Defaults: adaptive disabled; minimum 1, initial/maximum 2; step up/down 1;
evaluation 15 s; cooldown up 90 s/down 60 s; hysteresis 3 samples; telemetry TTL
60 s; available-memory headroom 2 GiB; per-Root memory reserve 2 GiB; free disk
headroom 4 GiB; CPU PSI 0.75; disk PSI 0.25; DB connection utilization 0.75;
four reserved DB connections per Root; checkpoint latency ceiling 1,000 ms.
Critical pressure can suspend all new admission even with minimum 1.

The fixed physical ceiling is the smaller of
`LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS` and
`LCSP_AGENT_SERVER_MAX_CONCURRENT_JOBS` (both default 2).
Keep `LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH` bounded by bridge workers. A physical
ceiling change requires drain/replacement. Ordinary effective-capacity changes
require neither restart nor executor mutation. Do not raise a production ceiling
until measured headroom, provider authorization and the acceptance gate support it.

Set `LCSP_ROOT_CAPACITY_RABBITMQ_MANAGEMENT_URL` to the existing broker management
origin (e.g. a private loopback endpoint); credentials come from `RABBITMQ_URL`,
never from a logged command. Missing broker data stays unknown and blocks
expansion beyond the initial envelope. Container memory/CPU limits, Docker stats,
host pressure and checkpoint observations come from the server. Missing critical
measurements suspend new admissions. Shared Python RSS is aggregate; per-Root
Python RSS cannot be attributed reliably in a threaded process and remains
unavailable. The per-Root reserve conservatively budgets that unknown consumption;
only measured sandbox memory earns active-Root memory credit.
The supported server runs under PM2 with a visible Linux cgroup v2 hierarchy.
Ancestor limits constrain the worker even when its leaf is unlimited. Hidden
ancestors in a delegated/container cgroup mount are unknown and suspend Root
admission; do not bypass this by reporting an unlimited limit.

Provider concurrent/RPM/TPM limits default to unknown. Configure all three only
from the authorized provider envelope. They restrict Root expansion; the existing
atomic paid-call admission remains the per-call authority. Unknown usage outcomes
and unknown tokens prevent expansion; missing usage is never zero. Run-owned
budget refusal stops expansion without cancelling another customer's funded work.

## Operator interface

`GET /admin/assessment-root-capacity` requires the existing ADMIN session/RBAC.
It returns the shared success envelope with desired/effective/stored capacity,
active reservations, available and draining slots, metric timestamps/source,
controller health, policy, deferral/recovery counts and the last 100 decisions.
Measurements contain aggregate operational data, not private legal reasoning.

`POST /admin/assessment-root-capacity` takes:

```json
{
  "expectedVersion": 12,
  "reason": "Approved bounded two-slot rollback after canary",
  "policy": { "enabled": false, "minimum": 1, "initial": 2, "maximum": 2 }
}
```

Read the current version and preserve the current policy fields when editing.
Stale versions fail with HTTP 409; invalid policy fails validation. Controls
invalidate the old ceiling, append authenticated actor/reason history, and wait
for fresh evaluation. `enabled: true` enables measured changes within bounds;
`manualOverride: 1` requests one slot; `manualOverride: 0` suspends admission.
`emergencyDisabled: true` immediately withholds new admission. Overrides never
bypass safety constraints. No command kills admitted work.

Internal register/report/reserve/quiesce endpoints require the existing worker
key. They are trusted runtime protocol, not an alternative customer interface.
Startup requires a non-zero, initialized 32-hex `/etc/machine-id`; absent, empty,
uninitialized or malformed identity fails closed before registration.
Registration/reporting read the worker-protected registration comparison version
and submit it unchanged. Version conflict rejects a delayed snapshot; the next
normal report obtains a fresh version. Reservations/releases advance the authority
version as well as control changes, so decision-history versions can have gaps.
Never call quiesce or register manually to clear a stuck slot. Lease expiry is
not physical termination. Investigate the owning process/provider call first.

The existing authorized DLQ actions remain available. Root discard retains a
cancelled transport tombstone and admission history instead of cascading physical
slots away. Explicit replay resets only quiescent admission intent; a live Root
retains its slot. Accepted decisions, legal pins, checkpoint ancestry and usage
are never cleared by these transport actions.
An eligible command outside the bounded fairness window is deferred, never
classified obsolete because of rank. Exact command/lifecycle eligibility is
checked independently; only a superseded, consumed or ineligible command may
take the obsolete ACK path. Owner history is aggregated once for fair selection.

## Drain, deployment and first activation

1. Capture exact deployed/target SHA, configuration fingerprints, database
   migration state, image digest, broker occupancy and actual native runs using
   `scripts/assessment-root-capacity-preflight.py`. Preserve local changes/data.
2. Verify disk/RAM/DB headroom. At the captured Fogewise free disk of about
   1.86 GB, rebuild/canary is **BLOCKED**. Do not prune Docker, delete customer
   sandboxes or lower production safety thresholds to obtain a PASS.
3. On an already upgraded runtime, run `node scripts/drain-agent-runtime.mjs`
   using private `.env.pm2` credentials. It sets server drain and polls real
   native futures/reservations until quiescent. Unsupported/invalid responses
   fail closed. Interrupting the command leaves drain enabled safely.
4. **First upgrade from LCSP-346:** the old server has no drain endpoint. The
   automated deploy therefore refuses it. Arrange the established maintenance
   admission pause, confirm broker/native quiescence, and stop only the runtime
   through its existing graceful lifecycle while observing child termination.
   Independent operator verification of zero live writers is required before
   installing this revision. There is no force/skip-drain flag. This bootstrap
   procedure has not yet been exercised on Fogewise.
5. Keep the old checkout/image as rollback targets. The updated `redeploy.sh`
   requires exact `LCSP_DEPLOY_EXPECTED_SHA`, clean checkout and fast-forward
   pull; it drains before source/build/migration changes. A failed restart does
   not kill the PM2 daemon or unrelated services. Use the existing exact-revision
   checkout/pull workflow; never run a reset/clean to overwrite server changes.
6. Start the single server, inspect new incarnation and bounded recovery, then
   validate health **and** the revision-bound native canary. Registration pins
   host identity; automatic cross-host takeover is forbidden. An API restart
   requires no leader takeover: the durable row lock coordinates evaluations.

For an aborted build with the original runtime still healthy, run
`node scripts/drain-agent-runtime.mjs --resume-admission` after restoring the
validated checkout/configuration. Do not resume an unhealthy or partially replaced
runtime. SIGTERM waits for actual native/model/accounting work; an unabortable call
can prolong shutdown. Do not force-kill it to meet a deployment deadline.

## Disable and rollback

For policy rollback, set enabled false, manualOverride null, initial/maximum 2,
and preserve safety thresholds. Existing excess Roots drain; new admission waits
until occupancy is below the fresh safe ceiling. Test Stop/Continue and HITL on
the same canonical thread/checkpoint. Disabling adaptive mode does not disable
global admission or paid-call governance.

For binary rollback, drain all native execution first, preserve evidence and
restore the recorded previous exact SHA/image and bounded 2/2/2 environment with
the existing process manager. This migration is additive; leave its operational
tables intact. Never reset/drop historical Assessment, checkpoint, usage or legal
data. A host migration additionally requires proof the old host cannot write;
the new host is deliberately rejected until an authorized operational recovery
is designed and reviewed. No automatic host-rebinding bypass is provided.

## Reproduce local verification

Use dedicated loopback test PostgreSQL and RabbitMQ, never production/proxy queues.
Run `pnpm run build:runtime-packages`, Prisma generate/migrate deploy against the
disposable DB, then API Jest `test/assessment-root-capacity.integration.spec.ts`
with `LCSP_TEST_CAPACITY_DATABASE_URL` pointing to a local `lcsp364_capacity*` DB.
Run `deepagents/.venv/bin/python -m pytest` from `deepagents`; enable the real broker
tests with `LCSP_TEST_RABBITMQ_URL` pointing to the disposable broker.

The native 1/2/4/8 load uses `LCSP_TEST_CAPACITY_LOAD=1 node
tests/assessment-domain-vertical.mjs`, a built API, test PostgreSQL on 55441 and a
dedicated RabbitMQ management broker on 5678/15678. It uses two real bridge
connections, one real server, real native Root/tools/checkpoints and a scripted
model/local filesystem. Its separately audited fixture envelope uses 512 MiB per
Root and 1 GiB disk headroom because it performs no clone/image build/sandbox
work. It never proves paid-provider, Docker workload or production acceptance.
The normal 4 GiB policy correctly refused this local host's roughly 2.37 GB disk.
All graphs generated from the saved timeline must be labelled derived measurements.

## Mixed-version canary isolation

An external API sharing the DB can claim the same pending outbox and publish to
its own broker. A private broker alone does not isolate the execution. Before a
new canary is activated, apply migration `20261031120000_assessment_execution_isolation`
and create a distinct, non-superuser PostgreSQL login for the Fogewise API. Grant
schema USAGE, table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT; do not
grant role membership or superuser rights. Store its generated password only in
the existing private deployment configuration. Migrations still use the previous
privileged migration login. Verify the actual API process login after restart;
dotenv does not override a stale inherited PM2 environment by default.

With the built API and its new `DATABASE_URL`, run
`LCSP_TEST_GRANT_ADMIN_ID=<verified-admin-id> node scripts/lcsp364-enroll-canary.mjs <assessment-id>`.
This script only permits the exact acceptance customer and an unstarted PREPARING
Assessment. It locks the Assessment, verifies the actual login and records an
idempotent audited enrollment. Do not enroll Canary A retrospectively, transfer
ownership of existing work, or alter its failed history.

For an enrolled Assessment, the DB converts new pending/retrying events to
`OWNED_PENDING`. Old publishers do not select this status. The current publisher
selects it only as the enrolled login and preserves UTC retry/backoff, bounded
batches, row locks, mandatory routing and broker confirmation. DB triggers reject
other logins' changes to the Assessment, outbox and canonical tables carrying an
assessmentId, including turns, decisions, facts and usage. `SET ROLE` cannot
impersonate `session_user`. This protects against accidental old application
writers, not malicious database superusers. No new Root or scheduler is created.

Verify a foreign-login no-op UPDATE of the new test Assessment fails with 42501,
ordinary unrelated writes remain operational, all local broker connections map
to the owned API/bridge processes, and the canary's command reaches that broker.
Only after that proof may a scoped canary proceed while unrelated external
executions remain untouched. Record this as scoped isolation, never as global
quiescence or proof that unsupported external workers obey the new global cap.
Local maintenance still requires actual native futures and broker deliveries to
be quiescent. Do not stop external processes or expire their leases manually.

If broker ready/unacked is zero but durable waiting age grows, inspect canonical
execution/turn state and command timestamps. A legacy terminal Root can have no
physical/admission bookkeeping. Matching completed FAILED/SUCCEEDED turns consume
strictly older commands for eligibility purposes; the query leaves every historical
row intact. Never clear an intent, lease or accepted decision just to unblock a
canary. Live physical slots retain capacity through terminal callbacks until the
actual execution is quiescent; later continuation commands use the same Root/thread.

Policy disable is the supported rollback during isolated unfinished work. Keep
the upgraded API login, route table and global admission checks. Binary rollback
to an old publisher is blocked until enrolled work is terminal/quiescent and no
owned event remains pending; the enrollment/history stays intact. Never delete
the fence to make an old worker accept protected work.

## Audited test funding

`scripts/lcsp364-test-credit.mjs` uses the compiled public API operations entry,
the existing user transaction lock, `BillingAccountingKernel.appendLedger()` and
its wallet projection. It verifies the exact acceptance customer and an active
ADMIN, grants 1,000,000 test credits with source `INTERNAL_TEST_GRANT`, reference
LCSP-364 and a fixed unique idempotency key, and appends its audit in the same
transaction. No SePay payment, order, webhook or revenue is created. Provider
admission, metering, model budgets and reference-cost limits are unchanged.

Run `LCSP_TEST_GRANT_ADMIN_ID=<verified-admin-id> node scripts/lcsp364-test-credit.mjs grant`
with the private deployment environment. Save the sanitized before/after receipt.
Do not make up a new key on retry. After canaries and paid attempts have drained
and reconciled, run the same command with `revoke` for an idempotent negative
ledger entry sourced `INTERNAL_TEST_GRANT_REVERSAL`. It refuses active credit holds
or unrelated positive funding; reconcile those explicitly before retrying.
Record granted, actually debited and remaining credits separately from provider
tokens/costs. The existing kernel has retired new model-credit reservations/debits;
therefore zero wallet debit is not zero provider cost or proof of paid acceptance.

For provider-free regression, build the API and run
`node --test scripts/lcsp364-acceptance.integration.test.mjs` with a disposable
loopback `LCSP_TEST_CAPACITY_DATABASE_URL` (`lcsp364_*`) and test RabbitMQ URL.
This verifies actual PostgreSQL roles/triggers, the real kernel, atomic audit
rollback, grant/reversal idempotency and confirmed broker publication/redelivery.
