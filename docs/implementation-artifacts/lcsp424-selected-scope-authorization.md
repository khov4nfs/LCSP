# LCSP-424 — Unified Legal Validation & Semantic Authorization

Status: unified architecture implemented (PR #630).

## Architecture Principles

- LCSP analyzes official Vietnamese legal sources and derives assessment rules relevant to the software or AI system under evaluation, retaining all material legal context and evidence across development, deployment, and operation.
- The system does not expose separate activity-scope modes (`FULL_SOURCE` / `DEVELOPMENT_ONLY`) or require a standalone Scope Review workflow before Preparation.
- All authoring paths (Whole-source, Selected, Bulk, JSON Import, and Regeneration) share unified legal validation:
  - Official Vietnamese legal source admission (`LegalSourceAuthorityService`), `EFFECTIVE` chunk status, `OPERATIVE` corpus role, and `contentSha256` integrity.
  - Complete `LegalRequirement` structure (actor, modality, action, applicability conditions, exceptions, `sourceRefs`) and `AssessmentRule` criteria / evidence requirements.
  - Unresolved legal uncertainty (`LEGAL_REVIEW_REQUIRED:` / `NEEDS_REVIEW`) blocks publication until independently resolved by a human reviewer.
  - Explicit `SelectedRuleScopeAuthorization` records remain supported for resolving uncertainty or revoking (`REJECTED`) specific rule authorizations without overwriting historical records.

## Migration & Historical Preservation

- `20261129010000_remove_target_activity_scope` safely recovers any historical `PAUSED` Preparation runs awaiting the removed Scope Review hold into `FAILED (RUNTIME_ERROR)` so they remain resumable with all source pins, frozen inventories, drafts, and review history intact, before dropping `targetActivityScope`, `scopeReviewRequested`, and `PreparationTargetActivityScope`.
- Historical `ComplianceRuleSetVersion`, `LegalRuleCatalogVersion`, `SelectedRuleScopeAuthorization`, and `Assessment` pins are preserved. New Assessments and Reactivations verify active lifecycle, `PASSED` validation, non-empty rules, admitted official Vietnamese sources, and absence of revoked authorizations.

PR: https://github.com/khov4nfs/LCSP/pull/630
Issue: https://minhpnq1807.atlassian.net/browse/LCSP-424
