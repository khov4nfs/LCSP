# LCSP-364: adaptive global Assessment Root admission

Status: implementation in progress; production acceptance is a separate gate.
Baseline: develop `e19048e1285c224085690cc344efb059c49bdf49`.

The LCSP-346 bridge and Agent Server each bound a startup-sized executor. These
bounds neither adapt nor coordinate several bridge processes. The server persists
requests and checkpoints, but run polling, cancellation and thread coordination
still use local dictionaries. Horizontal Agent Server replication is unsupported.

## Authority and execution topology

PostgreSQL, through the API, owns one capacity row and durable physical execution
reservations. Every reservation, decision and operator change serializes on that
row. The Root claim must bind the reservation's exact native transport run ID.
The existing Assessment lease, canonical Root thread, legal gates and paid-call
admission retain their authority. Reservations are not new Assessment workflows.

One Agent Server owns execution. A host-local exclusive process lock, held until
all executions and callbacks drain, prevents overlapping server incarnations.
The API pins that server's host identity and fences reports/reservations by a
new incarnation ID on restart. A different host cannot take over automatically.
Several bridge consumers may share this single endpoint. No controller leader
lease is necessary: short row-locked evaluations plus a persisted evaluation
timestamp/version serialize controllers across API replicas and restarts.

Executors are constructed once at the authorized physical ceiling. Their private
internals are never resized. The API changes the effective admission ceiling;
unused threads consume no Root/sandbox/provider capacity. Both bridge outstanding
submissions and Agent Server submissions remain bounded. Broker channel credit
remains bounded by physical bridge capacity, independent of effective Root
capacity; refusal is a confirmed durable delay without a failure retry attempt.
Other boundary types keep their existing bounded path.

## Physical capacity, drain and recovery

Expiry of an Assessment lease does **not** free a physical reservation. Neither
`finish`, HITL nor Stop alone proves the enclosing graph has stopped writing.
Only the owning server's post-execution quiescence receipt, or its consistent
live-run reconciliation, releases capacity. Lost receipts retain capacity.
On restart the exclusive process lock proves the previous local incarnation has
terminated. Persisted pending/running requests retain their reservations and
checkpoint identity; absent requests can then be reconciled safely. Network
loss suspends admission and never authorizes a second server or lease takeover
around a living execution. Host migration requires an operator-proven drain.

Scale-down withholds new admissions; already admitted work may exceed the new
target while draining. It is never killed to meet a target. A quiescent human
interrupt releases capacity; Continue competes again on the same canonical Root.
Deployment requires drain before PM2 replacement. The entrypoint must wait for
children after SIGTERM; its former immediate `finally` kill is unsafe for drain.

## Control, demand and fairness

The controller uses fresh, source-labelled host/cgroup/Docker measurements,
actual checkpoint observations, server slots, API/DB observations, broker demand
and usage/admission pressure. Missing measurements remain null. Unknown provider
limits cannot justify scaling beyond the configured conservative fallback.
Critical pressure or stale core telemetry can reduce admission to zero even
with a positive normal minimum. Hysteresis, separate cooldowns and bounded steps
control ordinary changes. An override cannot bypass physical/resource ceilings.

Eligible demand is derived from canonical Root commands and runtime/lifecycle
state, including requested continuations. Admission intent is committed with its
existing outbox command. Publication or an authenticated actual delivery makes
it eligible; a pending unpublished fixture/failed publication does not hide ready
customers. Physical quiescence consumes a started command, while an unstarted
transport request remains eligible for the established broker retry. Fair admission rotates owners by last
admission and then oldest eligible request. It sees durable demand beyond the
current RabbitMQ delivery window, preventing a large customer's queue prefix
from hiding another customer's work. It schedules independent Assessments only.

## Rejected alternatives and limits

- Replicated Agent Servers: local polling/cancellation state is not replica-safe.
- Redis locks, another queue or scheduler: existing API/PostgreSQL/RabbitMQ suffice.
- Mutating `ThreadPoolExecutor` internals: unsupported and hard to drain safely.
- Lease-TTL slot release: a timed-out model/tool can still be alive and writing.
- Queue-only or CPU-only scaling: ignores memory, disk, DB, sandbox and provider bottlenecks.
- Killing Roots on scale-down: breaks checkpoint, accounting and completion safety.

Production preflight on 2026-10-29 found 95% disk use, about 2 GiB free and six
running sandboxes. Rebuild/scale-up remains BLOCKED until fresh preflight proves
a safe rollout envelope. Synthetic load proves controller and transport contracts;
it never establishes real paid/native production semantic acceptance.
