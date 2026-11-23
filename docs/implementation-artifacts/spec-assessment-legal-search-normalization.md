---
title: 'Assessment legal-search normalization'
type: 'bugfix'
created: '2026-11-24'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'f88795701caa2b442fe4e93f335f7367cc2f1322'
context:
  - 'docs/project-context.md'
  - 'apps/api/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Pinned legal-source keyword search deduplicates raw terms case-sensitively. Equivalent case and Unicode compatibility variants consume separate term slots and generate redundant Prisma `AND` predicates despite case-insensitive database matching.

**Approach:** Canonicalize every term once at the application search boundary using Unicode NFKC and locale-independent lowercase, then remove unusable terms, deduplicate in first-occurrence order, and apply the existing term limit.

## Boundaries & Constraints

**Always:** Normalize before length filtering and deduplication; remove empty and shorter-than-two-character terms after normalization; preserve deterministic first-occurrence order; apply `MAX_TERMS` after dedupe; keep one `AND` clause per canonical term; preserve lease authorization, assessment pins, pinned `legalSourceVersionId`, result ordering, truncation and existing result contracts.

**Ask First:** Any request-schema, database index/migration, wildcard escaping, minimum-term-length, corpus normalization, or search-result behavior change beyond canonical term normalization.

**Never:** Introduce locale-dependent casing, semantic/vector search, fuzzy matching, ranking, rule-set repinning, unscoped legal-corpus search, a second normalization boundary, or commit/push/create a PR.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Case variants | `Register register REGISTER keeper` | `register`, `keeper` | No redundant predicate |
| Unicode compatibility | Full-width `Ｒｅｇｉｓｔｅｒ`, ASCII `Register`, Kelvin-sign `KEEPER` | Canonical `register`, `keeper` | Deterministic across host locales |
| Normalize before filtering | Ligature `ﬀ` | Canonical two-character term `ff` remains searchable | Empty/short canonical terms are removed |
| Empty whitespace | ASCII and Unicode whitespace only | No terms and no chunk query | Return empty non-truncated result after authorization |
| Dedupe before bound | Duplicate variants followed by more than six unique terms | First six unique canonical terms | Later unique terms are truncated |
| Pinned AND query | Case/compatibility duplicates with two logical terms | Two canonical `contains` predicates under the pinned source version | Existing authorization/pin errors propagate |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.ts` -- sole canonicalization boundary, pinned source resolution and Prisma `AND` construction.
- `apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts` -- ASM-LEGAL-01 reproducer and normalization/query boundary matrix.
- `packages/contracts/src/assessment-domain/schemas.ts` -- unchanged request, `MAX_TERMS`, result and size constraints.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts` -- expand RED coverage for the full edge-case matrix and exact Prisma predicates.
- [x] `apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.ts` -- implement NFKC plus `toLowerCase()` canonicalization before filtering, dedupe and bounding; update five-section documentation and explanatory comments.
- [x] `.agents/memory/lessons-learned.md` and `apps/api/AGENTS.md` -- persist the single-boundary deterministic normalization invariant if the completed fix reveals a reusable regression rule.

**Acceptance Criteria:**
- Given equivalent case or NFKC forms, when terms are prepared, then each logical term occupies one slot and one `AND` predicate.
- Given duplicates before additional unique terms, when the limit is applied, then duplicates do not consume the six-term budget.
- Given normalization changes query representation, when search executes, then lease authority and pinned legal-source scoping remain unchanged.
- Given the same input under any host locale, when normalization runs, then canonical terms and their ordering remain identical.

## Spec Change Log

## Design Notes

Use `String.prototype.toLowerCase()` rather than an implicit-locale `toLocaleLowerCase()`. NFKC and casing belong only in `searchTermsOf()`; controller, contract, Python client, database content and snippets remain unchanged. Existing `%`/`_` substring-pattern behavior and content-scan indexing are pre-existing debts outside ASM-19.

## Verification

**Commands:**
- `NODE_OPTIONS=--experimental-vm-modules pnpm --filter @lcsp/api exec jest --config ./jest.config.ts src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts --runInBand --watchman=false`
- `pnpm --filter @lcsp/api exec eslint src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.ts src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts`
- `pnpm run typecheck:run`
- `pnpm run check:business-logic-docs && pnpm run test:business-logic-docs`
- `pnpm run check:imports`
- `pnpm run check:architecture`
- `graphify update .`

**Execution evidence:** ASM-LEGAL-01 failed before production changes. The completed matrix passes 10/10 handler tests and 8/8 adjacent controller tests; ESLint, typecheck, business-logic documentation, import policy and architecture gates pass. Architecture reports three pre-existing `compliance-rule-set` circular warnings and zero errors.

## Suggested Review Order

**Canonical search boundary**

- Canonicalizes once before filtering, stable deduplication and term bounding.
  [`search-pinned-legal-source.handler.ts:30`](../../apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.ts#L30)

**Normalization and query evidence**

- Covers NFKC compatibility expansion and locale-independent casing.
  [`search-pinned-legal-source.handler.spec.ts:90`](../../apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts#L90)

- Proves duplicates cannot consume the six-term budget.
  [`search-pinned-legal-source.handler.spec.ts:100`](../../apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts#L100)

- Verifies canonical predicates retain the pinned legal-source boundary.
  [`search-pinned-legal-source.handler.spec.ts:152`](../../apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts#L152)

- Locks authorization ordering before the empty-query fast path.
  [`search-pinned-legal-source.handler.spec.ts:177`](../../apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts#L177)

- Confirms authorization and pin failures propagate before chunk search.
  [`search-pinned-legal-source.handler.spec.ts:193`](../../apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.spec.ts#L193)

**Persistent safeguards**

- Records canonicalize-before-dedupe as a reusable search invariant.
  [`lessons-learned.md:180`](../../.agents/memory/lessons-learned.md#L180)

- Adds bounded keyword normalization to the API review checklist.
  [`AGENTS.md:122`](../../apps/api/AGENTS.md#L122)
