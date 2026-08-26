---
status: canonical_ux_review_complete_for_epic_generation
reviewed_on: 2026-06-25
ux_sources:
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md
authority_sources:
  - docs/product/prd.md
  - docs/architecture/architecture.md
  - docs/architecture/multi-agent-system-architecture.md
  - docs/specs/functional-requirements.md
  - docs/specs/non-functional-requirements.md
  - docs/specs/scanner-spec.md
  - docs/specs/legal-matching-domain-spec.md
  - docs/specs/user-task-flows.md
excluded_sources:
  - git history for deprecated UX specification artifacts
---

# Canonical UX Review

## Verdict

```text
UX_DRAFT_REBASED
CANONICAL_UX_REVIEW_COMPLETE_FOR_EPIC_GENERATION
IMPLEMENTATION_NOT_AUTHORIZED_BY_UX_REVIEW_ALONE
```

The active UX draft is now the rebased pair:

- `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md`
- `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md`

The deprecated UX specification has been removed from the active doc set; use git history only if historical comparison is required. It is excluded from active authority because it preserved superseded structured-attestation and manual-upload concepts.

## Confirmed UX Requirements

- Manager-owned A-to-Z golden path without mandatory Developer participation.
- RBAC-scoped optional Developer task workspace.
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

## UX Exclusions

The following must not appear in active UX, epics or stories:

- structured technical attestation form;
- manual technical evidence JSON upload;
- Local/CI scanner report upload as an MVP product evidence path;
- customer-facing legal corpus administration;
- Developer-required workflow to unlock Manager MVP completion;
- risk labels before evidence, reconciliation, VerifiedProfile and citation gates pass;
- citation display without corpus version and provenance.

## Open UX Dependencies

- Final Vietnamese microcopy for wizard questions and blocker explanations.
- Exact readiness-only export contents.
- Manager-visible wording for automatic trusted trigger mapping states.
- ~~Final frontend component library decision.~~ RESOLVED 2026-07-11 — shadcn/ui (Base UI primitives), confirmed in code and bound into `DESIGN.md`. See `ux-LCSP-2026-06-24/.decision-log.md` resolution #7.

These dependencies should be carried into epics/stories as scoped product/design tasks or story acceptance constraints. They do not block epics/stories generation.
