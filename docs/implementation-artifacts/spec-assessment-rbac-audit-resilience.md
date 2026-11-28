---
title: 'Assessment RBAC Audit Resilience and Canonical Audit Events'
type: 'bugfix'
created: '2026-11-23'
status: 'done'
review_loop_iteration: 3
baseline_commit: '0e558abbfcecd07cc40e9f694e911a8c43fc391c'
context:
  - '{project-root}/docs/architecture/assessment-antigravity-work-package-prompts.md'
---

<frozen-after-approval reason="Approved Prompt 4 intent">

## Intent

**Problem:** Authorization audit failures are swallowed without recovery, material Assessment events omit canonical AuditEvent records, and sensitive export downloads can return bytes without a durable business audit.

**Approach:** Add a durable authorization-audit outbox fallback with local retry recovery and degraded telemetry; preserve DENY semantics; write canonical Assessment AuditEvents in caller transactions; require a successful business audit before returning export bytes.

## Boundaries & Constraints

**Always:** RBAC only; sanitize payloads; preserve correlation IDs; keep AssessmentEvent, AuditEvent, and outbox as separate records; atomically couple material mutations with their AuditEvent/outbox when they share a transaction.

**Ask First:** Any new external monitoring dependency, broker contract outside the existing outbox, or database model beyond the existing AuditEvent/OutboxMessage stores.

**Never:** Add PBAC/organization, fail-close every ordinary GET when the primary audit sink alone fails, use an in-memory-only fallback, return sensitive download bytes after business-audit failure, or modify the audit report.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Read ALLOW | Primary audit fails, fallback persists | Request continues; degraded metric/alert emitted | No raw error leak |
| Both sinks fail | ALLOW decision | Protected action stops | Safe 503 |
| DENY | Audit sinks fail | Decision remains DENY | Guard 403 / preflight DENY |
| Material event | Event append in transaction | AssessmentEvent + AuditEvent + outbox commit once | Any write failure rolls back |
| Export download | Valid owner-bound export, audit fails | No bytes returned | Safe 503 |

</frozen-after-approval>

## Code Map

- `apps/api/src/platform/rbac/*` -- authorization decision persistence, fallback, telemetry, guard and preflight policy.
- `apps/api/src/platform/outbox/outbox-publisher.service.ts` -- durable local recovery of authorization audit fallbacks.
- `apps/api/src/modules/assessment/application/services/assessment-event-appender.service.ts` -- transactional canonical audit creation.
- `apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.ts` -- sensitive download business-audit gate.
- `packages/contracts/src/{rbac,outbox}` -- canonical event/value constants.

## Tasks & Acceptance

**Execution:**
- [x] Rewrite ASM-RBAC-01/02 and retain ASM-AUDIT-01; observe RED.
- [x] Implement durable fallback, recovery, telemetry and safe fail-closed boundary.
- [x] Add canonical Assessment AuditEvent and sensitive download audit gate.
- [x] Run focused/adjacent tests, static gates, independent reviews and Graphify update.

**Acceptance Criteria:**
- Given a valid ordinary read ALLOW whose primary audit write fails, when durable fallback succeeds, then authorization continues with degraded telemetry and recoverable outbox evidence.
- Given a DENY or unavailable fallback, when auditing fails, then no audit failure can produce ALLOW or leak internal errors.
- Given a material Assessment event, when its transaction commits, then AssessmentEvent, canonical AuditEvent and outbox are present exactly once.
- Given a sensitive export download, when its business audit cannot persist, then no bytes are returned and the client receives safe 503.

## Spec Change Log

- Review remediation separated local recovery from broker batches, introduced occurrence-scoped canonical audit idempotency, validated fallback identity/reason codes, scoped export lookup at the database boundary, bounded correlation IDs and masked infrastructure failures.
- Broker connection and publish confirmation now have typed deadlines, generation fencing, reconnect behavior and cleanup for partially established AMQP resources so external outages cannot starve later local audit recovery.

## Verification

**Commands:**
- Focused Jest for RBAC, outbox, appender and rule-audit specs.
- Final focused/adjacent result: 11 suites, 171 passed; the separate Prompt-6 ASM-EXPORT-01 RED test was excluded and preserved.
- Monorepo typecheck, changed-file ESLint, business-documentation, import, contract-literal and architecture gates passed. Architecture retains three pre-existing warnings outside this work package.
- Independent security, clean-architecture and adversarial reviews: APPROVE after three remediation loops.
