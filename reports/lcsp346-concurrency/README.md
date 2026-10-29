# LCSP-346 acceptance record

Implementation branch: `feat/LCSP-346-bounded-assessment-concurrency`.
Verified develop/local/production baseline: `70ddc3c086678edabb6b7a9f6627685841afbafb`
(PR #439, following checkpoint-durability PR #438).

## Verified baseline

- Production checkout `/srv/apps/LCSP`, clean `develop`, PM2 API/Agent Runtime/Web.
- Active RabbitMQ vhost: `lcsp-sync-20261028` (not `/`). One Root consumer,
  prefetch 1, no ready/unacknowledged Root deliveries at preflight.
- Source defaults: four bridge workers, eight Agent Server workers. Effective
  Root delivery credit: one. No live API Root leases at the recorded preflight.
- Production has historical RUNNING/QUEUED labels with expired/missing leases;
  these labels are not evidence of executing Roots and are not modified.
- 136 applied database migrations; zero incomplete migrations.
- Active pinned Rule Set authority: `97004ff3-9240-4e37-8a94-9ade8832c00a`.
- Initial available memory approximately 3.7 GiB on an 8 GiB host.
- Production native dependencies: Deep Agents 0.7.17, LangGraph 1.2.18,
  LangGraph SDK 0.4.10, matching the committed lock.

## Local verification history

- Initial focused consumer/concurrency run: 60 passed.
- Real RabbitMQ 4 credit/overlap tests: 2 passed; subsequently expanded with a
  real-process SIGTERM/redelivery test. Final focused concurrency suite including
  that scenario: 20 passed, then 22 passed after worker-bound/admission additions.
- Clean source-matching verification worktree, no `.env`: **2002 Python tests
  passed, 22 explicitly skipped**. Test input hashes are retained with the run.
- Isolated API regression: **188 suites / 1493 tests passed**, 11 suites / 115
  tests explicitly skipped.
- Workspace typecheck, business documentation/checker tests, import policy,
  contract literals, retired authority absence, billing source gate, workflow
  formatting, launcher checks and seven semantic-oracle tests passed.
- Isolated API E2E: **20 suites / 175 tests passed**, four suites / 22 tests
  explicitly skipped. An additional real PostgreSQL durable request/checkpoint
  reconnect-and-owned-erasure test passed separately.

Earlier attempts are not acceptance: the existing local virtualenv initially had
LangGraph 1.2.11 despite the committed 1.2.18 lock; it was synchronized with
`uv sync --frozen --extra dev`. A new test initially asserted the wrong native
ReadResult field and was corrected. A direct metering fixture initially omitted
the production model-step activation scope and was corrected. The full suite
from a checkout containing `.env` exposed a legacy environment-sensitive test;
an arbitrary external cwd also violated existing cwd-dependent fixture contracts.
The final full run used a clean Git worktree with identical candidate source
hashes. An initial API E2E startup lacked the generated Prisma Client; it was
regenerated after the parallel suites completed and E2E restarted.

Saved logs are sanitized. One local environment-sensitive failure echoed a
database credential in tool output; credential rotation remains an operator
follow-up. No credential is included in this report or publication artifacts.

## Production plan and current gates

Two existing authorized Customer accounts have authenticated in separate browser
contexts. No LCSP-346 paid Assessment has been launched before PR deployment.
Use AI-Proctored-System for A and credit_score_engine for B. Reuse their overlap
for P1/P2, exercise P4 while both are active, and use provider-free broker tests
for excess-load/destructive fault scenarios to avoid duplicate paid runs.

The Jira connector still grants a different site. The requested site rejects
access, and LCSP-346 is absent on the granted site. The user-supplied mission is
the implementation scope; no Jira status is changed.

| Gate                             | Current state                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| A implementation                 | Local implementation and observable overlap proven; production proof pending          |
| B automated regression           | Python/API unit/API E2E/static and real PostgreSQL recovery PASS, with explicit skips |
| C PR/CI                          | Pending commit/push/PR                                                                |
| D exact production convergence   | Pending PR                                                                            |
| E real cross-account concurrency | Not executed                                                                          |
| F scope preservation             | No multi-repository, rule-selection, legacy dispatcher or legal authority changes     |

This file will be supplemented by revision-bound deployment and production
execution evidence. Neither a healthy restart nor these provider-free tests
constitutes production Assessment acceptance.
