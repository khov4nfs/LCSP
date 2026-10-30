# LCSP-364 review regressions

Review baseline: `b360cfb306ce370f5fe72537fe34ec3df4d1a013`, khov4nfs
CHANGES_REQUESTED. Production acceptance remains BLOCKED. These are provider-free
regressions, not production or paid semantic/accounting evidence.

## P1 — eligible command outside the fairness window

Root cause: `waiting()` returned at most 10,000 candidates. `reserve()` used absence
from that window as an obsolescence proof. The obsolete signal went through the
real SDK/server path to a broker ACK without durable capacity retry.

Fix: check the exact Assessment's current command against the same canonical
eligibility predicate independently of rank. Capacity/fairness refusal defers it.
Admission reads only the fair head; command lookup uses the existing Assessment
aggregate index, and owner history is aggregated once instead of once per candidate.
No transaction timeout, resource threshold or execution ceiling was raised.

The real PostgreSQL fixture creates **10,001 pending commands**, delivers the last
first, verifies non-obsolete deferral, then verifies that the other owner's late
command can enter after the first owner's reservation quiesces. These are unstarted
admission reservations, not claims of 10,001 native executions.

The combined PostgreSQL/API/HTTP Agent Server/SDK/RabbitMQ regression verifies:

- An eligible out-of-order command receives durable capacity retry before original ACK.
- A genuinely obsolete key is ACKed without another retry copy.
- Two original delivery tags are settled on the connection thread; one persistent
  retry copy remains, with failure attempt 3 preserved.
- No native Root/provider executes in this admission/settlement fixture.

The test fails on the baseline; after the fix all 17 PostgreSQL integration cases,
including this actual broker path, pass locally. Bulk fixtures use no manual ANALYZE
or increased production transaction timeout. CI provisions the dedicated RabbitMQ
service and Python dependencies in the required PostgreSQL admission job.

## P1 — unbounded synchronous compatibility endpoint

Root cause: `POST /threads/{thread_id}/runs/wait` called the graph on an anyio thread
without a physical slot, tracked Future, global admission or drain check.

Fix: remove the unused compatibility route and its direct graph method in all
modes. LCSP's supported SDK flows use run create/poll/cancel. Repository caller
discovery found no supported wait-route callers; native SDK/image/load CI remains
required on the new head.

The production-mode HTTP regression occupies the actual bounded executor, then
sends 16 concurrent compatibility requests with and without drain. Baseline returns
200 and executes extra graphs; fixed code returns 405 for every compatibility
request, creates no extra Future, and retains physical concurrency one. The
supported create endpoint returns 429 at saturation/drain; the original run drains
and remains readable through polling.

## Verification and disposition

Raw sanitized local logs and source fingerprints are summarized in
[review-regressions.json](review-regressions.json). The red receipts intentionally
fail on the baseline. Full exact-head CI results are published in the PR/Jira;
older 46-check receipts apply only to b360cfb30 and do not prove this follow-up.

GitHub is not Draft at review capture. CHANGES_REQUESTED is not dismissed by this
implementation. Independent re-review, production resource preflight/activation,
A–H canary, paid reconciliation and rollback retain their original gates. No
production mutation, merge or Jira Done transition is part of these fixes.
