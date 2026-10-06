# W2 portfolio persistence boundary preparation

Status: **DRAFT design handoff; preparation only.** This report is the only file owned by this lane. It does not add a Prisma model, migration, contract, API route, worker write, canonical value, compatibility alias, dual writer, backfill, or production claim.

Owner: the future single W2 Prisma/API persistence owner. The design is subordinate to the W1 integration gate and the W2 live corpus-to-portfolio gate; neither gate is bypassed or accepted here.

## 1. Freeze binding

- Freeze §1 requires `LegalCorpusVersion -> Legal Preparation -> LegalRule/context -> EngineeringRule -> mechanical validation -> one atomic ACTIVE portfolio`; legal meaning stays agent-owned and deterministic code may enforce identity, hashes, citations, provenance, persistence, and atomicity only (`reports/architecture-freeze-migration-manifest.md:10-45`).
- Freeze §6 makes `LegalCorpusVersion` the immutable source snapshot, `LegalRule` the agent-authored proposition/context, and the versioned EngineeringRule portfolio the sole runtime basis. Every future decision/artifact must carry one immutable portfolio pin (`reports/architecture-freeze-migration-manifest.md:216-236`).
- Freeze §8 says old approval rows are historical ingestion/activation audit only, invalid source/rule data cannot be pinned, and a failed preparation keeps the prior ACTIVE pointer (`reports/architecture-freeze-migration-manifest.md:289-297`).
- Freeze §11 W2 assigns one serialized Prisma/API owner, one `submit portfolio -> validate -> atomically activate` boundary, no signoff/draft/publish/discard writes or approval records, no assessment/customer/repository context in Legal Preparation, and an integration gate that rejects fake/stale/repealed refs, duplicate/orphan IDs, and incomplete coverage (`reports/architecture-freeze-migration-manifest.md:364-384`).

State binding for this DRAFT handoff is frozen: proposed portfolio/artifact rows use only the shared `ArtifactLifecycleState` (ALCS) values `BUILDING`, `ACTIVE`, `SUPERSEDED`, and `INVALID`; Legal Preparation executions use the shared `AgentExecutionState` (AES) values `QUEUED`, `RUNNING`, `INTERRUPTED`, `PAUSED`, `SUCCEEDED`, `FAILED`, and `CANCELLED`. Mechanical validation failures are structured validation results attached to the candidate and activation record, with the candidate in `INVALID`; they are not a lifecycle family and do not introduce `FAILED_VALIDATION`, `ACTIVATED`, or `REJECTED` values.

### W2 expand versus W6/W7 archive and removal

- **W2 expand only:** add the new portfolio-bound storage and one canonical writer boundary. Do not drop, alter, repoint, or reinterpret the existing V1 `LegalRule`, `LegalRuleCatalogVersion`, `RuleApprovalRecord`, `LegalRuleMatch`, their existing foreign keys, or their consumers. Do not perform a semantic or non-null backfill. Existing V1 rows remain readable as historical data, never as a fallback or second authority.
- **W6 archive only:** after the W1/W2 integration and live gates, archive the surviving V1 rows, IDs, foreign-key relationships, and consumer history as read-only historical material. This is not a semantic promotion, retarget, or non-null backfill into the W2 writer.
- **W7 removal only:** after archive, reader/writer cutover, retention, and deletion gates, remove V1 tables, fields, foreign keys, and consumers in a separately reviewed migration. No W2 expand step performs destructive DDL or rewires an existing FK.

## 2. Current persisted boundary and exact gaps

### Current models and foreign keys

