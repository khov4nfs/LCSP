---
title: 'MW-evid-001: Get Technical Evidence Report Endpoint'
type: 'feature'
created: '2026-07-19T22:03:39+07:00'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/docs/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/implementation/tasks/modules/evidence/01-get-technical-evidence-endpoint.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** LCSP persists accepted `TechnicalEvidenceReport` records from trusted scan callbacks but has no protected read endpoint. Managers and scoped Developers therefore cannot review safe evidence provenance and findings.

**Approach:** Add a NestJS evidence query slice that selects the newest accepted report inside the caller's organization and projects only an allowlisted response. Extend RBAC to evaluate either the Manager full-read action or Developer redacted-read action, then apply assessment scope and location redaction server-side.

## Boundaries & Constraints

**Always:** Evaluate session, active membership, policy version and one of `evidence:read` / `evidence:read:redacted` through RBAC; cloak missing, rejected, cross-organization and out-of-scope evidence as the same 404; return only allowlisted finding/provenance fields; null Developer file/line locations; preserve correlation ID and RBAC decision logging; choose the newest accepted immutable report.

**Ask First:** Any schema migration, new dependency, change to callback payload acceptance, or expansion beyond this GET endpoint and the minimal reusable RBAC any-action seam.

**Never:** Return raw `evidencePayload`, source/snippet/content/raw-output fields, secrets, policy internals or rejected reports; authorize from role labels or UI hints; add manual/Local/CI evidence upload; mutate evidence history; make Developer participation required.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Manager read | Accepted same-org report; `evidence:read` allowed | 200 with provenance, privacy flags and valid safe findings including file/line locations | N/A |
| Developer read | Accepted same-org report; matching assessment scope; `evidence:read:redacted` allowed | 200 with identical safe projection but every file/line location is null | N/A |
| Hidden evidence | Missing, rejected, cross-org, or Developer scope mismatch | No evidence data or existence signal | 404 `EVIDENCE_NOT_FOUND` with correlation ID |
| RBAC denial | Policy grants neither accepted action | No query result or evidence data | 403 `RBAC_DENIED`; denied decision includes policy version/correlation ID |
| Unsafe/malformed finding | Accepted row contains extra unsafe keys or invalid finding shape | Project allowlisted fields only; omit malformed finding rather than spread raw JSON | Never serialize unsafe keys, source, raw output or secret-like values |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/rbac/actions.ts` -- canonical Manager and Developer evidence actions.
- `packages/contracts/src/rbac/developer-policy.ts` -- Developer allowlist must reference the canonical redacted action.
- `packages/contracts/src/evidence/` -- stable `EVIDENCE_NOT_FOUND` contract and public export.
- `apps/api/src/platform/rbac/decorators/` and `apps/api/src/platform/rbac/rbac.guard.ts` -- reusable any-action metadata, evaluation, selected-action context and decision audit.
- `apps/api/src/modules/evidence/` -- new controller, CQRS query/handler, response contract, redactor and module wiring.
- `apps/api/prisma/schema.prisma` -- existing `TechnicalEvidenceReport`; no migration expected.
- `apps/api/src/modules/scan/application/services/scan/evidence-schema-validator.service.ts` -- acceptance-time privacy invariants to preserve defense-in-depth.
- `apps/api/test/get-technical-evidence.e2e-spec.ts` -- endpoint coverage for task cases T01-T07.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/rbac/`, `packages/contracts/src/evidence/` -- add canonical evidence actions/error code and exports; remove the Developer raw action literal.
- [x] `apps/api/src/platform/rbac/` -- add tested any-action authorization that records the actual allowed/denied action and exposes the selected action to downstream code without weakening existing single-action routes.
- [x] `apps/api/src/modules/evidence/` and `apps/api/src/app.module.ts` -- implement/wire `GET /assessments/:assessmentId/evidence`, newest accepted tenant-scoped lookup, Developer scope gate and safe DTO projection.
- [x] `apps/api/src/modules/evidence/application/services/evidence/evidence-redactor.service.spec.ts` -- unit-test allowlist projection, malformed-item omission, secret defense and Developer location redaction.
- [x] `apps/api/test/get-technical-evidence.e2e-spec.ts` and shared test cleanup -- cover T01-T07 plus RBAC decision metadata and no existence leak.
- [x] `docs/implementation/tasks/modules/evidence/01-get-technical-evidence-endpoint.md` -- mark DONE only after all verification passes.

**Acceptance Criteria:**
- Given an accepted same-organization report and an authorized Manager, when the endpoint is read, then the response matches the documented contract with full safe finding locations and provenance.
- Given an authorized scoped Developer, when the assigned assessment evidence is read, then only permitted evidence is returned and all file/line locations are null.
- Given absent, rejected, cross-tenant or out-of-scope evidence, when requested, then the endpoint returns one indistinguishable safe 404.
- Given neither evidence action is granted, when requested, then RBAC denies with an audited policy ID/version and correlation ID.
- Given stored JSON contains extra source/raw/secret fields, when projected, then none appear in the serialized response.

## Spec Change Log

## Design Notes

Use a reusable `RequireAnyAction` RBAC metadata form rather than `@RequireSession` plus a manual capability check. The guard evaluates candidate actions against the loaded membership-bound policy, logs the concrete decision, and places the selected allowed action in request context; the evidence handler derives full versus redacted projection from that evaluated action. Query Prisma with `assessmentId + organizationId + accepted`, ordered newest-first, and select columns explicitly. The redactor maps only known finding keys and never spreads persisted JSON.

## Verification

**Commands:**
- `pnpm --filter @lcsp/api test -- --runInBand` -- RBAC and redactor unit suites pass.
- `pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/get-technical-evidence.e2e-spec.ts` -- T01-T07 pass.
- `pnpm --filter @lcsp/api build` -- NestJS/TypeScript build passes.
- `pnpm --filter @lcsp/api lint` -- changed API files pass lint.
- `pnpm run check:imports && pnpm run check:contracts` -- package boundaries and canonical literals pass.

## Implementation Result

- Status: done
- Unit tests: 44 suites, 275 tests passed.
- Evidence/auth e2e tests: 3 suites, 14 tests passed, including MW-evid-001 T01-T07.
- Build, typecheck, lint, import-policy and contract-literal checks passed.
