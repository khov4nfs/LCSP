# LCSP-347 PM re-review technical handoff

Reviewed baseline: `d35f65d5d2cd688ca2f0192b61af04db54a61f27`. Keep PR 456 Draft. No merge/deployment or paid model evaluation is authorized by this handoff.

## Customer read contracts

- JSON Final Report loading verifies the canonical artifact first, applies the existing durable overlay through `localizedReportDocument`, validates the complete V1/V2 document and hashes the actual response bytes. Canonical artifact ID and source digest remain independent from the localized response digest.
- Overlays must match source ID/hash, locale, artifact identity, translation revision and the complete authored-field path set. Protected fields cannot be injected. The original artifact is never rewritten.
- Event pages authorize the customer owner before looking up localization at `(assessmentId, EVENT, eventId, sequence)`. Catalog labels and technical identities remain unchanged. Optional authored activity summaries follow durable enqueue/projection and flow into the existing work disclosure.
- Catalog localization is limited to narratives exposed on the current page. Every rule/requirement lookup binds Rule Set scope, entity ID/type and `contentDigest` revision. Group membership, pagination totals and selected-rule/version authorization remain canonical.
- Missing/failed locale revisions return `AUTHORED_LOCALIZATION_INCOMPLETE` with PENDING/FAILED metadata. GET does not call a translation provider. Historical unlocalized records require the existing backfill before locale readback can succeed.
- Existing read APIs without a locale retain their canonical compatibility path. Customer BFF requests carry the trusted locale. Event and catalog caches partition by locale.

## Focused validation and limits

Localization CI recovery keeps application boundaries explicit:

- API producer: `pnpm --dir apps/api exec cross-env NODE_OPTIONS=--experimental-vm-modules jest --config ./jest.config.ts --runInBand --runTestsByPath test/localized-assessment-read.spec.ts` ? 22 passed. Real HTTP controllers, query handlers, enqueue/projection and report integrity loading execute over the scoped persistence double. The V2 fixture builds explicit required decision fingerprint entries; corrupt fingerprints still reject.
- Web consumer: `pnpm --dir apps/web exec tsx --tsconfig tsconfig.test.json --test tests/localized-assessment-read.test.ts tests/rule-audit-picker.test.tsx` ? 16 passed. Real BFF routes and conversation projection consume validated API wire fixtures, without API/Prisma imports. The existing selected-rule picker test remains intact.
- Shared data is serialized HTTP contract data in `apps/web/src/public/assets/mocks/localized-assessment-wire.json`; the API producer asserts exact parity with these fixtures. No private implementation is exported or imported across applications.
- `uv run --frozen pytest -q tests/test_assessment_root_completion.py tests/test_system_event_dispatch_async.py --tb=short` ? 13 passed. The real Supervisor graph rejects unauthorized conversational inference without invoking the model; a registered system event still dispatches. Assessment completion/HITL/checkpoint tests are retained.
- `pnpm run check:imports`, `pnpm run typecheck`, and targeted API ESLint passed. No production code, authority guard, schema, fingerprint algorithm or import allowlist was changed by this CI recovery.

Three existing targeted Jest suites: 11 passed. API and Web TypeScript checks passed. Chromium smoke opened the actual server-rendered work disclosure, expanded it and verified EN/VI narratives. This is component browser evidence, not a full authenticated Next/PDF export journey.

Real PostgreSQL restart/replica integration and complete API/Web/worker regression remain for GitHub CI and independent review. Docker daemon was unavailable locally. No claim of independent translation fidelity or legal correctness follows from these provider-free checks.

## Framework controls and runtime release checklist

The strict inventory now includes `agent.py` and `harness.py` entrypoints, exact installed dependency/symbol fingerprints and local adapter source hashes. See `deepagents/instructions/verification-report.json` for current counts.

- Main model requests resolve role/phase/scope instructions, tool descriptions and schema guidance at the final boundary. Extra system messages, unknown tools and uncontrolled profile middleware/exclusions fail closed.
- Parent and separately routed Claim Author profiles are guarded under the same reentrant construction lock. Delegates explicitly use isolated mode; default general-purpose and fork paths cannot activate in these graphs.
- Stock profiles that install extra middleware (including some Codex/Nemotron profiles) are deliberately unavailable until that middleware receives explicit control review. Do not remove this guard to enable a deployment configuration.
- Summaries validate the exact approved role composition and template around serialized history. They retain legal actor/source distinctions and emit actual system/template receipts into the run evidence. Media-reference semantics come from the approved summary template.
- Native model-limit counters and end routing remain unchanged; generated terminal content resolves `runtime.budget-finalization:HARD_STOP`.
- The outer Agent Server supervisor is transport-only. Trusted system events dispatch and end; unsupported interactive fallback is rejected before model/compaction hooks. Legacy interactive supervisor checkpoints are outside supported cutover; do not replay them as authorized Assessment checkpoints.
- The production loader is unpatched in negative tests. Missing/corrupt/unapproved/revoked assets and reserved TEST_ONLY identities reject before inference.