| Current model | Exact checked-out shape and FK behavior | Boundary gap for W2 |
|---|---|---|
| `LegalRuleCatalogVersion` | `id`, non-unique `version`, shared `LegalRuleLifecycleStatus`, `ruleRefs Json`, `approvedAt`, `rules`, `approvals`, `legalRuleMatches`; no `legalCorpusVersionId` FK (`apps/api/prisma/schema.prisma:986-998`). | A catalog can be approved without a relational corpus pin; `ruleRefs` is JSON only. This model is not a portfolio authority. |
| `LegalCorpusVersion` | `version @unique`, shared `DRAFT/APPROVED/REJECTED/SUPERSEDED` status, `sourceManifest`, `integrityManifestRef`, source/chunk/index/approval/preparation relations (`apps/api/prisma/schema.prisma:1000-1017`, enum at `:1355-1360`). | There is no portfolio row, no explicit ACTIVE value/pointer, and no relation to `LegalRuleCatalogVersion`. |
| `CorpusPreparation` | `idempotencyKey @unique`, `targetCorpusId @unique`, nullable plain `baseCorpusId` (not an FK), and `targetCorpusId -> LegalCorpusVersion.id ON DELETE RESTRICT` (`apps/api/prisma/schema.prisma:1019-1033`). | It tracks corpus-only preparation, not a complete LegalRule/EngineeringRule portfolio. `baseCorpusId` cannot provide a trusted lineage FK. |
| `LegalRetrievalIndex` | `legalCorpusVersionId -> LegalCorpusVersion.id ON DELETE CASCADE`; globally unique index `version`; validation refs/status/timestamp (`apps/api/prisma/schema.prisma:1047-1060`). | Useful source/retrieval precondition, but no portfolio completeness or rule linkage. |
| `LegalSourceDocument` / `LegalDocumentChunk` | Both point to `LegalCorpusVersion`; document/chunk FKs are `ON DELETE CASCADE`; chunks also point to `LegalSourceDocument` with `ON DELETE CASCADE`; unique document/locator constraints are corpus-scoped (`apps/api/prisma/schema.prisma:1062-1078`, `:1107-1126`). | These are the canonical bytes/locator rows to pin. Source refs in current rules do not FK to them. |
| `LegalSourceSnapshot` | Standalone immutable-looking source bytes/provenance row; `catalogSourceRef` and `adminCatalogVersion` are strings, not FKs to corpus or catalog (`apps/api/prisma/schema.prisma:1080-1105`). | Preserve as acquisition/provenance input; do not treat its catalog strings as a relational portfolio pin. |
| `CorpusApprovalRecord` | `legalCorpusVersionId -> LegalCorpusVersion.id ON DELETE CASCADE`; nullable `idempotencyKey @unique`; `approvedBy` is a string; stores integrity/retrieval refs and outbox ID (`apps/api/prisma/schema.prisma:1128-1144`). | Approval naming/nullable idempotency and corpus-only scope cannot represent automatic complete-portfolio activation. Keep historical; do not use as W2 approval. |
| `LegalRule` | Globally unique `legalRuleId`; `legalRuleCatalogVersionId -> LegalRuleCatalogVersion.id ON DELETE CASCADE`; semantic/sentinel JSON fields and `citationLocatorRefs Json`; no corpus FK (`apps/api/prisma/schema.prisma:1146-1161`). | Same rule cannot be versioned across catalogs without changing the global uniqueness; citation identity is not DB-enforced and can disagree with the catalog. |
| `RuleApprovalRecord` | `legalRuleCatalogVersionId -> LegalRuleCatalogVersion.id ON DELETE CASCADE`; `approvedBy` is a string; no idempotency key or actor FK (`apps/api/prisma/schema.prisma:1163-1174`). | Human/automatic approval semantics must not be a target writer. Retain only as historical audit during a later migration. |
| `LegalRuleMatch` | Separate `catalogVersion -> LegalRuleCatalogVersion.id` and `corpusVersion -> LegalCorpusVersion.id`, both `ON DELETE RESTRICT`, plus Assessment/VerifiedProfile links (`apps/api/prisma/schema.prisma:1176-1198`). | The two FKs are not constrained to the same source lineage and this is a legacy assessment/classification projection, not the W2 portfolio. |
| `EngineeringRuleAssessment` | Stores `engineeringRuleId` and `engineeringRuleVersion` as strings; only `assessmentId -> Assessment.id ON DELETE CASCADE` (`apps/api/prisma/schema.prisma:738-757`). | There is no Prisma `EngineeringRule` model or FK, so assessment rows cannot pin a durable rule version. |

### Current active-pointer behavior

There is no `ACTIVE` enum. The current enum is `DRAFT | APPROVED | REJECTED | SUPERSEDED` (`apps/api/prisma/schema.prisma:1355-1360`). “Active” is an unstable projection selected by query ordering:

