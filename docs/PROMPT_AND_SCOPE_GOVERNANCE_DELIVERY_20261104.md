# LCSP — Prompt fingerprints, EN/VI tool workflows & DEVELOPMENT_ONLY scope governance

**As of 2026-11-04** · Implementation artifact in Draft PR #456. **Multi-repository Live Eval is explicitly excluded from this change.** No production deployment/merge, human legal acceptance or live model parity is claimed.

## A. Prompt / Skill / Tool Fingerprinting

Source of truth: `deepagents/evals/run_manifest.py`, `deepagents/evals/settle_manifest.py`.

- Assessment Root computes an immutable SHA-256 manifest from the **resolved** Root/Researcher system prompts, selected `responseLanguage`, model identifier (if provided by the adapter), available localized skills, API/graph tool descriptions, and server-owned source pins. Loaded skills are tracked by the skill loader and included when the run finishes.
- Preparation computes a distinct fingerprint for each model-facing phase request **after** phase/locale selection and tool allowlisting. Its manifest binds `legalSourceVersionId`, currently selected skills and tool descriptions, and hashes the exact system message (including the compaction suffix); discarded tools are not recorded as available.
- Set `LCSP_EVAL_MANIFEST_DIR` on the worker to emit immutable, owner-private receipt JSON files. Set `LCSP_EVAL_GOLD_REVISION` only in an evaluation run to annotate its approved gold reviewer revision; leaving it unset gives explicit `null`. Never place raw prompts, source code, user answers, secrets or legal quotes in receipts.
- Cost and attempt data **must not be estimated**: `providerCost`, `cachedInputTokens`, `failedAttempts`, etc. are `null` until supplied by the separately reconciled API usage journal/billing ledger. `reconcile_usage` rejects wrong run ID, partial journal, incorrect hash, negative counts or unbilled cost. `--usage-journal` input must be produced by the authoritative journal/export; this script does not fetch or fabricate payments.

Example for an independently reconciled (already existing) journal snapshot:

```bash
cd deepagents
python -m evals.settle_manifest \
  --manifest /secure/receipts/<run-id>.json \
  --usage-journal /secure/reconciled-usage.json \
  --output /secure/receipts/<run-id>.settled.json
```

`manifestSha256` changes when prompt, selected skill, tool description, model, locale, source pin, gold revision or trusted usage changes. Existing files are exclusive-create and replay-validated; overwrite is never implicit. A matching hash is **provenance only**, not correct legal reasoning.

## B. Tool Instruction, Context and EN/VI

- `deepagents/assessment_root/tool_contracts.py`: eight critical governed tools have bilingual `WHEN/READ/NEXT/FAILURE` playbooks. These reinforce API-owned evidence authority, selected-rule scope, HITL and negative-search boundaries. All pre-existing tool schemas, names and permissions stay unchanged.
- `test_assessment_tool_workflows.py` checks both languages expose the same workflow identities and canonical enums, preserving the context/resume policy. Existing `test_assessment_prompt_locales.py` verifies Root/Researcher/compaction locale wiring; `test_preparation_model_manifest.py` verifies phase prompt+tool fingerprints differ across locales while preserving the same tool identity.
- **Limit:** Structural EN/VI parity and deterministic tests do not prove identical model-produced legal conclusions. No multi-repository live parity was run, per instruction to skip task 1.

## C. Server-owned DEVELOPMENT_ONLY lifecycle

