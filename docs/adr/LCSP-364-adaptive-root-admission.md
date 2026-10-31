# LCSP-364: adaptive global Assessment Root admission

Status: implementation in progress; production acceptance is a separate gate.
Initially verified develop: `e19048e1285c224085690cc344efb059c49bdf49`.
Refreshed and rebased before publication onto actual develop
`9d677b8fc308bdc4ac7ce27addb74e796b58b880`.
Before delivery, integrated the next verified develop head
`aa2ce4f3f7c5b1b6375eaf659bee0197aa61803b` (merged MFA security #433).

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
Registration compares a freshly read control version: a delayed old handshake
cannot fence a newer owner. A later invalid environment seed cannot overwrite
or block an already persisted, audited policy.
Reports also compare that version, which advances on reservation and release.
An old report delayed beyond its HTTP timeout cannot reconcile away a slot
admitted by a newer operation. Audit decision versions may therefore have gaps;
the control version is an authority generation, not a count of scale decisions.
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
The unused synchronous `runs/wait` compatibility route is removed. All HTTP
execution enters the tracked create/poll/cancel lifecycle; concurrent compatibility
requests cannot acquire compute outside physical capacity or bypass drain.

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
The collector includes visible cgroup ancestors because limits are hierarchical
([Linux kernel contract](https://docs.kernel.org/admin-guide/cgroup-v2.html));
hidden delegated ancestry is unknown. Containerized Agent Server execution is
not an enabled rollout topology; the supported server is the single PM2 process.

Eligible demand is derived from canonical Root commands and runtime/lifecycle
state, including requested continuations. Admission intent is committed with its
existing outbox command. Publication or an authenticated actual delivery makes
it eligible; a pending unpublished fixture/failed publication does not hide ready
customers. Physical quiescence consumes a started command, while an unstarted
transport request remains eligible for the established broker retry. Fair admission rotates owners by last
admission and then oldest eligible request. It sees durable demand beyond the
current RabbitMQ delivery window, preventing a large customer's queue prefix
from hiding another customer's work. It schedules independent Assessments only.
Eligibility is checked by exact Assessment/command independently of the bounded
fairness window. An eligible out-of-order delivery is deferred rather than ACKed
as obsolete. Admission selects only the fair head and aggregates owner history
once, so large backlogs do not multiply history scans while holding global authority.
An older mixed-version writer can leave admission intent unbound after recording
a completed FAILED/SUCCEEDED Root turn. Such a matching terminal turn excludes
its strictly older command from waiting/duplicate admission without rewriting
history. A held physical slot still defers redelivery until actual release, and
a newer or same-millisecond continuation command remains eligible. This prevents
a settled legacy command from becoming a permanent global fairness head.

## Rejected alternatives and limits

Mixed-version production canaries additionally opt into an audited PostgreSQL
writer-role fence before activation. Their pending outbox uses OWNED_PENDING,
which old publishers do not select, and only the enrolled DB login may mutate
their canonical Assessment records. A dedicated broker alone is insufficient:
an old API can take shared pending outbox rows and send them elsewhere. The fence
never transfers historical work or replaces Root leases, admission, checkpoints,
paid governance or legal authority. Unrelated external processes remain untouched;
this is scoped isolation, not a claim of all-writer/global quiescence. Binary
rollback cannot remove the fence or resume unfinished protected work on old code.

- Replicated Agent Servers: local polling/cancellation state is not replica-safe.
- Redis locks, another queue or scheduler: existing API/PostgreSQL/RabbitMQ suffice.
- Mutating `ThreadPoolExecutor` internals: unsupported and hard to drain safely.
- Lease-TTL slot release: a timed-out model/tool can still be alive and writing.
- Queue-only or CPU-only scaling: ignores memory, disk, DB, sandbox and provider bottlenecks.
- Killing Roots on scale-down: breaks checkpoint, accounting and completion safety.

Production preflight on 2026-10-30 at 09:01 UTC found 95% disk use, 1,859,514,368 bytes free and three
running sandboxes. Rebuild/scale-up remains BLOCKED until fresh preflight proves
a safe rollout envelope. Synthetic load proves controller and transport contracts;
it never establishes real paid/native production semantic acceptance.