- `GetActiveLegalCorpusHandler.execute` selects the latest `APPROVED` corpus by `createdAt DESC` and returns it as active (`apps/api/src/modules/legal-rule-catalog/application/queries/get-active-legal-corpus/get-active-legal-corpus.handler.ts:23-47`).
- `GetActiveRuleCatalogHandler.execute` selects the latest `APPROVED` catalog by `createdAt DESC`, then reads approved rules and resolves each JSON citation locator against chunks (`apps/api/src/modules/legal-rule-catalog/application/queries/get-active-rule-catalog/get-active-rule-catalog.handler.ts:34-127`).
- Recovery instead chooses an approved corpus by `approvedAt DESC, createdAt DESC`, creates an already-approved catalog and rules from candidate chunks, and writes `RuleApprovalRecord` (`apps/api/src/modules/legal-rule-catalog/application/services/rule-catalog-version.service.ts:93-242`). Its “latest approved catalog with rules” helper uses `approvedAt DESC, createdAt DESC` (`:244-265`).
- Admin `isCurrentActive` also uses `approvedAt DESC, createdAt DESC` (`apps/api/src/modules/legal-rule-catalog/application/services/admin-corpus-versions.service.ts:771-785`). The differing orderings mean corpus/catalog/readiness can disagree about the active basis.
- `LegalCorpusService.activateValidatedCorpusVersion` currently validates only corpus documents/chunks/retrieval index, acquires a corpus advisory lock, marks the target `APPROVED`, marks every other approved corpus `SUPERSEDED`, creates `CorpusApprovalRecord`, outbox, and audit rows in a serializable transaction (`apps/api/src/modules/legal-rule-catalog/application/services/legal-corpus.service.ts:233-518`). It never validates or swaps a complete LegalRule + EngineeringRule portfolio.
- `AdminCorpusVersionsService.prepare` creates a DRAFT corpus plus `CorpusPreparation` and an outbox request with `deferActivation: true`; `completePreparation` only writes preparation/readiness metadata (`apps/api/src/modules/legal-rule-catalog/application/services/admin-corpus-versions.service.ts:100-272`, `:319-422`). `publish` is the separate human/admin activation route (`:658-769`).

## 3. Minimal expand-only persistence boundary (future DRAFT schema proposal)

The future owner should implement one coherent portfolio schema family, not add a second runtime authority. The following is the smallest W2 expand-only storage shape that makes corpus lineage, complete coverage, immutable versions, activation, and retry behavior mechanically expressible.

The existing Prisma model named `LegalRule` is a V1 catalog-bound storage object. The frozen logical `LegalRule` concept must not be treated as an in-place rewrite during W2 expand. This DRAFT uses `LegalPortfolioRule` as a storage-boundary proposal for a new portfolio-bound row; the future schema owner may choose the final name. It is not a runtime compatibility alias, dual writer, fallback, or duplicate source authority. Existing V1 `LegalRule` rows and consumers remain intact until the separately gated W6 archive and W7 removal stages.

### Proposed W2 storage rows

`LegalPreparationRun` (new name to avoid giving corpus-only `CorpusPreparation` a second meaning):

- `id` PK; `idempotencyKey` required unique; `sourceCorpusVersionId` FK to `LegalCorpusVersion.id` with `RESTRICT`; `requestDigest`; worker execution/correlation refs using AES; structured validation/failure metadata; created/completed timestamps.
- One run creates one `LegalPortfolioVersion`; the portfolio carries `preparationRunId` unique FK back to this row. Do not allow a run to emit separate catalog/rule/cache writers.

`LegalPortfolioVersion` (new sole runtime aggregate):

- `id` PK; `version` required unique; `legalCorpusVersionId` required FK to `LegalCorpusVersion.id` with `RESTRICT`; `preparationRunId` required unique FK to `LegalPreparationRun.id` with `RESTRICT`.
- `lifecycleState` uses only ALCS (`BUILDING`, `ACTIVE`, `SUPERSEDED`, `INVALID`); immutable `portfolioDigest`, `validationManifestRef`, source/retrieval integrity refs, `createdAt`, `validatedAt`, `activatedAt`, `supersededAt`.
- Add a PostgreSQL partial unique index allowing at most one row with `lifecycleState = ACTIVE`. Reads use this row, never `ORDER BY approvedAt/createdAt`.
- Child rows are immutable once the aggregate has passed validation. No in-place retargeting of corpus, rule, EngineeringRule, source hash, or provenance fields.