1. **Admin requests the scope at start** via existing `POST /admin/compliance-rule-sets/prepare` and `targetActivityScope:"DEVELOPMENT_ONLY"`. A run is created with `scopeReviewRequested=true` but effective `targetActivityScope=FULL_SOURCE`; the full pinned legal corpus is still discovered. A different scope cannot reuse the same idempotent attempt silently. Retry carries forward the requested scope.
2. **Freeze/pause:** When the canonical claim inventory passes validation and FINALIZE, API atomically persists the frozen graph and advances to `CLAIM_INVENTORY_READY` and `executionState=PAUSED`. The worker stops before another model request (`ScopeReviewPauseRequired`), without marking the run failed. A direct FULL_SOURCE run is unaffected.
3. **Admin reviews all operative claims** using `POST /admin/compliance-rule-sets/preparations/{runId}/scope-reviews`. Body: `inventoryRevision`, `inventoryFingerprint`, `expectedReviewRevision`, plus per-claim `claimId,legalSourceVersionId,sourceNodeIds,actor,modality,action,stage,reason`. `stage` is `DEVELOPMENT | NON_DEVELOPMENT | LEGAL_REVIEW_REQUIRED` per proposition, not per article. Source IDs must match the frozen ledger, not user-provided legislation.
4. **Independent approval** via `POST .../scope-reviews/approval` with `inventoryRevision,expectedReviewRevision,decisionDigest,confirmsLegalReview:true`. The approver must be an authenticated ADMIN actor different from the submitter. The server compares live frozen inventory, signed-in reviewer, revision and typed source graph; unresolved claims block approval. This is a server-identified human approval, not independent certification of legal truth.
5. **Activation of scoped mode** via `POST .../scope-reviews/activate` with `inventoryRevision` only on the same PAUSED run, after approval and rechecking source hashes. Effective `targetActivityScope=DEVELOPMENT_ONLY` is persisted. The source ledger remains FULL, immutable and revisioned. **This endpoint does not activate a Rule Set.**
6. **Resume** via the existing Admin resume endpoint. Only a reviewed, approved and activated scope can resume from review PAUSED. Worker claim revalidates scope and passes a trusted `approvedScopeDigest`; the model refuses a scope without this server-issued proof. `AUTHOR_RULES`, validate, submit and activation perform additional server-side validation.
7. **Publication gate:** Every relevant normative claim remains accounted, with complete source node pins. Mixed actor/stage legal requirements must be split. Only DEVELOPMENT claims appear in AssessmentRules; NON_DEVELOPMENT claims remain visible in legal-source accounting and are explicitly labeled `OUT_OF_SCOPE_TARGET:` rather than `NO_REQUIREMENT`. Context is retained only through directed, source-pinned material edges. No unresolved review or unaccounted claim may pass. The published Rule Set Version carries `targetActivityScope`.

### Governance and rollout boundaries

- Separate physical Rule Set versions have an explicit scope column; the existing system still enforces one globally ACTIVE Rule Set. Switching to a Development version therefore uses the current activation/supersession model, not parallel ACTIVE catalogs. If parallel FULL/DEVELOPMENT catalogs are required, that is a distinct product/workflow change.
- Human approval is an authenticated, revision-checked ADMIN decision. It does **not** replace independent legal gold review. Current UI is the existing Admin API; a specialized review UI has not been added.
- Negative tests cover missing/mixed claims, foreign context provenance, wrong actor, permission-as-duty, operator-only Rule leakage, omitted developer duty, idempotent retry, pause-before-approval and basic bilingual prompt/skill tool wiring.
- Runtime assessment and production migration/rollout must remain gated on focused CI, disposable-DB migration tests, dedicated legal review and release approval. Do not infer successful activation from unit tests alone.

## D. Explicit acceptance / scope

| Workstream | Implemented | Not proven by this PR |
| --- | --- | --- |
| Fingerprinting | Hash resolved prompts, localized skills, tool descriptions, pins, configured model; immutable receipts and reconciled usage setter | End-to-end journal export or actual model spend for every deployed run; production storage policy |
| Tool/context EN/VI | Localized usage playbooks and provider-free locale/resume/compaction tests | Live legal-decision semantic parity |
| Scope governance | Persisted claim-level ledger, CAS revision, second-actor approval, pause/approve/activate/resume, fail-closed scoped packet validator | Independently approved legal decisions; live scoped Rule Set acceptance and deployment |
| Multi-repository Live Eval | **SKIPPED per user instruction** | No live baseline/candidate metrics claimed |

A green structural test or synthetically passing scope projection never substitutes for legal acceptance or a successful production run.
