# Bounded independent Assessment execution (LCSP-346)

One supported production topology is one RabbitMQ bridge and one LCSP Agent Server.
Each Assessment still has one authoritative Root and one pinned repository. This
change does not implement multi-repository Assessments or rule selection.

## Root causes and bounds

Previously the bridge defaulted to prefetch 1 and four boundary threads. The one
Root consumer could therefore receive only one unsettled delivery. Also,
`max(prefetch, configured_workers)` silently increased an explicit worker cap,
and `ThreadPoolExecutor` could accumulate submissions across reconnects or
timed-out, still-running dispatches.

The bridge now defaults to two workers and prefetch equal to worker capacity.
It applies both per-consumer prefetch and shared channel credit. A nonblocking
semaphore bounds submitted work for the entire executor lifetime, across broker
connections. The Agent Server also caps restored and new graph execution at the
smaller of its configured capacity and the boundary worker capacity.

| Setting                                | Default      | Supported behavior                                            |
| -------------------------------------- | ------------ | ------------------------------------------------------------- |
| `LCSP_AGENT_RUNTIME_BOUNDARY_WORKERS`  | 2            | Authoritative process cap, 1 through 64                       |
| `LCSP_AGENT_RUNTIME_RABBITMQ_PREFETCH` | worker count | Per-consumer credit, 1 through 65535; 0/unlimited is rejected |
| `LCSP_AGENT_RUNTIME_JOBS_PER_WORKER`   | 8            | Server execution is capped at `min(jobs, boundary workers)`   |

With `W` workers, `P` prefetch and `Q` boundary consumers on the shared channel,
unacknowledged deliveries are bounded by `min(W, P * Q)`, submitted bridge work
by `W`, and executing server graphs by `min(W, jobs)`. For the single Root queue,
normal concurrent Root admission is at most `min(W, P, jobs)`. Explicit prefetch
1 retains serial Root dispatch. Worker capacity 1 remains supported.

Two workers is the initial production setting for the 8 GiB Fogewise host;
production acceptance must record measured memory and actual Root overlap before
claiming that setting is production-validated.

## Delivery ownership and recovery

Successful dispatch ACKs only after the Agent Server run terminates. Admission to
the thread pool never ACKs a delivery. If capacity is still occupied after a
reconnect or timeout, the existing broker retry mechanism durably defers the
delivery for two seconds without incrementing its failure-attempt count. Only a
confirmed mandatory publication permits ACK of that original delivery; failed
publication NACKs/requeues it. Durable deferral is not Assessment completion.

Worker completions and timeout timers schedule settlement through the original
connection's `add_callback_threadsafe`. The delivery-local settlement guard
selects one outcome. Reused delivery tags on a new connection cannot settle an
old delivery. Closing a connection, including SIGTERM, leaves its unsettled work
for broker redelivery. A timeout cannot release executor capacity until the
actual worker future ends. The existing durable server request, API lease and
checkpoint contracts decide whether redelivery reuses or skips execution.

Broker FIFO delivery and bounded credit allow a finite eligible backlog to
progress as slots free. One slow Root leaves the other slot available. This is
not weighted per-account scheduling or a promise of bounded waiting under
unlimited offered load.

## Isolation and authority

The unchanged path is:

`Assessment creation -> Runtime Preparation transaction/pins -> idempotent outbox
-> RabbitMQ Root queue -> bounded bridge executor -> Agent Server transport
thread/advisory lock -> API assessment/runtime row lock and lease -> fresh Root
and repository backend -> canonical Root LangGraph thread/checkpoints -> governed
decisions -> deterministic Completion Gate -> immutable report artifact`.

Each bridge submission runs in a copied Context. Root clients, leases, backend
activation, pins, caches, human requests, cancellation events, stream sessions,
model-step identities and usage state remain run-scoped. Short graph-construction
profile locks, assessment row locks, per-thread advisory locks and atomic usage
journal transactions remain intentional. No global lock surrounds inference.

The claim service still rejects a competing live lease. No legal applicability,
decision validation, full paginated pinned Rule Set coverage, finalization,
paid-admission, recovery or billing policy has moved into the dispatcher.

## Read-only research

The native `task` delegate remains the only researcher and cannot inherit governed
fact, evidence, human-resolution, decision or report tools. Source writes remain
denied. The Root graph explicitly uses native `max_concurrency=1`; each independent
Root owns its own graph, so that setting does not serialize different Assessments.

Parallel research above one is deliberately not enabled: native isolated child
messages do not establish LCSP task-level evidence/usage equivalence. Descendants
share the Root's `SearchTrace` (whose `snapshot_and_reset` consumes accumulated
reads), provider-route state and mutable Root caches. The regression fixture runs
a native batch of two researcher tasks serially and verifies that returned
candidates never become accepted evidence or decisions. Raising this cap requires
the cancellation, late-result, attribution and semantic equivalence proof in the
LCSP-346 acceptance matrix.

## Deployment and production acceptance

1. Record the clean production branch/HEAD, PM2 state, effective process settings,
   active leases, persisted server requests, broker vhost/queues and migration
   status. Preserve server-local environment and unrelated work.
2. After the feature branch is committed, pushed and published as a PR, fetch it,
   safely switch to that branch and pull with `--ff-only`. Verify local, remote PR
   and VPS checkout SHAs are identical. Do not merge for acceptance testing.
3. Synchronize the existing production virtualenv from the committed frozen lock,
   rebuild the affected runtime/sandbox image with the exact revision label and
   restart only `lcsp-agent-runtime` once unrelated active work is absent. API and
   Web builds are unnecessary when their executable sources are unchanged.
4. Check runtime `/ok`, API `/health`, Web, process stability, image/source hashes,
   broker consumer credit and the startup capacity log. Health alone is not PASS.
5. Use two distinct authenticated Customer contexts and one repository per
   Assessment. Record real Root start/end intervals, leases, canonical threads,
   snapshots, sandboxes, stream/model/tool identities and usage reconciliation.
6. Stop A while B progresses, Continue A from its canonical checkpoint, verify
   cross-owner denial and let representative workflows reach their genuine
   terminal states. Leave unknown customer facts unresolved; never create a
   report or change lifecycle state manually.

Sanitized execution history and gate results belong in the PR conversation and
`reports/lcsp346-concurrency/`. Failed and unexecuted scenarios must remain visible.