`LegalPortfolioRule` (DRAFT storage-boundary name for the logical LegalRule; separate from the existing V1 `LegalRule`):

- `id` PK; `portfolioVersionId` FK to `LegalPortfolioVersion.id` with `RESTRICT`; stable logical `legalRuleId`; agent-authored proposition payload and content digest; accepted W2 coverage declaration plus a required reason payload when the rule is not assessable.
- Replace global `legalRuleId @unique` with uniqueness scoped to the portfolio (`portfolioVersionId, legalRuleId`). The portfolio, not a per-rule APPROVED status, is the version authority.
- The new row has no current catalog FK; do not remove or repoint the current V1 catalog FK in W2. The new writer does not use `aiDetected=confirmed` as authority or human `authoredBy`/approval meaning. The exact semantic payload remains the agent contract’s responsibility and is not designed here.

`EngineeringRule` (new first-class durable row):

- `id` PK; `portfolioVersionId` FK to the portfolio; FK to the proposed portfolio-bound LegalRule row; stable `engineeringRuleId` scoped to the portfolio; immutable contract payload, schema/version metadata, source fingerprint/digest, and created timestamp.
- Enforce same-portfolio ownership for both FKs (a composite ownership key or equivalent API/database check) and unique `(portfolioVersionId, engineeringRuleId)`; reject an orphan EngineeringRule. No cache/bundle/Chroma row is an authority.

`LegalRuleContextRelation` (new relational context graph):

- `id` PK; `portfolioVersionId` FK; logical portfolio-rule FK; `fromChunkId` and `toChunkId` FKs to `LegalDocumentChunk.id`; relation kind, ordinal, and relation digest; unique within portfolio/rule/endpoints/kind.
- The validator must require both chunks to belong to the portfolio’s `legalCorpusVersionId`. The row stores structural context links only; it does not classify legal meaning.

`LegalRuleProvenance` (new source-proof rows):

- `id` PK; `portfolioVersionId`, portfolio-rule, `legalCorpusVersionId`, and `chunkId` FKs with `RESTRICT`; copied `documentId`, locator, content hash, source-effect status, hierarchy/provenance digest, and ordinal for exact replay/audit.
- The DB/API boundary verifies copied identity against the canonical chunk/document row. The content/hash/locator is the proof; free-form citation JSON cannot be the sole authority. EngineeringRule rows inherit the LegalRule context and carry their own source fingerprint; if the accepted EngineeringRule contract requires distinct source links, add a typed join before implementation rather than a polymorphic `subjectId`.

`LegalPortfolioActivationRecord` (new activation audit, not approval):

- `id` PK; `portfolioVersionId` FK and `preparationRunId` FK with `RESTRICT`; required unique `idempotencyKey`; `requestDigest`; nullable `previousActivePortfolioVersionId` self-FK with `RESTRICT`; validation manifest/integrity refs; structured validation result/failure-code payload; correlation/service actor refs; created/committed timestamps; optional unique outbox event ref.
- Add a partial unique index allowing one committed activation per portfolio. A human approver, reviewer signoff, semantic approval status, or activation/rejection lifecycle enum is absent. A mechanical validation failure may commit a structured validation record with the candidate in `INVALID` without touching the prior `ACTIVE` row.

The future W3 `AssessmentCase` must then carry `legalPortfolioVersionId` (and the immutable portfolio digest) as a required `RESTRICT` FK; RuleDecision/history and AssessmentArtifact must repeat the same pin or reference the case pin. Current `Assessment` has lifecycle/runtime fields but no portfolio pin (`apps/api/prisma/schema.prisma:152-194`), so this report does not claim assessment pinning is implemented.

## 4. Atomic complete-portfolio activation

The future API boundary is one submit/validate/activate operation. Source acquisition may keep its existing crawl, byte/hash, hierarchy, and retrieval-index helpers, but no source-only activation may commit independently of the portfolio.

