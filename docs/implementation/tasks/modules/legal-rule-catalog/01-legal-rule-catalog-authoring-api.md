---
task_id: MW-lrc-001
module: legal-rule-catalog
runtime: nestjs-api
priority: P1
status: READY_FOR_DEV
epic_story: 6.3
depends_on:
  - platform/rbac/03-nestjs-guard.md
  - platform/audit-writer/02-audit-writer-service.md
---

# Legal Rule Catalog Authoring & Approval API

## Outcome

Internal API/CLI for an Internal Legal Operator to author, review, and approve `LegalRule` entries into an immutable `LegalRuleCatalogVersion`, per `docs/specs/legal-rule-catalog-spec.md`. This is dataset 2 (the risk-tier ruleset) — a separate governed artifact from the legal corpus (dataset 1, `docs/specs/legal-corpus-source-spec.md`). No `LegalRule` content is ever auto-derived from corpus text by an LLM or rule-mining process; this API only lets a human author a rule and validates its citation locators against an approved corpus.

## Module Files

| File | Action | Notes |
|---|---|---|
| `apps/api/src/modules/legal-rule-catalog/presentation/http/legal-rule-catalog.controller.ts` | Create | Draft/approve/list endpoints |
| `apps/api/src/modules/legal-rule-catalog/application/commands/draft-legal-rule/draft-legal-rule.command.ts` | Create | Command shape |
| `apps/api/src/modules/legal-rule-catalog/application/commands/draft-legal-rule/draft-legal-rule.handler.ts` | Create | Draft creation + citation locator validation |
| `apps/api/src/modules/legal-rule-catalog/application/commands/approve-rule-catalog-version/approve-rule-catalog-version.command.ts` | Create | Command shape |
| `apps/api/src/modules/legal-rule-catalog/application/commands/approve-rule-catalog-version/approve-rule-catalog-version.handler.ts` | Create | Approval + immutability enforcement |
| `apps/api/src/modules/legal-rule-catalog/application/services/citation-locator-validator.service.ts` | Create | Validates `citationLocatorRefs` resolve inside an APPROVED `LegalCorpusVersion` |
| `apps/api/prisma/schema.prisma` | Modify | Add `LegalRule`, `LegalRuleCatalogVersion`, `RuleApprovalRecord` models |

## Prisma Models

```prisma
model LegalRuleCatalogVersion {
  id         String   @id @default(uuid())
  version    String
  status     String   @default("DRAFT")   // DRAFT | APPROVED | SUPERSEDED
  ruleRefs   Json                          // Included LegalRule IDs at this version
  createdAt  DateTime @default(now())
  approvedAt DateTime?

  @@index([status])
}

model LegalRule {
  id                       String   @id @default(uuid())
  legalRuleId              String   @unique   // Stable business identifier, e.g. AI-HIGH-IMPACT-...
  legalRuleCatalogVersionId String
  ruleFamily               String
  requiredFacts            Json
  optionalFacts            Json?
  blockingFacts            Json?
  unknownFactPolicy        String
  citationLocatorRefs      Json                // [{legalCorpusVersionId, documentId, locator}]
  status                   String   @default("DRAFT")   // DRAFT | APPROVED | DEPRECATED
  authoredBy               String

  @@index([legalRuleCatalogVersionId])
}

model RuleApprovalRecord {
  id                       String   @id @default(uuid())
  legalRuleCatalogVersionId String
  approvedBy               String
  status                   String   // APPROVED | REJECTED
  scopeDescription         String
  comments                 String?
  approvalDate             DateTime @default(now())

  @@index([legalRuleCatalogVersionId])
}
```

## API Contract

**Endpoint 1:** `POST /internal/legal-rule-catalog/rules`
**Auth required:** Yes — `@RequireAction('legal-rule-catalog:author')`

| Field | Type | Required | Notes |
|---|---|---|---|
| `legalRuleId` | string | Yes | Stable identifier |
| `ruleFamily` | string | Yes | |
| `requiredFacts` / `optionalFacts` / `blockingFacts` | JSON | Yes/No/No | |
| `unknownFactPolicy` | string | Yes | |
| `citationLocatorRefs` | array | Yes | Each entry validated against an APPROVED `LegalCorpusVersion` |

