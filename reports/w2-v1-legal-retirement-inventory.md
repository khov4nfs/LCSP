# W2.5 — V1 legal authority retirement inventory

Scope: retire only the production write/authority paths replaced by the validated
`LegalPortfolioVersion` vertical. W3/W4 assessment runtime paths are NOT deleted merely because
they are legacy. Classification was made from current source (caller/import/registration search),
not from the plan.

Classes: `DELETE_NOW` · `KEEP_TRUSTED_INFRASTRUCTURE` · `DEFER_TO_W3_W4_W5_W6` · `HISTORICAL_ONLY`.

## DELETE_NOW (deleted; zero production callers — enforced by `pnpm run check:legal-v1-retired`)

| # | Legacy authority | What was removed |
|---|---|---|
| 1 | Human LegalRule approval/signoff | `approve-rule-catalog-version` command/handler/contract/spec; `POST /internal/legal-rule-catalog/versions/:id/approve`; `RuleApprovalRecord` writer; corpus **human review signoff** branch (`requireApprovedReviewSignoff`) replaced by the mechanical official-source auto-trust gate (`requireOfficialSourceAutoTrust`); `humanLegalSignoffRequired` policy flag |
| 2 | draft/approve/publish/discard semantic write routes | `POST …/rules` (draft), `POST …/versions` (create draft catalog), manual admin `POST …/corpus` ingest, `POST …/rules/recover-from-active-corpus`, `GET …/active` (V1 catalog read), `POST /admin/corpus-versions/:id/publish`, `…/:id/discard`; `AdminCorpusVersionsService.publish/discardDraft` + `CorpusDiscardReceipt` writer; `draft-legal-rule` command/handler/contract/spec; admin `actions` are now always `{canPublish:false, canDiscard:false}` |
| 3 | Regex/normative LegalRule factory + classifier | `RuleCatalogVersionService` (chunk-per-rule `aiDetected=confirmed` factory + `normativeClass`); API ingest obligation-term/context-only classification (now structural exclusion of empty/heading/preamble chunks only); Python `normative_chunk_filter` (replaced by non-semantic `structural_chunk_filter`); dev seed `normativeClass` stamping |
| 4 | Assessment-triggered recovery / lazy preparation | `_AssessmentLegalPreparationDeferredDriver`, `_as_waiting_for_triage`, `_dispatch_legal_triage_request`, RabbitMQ triage publisher, `source_crawl_requests`, `rule_service` in `EngineeringAssessmentBoundary`; driver `recoverLegalRulesOnly`/`_recover_legal_rule_catalog`/resume-after-recovery; `WorkerApiClient.recover_legal_rules_from_active_corpus` |
| 5 | EngineeringRule `get_or_compile`/cache/bundle fallback | `engineering_rules/orchestration/service.py`, `compilation/{compiler,chunk_triage,fingerprint}.py`, `registry/{cache,precompiled_*}.py`, `restore_engineering_rule_artifacts.py` |
| 6 | Chroma/precompiled EngineeringRule authority | `EngineeringRuleCache`, `PrecompiledEngineeringRuleRegistry`, precompiled bundle JSON + Dockerfile/`.dockerignore` references, export/import/warm scripts, precompiled template projection |
| 7 | Legal triage as authoring/readiness authority | `tools/triage/**`, `subagents/triage`, `skills/legal-rule-triage`, `middleware/triage_{progress,singleton}`, `TriageResult` handoff, triage branch of `RootOrchestrationLifecycle`, `legal_rule_triage_requested` registration, root `instructions.md` Workflow A, `WaitingAssessmentRegistry` |
| 8 | Duplicate EngineeringRule compilation/semantic generation | `EngineeringRuleCompiler`, `LegalChunkEngineeringRuleTriage` (second LLM paths) |
| 9 | Old preparation/recovery registrations that could create/activate semantic output | `legal_rule_triage_requested`; unwired `schedules/legal_catalog_daily.py` (LLM maintenance prompt); `orchestrate_reviewed_legal_corpus.py`, `normalize_vbpl_document.py`; `author-law-134-baseline-catalog.ts`, `restore-legal-corpus-artifacts.ts`; `seed_legal_rules_dev.py` |

Behaviour changes that make the deletions safe:

* Admin **prepare** is now a trigger + history record. The recovery driver activates the validated corpus
  **automatically** (no `deferActivation`, no publish) and then closes the preparation row via the
  existing callback; `start_legal_preparation` still fires exactly once between index registration and
  activation.
* Corpus ingest accepts only official-source auto-trusted manifests (`reviewRequired:false` +
  `trustPolicy:OFFICIAL_SOURCE_AUTO_TRUSTED`).

## KEEP_TRUSTED_INFRASTRUCTURE

Official-source acquisition (crawl scripts, `official_source_payload`, source snapshots API) · immutable
corpus/document/chunk rows · hierarchy + structural chunk gate · legal/source status (`vbpl_effects`) ·
source/version/hash validation (`validateIngest`) · retrieval index build/validate/register · citation
locator validation (`validate-citation-set`) · worker-guarded `corpus/validated-draft`,
`…/retrieval-indexes/validated`, `…/activate-validated`, `…/chunks`, `corpus/active` · admin
list/detail/**prepare** (read-only history + trigger) · `LegalChangeDetectorBoundary` · generic
outbox/idempotency · RBAC/auth/tenant guards · audit/accounting · `artifact_store` (source artifacts).

## DEFER (explicitly NOT W2 legal-authority retirement)

| Item | Owner | Why it stays |
|---|---|---|
| `rule_sources._to_v1_rule` bridge | **DEFER_TO_W3/W4** | Strictly a read adapter ACTIVE V2 portfolio → still-V1 assessment execution; no authoring/recovery/cache authority |
| V1 `EngineeringRule` contract (`models`, `validator`, `legal_reasoning_contract`, `runtime_projection`), `::ENG::`/`::PRECOMPILED::` id parsing in `absence_policy`/`rule_applicability_gate`, `rule_applicability_evaluator`, `legal_match_builder` | W3/W4 | Consumed by the per-rule assessment loop/evaluator |
| `resume_waiting_runs` tool/command/handler + `enqueueWaitingLegalMatchingRunsAfterActivation` | W3/W4 | Assessment resume machinery with no legal authority; keyed on a V1 approved catalog that is no longer produced |
| V1 LegalRule *readers* (classification, evidence, document modules) | W3/W4 | Read-only |
| Root `agent.py`/`instructions.md` full rewrite, interview/`PostGuardContinuationStore` | W3 | Root rewrite is W3; only the legal-triage authority was removed here |
| `build_reviewed_legal_corpus.py` + `reviewed_input/*` | W2 follow-up/W6 | Manual-review producers; no route accepts a signoff manifest any more |
| Web admin corpus-versions publish/discard UI, BFF routes, client, i18n keys | **DEFER_TO_W5** | Backend authority is gone; actions are always disabled (`canPublish/canDiscard=false`) |
| Prisma V1 models (`LegalRuleCatalogVersion`, `LegalRule`, `RuleApprovalRecord`, `CorpusApprovalRecord`, `CorpusDiscardReceipt`) + `packages/contracts/src/legal-rule-catalog` | W6 (schema drop) | Drop only after history archive + migration upgrade acceptance |
| Unused roles `triage`, `legal-chunk-triage`, `legal-compiler` in `config/model_routes.yaml` | user-owned file | Not modified; harmless |

## HISTORICAL_ONLY

Prisma migrations, `reports/**`, `docs/**`, `CHANGELOG.md`, `deepagents/.mda/**` build copies.
