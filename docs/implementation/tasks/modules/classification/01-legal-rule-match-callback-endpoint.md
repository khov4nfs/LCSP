---
task_id: MW-cls-001
module: classification
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 6.7
depends_on:
  - reconciliation/04-verified-profile-callback-endpoint.md
  - platform/outbox/02-outbox-publisher.md
---

# LegalRuleMatch Callback Endpoint

## Outcome

Receive `LegalRuleMatch` results from the Python legal worker after ChromaDB legal retrieval. Validate citation allowlist and corpus version. Store immutable `LegalRuleMatch`. Emit event for classification. Block if citation basis is missing or corpus version not approved.

## Module Files

| File                                                                                                                  | Action | Notes                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `apps/api/src/modules/classification/presentation/http/classification.controller.ts`                                  | Create | `POST /internal/classification/legal-rule-match-callback` |
| `apps/api/src/modules/classification/application/commands/accept-legal-rule-match/accept-legal-rule-match.command.ts` | Create | Command shape                                             |
| `apps/api/src/modules/classification/application/commands/accept-legal-rule-match/accept-legal-rule-match.handler.ts` | Create | Validation + guardrail + persistence                      |
| `apps/api/src/modules/classification/application/services/classification/citation-guardrail.service.ts`               | Create | Citation allowlist validation                             |
| `apps/api/prisma/schema.prisma`                                                                                       | Modify | Add `LegalRuleMatch` model                                |
| `apps/api/src/modules/classification/classification.module.ts`                                                        | Create | NestJS module                                             |

## Prisma Model

```prisma
model LegalRuleMatch {
  id                       String   @id @default(uuid())
  verifiedProfileId        String
  assessmentId             String
  organizationId           String
  corpusVersionId          String                     // Must be approved LegalCorpusVersion
  legalRuleCatalogVersionId String                     // Must be approved LegalRuleCatalogVersion
  schemaVersion            String
  matches                  Json                        // Array of LegalRuleMatchItem
  citationAllowlist        Json                        // Allowed citation chunk IDs
  overallCoverageStatus    String   @default("NO_CITATION") // NO_CITATION | PARTIAL_CITATION | COMPLETE_CITATION
  guardrailStatus          String   @default("passed")     // 'passed' | 'blocked'
  blockedReason            String?
  status                   String   @default("accepted")   // 'accepted' | 'rejected'
  createdAt                DateTime @default(now())

  @@index([assessmentId])
}
```

## LegalRuleMatchItem Structure

```json
{
  "match_id": "string",
  "rule_id": "string",
  "legal_rule_catalog_version_id": "string",
  "article_ref": "string",
  "clause_ref": "string",
  "match_type": "PRIMARY_MATCH | PARENT_CONTEXT | REFERENCED_CONTEXT",
  "citation_chunk_ids": ["string"],
  "confidence": 0.0,
  "coverage_status": "NO_CITATION | PARTIAL_CITATION | COMPLETE_CITATION",
  "usage_claim_ref": "string"
}
```

`confidence` is a deterministic float (0.00-1.00) per `legal-matching-domain-spec.md`'s Match Confidence Model — never a categorical `high|medium|low` string. `coverage_status` is required per match; `overallCoverageStatus` on `LegalRuleMatch` aggregates across all matches per the Coverage Model (`completeCitationCount / requiredCitationCount * 100`).

## API Contract

**Endpoint:** `POST /internal/classification/legal-rule-match-callback`
**Auth:** `X-Worker-Api-Key`

**Request body:**

| Field                           | Type                 | Required | Notes                                                      |
| ------------------------------- | -------------------- | -------- | ---------------------------------------------------------- |
| `verified_profile_id`           | string               | Yes      |                                                            |
| `assessment_id`                 | string               | Yes      |                                                            |
| `corpus_version_id`             | string               | Yes      | Must be approved `LegalCorpusVersion`                      |
| `legal_rule_catalog_version_id` | string               | Yes      | Must be approved `LegalRuleCatalogVersion`                 |
| `schema_version`                | string               | Yes      |                                                            |
| `matches`                       | LegalRuleMatchItem[] | Yes      | May be empty                                               |
| `citation_allowlist`            | string[]             | Yes      | List of allowed citation chunk IDs                         |
| `overall_coverage_status`       | string               | Yes      | `NO_CITATION` \| `PARTIAL_CITATION` \| `COMPLETE_CITATION` |

**Success response (200):**

| Field                 | Type    | Notes                 |
| --------------------- | ------- | --------------------- |
| `accepted`            | boolean |                       |
| `legal_rule_match_id` | string  |                       |
| `guardrail_status`    | string  | `passed` \| `blocked` |
| `correlationId`       | string  |                       |

**Error responses:**

