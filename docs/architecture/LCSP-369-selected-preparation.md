# LCSP-369: selected LegalRule preparation

The Admin **Compliance Rule Sets** page now builds a Preparation Rule Set through one flow: choose an editable canonical catalog, add or edit its rules, select eligible rules across server pages, confirm the exact selection, observe independent results, and inspect or regenerate an individual rule. Chunking and source activation expose source readiness; they never author catalog rules or start preparation.

## Domain mapping and development scope

At the implementation base `5f25888b059e3ac3bc1dfdfa07796668b6413b20`, the active generated entities are `LegalRequirement` and `AssessmentRule`, grouped under `ComplianceRuleSetVersion`. Neither generated entity is a canonical input catalog. The historical LCSP-149 implementation at `47b46c6751e79ec18595cf799a81bbe99180284a` was inspected as a reference only.

The forward migration `20261117090000_editable_legal_rule_preparation` adds the canonical input `LegalRule` and its editable `LegalRuleCatalogVersion` container, alongside preparation selection, batch, artifact and result records. It does not undo historical migrations or copy retired data. Administrators explicitly supply catalog records and citation locators. Per the revised development scope, catalog edits require Admin authorization and an expected revision, but no review/approval workflow or immutable approved publication is restored. Result snapshots remain immutable so development edits can be compared accurately.

| Record | Responsibility |
| --- | --- |
| LegalRuleCatalogVersion / LegalRule | Editable, explicitly authored input identity, description and citations |
| LegalSourceVersion / LegalDocumentChunk / LegalRetrievalIndex | Existing source, exact chunk bytes/hash and validated index |
| PreparationRuleSelection | Exact selected canonical row IDs, filter scope and catalog/source/chunk snapshot |
| PreparationRuleBatch | Persisted selected membership and independent result references; the prepared set |
| PreparationRule / PreparationRuleResult | One artifact per canonical rule and successive result attempts |
| LegalRequirement / AssessmentRule output | Distinct generated downstream artifacts, bound to this selected rule's source snapshot |
| ComplianceRuleSetVersion | Existing customer/shared publication boundary; selected preparation does not implicitly activate one |

## Selection, dispatch and recovery

`/admin/legal-rule-catalog` is Admin-only. Catalog reads return server-filtered pages, eligibility explanations and preparation freshness. Select all resolves the complete filtered eligible result on the server. A preview pins exact inputs before confirmation; submission revalidates ownership, canonical identity, revision, source, index and chunk hashes in one transaction. Empty selections reject. Only selected eligible rules create artifacts or dispatch events.

Bulk idempotency uses the initiating actor plus a stable request key, transaction advisory locks and per-artifact row locks. A replay returns the original batch; conflicting reuse rejects. Already successful identical inputs and active identical attempts are reused. An active attempt with different inputs conflicts. Retry creates a new batch referencing successful items and new revisions only for failed/interrupted items. One failed revision has at most one retry successor. No successful sibling is rolled back or rerun. Catalog pins also block source deletion through the existing deletion preview and transaction, with a specific EN/VI blocker.

Each new item reuses `RuleSetPreparationRun`, the existing preparation outbox event, registered runtime boundary, bounded invocation machinery, role/model governance, usage accounting and Run Activity. `SELECTED_RULE_V1` plus the selected-result marker routes to the one-rule native LangChain structured-output graph. There is no second scheduler, queue or event bus. The historical worker claim refuses this execution contract. A duplicate selected claim rejects before model construction; invalidated source pins settle failure before instruction loading or model work.

The old source-activation preparation trigger has no execution authority. The old Admin source-wide start endpoint requires explicit selection instead. Historical source-wide results, activity and retry inspection remain available.

## Regeneration and output integrity

Regeneration locks one artifact, checks the expected latest result, creates exactly one new result/run and preserves older results. Its default input is the last successful pinned catalog/source/chunk snapshot. Choosing latest inputs is explicit. No unrelated rule is dispatched. A batch URL can be reopened after a refresh; per-rule history has server pagination and comparison controls.

Each selected invocation freshly loads a context-local runtime instruction bundle through the canonical loader, preventing a stale process cache from masking an instruction edit. The recorded receipt contains the selected instruction's content-addressed revision, exact text, SHA-256 and bundle fingerprint. Other invocations retain their own pinned/cached view. This uses the current development instruction source; it adds no approval publication workflow.

The shared downstream packet schema normalizes derived assessment prose from parent bindings. The existing assessment binding validator is shared with full-source preparation. Selected results also enforce currently effective citations, exact source allowlists, operative source declarations, applicability scope, unique identities, parent/coverage links and rule-scoped generated IDs. No deterministic legal interpretation or customer compliance verdict is introduced. Preparation success means a result was generated, including an explicitly limited analysis when supported downstream artifacts cannot be produced.

## Verification and limits

Provider-free coverage includes real PostgreSQL migrations and API transactions, authorization, server pagination/Select all, exact dispatch membership, duplicate submission/claim, partial failure, retry, stale inputs, source invalidation at claim, immutable results, instruction receipts and one-rule regeneration. Native graph tests exercise actual LangChain structured output with a fake chat model, fresh instruction loading and ambiguous callback handling. Browser tests use the real Next UI/BFF and a local fixture API for EN/VI, keyboard selection, cross-page filters, confirmation, progress, retry, regeneration/comparison and catalog editing.

The existing real-stack vertical also exercises Admin sign-in, catalog authoring, cross-page selection, duplicate submission, native selected graph callbacks over HTTP, partial failure/retry and single-rule regeneration. Its fake model runs through the native graph; claims, instruction receipts and immutable result history use the real API and PostgreSQL. It warms a stale instruction cache before execution and verifies that the recorded result uses changed instruction bytes.

These are complementary receipts, not a paid-provider or production-corpus acceptance claim. The current development catalog is capped at 10,000 rules, selected snapshots at 16 MiB, and individual rule citations at 64. Derived preparation-state filtering currently projects that bounded catalog on the server before pagination; a database read projection is required before raising the cap. No production deployment or paid model execution is part of these checks.