1. Validate request shape, worker authority, target run, idempotency key, and request digest. These cheap checks may happen before the transaction; no write is made.
2. Start a serializable transaction. Reuse the existing transaction-scoped advisory-lock pattern (`acquireLegalCorpusLifecycleLock`, `apps/api/src/modules/legal-rule-catalog/application/services/legal-corpus.service.ts:33-45`) with a new portfolio-activation lock key, or lock one singleton pointer row. Re-read the activation record by required idempotency key under the lock.
3. If a record exists with the same key and digest, return its stored result without another status change, audit row, or outbox event. If the key maps to a different target/digest, return conflict. This check must be inside the transaction; the current pre-transaction corpus replay lookup is insufficient for concurrent portfolio submissions (`.../legal-corpus.service.ts:245-270`).
4. Lock the target portfolio and current ACTIVE row. Validate all children against the target: one corpus FK; exact source/chunk hashes and effect status; valid retrieval index; unique LegalRule and EngineeringRule IDs; every LegalRule covered by one or more EngineeringRules or an explicit agent-declared non-assessable reason; no orphan EngineeringRule/context/provenance rows; no mixed corpus/portfolio pins; no repealed, stale, or missing references; and complete required validation manifests. These are identity/completeness checks only, not legal classification or applicability decisions.
5. On mechanical invalidity, leave the current `ACTIVE` row untouched, mark the target `INVALID`, create one activation record containing structured validation failure codes and the previous-active ID, and commit that failure/audit transaction. A retry with the same key replays the same result; a repaired attempt is a new immutable portfolio/run, not an in-place rewrite.
6. On valid output, mark the current ACTIVE portfolio (if any) SUPERSEDED, mark the target ACTIVE with its immutable activation metadata, create `LegalPortfolioActivationRecord` with `previousActivePortfolioVersionId`, enqueue one activation outbox event, and write the audit event in the same transaction. Commit only after all rows succeed; the publisher runs after commit.
7. On a database/serialization/outbox/audit error before commit, roll back the whole transaction. The previous ACTIVE pointer and target remain unchanged, with no activation outbox event. The caller may retry the same idempotency key using transaction retry handling.

There is no `findFirst(APPROVED)`, no latest-by-timestamp fallback, no approval endpoint, no catalog promotion, and no assessment-triggered preparation in this boundary.

## 5. Mechanical acceptance cases for the future owner

| Case | Required persisted result |
|---|---|
| Missing/invalid worker request, unknown run, missing digest | No portfolio/pointer mutation; structured validation failure; no activation audit/outbox write. |
| Mixed corpus IDs, source/chunk hash mismatch, repealed/missing chunk, invalid retrieval manifest | Target is `INVALID`, not `ACTIVE`; prior `ACTIVE` is unchanged; structured validation failure is recorded if the failure transaction commits. |
| Missing LegalRule coverage, orphan EngineeringRule/context/provenance, duplicate logical IDs, or a rule outside the target portfolio | Same as above; no semantic classifier is invoked to repair the packet. |
| No prior ACTIVE exists and packet is invalid | Candidate is `INVALID`; no `ACTIVE` pointer is created; preparation fails closed. |
| Same idempotency key + same target/digest after success | Return the original activation/audit result; exactly one successful activation and one activation outbox event. |
| Same idempotency key + different target/digest | Conflict; neither target becomes ACTIVE. |
| Same target concurrently submitted with different keys | Lock serializes; first valid commit wins; later request sees ACTIVE and conflicts (no second successful activation). |
| Two different valid targets concurrently submitted | Lock serializes both; the later commit records the earlier ACTIVE as `previousActive`; exactly one ACTIVE remains. |
| Invalid target races a valid target | Invalid transaction cannot change the pointer; valid transaction may activate from the last committed ACTIVE. |
| Crash/serialization failure before commit | Full rollback; old ACTIVE and candidate state remain as before; retry with the same key is safe. |
| New activation after an assessment has pinned an older portfolio | Old portfolio and all child/source rows remain immutable/readable for the pin; no retarget, rewrite, or hidden rebase. |

## 6. Source seams and later disposition