| HTTP | `error_code`                        | Meaning                                                                         |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------- |
| 401  | `UNAUTHORIZED`                      |                                                                                 |
| 404  | `VERIFIED_PROFILE_NOT_FOUND`        |                                                                                 |
| 422  | `CORPUS_VERSION_NOT_APPROVED`       | `corpus_version_id` is not an approved version                                  |
| 422  | `RULE_CATALOG_VERSION_NOT_APPROVED` | `legal_rule_catalog_version_id` is not an approved version                      |
| 422  | `CITATION_OUT_OF_ALLOWLIST`         | Citation chunk ID not in `citation_allowlist`                                   |
| 422  | `CITATION_REPEALED`                 | Citation chunk has `legal_status = REPEALED` — not a valid current-law citation |

## Business Rules

1. Auth: validate `X-Worker-Api-Key`.
2. Validate `corpus_version_id` references an approved `LegalCorpusVersion`. → `CORPUS_VERSION_NOT_APPROVED`.
3. Validate `legal_rule_catalog_version_id` references an approved `LegalRuleCatalogVersion`. → `RULE_CATALOG_VERSION_NOT_APPROVED`.
4. Run `CitationGuardrailService.validate(matches, citationAllowlist)`:
   - Each `citation_chunk_id` in every match must be in `citation_allowlist`.
   - Out-of-allowlist citations → `CITATION_OUT_OF_ALLOWLIST` rejection.
   - Any citation chunk with `legal_status = REPEALED` → `CITATION_REPEALED` rejection, regardless of allowlist membership.
5. `PRIMARY_MATCH`, `PARENT_CONTEXT`, `REFERENCED_CONTEXT` must remain distinct — no merging.
6. Compute `overallCoverageStatus` from per-match `coverage_status` per the Coverage Model in `legal-matching-domain-spec.md`.
7. If matches empty → `guardrail_status = blocked` (Citation Guardrail: no citation basis → blocked state).
8. Create `LegalRuleMatch` (immutable).
9. Emit outbox `legal-rule-match-ready` for classification worker.
10. Audit event `LEGAL_RULE_MATCH_ACCEPTED` or `LEGAL_RULE_MATCH_BLOCKED`.

## Commands / Events

| Name                           | Type             | Safe payload                                                                          |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------- |
| `AcceptLegalRuleMatchCommand`  | App command      | `{ verifiedProfileId, assessmentId, corpusVersionId, schemaVersion, correlationId? }` |
| `event.legal-rule-match-ready` | Outbox           | `{ legalRuleMatchId, assessmentId, guardrailStatus, correlationId }`                  |
| `LEGAL_RULE_MATCH_ACCEPTED`    | `AuthAuditEvent` | `{ legalRuleMatchId, assessmentId, corpusVersionId, correlationId }`                  |
| `LEGAL_RULE_MATCH_BLOCKED`     | `AuthAuditEvent` | `{ assessmentId, guardrailStatus, blockedReason, correlationId }`                     |

## Test Cases

| ID   | Scenario                                                | Expected                                |
| ---- | ------------------------------------------------------- | --------------------------------------- |
| T01  | Valid matches with allowlisted citations                | 200 `guardrail_status = passed`         |
| T02  | Empty matches                                           | 200 `guardrail_status = blocked`        |
| T03  | Citation chunk not in allowlist                         | 422 `CITATION_OUT_OF_ALLOWLIST`         |
| T04  | Corpus version not approved                             | 422 `CORPUS_VERSION_NOT_APPROVED`       |
| T04b | Rule catalog version not approved                       | 422 `RULE_CATALOG_VERSION_NOT_APPROVED` |
| T04c | Citation chunk `legal_status = REPEALED`                | 422 `CITATION_REPEALED`                 |
| T05  | `PRIMARY_MATCH` and `REFERENCED_CONTEXT` distinct in DB | Field inspection                        |
| T06  | Invalid API key                                         | 401                                     |
| T07  | Outbox event emitted                                    | DB verified                             |

## Definition of Done

- Citations validated against allowlist — out-of-allowlist and `REPEALED` citations rejected.
- Corpus version and rule catalog version must both be approved — not any version.
- `PRIMARY_MATCH`, `PARENT_CONTEXT`, `REFERENCED_CONTEXT` distinct in data.
- Empty matches → blocked state (fail-closed Citation Guardrail).
- Immutable once accepted.

## Dev Agent Record & Verification Notes

- **Date:** 2026-07-26
- **Status:** DONE
- **Implementation Highlights:**
  - Added `LegalRuleMatch` model to `apps/api/prisma/schema.prisma` and generated Prisma Client.
  - Implemented `CitationGuardrailService` to enforce citation allowlist validation and reject `REPEALED` citations.
  - Implemented `AcceptLegalRuleMatchHandler` and `ClassificationController` endpoint (`POST /internal/classification/legal-rule-match-callback`).
  - Added error codes, statuses, event types, and approved version lists to `@lcsp/contracts/scan`.
  - Registered `ClassificationModule` in `AppModule`.
- **Verification Results:**
  - Unit tests: `pnpm --filter @lcsp/api test apps/api/src/modules/classification/` passed 9/9 tests.
  - E2E tests: `pnpm --filter @lcsp/api test:e2e apps/api/test/legal-rule-match-callback.e2e-spec.ts` passed 9/9 tests.
  - Build: `pnpm --filter @lcsp/api build` passed with zero errors.
