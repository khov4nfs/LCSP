---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy']
lastStep: 'step-03-test-strategy'
lastSaved: '2026-11-23'
storyId: 'assessment-admin-metadata-boundary'
storyKey: 'assessment-admin-metadata-boundary'
storyFile: 'docs/specs/spec-assessment-admin-metadata-boundary/SPEC.md'
atddChecklistPath: 'docs/test-artifacts/atdd-checklist-assessment-admin-metadata-boundary.md'
generatedTestFiles: []
inputDocuments:
  - 'docs/specs/spec-assessment-admin-metadata-boundary/SPEC.md'
  - 'apps/api/jest.config.ts'
  - 'apps/api/src/modules/assessment/infrastructure/persistence/assessment-detail.loader.spec.ts'
  - 'apps/api/src/modules/assessment/presentation/http/assessment-admin-rbac.red.spec.ts'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/data-factories.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/component-tdd.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/test-quality.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/test-healing-patterns.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/test-levels-framework.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/test-priorities-matrix.md'
  - '.agents/skills/bmad-testarch-atdd/resources/knowledge/ci-burn-in.md'
---

# ATDD Checklist — Assessment ADMIN Metadata-Only Boundary

## Preflight and context

- Detected stack: fullstack monorepo; this story's primary test surface is backend Jest unit/contract coverage.
- Approved acceptance contract: `docs/specs/spec-assessment-admin-metadata-boundary/SPEC.md`.
- Existing framework: `apps/api/jest.config.ts` with ESM `ts-jest` configuration.
- Existing RED tests: ASM-ADMIN-01/02 in the detail-loader spec and ASM-ADMIN-03/04 in the RBAC metadata spec.
- Affected integration points: assessment list/detail query handlers, shared contracts, provenance controller and workspace runtime SSE controller.
- Priority: P0 because this is a cross-customer data-minimization and authorization boundary.
- Test data strategy: deterministic in-memory Prisma mocks with explicit CUSTOMER/ADMIN roles; no browser or external-service fixtures are required.

The user already approved Prompt 2 and its acceptance contract, so the loaded inputs are confirmed for implementation.

## Generation mode

AI generation is selected because the affected behavior is a deterministic backend authorization and projection contract with existing Jest RED tests. Browser recording would not improve coverage of the persistence `select` clauses or RBAC decorator metadata.

## Test strategy

| Acceptance criterion | Level | Priority | RED coverage |
|---|---|---:|---|
| ADMIN list returns unowned operational metadata without owner impersonation | Unit/contract | P0 | ASM-ADMIN-01 |
| ADMIN detail uses a safe scalar-only query and exact metadata projection | Unit/contract | P0 | ASM-ADMIN-02 plus strengthened select/shape assertions |
| Provenance transport excludes ADMIN | RBAC metadata unit | P0 | ASM-ADMIN-03 |
| Customer content-rich workspace SSE excludes ADMIN | RBAC metadata unit | P0 | ASM-ADMIN-04 |
| CUSTOMER list/detail remain owner-scoped with unchanged content projection | Unit regression | P0 | Existing customer loader and query-handler tests |
| ADMIN read authority does not change mutation decorators | RBAC metadata regression | P0 | Assessment controller decorator assertions |

The four existing ASM tests must fail before production changes. Strengthened tests will additionally prove that ADMIN queries use Prisma `select` rather than `include`, the returned object has no content keys, and customer behavior remains unchanged.