| Exact seam | Later disposition for the single W2 owner |
|---|---|
| `LegalCorpusService.validateIngest` (`apps/api/src/modules/legal-rule-catalog/application/services/legal-corpus.service.ts:1057-1095`) | **REUSE mechanical** non-empty/sha256/chunk checks; **REWRITE** the call to `requireApprovedReviewSignoff` so it cannot be a human gate. |
| `requireApprovedReviewSignoff` (`.../legal-corpus.service.ts:1097-1218`) | **DELETE** human signoff semantics. The official-source trust metadata can remain source provenance, but it is not approval. |
| `registerValidatedRetrievalIndex` and `validateActivationInput` (`.../legal-corpus.service.ts:520-639`) | **REUSE/REWRITE** as source/retrieval preconditions of portfolio validation; do not let either endpoint activate corpus independently. |
| `activateValidatedCorpusVersion` and `acquireLegalCorpusLifecycleLock` (`.../legal-corpus.service.ts:33-45,233-518`) | **REUSE transaction/advisory-lock/outbox/audit pattern; REWRITE** aggregate scope from corpus approval to complete portfolio activation. |
| `AdminCorpusVersionsService.prepare` / `completePreparation` (`.../admin-corpus-versions.service.ts:100-272,319-422`) | **REWRITE** the future canonical path to create the one preparation run + portfolio in `BUILDING` state and complete only the canonical submission path. Preserve idempotency/outbox trigger mechanics; leave V1 preparation rows/consumers intact during W2 expand. |
| `AdminCorpusVersionsService.publish` / `discardDraft` (`.../admin-corpus-versions.service.ts:533-769`) and controller routes (`.../legal-rule-catalog.controller.ts:297-321`) | **RETAIN** existing V1 routes/consumers for historical/archive continuity during expand; the new canonical writer never invokes them. Archive at W6 and remove only at W7 after the deletion gate; no compatibility route is added. |
| `RuleCatalogVersionService.createDraft` / `recoverApprovedRulesFromActiveCorpus` (`.../rule-catalog-version.service.ts:64-242`) | **RETAIN** existing V1 catalog/rule factory and rows through W6 archive; the new canonical writer never promotes them. **DELETE** only at W7 after archive and consumer gates. |
| `ApproveRuleCatalogVersionHandler.execute` (`apps/api/src/modules/legal-rule-catalog/application/commands/approve-rule-catalog-version/approve-rule-catalog-version.handler.ts:32-141`) | **RETAIN** the existing V1 approval writer/records for historical continuity until W6 archive; the new canonical path does not use them. **DELETE** only at W7 after the removal gate; new integrity validation is portfolio-owned. |
| `GetActiveLegalCorpusHandler.execute` / `GetActiveRuleCatalogHandler.execute` (`.../get-active-legal-corpus...handler.ts:23-47`, `.../get-active-rule-catalog...handler.ts:34-127`) | **ADD** one portfolio reader for the canonical path selecting the explicit ALCS `ACTIVE` row; keep V1 readers available for read-only historical continuity until W6/W7, never as a fallback or repointed FK authority. |
| `CitationLocatorValidatorService.validateAll` (`apps/api/src/modules/legal-rule-catalog/application/services/citation-locator-validator.service.ts:19-76`) | **REUSE mechanical** locator/existence/repealed checks, parameterized by the pinned corpus; it cannot authorize legal meaning. |
| `LegalCorpusRecoveryDriver.run` / `_run_locked` (`deepagents/tools/legal/sources/recovery/legal_corpus_recovery_driver.py:92-230`) | **RETAIN** the V1 source/recovery consumer and historical outputs through W6 archive; add the canonical portfolio submission path separately, with no V1-to-V2 writer or fallback. **DELETE** old catalog recovery/assessment-resume behavior only at W7 after removal gates. |
| `_recover_legal_rule_catalog` (`.../legal_corpus_recovery_driver.py:448-480`) | **RETAIN** the V1 recovery consumer and its historical output through W6 archive; the W2 canonical writer never promotes those rows. **DELETE** only at W7 after archive/removal gates. |
| `LegalRuleTriageService.get_work_items`, `persist_result`, `_load_sources` (`deepagents/tools/triage/legal_rule_triage/service.py:53-167,169-261`) | **RETAIN** V1 consumers through W6 archive for historical continuity; add the W2 complete portfolio packet path separately, with no V1-to-V2 dual writer or fallback. **DELETE** only at W7. |
| `LegalRuleTriageBoundary.handle` (`deepagents/tools/triage/legal_rule_triage/boundary.py:42-109`) | **RETAIN** the V1 dispatch consumer through W6 archive; the new Legal Preparation path has no assessment context and does not invoke it. **DELETE** only at W7 after the removal gate. |
| `EngineeringRuleService.resolve_source_identity` / `prepare_from_triage` (`deepagents/tools/legal/corpus/engineering_rules/orchestration/service.py:174-338`) | **REUSE** mechanical source identity/schema/provenance validation in the new path, but keep V1 persistence consumers intact through W6; **REWRITE** the future canonical write to the API portfolio submit boundary, with no dual writer. |
| `EngineeringRuleService.get_or_compile` / `_retarget_cached_rules` (`.../orchestration/service.py:46-121,416-445`) | **RETAIN** V1 cache/bundle consumers through W6 archive for legacy continuity, never as the W2 portfolio reader or fallback; **DELETE** only at W7 after the removal gate. |

