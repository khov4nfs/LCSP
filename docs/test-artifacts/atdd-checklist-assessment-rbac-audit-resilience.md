---
stepsCompleted: ['preflight', 'red', 'implementation', 'green', 'quality-gates']
lastStep: 'quality-gates'
lastSaved: '2026-11-23T18:30:00+07:00'
storyId: 'ASM-RBAC-01-ASM-RBAC-02-ASM-AUDIT-01'
storyKey: 'assessment-rbac-audit-resilience'
storyFile: 'docs/architecture/assessment-antigravity-work-package-prompts.md'
generatedTestFiles:
  - 'apps/api/src/platform/rbac/prisma-authorization-decision.repository.spec.ts'
  - 'apps/api/src/platform/rbac/rbac.guard.spec.ts'
  - 'apps/api/src/platform/rbac/rbac-preflight.service.spec.ts'
  - 'apps/api/src/platform/outbox/outbox-publisher.service.spec.ts'
  - 'apps/api/src/modules/assessment/application/services/assessment-event-appender.service.spec.ts'
  - 'apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.spec.ts'
---

# ATDD Context — Assessment RBAC Audit Resilience

## Acceptance contract

- An ordinary-read ALLOW may continue during primary AuditEvent outage only after a deterministic local outbox fallback is durable and degraded telemetry is emitted.
- Failure of both primary and fallback stores rejects ALLOW with a safe 503; DENY remains DENY even if audit persistence fails.
- Local fallback recovery writes the canonical AuditEvent and acknowledges the outbox row in one transaction without depending on RabbitMQ.
- Material AssessmentEvent, canonical AuditEvent and outbox delivery intent remain separate records but commit or roll back together.
- A sensitive rule-audit export returns no bytes until its business audit succeeds.

## RED evidence

Before production changes, the Prompt 4 reproducer run observed seven relevant failures: guard ALLOW did not stop when both sinks failed; preflight could preserve an unauditable ALLOW; primary failure had no durable fallback or both-sink propagation; the outbox could not locally restore authorization audit evidence; AssessmentEvent omitted canonical AuditEvent; and export bytes escaped when business-audit persistence failed. The separate ASM-EXPORT-01 RED test belongs to Prompt 6 and was preserved unchanged rather than fixed here.

## GREEN validation

- Focused plus adjacent Jest: 11 suites, 171 passed, 1 Prompt-6 test excluded by name; final RabbitMQ timeout/resource-cleanup subset: 2 suites, 32 passed.
- Regression locks cover primary/fallback failure, occurrence-scoped idempotency, degraded health telemetry, DENY preservation, broker-independent local recovery, identity/reason validation, sanitized retry persistence, bounded retry, connection/publish deadlines, partial-resource cleanup, exact transaction identity, rollback propagation, database-scoped export ownership and no sensitive bytes after audit failure.
- Monorepo TypeScript build/typecheck: exit 0.
- Changed-file ESLint: exit 0.
- Business-logic documentation check and checker tests: exit 0.
- Import and contract-literal gates: exit 0.
- Architecture gate: exit 0 with three pre-existing warnings outside the Assessment/RBAC change surface.

## Handoff constraints

The source audit report and Antigravity prompt documents remain unchanged. No PBAC, organization boundary, worker-key rotation, commit, push, PR or audit-report GREEN edit is included.