Production remains **BLOCKED_EXTERNAL_APPROVAL**. All 59 VI/EN entries remain PENDING independent equivalence review. The candidate manifest is `deepagents/instructions/candidates/r1/manifest.pending.json`, not an approved release. A release authority must approve exact VI/EN bytes, issue real approval metadata, publish an immutable approved manifest, and pin its actual SHA-256 through deployment governance. Then run unpatched production positive loading, EN/VI construction, compaction/resume and deployment-config compatibility checks. No release digest or reviewer identity has been invented.

## Seven-case legal evaluation inputs

`deepagents/evals/fixtures/lcsp347_pm_review_package.pending.json` accounts for all seven PM case IDs, without asserting legal labels or source quotations. Exact source text/version/effect/locators, actor/action/trigger/stage, repository-verifiable aspects, proposed dispositions, independent reviewers, gold revisions and hashes are currently absent. Actual DEVELOPMENT, mixed-provision and unresolved/HITL controls are also absent. Source-grounded coverage is **0/7**, not reviewed acceptance.

Required providers: Legal Source custodian supplies immutable exported provisions; independent legal reviewer supplies source-grounded gold and controls; translation/release authority supplies approved EN runtime; PM/budget owner authorizes fixed model/holdout/rubric/spend. These inputs cannot be produced by relabeling synthetic fixtures.

Preflight (expected exit 4 while inputs are missing):

```powershell
cd deepagents
uv run --frozen python -m rule_set_preparation.eval_cli --review-package evals/fixtures/lcsp347_pm_review_package.pending.json --preflight-only
```

Once external approvals and frozen model outputs exist, use the existing scorer with `--gold`, `--approved-gold-sha256`, `--candidate`, `--run-manifest`, `--baseline`, `--baseline-run-manifest`, `--review-package`, `--approved-review-package-sha256`, and `--billing-evidence-dir`. The receipt archive contains provider usage/billing JSON files named by their verified SHA-256. Paired comparison rejects changed model/source/gold/bundle, synthetic runtime approval, changed authorized holdout/rubric and missing/unreconciled provider billing evidence. It reports atomic-claim FP/FN/recall/leakage and each side's actual attempts/tokens/cost without making model calls.

No gold was approved, no paid model output was generated, and no live semantic accuracy/cost result is claimed. PM acceptance remains blocked until independent evidence and PostgreSQL/browser release verification are supplied.

## Additional final evidence

- Final targeted worker suites: 53 runtime/inventory/compiler cases; 10 summary/compaction cases; 21 framework/transport cases; 3 summary fallback/budget-sharing cases. Suites overlap and must not be summed as distinct tests.
- Paired-evaluator/compiler checks: 28 passed, including negative review/billing/budget boundaries and exact UTF-8/LF candidate bytes on Windows. No paid provider calls.
- Targeted API/Web ESLint and the business documentation gate pass; no coverage threshold, assertion or release gate was removed.
- Local adapter fingerprints hash canonical Python AST without source locations. This detects semantic drift while remaining stable under Windows/Linux line endings; model instruction hashes still cover exact asset bytes.
- Knowledge-graph refresh was attempted but the `graphify` executable is not installed in this environment.

The seven-case package is also bound to the aggregate gold: reviewed propositions, context and stage expectations cannot be omitted from the scored holdout. Frozen comparison emits per-case outcomes, actual usage deltas and explicit blocked states; an authorized budget cannot be exceeded or silently converted to another currency.

## PM review 5818396646: pagination, global metrics and coverage labels

Root cause: the scope UI never followed existing scope cursors, the job response lacked navigation metadata, and the form rendered only 50 of its first 100 jobs. Operational totals were accumulated from that scope page. Assessment Detail loaded canonical concepts without the reviewed `/concept` projection.

