---
status: canonical_ux_review_complete_with_prompt8
reviewed_on: 2026-11-24
ux_sources:
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-11-24-shared-wallet/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-11-24-shared-wallet/EXPERIENCE.md
  - docs/planning-artifacts/assessment-shared-wallet-pricing-ux.md
authority_sources:
  - docs/product/prd.md
  - docs/product/addendum.md
  - docs/architecture/architecture.md
  - docs/architecture/adr/adr-028-shared-wallet-model-usage-settlement.md
  - docs/architecture/multi-agent-system-architecture.md
  - docs/specs/functional-requirements.md
  - docs/specs/non-functional-requirements.md
  - docs/specs/legal-matching-domain-spec.md
  - docs/specs/user-task-flows.md
excluded_sources:
  - git history for deprecated UX specification artifacts
---

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

# Canonical UX Review

## Verdict

```text
UX_DRAFT_REBASED
CANONICAL_UX_REVIEW_COMPLETE_FOR_EPIC_GENERATION
PROMPT8_FINANCIAL_UX_VALIDATED_AND_FINAL
IMPLEMENTATION_NOT_AUTHORIZED_BY_UX_REVIEW_ALONE
```

The active UX draft is now the rebased pair:

- `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md`
- `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md`

The deprecated UX specification has been removed from the active doc set; use git history only if historical comparison is required. It is excluded from active authority because it preserved superseded structured-attestation and manual-upload concepts.

The 2026-11-24 Prompt 8 overlay adds shared-wallet, model-pricing and financial-recovery authority through:

- `docs/planning-artifacts/assessment-shared-wallet-pricing-ux.md`;
- `docs/planning-artifacts/ux-designs/ux-LCSP-2026-11-24-shared-wallet/DESIGN.md`;
- `docs/planning-artifacts/ux-designs/ux-LCSP-2026-11-24-shared-wallet/EXPERIENCE.md`.

The 2026-06-24 pair remains the visual and assessment-workflow baseline. The Prompt 8 overlay wins for financial surfaces and states. Current product/architecture authority also supersedes legacy organization-membership, PBAC and Developer-invitation/task wording: authorization is RBAC with owner/resource scope, and the active assessment journey is Manager-led without Developer collaboration.

## Confirmed UX Requirements

- Manager-owned A-to-Z golden path without Developer participation in active MVP.
- RBAC authorization with owner/resource scope through `assessment.ownerId` and `wallet.userId`; no organization or PBAC authority.
- Readiness-only state before technical evidence, with no HIGH/MEDIUM/LOW risk label.
- Read-only GitHub repository connection, commit pinning, trusted scan initiation, scan status, retry/re-run messaging and safe failure states.
- Evidence review using redacted findings, confidence, limitations and evidence references.
- Conflict comparison where Manager resolves with rationale before VerifiedProfile.
- VerifiedProfile review before classification.
- ChromaDB vectorless legal retrieval status shown only through assessment-relevant corpus/index/citation states.
- Citation detail exposes document title/number, article, clause, point, context role, corpus version, effective dates, legal status, source checksum and allowlist result.
- `PRIMARY_MATCH`, `PARENT_CONTEXT` and `REFERENCED_CONTEXT` remain visually distinct.
- Citation outside retrieved/referenced allowlist blocks or rejects classification/document output.
- Gap analysis and final documents remain blocked until upstream evidence, classification and citation gates pass.
- Readiness-only exports are visibly distinct from final reports.
- Audit trail exposes safe metadata, evidence refs, citation refs, RBAC policy/version and correlation IDs without raw source, full prompts or secrets.
- One account-level shared wallet exposes spendable and outstanding credits without per-assessment allocation.
- Checkout separates service value, tax, payment total and credited amount; tax never becomes wallet credit.
- `PAYMENT_REQUIRED` preserves completed work, blocks only new paid invocations and requires customer-controlled Continue after confirmed top-up.
- Payment recovery remains independent from applicable runtime safety gates and never resumes an assessment automatically. No-progress is diagnostic telemetry, not a Customer blocker.
- Charge history groups logical operations while exposing each separately billable physical retry/fallback invocation.
- Unknown usage and billing-integrity contradictions remain distinct, safe, non-zero-assumption states.
- Admin pricing covers exact model, provider default and optional approved global default, with immutable publication and history.
- Reconciliation and compensation are permissioned, redacted, append-only experiences; compensation remains linked and bounded by the original debit.

## UX Exclusions

The following must not appear in active UX, epics or stories:

- structured technical attestation form;
- manual technical evidence JSON upload;
- Local/CI scanner report upload as an MVP product evidence path;
- customer-facing legal corpus administration;
- Developer invitation/task collaboration in the active MVP;
- risk labels before evidence, reconciliation, VerifiedProfile and citation gates pass;
- citation display without corpus version and provenance.
- per-assessment credit allocation or reservation;
- automatic assessment resume after payment;
- customer-visible internal margin, provider credentials, prompts, outputs or secrets;
- paid-tool billing inside Prompt 8;
- editing or deleting published pricing, debits or compensations.

## Open UX Dependencies

- Final Vietnamese microcopy for wizard questions and blocker explanations.
- Exact readiness-only export contents.
- Manager-visible wording for automatic trusted trigger mapping states.
- Product/Finance approval of production tariff values and pricing assumptions.
- `G-01..G-07`, migration reconciliation, rollback rehearsal and operational evidence before debit enablement.
- ~~Final frontend component library decision.~~ RESOLVED 2026-07-11 — shadcn/ui (Base UI primitives), confirmed in code and bound into `DESIGN.md`. See `ux-LCSP-2026-06-24/.decision-log.md` resolution #7.

These dependencies should be carried into epics/stories as scoped product/design tasks or story acceptance constraints. They do not block epics/stories generation.

Prompt 8 implementation stories may proceed to contract/RED-test decomposition from the validated final UX. Production debit and tariff publication remain separately gated. Browser acceptance must cover payment-required recovery with manual Continue, charge provenance, immutable pricing publication, shadow non-authority and unknown-usage reconciliation; browser evidence does not replace server-side RBAC, idempotency, atomicity or migration evidence. Validation evidence is recorded in `docs/planning-artifacts/ux-designs/ux-LCSP-2026-11-24-shared-wallet/validation-report.md` and its HTML twin.