The prior source-acquisition, legal-evaluation, and native-prompt reports remain read-only inputs; this report deliberately does not repeat their semantic rubric/prompt claims.

## 7. Remaining prerequisites and NOT_PROVEN

- **W1 integration gate: NOT_PROVEN here.** The W2 persistence migration cannot be authored until W1 contract/persistence/API integration is independently accepted (`reports/architecture-freeze-migration-manifest.md:370-375`).
- **W2 submit envelope/auth and exact child payload schemas: NOT_ACCEPTED.** The future owner must freeze them with the API legal owner; this report does not create contracts or canonical values.
- **Prisma/migration implementation and live transaction tests: NOT_DONE.** No schema, migration, API, Python, test, or runtime file was changed.
- **Database partial-index/serializable-retry behavior: NOT_PROVEN.** The owner must verify the selected PostgreSQL constraint/index syntax, lock scope, transaction retry policy, and outbox/audit FK ordering against the actual migration chain.
- **Corpus-to-portfolio live vertical, provider/worker behavior, network/API persistence, browser behavior, and W2 gate: NOT_PROVEN.** No external provider, network, database, API, browser, or production run was performed.
- **AssessmentCase/RuleDecision/artifact pin implementation: NOT_PROVEN and W3-owned.** This report only records the required future FK/pin boundary; it does not redesign W3 or promote current `LegalRuleMatch`/`EngineeringRuleAssessment` rows.
- **Historical archive/removal/backfill: OUT OF SCOPE.** Existing corpus/catalog/approval/cache/bundle rows remain read-only until the separately gated migration; none is a target writer or fallback.

Verification for this preparation: indexed code-graph discovery was used first, followed by direct checked-out source/schema reads; no full re-index was run. The only permitted write is this report.

## 8. Correction receipt

- **State-name check: PASS.** Proposed portfolio/artifact lifecycle uses only ALCS `BUILDING`, `ACTIVE`, `SUPERSEDED`, `INVALID`; Legal Preparation execution uses only AES `QUEUED`, `RUNNING`, `INTERRUPTED`, `PAUSED`, `SUCCEEDED`, `FAILED`, `CANCELLED`. `FAILED_VALIDATION`, `ACTIVATED`, and `REJECTED` are not proposed lifecycle values; validation failures are structured results with candidate `INVALID`.
- **Storage/staging check: PASS.** The existing V1 `LegalRule`/catalog/approval tables, foreign keys, and consumers remain intact through W2 expand; the proposed `LegalPortfolioRule` name is a future storage-boundary label only. W2 adds canonical portfolio storage/writer; W6 archives; W7 removes only after gates. No FK drop/repoint or non-null semantic backfill is proposed.
- **Atomicity check: PASS as design invariant.** Portfolio versions remain immutable; one explicit `ACTIVE` row is guarded; valid activation records the previous active; invalid validation leaves the previous active untouched; idempotency replay is inside the serialized transaction.
- **Exact no-diff-outside-scope: PASS.** `CHANGED_BY_THIS_TASK = {reports/w2-portfolio-persistence-boundary-preparation.md}`. No production file, schema, migration, contract, API, Python, web, i18n, test, other report, ledger, service, database, provider, network, full-index artifact, commit, or push was written.
- **Implementation/live gates: NOT_PROVEN.** W1/W2 acceptance, schema/migration implementation, database transaction/index behavior, provider/worker/API persistence, browser behavior, archive/removal, and production cutover remain NOT_PROVEN.
