> Historical reference-only implementation report. The later owner simplification removes second-model verification and lease acquisition; current evidence is in [worker P's report](LCSP-360-simplify-P-report.md). Reference-only source boundaries remain.

# LCSP-360 Worker F — reference-only documents

**Root cause:** `LegalSourceDocument` had no corpus role. Every nonempty document entered review, and reference targets were assumed to be potential claim endpoints. Dropping a document avoided review but also removed the pinned provisions needed to express partial repeals and amendments.

**Fix:** add a defaulted persisted `OPERATIVE` / `REFERENCE_ONLY` role. Keep the entire immutable source graph and source files; restrict review and assertion authority to operative documents. The human decision in this task supersedes the original plan's full-review decision for Luật 71. This implementation does not mutate that corpus or activate any version.

## Behaviour

- Additive migration `20261024140000_document_corpus_role` adds `LegalSourceDocumentCorpusRole` and `LegalSourceDocument.corpusRole DEFAULT OPERATIVE`. Existing active/superseded rows keep their content. Existing database immutability triggers cover updates of the new field.
- Shared contracts define `LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES`, its derived type, the PATCH schema, `REFERENCE_ONLY_TARGET_REASON`, and shared audit event constants. Explicit persistence mappers translate roles. Admin document views and preparation bundle documents expose the role. `createVersion` copies it with all the document's content.
- `PATCH /admin/legal-source-versions/:versionId/documents/:documentRowId/corpus-role` uses the effect PATCH's controller-level administrator RBAC, UUID/body validation, envelope, transactional service/audit and route allowlist patterns. Identical role requests are idempotent. Non-DRAFT versions are immutable. A diagnostic can pin a DRAFT, so the new service also refuses a version with any preparation run, before changing the denominator.
- The graph builder fingerprints nonempty reference-only membership into source/materialization identity. Graph export derives `referenceOnlyDocumentIds` from database document rows. The snapshot loader also carries the trusted list. The producer cannot set it through claim payloads.
- `sourceReviewUnits` and `reviewReferenceOwners` exclude reference-only nodes/origins. INIT, NEXT and EXPAND inherit that filter; dependency publication excludes these nodes and rows. Existing finalize reads only persisted frontier rows and validates against the trusted snapshot. Both legacy semantic coverage and frontier coverage exclude reference-only sources.
- Reviewed references into reference-only documents require non-material `REFERENCE_ONLY_TARGET`, with no relation IDs or target claim. Python `check_claims` inserts this decision when omitted, and normalizes explicit false/UNRESOLVED decisions to it. Explicit material bindings fail with repair guidance. No accounting is required or accepted for references originating in reference-only documents.
- Claims cannot use reference-only `sourceNodeIds` or `sourceSupport`; those nodes cannot carry review accounting. Requirement/AssessmentRule citations to their chunks are also refused. Retrieval coverage excludes their chunks; complete structural mappings and readable retrieval windows still retain all source content.
- Python keeps `all_source_files` for rendering and filtered `source_files` for claim paths/assignments. All source files remain under the existing read-only filesystem permission. Root/document indexes and file headers identify `REFERENCE_ONLY (no claim file)`. Structural navigation and printed locator resolution keep all nodes. Three short discovery instructions explain the role and legalEffect target use.
- Legal-effect targets remain unrestricted within the pinned graph. The two-document bridge resolves `document#locator` through `get_applicable_legal_state`, commits a REPEALS target in B, persists B as a legal-effect target, reaches `discoveryCompleteEligible` with only A reviewed, and successfully finalizes. Worker F preserved ClaimInventory, authoring behaviour, filesystem permissions and provider routing.
- Admin web select was not added: wiring a new web mutation/BFF, UI state, i18n and browser acceptance was outside the small list-row change allowance. Administration is available through the API and operational script.

## Coverage trace

Ran `graft callers sourceReviewUnits --depth all`. Direct source inspection confirmed finalize -> `validateClaimInventory` -> `validateSemanticClaimGraph`, and validate/submit -> `LegalSourceSnapshotLoader` -> `validateComplianceRuleSetPacket`. Those shared validators enforce the trusted role boundary. Activation persists accepted packet provenance; historical reactivation checks its accepted immutable packet rather than recomputing a new source denominator. No separate denominator was added to those callers. Full AST/chunk integrity checks intentionally continue covering reference-only content because it remains pinned context.

## Operational command

No command below was run against `lcsp_dev`. The owner supplies the explicit connection and DRAFT version ID after applying migrations:

```bash
rtk proxy env DATABASE_URL="$LCSP_CORPUS_DATABASE_URL" pnpm --dir apps/api exec tsx scripts/phase1-set-corpus-role.ts "$DRAFT_VERSION_ID" luat-so-71-2025-qh15-luat-cong-nghiep-cong-nghe-so
```

The script requires an explicit DATABASE_URL, a UUID version ID and documentId. It refuses non-DRAFT versions and drafts with Preparation runs through the same service path, uses the draft's recorded creator for audit attribution, prints `{versionId, documentId, before, after}`, and never activates a source. The disposable test runs it twice and checks before/after/idempotency, then confirms ACTIVE refusal.

## Files changed by Worker F

Owner WIP in these shared files was retained. This list identifies Worker F's scope, not ownership of the entire current diff.

- `apps/api/prisma/migrations/20261024140000_document_corpus_role/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/scripts/phase1-set-corpus-role.ts`
- `apps/api/src/app.routes.allowlist.json`
- `apps/api/src/infrastructure/prisma/prisma-enum-mappers.ts`
- `apps/api/src/modules/compliance-rule-set/application/commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.ts`
- `apps/api/src/modules/compliance-rule-set/application/commands/source-review/reference-only.integration.spec.ts`
- `apps/api/src/modules/compliance-rule-set/application/commands/source-review/source-review.handler.ts`
- `apps/api/src/modules/compliance-rule-set/domain/compliance-rule-set-integrity.validator.ts`
- `apps/api/src/modules/compliance-rule-set/domain/reference-dependencies.ts`
- `apps/api/src/modules/compliance-rule-set/domain/reference-only.spec.ts`
- `apps/api/src/modules/compliance-rule-set/domain/semantic-claim-integrity.validator.ts`
- `apps/api/src/modules/compliance-rule-set/domain/source-review-frontier.ts`
- `apps/api/src/modules/compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.ts`
- `apps/api/src/modules/legal-source/application/services/legal-document-graph.service.ts`
- `apps/api/src/modules/legal-source/application/services/legal-source-corpus-role.integration.spec.ts`
- `apps/api/src/modules/legal-source/application/services/legal-source-document.service.ts`
- `apps/api/src/modules/legal-source/application/services/legal-source-management.service.ts`
- `apps/api/src/modules/legal-source/application/services/legal-source-views.ts`
- `apps/api/src/modules/legal-source/domain/document-graph.ts`
- `apps/api/src/modules/legal-source/presentation/http/legal-source-admin.controller.ts`
- `apps/api/test/support/review-frontier-bridge.ts`
- `apps/api/test/support/seed-reference-dependencies.ts`
- `deepagents/rule_set_preparation/claim_files.py`
- `deepagents/rule_set_preparation/instructions-discovery.md`
- `deepagents/rule_set_preparation/legal_source_files.py`
- `deepagents/rule_set_preparation/source_graph.py`
- `deepagents/tests/test_reference_only_claim_files.py`
- `packages/contracts/src/compliance-rule-set/schemas.ts`
- `packages/contracts/src/legal-source/document-graph.ts`
- `packages/contracts/src/legal-source/event-types.ts`
- `packages/contracts/src/legal-source/management.ts`
- `packages/contracts/test/legal-source-corpus-role.spec.ts`

## Verification

All database operations used PostgreSQL 16 containers `lcsp-fbd-f-pg` (55472) and `lcsp-fbd-f-bridge` (55449), database `lcsp_review_frontier_test`. Port 55449 was free before starting the bridge container. Both clean databases applied all **130 repository migrations** successfully. A final fresh `lcsp-fbd-f-final` container reused port 55472 for the last direct-API repair-guidance regression and also replayed all 130 migrations. Inspected the new column's enum type and `OPERATIVE` default. Existing immutable-update triggers were exercised by the API tests.

```text
rtk proxy pnpm typecheck
PASS (run twice; generated Prisma Client 7.8.0 and tsc -b completed)

rtk proxy pnpm lint
PASS (import policy, contract literal policy, retired-authority policy, full typecheck)

rtk proxy pnpm exec prettier --write <Worker F supported TS/JSON/Markdown paths>
PASS; explicitly excluded semantic-audit.ts, legal-document-graph.service.ts,
document-graph.ts, packet-schema.json and semantic-support.ts as requested.
No TypeScript enums or direct literal-union declarations were added; regex hits
were Zod .enum calls and prisma-enum-mappers import paths.

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55472/lcsp_review_frontier_test
NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest
  --config jest.config.ts --runInBand --runTestsByPath
  src/modules/compliance-rule-set/domain/reference-only.spec.ts
  src/modules/compliance-rule-set/application/commands/source-review/reference-only.integration.spec.ts
  src/modules/legal-source/application/services/legal-source-corpus-role.integration.spec.ts
  src/modules/compliance-rule-set/application/commands/source-review/source-review.integration.spec.ts
  src/modules/compliance-rule-set/domain/source-review-frontier.spec.ts
  src/modules/compliance-rule-set/domain/reference-dependencies.spec.ts
  src/modules/compliance-rule-set/domain/semantic-claim-integrity.validator.spec.ts
  src/modules/compliance-rule-set/domain/compliance-rule-set-integrity.validator.spec.ts
  src/modules/compliance-rule-set/domain/claim-inventory.spec.ts
147 passed, 9 suites (191.591s)

Final focused reruns after HTTP/copy/support-span test additions:
  legal-source-corpus-role.integration.spec.ts: 10 passed (7.268s)
  reference-only.spec.ts + reference-only.integration.spec.ts: 8 passed (1.4s)
These overlap the broad run; they are not an additional 18 distinct production behaviours.

After a final direct-API repair-guidance change, a fresh migrated database ran:
  reference-only.integration.spec.ts + source-review.integration.spec.ts
  + reference-only.spec.ts: 41 passed, 3 suites (3.254s)
The added parameterized case proves that blocking on B returns the fixed
REFERENCE_ONLY_TARGET repair, never an impossible request to expand/review B.
Final pnpm lint (including typecheck) also passed after this change.

NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest
  --config jest.config.ts
  --roots /home/khovan/Workplaces/LCSP/packages/contracts/test
  --testRegex '.*\.spec\.ts$' --runInBand
69 passed, 2 suites (0.722s), including all unchanged claim-file schema parity fixtures

# From deepagents/:
PYTHONPATH=.:tests
REVIEW_FRONTIER_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55449/lcsp_review_frontier_test
.venv/bin/python -m pytest tests/test_reference_only_claim_files.py
  tests/test_claim_files.py tests/test_claim_files_frontier.py
  tests/test_legal_source_graph.py tests/test_legal_source_files_provenance.py
  -q --disable-warnings --tb=short
67 passed (5.50s), including the new real-API two-document bridge

rtk proxy git diff --check
PASS
```

New tests: five Python cases, four frontier integration cases, five domain cases, ten mutation/HTTP/contract cases, and two package-contract cases. New source-policy tests cover INIT/NEXT/EXPAND counts, outgoing reference ownership, automatic target decisions, anchor/support refusal, trusted export identity, version copying, immutable versions, draft diagnostic pins, HTTP authorization/validation/envelopes/audit, operational-script idempotency and finalize coverage. No live verifier/model invocation was used.

## Earlier failures retained

- First Python invocation used the repository-relative output path while the shell cwd was already `deepagents/`: file creation failed with `No such file or directory`, and pytest reported `no tests ran`. Corrected the path; subsequent Python commands run from `deepagents/` with `PYTHONPATH=.:tests .venv/bin/python -m pytest`.
- Initial new Python suite: **1 failed, 4 passed**. Fixture used `legalEffect.conditions: []`; the unchanged schema requires text/null. Corrected the fixture to null.
- An interim rerun from repository root also produced **1 failed, 4 passed** for the same missing FINALIZE graph/identity fixture. The final required Python run was from `deepagents/`.
- Next new Python suite: **1 failed, 4 passed**. Direct FINALIZE fixture omitted graph/identity keys: `CLAIM_INVENTORY_INVALID: Graph and canonical identity keys are required`. Supplied the existing inventory graph/identities; no gate was weakened.
- Initial new domain suite: **1 failed, 3 passed**. A copied fixture's normalized node fingerprint was incorrectly reused as its exact retrieval-content hash. Corrected to SHA-256 of the actual text.
- Initial new frontier/domain combination: **2 failed, 5 passed**. EXPAND fixture omitted its required reason; a test used an undefined disposition constant. Added the reason and the existing `NO_RELEVANT_SEMANTIC_CLAIMS` constant.
- First contracts Jest invocation changed rootDir and could not locate `<rootDir>/test/jest-env.ts`. Kept the API Jest configuration and supplied the contracts test directory with `--roots`; the contracts/parity run then passed.

## Open limits / not done

- No dev database access, real corpus role mutation, activation, live paid provider call, golden-set/legal-entailment acceptance, full-corpus Preparation, deployment, staging, commit, push, stash or owner-WIP reversal.
- The database fixture auditors are mechanical signed fixtures, not evidence of legal entailment. HTTP tests exercise the real RBAC guard with a scripted session-context loader, not a real login journey.
- No frontend file was changed and no browser verification was needed or claimed.
- Ownership follow-up: the no-frontier fallback in `ClaimInventory.__post_init__` still builds `required_nodes` from every nonempty graph node, and its direct registration path is not Worker F-owned. If that API-less fallback must support reference-only documents, its owner should filter `source.is_reference_only(nid)` there and reject those direct anchors. The production file-based path uses the persisted frontier and is covered by the passing bridge; backend COMPLETE and finalize refuse reference-only assertions independently.
- The retained explicit `frontier` filesystem renderer is outside Worker F's renderer ownership and retains its historical file format. The requested new role headers/claim-file exclusion are verified in the default file discovery mode.

## Cleanup and graph refresh

- Removed `lcsp-fbd-f-pg`, `lcsp-fbd-f-bridge` and final-check `lcsp-fbd-f-final` with their anonymous volumes. A name-filtered Docker check returned no remaining Worker F container. No foreign container or service was stopped.
- `rtk proxy graphify update .`: **PASS**, AST-only/no LLM. Updated `graphify-out/graph.json` and `GRAPH_REPORT.md`: **35,984 nodes, 64,023 edges, 12,538 communities** (final refresh after the repair-guidance change). Graphify backed up the previous curated graph using its normal mechanism.
- Existing graph coverage limits remain: missing `tree_sitter_sql` leaves 130 migration SQL files unindexed; `apps/api/test/smoke.e2e-spec.ts:84` has a syntax error. HTML regeneration was skipped because the aggregated graph exceeds the 5,000-node visualization limit, leaving `graph.html` stale. No graph labeling/model call was run.
- Final whitespace check passed. The report was formatted with Prettier. Owner changes to the then-existing verification modules and file adapter were preserved.

Final verification: **147 API regression tests passed**, later focused runs **10 + 8 passed** and final handler/domain rerun **41 passed** (overlapping); **69 contracts/parity tests passed**; **67 Python tests passed**; **typecheck and lint passed**; **130 migrations replayed on each of three disposable DBs**. Live corpus application, real-provider semantic acceptance and frontend UI remain unperformed as stated above.