Fix: the Admin job contract is now `{ items, nextAfter, hasMore }`. Scope discovery also includes `hasMore`. Both interfaces provide next/previous navigation; queue keys include scope, cursor, filter and history, and consume cancellation signals. Job filters run over PostgreSQL's latest generation per `(scopeId, entityType, entityId, canonicalRevision, canonicalDigest, fieldPath, locale)`, before pagination. `SOURCE_REVIEW_REQUIRED` includes unverified UNKNOWN/MIXED work; their classifications remain distinct. Historical generations are available through the separate read-only `history=true` API query, not counted as current work. Per-request immutable review evidence remains available on each row.

Selections are explicitly limited to the current page and cleared when navigating. Unsubmitted edits are retained by exact request/revision/hash/path/locale identity. Up to 50 selected fields may be attested; oversized selections are rejected visibly rather than sliced. Batch outcomes are itemized; rejected selections remain unresolved. No unseen field or provider output is automatically approved.

Global totals now use parameterized PostgreSQL aggregation over the effective generations, independent of scope page/cursor. Only aggregate rows (at most the operational-state value set) reach application memory. Per-scope readiness remains separately labeled. No provider credentials or customer narrative is returned through metrics. Admin RBAC remains mandatory. The existing indexes support scope/origin lookups; no migration or production data backfill is required for these read changes.

Coverage loads only the pinned coverage rule IDs and versions, rejects missing/version-mismatched rules, and bulk-resolves exact `ASSESSMENT_RULE` `/concept` entries at the rule's content digest and Rule Set scope. There is one localization query per batch of at most 200 coverage rules. Path, entity, original SHA and latest translation revision verification reuse the existing resolver. No canonical rule, accepted decision, evidence, report bytes or fingerprint is rewritten.

Focused evidence:

- `test/localization-pagination.integration.spec.ts`: dedicated PostgreSQL 16 database `lcsp347_localization_test`, 30 new scopes, 320 current jobs in scope 30, both target locales, all operational filters, old READY/new PENDING generations, no cursor duplicates, global failures/retries/oldest age beyond page one, exact batch reviews followed by independent-client readiness reload. Coverage uses real persisted localization and the actual Detail loader over controlled repository-port fixtures; wrong scope/entity/digest/version and foreign assessment owner reject. Two rules share canonical text but resolve independently; bulk lookup count is asserted.
- API command: `pnpm --filter @lcsp/api exec cross-env NODE_OPTIONS=--experimental-vm-modules jest --config jest.config.ts --runInBand --runTestsByPath test/localization-pagination.integration.spec.ts test/authored-language.integration.spec.ts test/localized-assessment-read.spec.ts src/modules/assessment/infrastructure/persistence/assessment-detail.loader.spec.ts` with the dedicated test URL.
- Web command: `pnpm --dir apps/web exec tsx --tsconfig tsconfig.test.json --test tests/localization-pagination.test.tsx tests/localization-admin-bff.test.ts tests/rule-grouping-review.test.tsx tests/assessment-conversation-projection.test.ts tests/assessment-locale-cache.test.tsx`.
- Mounted UI verifies scope 30, jobs 101?160, retained drafts, the 50-item bound, partial results, filters and cursor requests. BFF tests validate envelopes and forwarded session/cursors/filters, rejecting malformed cursors or missing session before upstream access. Conversation tests retain accepted decision identity while displaying Detail's EN/VI concept.
- `node apps/web/tests/browser/verify-reviewed-workflows.mjs`: actual Chromium and production React/Tailwind components, isolated HTTP fixture. Navigates scope 30 and job 101+, retains prior report/catalog EN?VI?EN and PENDING/FAILED controls, zero console errors. Playwright MCP was unavailable; installed Playwright Chromium was used directly. This is not an authenticated deployed Next.js/provider journey.

These checks do not approve any runtime translations, legal gold or real-provider linguistic fidelity. Full deployment validation, production-like authenticated journey and independent PM acceptance remain separate. No production backfill, paid model invocation, merge or deployment occurred.

Delivery verification: the four focused API files passed 41 cases; the final expanded PostgreSQL cursor/filter/coverage file was rerun after the bounded SQL scope-discovery change and passed both cases. The five focused Web files passed 23 cases; the mounted pagination case was rerun after switching selection counts to `useWatch` and passed. The final Chromium run passed scope 30/job 101+ navigation with zero console errors. API/Web typechecks, targeted API/Web ESLint, import policy, contract-literal policy, business documentation (zero missing/invalid), and diff whitespace checks passed. No Prisma schema change or migration is required in this delivery.