**Endpoint 2:** `POST /internal/legal-rule-catalog/versions/:versionId/approve`
**Auth required:** Yes — `@RequireAction('legal-rule-catalog:approve')`

| Field | Type | Required | Notes |
|---|---|---|---|
| `scopeDescription` | string | Yes | Review scope note |
| `comments` | string | No | |

**Error responses:**

| HTTP | `error_code` | Meaning |
|---|---|---|
| 403 | `RBAC_DENIED` | Actor lacks required action |
| 422 | `RULE_CITATION_UNRESOLVED` | A `citationLocatorRef` does not resolve to a chunk in an approved `LegalCorpusVersion` |
| 422 | `RULE_CITATION_REPEALED` | A `citationLocatorRef` resolves to a chunk with `legal_status = REPEALED` |
| 409 | `CATALOG_VERSION_ALREADY_APPROVED` | Cannot add rules to an approved (immutable) version |

## Business Rules

1. RBAC guard: `legal-rule-catalog:author` for drafting, `legal-rule-catalog:approve` for approval — distinct actions, distinct actors expected (Internal Legal Operator review separation).
2. Every `citationLocatorRef` is validated at draft time against the corpus API: it must resolve to a chunk in an `APPROVED` `LegalCorpusVersion` with `legal_status = ACTIVE`. `REPEALED` or unresolved locators reject the draft.
3. A `LegalRule` is never generated by an LLM or automated extraction — `authoredBy` must be a human actor reference; the endpoint has no automated-authoring code path.
4. Rules only enter production use once their owning `LegalRuleCatalogVersion.status = APPROVED` via `RuleApprovalRecord`.
5. `LegalRuleCatalogVersion` is immutable once `APPROVED` — further rule changes create a new `DRAFT` version.
6. Rejection leaves the version `DRAFT`, blocked from legal-matching use.
7. If a corpus supersession later causes a cited locator to become `REPEALED` (see `legal-rule-catalog-spec.md`'s Corpus Supersession Impact on Rules), the affected `LegalRule` is flagged for mandatory re-review — not silently kept `APPROVED`.
8. Audit event for every draft, approval, and rejection.

## Commands / Events

| Name | Type | Safe payload |
|---|---|---|
| `DraftLegalRuleCommand` | App command | `{ legalRuleId, ruleFamily, citationLocatorRefs, authoredBy, correlationId? }` |
| `ApproveRuleCatalogVersionCommand` | App command | `{ legalRuleCatalogVersionId, approvedBy, scopeDescription, correlationId? }` |
| `LEGAL_RULE_DRAFTED` | `AuthAuditEvent` | `{ legalRuleId, legalRuleCatalogVersionId, correlationId }` |
| `LEGAL_RULE_CATALOG_VERSION_APPROVED` | `AuthAuditEvent` | `{ legalRuleCatalogVersionId, approvedBy, correlationId }` |
| `LEGAL_RULE_CATALOG_VERSION_REJECTED` | `AuthAuditEvent` | `{ legalRuleCatalogVersionId, correlationId }` |

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Draft with all citation locators resolving to ACTIVE chunks | 201, rule status `DRAFT` |
| T02 | Draft with a locator resolving to a `REPEALED` chunk | 422 `RULE_CITATION_REPEALED` |
| T03 | Draft with an unresolvable locator | 422 `RULE_CITATION_UNRESOLVED` |
| T04 | Approve a version with all rules citation-valid | 200, version `APPROVED`, immutable |
| T05 | Attempt to add a rule to an already-approved version | 409 `CATALOG_VERSION_ALREADY_APPROVED` |
| T06 | Actor lacks `legal-rule-catalog:author` | 403 `RBAC_DENIED` |
| T07 | Corpus version referenced by a rule is later superseded, cited locator becomes `REPEALED` | Rule flagged for mandatory re-review |
| T08 | Audit event recorded for draft/approve/reject | Verified in `AuthAuditEvent` |

## Definition of Done

- `LegalRule` never created by an automated/LLM process — `authoredBy` always a human actor.
- Every `citationLocatorRef` validated against an approved, active corpus chunk before draft acceptance.
- `LegalRuleCatalogVersion` immutable once approved.
- Rejected versions remain `DRAFT`, blocked from legal-matching.
- Corpus supersession affecting a cited locator triggers mandatory rule re-review, never silent continuation.
