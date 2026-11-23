---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-11-23T15:50:00+07:00'
storyId: 'ASM-16-ASM-17'
storyKey: 'assessment-final-report-lifecycle'
storyFile: 'docs/architecture/assessment-antigravity-work-package-prompts.md'
atddChecklistPath: 'docs/test-artifacts/atdd-checklist-assessment-final-report-lifecycle.md'
generatedTestFiles:
  - 'apps/api/src/modules/assessment/application/commands/submit-assessment-final-report/submit-assessment-final-report.handler.spec.ts'
  - 'apps/api/src/modules/assessment/infrastructure/persistence/assessment-report.loader.spec.ts'
  - 'apps/api/src/modules/assessment/application/services/final-report-error-classifier.spec.ts'
  - 'apps/api/src/platform/storage/artifact-storage.service.spec.ts'
inputDocuments:
  - 'docs/architecture/assessment-antigravity-work-package-prompts.md'
  - 'docs/architecture/assessment-module-audit-red-test-handoff.md'
  - 'apps/api/AGENTS.md'
  - '.agents/memory/lessons-learned.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/data-factories.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/component-tdd.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/test-quality.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/test-healing-patterns.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/overview.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/api-request.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/auth-session.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/recurse.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/ci-burn-in.md'
---

# ATDD Context — Assessment Final Report Lifecycle

## Preflight

- Stack: backend-scoped NestJS/Jest work inside the LCSP monorepo.
- Approved requirement source: Prompt 3, covering ASM-16 and ASM-17.
- Test framework: `apps/api/jest.config.ts` with existing focused handler and loader specs.
- Development environment: repository dependencies and scoped Jest runner are available.

## Acceptance contract

- Replace superseded compensating-erase behavior with synchronous two-phase `BUILDING → storage verify → ACTIVE` publication.
- Preserve the authoritative BUILDING row across storage or activation failure.
- Resume the same artifact for the same request digest; reject a different digest with safe 409.
- Serve only ACTIVE reports.
- Classify integrity problems as 409, dependency outages/timeouts as safe 503, and unexpected failures as masked 500.

## Affected test surfaces

- `submit-assessment-final-report.handler.spec.ts`: ASM-REPORT-01A/B/C.
- `assessment-report.loader.spec.ts`: ASM-REPORT-01D and ASM-REPORT-02.
- Adjacent final-report handler/loader tests remain regression coverage.

## Generation mode

- Mode: AI generation.
- Reason: Prompt 3 is a backend transaction/storage lifecycle contract with explicit acceptance cases; browser recording would add no behavioral evidence.

## Test strategy

| ID | Priority | Level | Scenario | RED reason before implementation |
|---|---|---|---|---|
| ASM-REPORT-01A | P0 | Handler integration-unit | Phase-1 BUILDING transaction fails before storage | Current handler writes storage before creating the row. |
| ASM-REPORT-01B | P0 | Handler integration-unit | Storage fails after BUILDING commit | Current flow leaves no authoritative BUILDING row and propagates a raw error. |
| ASM-REPORT-01C | P0 | Stateful handler integration-unit | Activation fails, then same digest resumes the same artifact | Current single transaction rolls back BUILDING and existing BUILDING is always rejected. |
| ASM-REPORT-01C-concurrency | P0 | Stateful handler integration-unit | Same digest converges; different digest conflicts | Current static mock cannot model the unique-row race or winner replay. |
| ASM-REPORT-01D | P0 | Loader unit/integration-unit | BUILDING/INVALID/SUPERSEDED never read storage | Existing guard is expected to be GREEN characterization coverage. |
| ASM-REPORT-02 | P1 | Loader unit/integration-unit | Integrity=409, dependency=503, unexpected=masked 500 | Current catch-all turns every non-HTTP failure into 409 and leaves the initial DB read unclassified. |

The handler harness must persist committed state across transactions and retries, model rollback and phase-specific failures, and preserve explicit assertions in each test. No test may assert compensating deletion of shared content-addressed chunks.

## ATDD generation receipt

- API scaffold output: 18 proposed assertions aggregated into the existing handler and loader specs rather than overwriting their established fixtures.
- E2E scaffold output: 0 tests; this work package has no browser surface.
- Fixtures: stateful artifact row, transaction rollback, phase-specific failure injection, P2002 winner reload, metadata drift, and typed dependency errors.
- Activated tests are permanent regression tests; no `it.skip()` remains for this work package.

## RED evidence

The focused Jest run failed before production changes with 6 reproductions: storage was called before BUILDING commit, storage failure left no durable BUILDING row, same-digest retry conflicted, storage outage returned 409, DB outage escaped unclassified, and unexpected failure returned 409. Review-driven RED additions also reproduced query-level BOLA absence, incomplete BUILDING pin revalidation, builder DB outage returning 422, local storage outages returning 500, and write round-trip corruption returning 400. The final review remediation added four independently observed RED paths: Git SHA casing drift returned 409, a foreign scan-job pin replayed successfully, Prisma `P2034` returned 500, and a valid P2002 constraint-name target failed to converge.

## GREEN validation

- Final focused/adjacent Jest result: 5 suites, 63 tests passed.
- Covered: ASM-REPORT-01A/B/C/D, array and constraint-name unique-row convergence, different-digest conflict, Tx2 rollback after post-update completion failure, ACTIVE/Assessment lifecycle consistency, BOLA query scoping, normalized Git SHA pins, scan-job Assessment/snapshot binding, ASM-REPORT-02 409/503/500 classification including P2034, atomic concurrent chunk publication, explicit storage-integrity typing, and dependency deadline behavior.
- TypeScript `tsc --noEmit`: exit 0.
- Changed-file ESLint: exit 0.
- Business-logic documentation check and its test suite: exit 0.
- Import, contract-literal, and architecture gates: exit 0 (architecture retains three pre-existing warnings and no errors).

## Handoff

Story source: `docs/architecture/assessment-antigravity-work-package-prompts.md` (preserved unchanged). The next workflow is independent code/security review followed by Codex handoff; no commit, push, PR, or audit-report GREEN edit is authorized.

