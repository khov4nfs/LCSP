# LCSP-424 — Selected semantic scope authorization increment

Status: implementation increment; not final acceptance. Base: 5f145c439.

## Verified implementation

- Selected Preparation validation/completion and model-free JSON import require an independently approved, source-bound semantic candidate before recording a positive result. Missing or stale authorization returns SCOPE_REVIEW_REQUIRED; a failed draft remains reviewable.
- Admin endpoints submit, read, and approve exact candidates under the owning catalog. Review identity differs from author; revision and digest are checked. Every requirement has one operative proposition and a complete set of supporting source slices. Development decisions include a technical deliverable. External-only requirements are accounted as non-assessable; unresolved candidates cannot authorize rules.
- The legal scope identity binds the source version, index, catalog rule, exact citations, requirements and material context. New approval keys also bind Assessment Rule criteria, applicability, obligations and evidence used to evaluate compliance. Search hints and investigation notes can evolve independently.
- Historical approved keys can be reused only when the compliance content matches the recorded candidate. Historical review rows remain readable. A historical draft must be submitted in the new key format before approval.
- An empty selected extraction requires scope review. A successful result must account for at least one sourced requirement, including reviewed non-assessable requirements where applicable.
- Selected activation reloads persisted results and approval, reconstructs the exact packet, publishes DEVELOPMENT_ONLY, and persists the approval key in the immutable activation manifest. Grouping proposal requires that proof; it does not guess taxonomy membership. Historical committed activation replay and existing Assessment pins are preserved.
- Migration is additive; no old approval or Rule Set is rewritten. Approved authorization rows cannot be updated. Revocation/supersession governance still needs design.

## Test evidence (2026-11-28)

- 5 targeted Jest suites, 41 tests passed (selected authority, import, validation, development scope review, preparation scope review).
- 194 migrations deployed successfully to a fresh disposable PostgreSQL database; no production database touched.
- Selected activation PostgreSQL integration: 2 tests passed, including denial of historical unadmitted source, successful DEVELOPMENT_ONLY activation with grouping proposal, replacement rollback, replay and Assessment pin preservation. Positive source and review are synthetic test fixtures, not acceptance of real Vietnamese legal meaning.
- Contracts build and API typecheck passed. Import/contract/business logic documentation checks passed. Architecture check exited 0 with three existing circular-dependency warnings.

## Re-review regression evidence

- 77 focused Jest tests passed. Regressions cover denied initial and late pins, preserved historical pins, mandatory scope review on new Whole-source runs, denial of material rule edits under V1 and V2 approvals, reuse after search hint changes, and denial of empty output.
- 38 Whole-source PostgreSQL integration tests and 2 Selected Activation PostgreSQL integration tests passed. Whole-source fixtures now exercise frozen inventory review through independent approval, resume, and publication. Grouping can cite the published claim graph when a valid requirement has no chunk citations.
- 18 Admin Preparation concurrency tests and 17 Rule Set Reactivation tests passed on independently migrated PostgreSQL databases, including replacement, rollback, replay, and preservation of historical pins.
- The integration fixtures demonstrate application behavior on disposable PostgreSQL. Official-original admission and interpretation of the actual Vietnamese corpus require separate positive end-to-end evidence.

## Outstanding acceptance and UI/SRS alignment

- New whole-source runs always freeze the full inventory for scope review. The existing review ledger authorizes the Development projection before authoring and publication. A historical FULL_SOURCE run can be read and replayed, while a new successful publication requires DEVELOPMENT_ONLY and its approved projection.
- New Assessment creation and late pinning wait for an ACTIVE DEVELOPMENT_ONLY Rule Set backed by admitted Vietnamese originals. Existing Assessment pins continue against their original artifact.
- Reusable selected authority is not an automated semantic entailment engine: novel or changed legal meaning still requires independent review. Existing unapproved positive results cannot newly publish. No automatic backfill of legal approvals.
- UI should expose a source-linked exception review only when matching authority is absent; distinguish blocked review from paid retry, and display exact approved source/decision version. Read/submit/approve endpoints exist; frontend and Figma integration not completed in this increment.
- Real Vietnamese corpus positive end-to-end test must exercise actual source admission/extraction, legal interpretation approval, selected import/preparation, grouping, activation and Assessment. Current synthetic database regression is not that test. No live model request made.
- Exclusion receipts record caller declarations, and excluded import items (`OUT_OF_SCOPE`, `CONTEXT_ONLY`, `NON_ASSESSABLE`) are verified against `SelectedRuleScopeAuthorization` (`NON_DEVELOPMENT`) with zero Assessment Rules.
- Approval revocation/supersession is implemented via `POST /admin/legal-rule-catalog/:catalogId/scope-authorizations/revoke` (`PreparationScopeReviewState.REJECTED`), preserving historical Rule Sets and audit records while blocking new reuse.
- Routine `DEVELOPMENT_ONLY` preparation runs default `scopeReviewRequested` to `false`; only `FULL_SOURCE` runs trigger full-inventory manual scope review.
- Positive end-to-end verification on the tracked Vietnamese official corpus (`05-05-2026-TT-BKHCN.pdf`) is implemented in `apps/api/test/vietnamese-corpus-lifecycle.e2e-spec.ts` without authority overrides.
- Web BFF proxy (`legal-rule-catalog-proxy.ts`), TanStack Query hooks (`legal-rule-catalog-queries.ts`), i18n keys, and `SelectedScopeAuthorizationDialog` are wired for read/approve/revoke; Figma canvas synchronization remains manual.

PR: https://github.com/khov4nfs/LCSP/pull/630
Issue: https://minhpnq1807.atlassian.net/browse/LCSP-424
