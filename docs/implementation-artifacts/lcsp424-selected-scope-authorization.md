# LCSP-424 — Selected semantic scope authorization increment

Status: implementation increment; not final acceptance. Base: 5f145c439.

## Verified implementation
- Selected Preparation validation/completion and model-free JSON import require an independently approved, source-bound semantic candidate before recording a positive result. Missing or stale authorization returns SCOPE_REVIEW_REQUIRED; a failed draft remains reviewable.
- Admin endpoints submit, read, and approve exact candidates under the owning catalog. Review identity differs from author; revision and digest are checked. Every requirement has one operative proposition and a complete set of supporting source slices. Development decisions include a technical deliverable. External-only requirements are accounted as non-assessable; unresolved candidates cannot authorize rules.
- Authority binds source version, index, legal rule, exact citation identity, requirements and material context. It does not treat client flags, keywords, or structural validation alone as semantic proof.
- Selected activation reloads persisted results and approval, reconstructs the exact packet, publishes DEVELOPMENT_ONLY, and persists the approval key in the immutable activation manifest. Grouping proposal requires that proof; it does not guess taxonomy membership. Historical committed activation replay and existing Assessment pins are preserved.
- Migration is additive; no old approval or Rule Set is rewritten. Approved authorization rows cannot be updated. Revocation/supersession governance still needs design.

## Test evidence (2026-11-28)
- 5 targeted Jest suites, 41 tests passed (selected authority, import, validation, development scope review, preparation scope review).
- 194 migrations deployed successfully to a fresh disposable PostgreSQL database; no production database touched.
- Selected activation PostgreSQL integration: 2 tests passed, including denial of historical unadmitted source, successful DEVELOPMENT_ONLY activation with grouping proposal, replacement rollback, replay and Assessment pin preservation. Positive source and review are synthetic test fixtures, not acceptance of real Vietnamese legal meaning.
- Contracts build and API typecheck passed. Import/contract/business logic documentation checks passed. Architecture check exited 0 with three existing circular-dependency warnings.

## Outstanding acceptance and UI/SRS alignment
- Whole-source Preparation still uses its existing scope review ledger and optional scope intent. Do not delete that gate or relabel historical FULL_SOURCE artifacts until a canonical server-owned replacement passes regression.
- Reusable selected authority is not an automated semantic entailment engine: novel or changed legal meaning still requires independent review. Existing unapproved positive results cannot newly publish. No automatic backfill of legal approvals.
- UI should expose a source-linked exception review only when matching authority is absent; distinguish blocked review from paid retry, and display exact approved source/decision version. Read/submit/approve endpoints exist; frontend and Figma integration not completed in this increment.
- Real Vietnamese corpus positive end-to-end test must exercise actual source admission/extraction, legal interpretation approval, selected import/preparation, grouping, activation and Assessment. Current synthetic database regression is not that test. No live model request made.
- Final SRS, Wireframe and Final SaaS UI Light synchronization and whole-source acceptance remain open.

PR: https://github.com/khov4nfs/LCSP/pull/630
Issue: https://minhpnq1807.atlassian.net/browse/LCSP-424
