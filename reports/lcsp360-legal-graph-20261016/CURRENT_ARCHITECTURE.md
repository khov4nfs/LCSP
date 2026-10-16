# LCSP-360 current architecture inventory

Baseline observed 2026-10-16: local, remote and VPS `651c50e09e99d865394a6102108e97be7fe5b6d2`; canonical branch `fix/LCSP-360-corpus-driven-applicability`. See read-only `production-baseline.json` and preserved-work hashes in `local-baseline.json`.

## CURRENT_SOURCE_MODEL

1. `apps/api/prisma/schema.prisma`: `LegalSource` is the global Admin-managed family (`slug`, name, description); legal sources are shared authority, not tenant-owned content. `LegalSourceVersion` pins `sourceManifest`, integrity reference, status and parent family. Assessment pins remain on `AssessmentCase.ruleSetVersionId`.
2. `LegalSourceDocument` belongs to a version; unique `(legalSourceVersionId, documentId)`. It stores URL/hash, effect, snapshot path, optional original blob, ingestion attempt/state/profile/extraction/provenance. `LegalSourceDocumentBlob` is immutable content-addressed original bytes. `LegalSourceSnapshot` preserves acquisition URL, hash, snapshot object key and provenance.
3. `LegalDocumentChunk` is the sole persisted addressable source unit: `(version, documentId, locator)` unique, exact content/hash, JSON hierarchy, page bounds, effect/status provenance. No document-node or semantic-claim model exists. Hierarchy is repeated JSON; chunk identity and locator are used for structural traversal and coverage.
4. Managed ingestion: `LegalSourceDocumentService` upload/import -> outbox -> `deepagents/tools/legal/managed_documents/boundary.py` -> `extract.py` -> `chunker.py` -> `ingest.py` -> worker `ingestion-result` -> `recordIngestionResult`. Document-attempt compare-and-set, DRAFT lock, hash/locator validation, batched chunk persistence, structural retrieval-index validation.
5. Extraction supports PDF text layer (`pypdf`), HTML blocks, DOCX XML, plain text and Markdown. It retains pages for PDF; no bounding boxes. It normalizes extracted text without changing stored original bytes.
6. Config-driven `deepagents/config/legal_structure_profiles.json`: ARTICLES currently collapses chapter/part, article/section and clause; points stay within clause. NUMBERED_SECTIONS supports dotted outline; PARAGRAPHS uses bounded windows. Front matter is counted and excluded from structured chunks. This is not a jurisdiction-neutral AST.
7. Page bounds are on chunks, nullable; no persisted character spans. Effect is separate: `LegalEffectStatus`, `legalStatusSourceRef`, document provenance `provisionStatuses`; `UNKNOWN` blocks authoring, as do non-current references. Reindex must not infer legal effect from words or rewrite status.
8. No canonical `sourceRevision` or `normalizedPath` in these source/Preparation models (exact source scan); existing source identity is version + document + locator + content hash. New derived revision must be independent of source manifests/digests.

Selected production version `80bcda31-d0a7-4463-9f6e-41bd6da6ff12`: 2 legacy documents, 544 chunks, no blob/extraction records; snapshot payload paths exist in metadata. Missing physical locators must remain missing, never synthesized from page/chunk numbers.

## CURRENT_RETRIEVAL_MODEL

9. Preparation claim handler loads the run's pinned documents/chunks only. `rule_set_preparation/legal_source_files.py` materializes INDEX and exact chunk files. Native filesystem tools (`ls`, `glob`, `grep`, `read_file`) are read-only under `/legal-source`. Child `legal-source-reader` returns candidate statements and chunk refs; parent owns interpretation and submission.
10. Assessment Root `read_legal_source` / `search_legal_source` use pinned source API reads; search uses all-word text matching. Preparation has no first-class node/parent/child/reference tool.
11. Existing retrieval components under `tools/legal/retrieval`: Chroma index builder with explicit zero embeddings (structure index, not semantic vector search); `chromadb_citation_retriever.py` expands parent/related *chunk* IDs from hierarchy metadata. Preserve these useful existing capabilities; do not claim a live embedding/BM25 service that does not exist.

## CURRENT_SEMANTIC_MODEL

12. Contracts: `packages/contracts/src/compliance-rule-set/{constants,schemas,applicability}.ts`. `LegalRequirement` has proposition, explicit actor/modality/action operative propositions with chunk refs, conditions, qualifiers, exceptions, non-repository flag, coverage/non-assessability reason. Agent authors all meaning. One Requirement may aggregate propositions.
13. `LegalRequirementProvenance` resolves refs to chunks with composite source-version ownership FKs. `LegalRequirementContextRelation` uses DEFINITION/SCOPE/QUALIFIER/EXCEPTION/CROSS_REFERENCE and targets exactly one Requirement or source chunk; database CHECK and raw target-Requirement composite FK enforce integrity. No first-class temporal claims/accounting or node-to-many-claims ledger.
14. `AssessmentRule` JSON contract plus criteria, parent join table and source fingerprint. `applicability.ts` renders guidance, intent, context IDs, unresolved facts and criterion statements from linked parents; validator rejects supplied contradictory renderings. This preserves actor direction and parent limits mechanically without interpreting statute text.

## DOWNSTREAM_SEMANTIC_SURFACES

Normative: Requirement operative propositions, proposition, conditions, qualifiers, exceptions; AssessmentRule legalIntent, applicabilityGuidance, criteria[].statement, contextRelationIds, unresolvedConditions/bindings. Existing guidance/criterion rendering is canonical parent-derived.

Potential shadow authority: criteria[].investigationFocus, investigationGoals, requiredEvidence, supportingEvidence, negativeEvidence, graphQueries (name/startNodeTypes/direction/followEdges/stopNodeTypes/semanticTypes), startingNodeTypes, targetNodeTypes, edgeStrategies, keywords, commonApis, commonLibraries, patterns; `concept`/Requirement title are labels. These free strings currently have no deterministic claim authority binding. Assessment consumes the JSON contract, so this is a runtime boundary, not only an authoring prompt issue.

Minimum authority contract: legal predicates derive from structured claims/Requirement bindings. Evidence requests point to canonical criteria; technical exploration fields are explicitly non-normative suggestions and cannot become pass/fail criteria or required technical capabilities. Supplied normative renderings must match canonical output, rather than being silently overwritten.

## CURRENT_COVERAGE_MODEL

15. `compliance-rule-set-integrity.validator.ts`: validates index, IDs, exact source hashes/version/effect/provenance, parent/criterion integrity and Requirement assessability. Operative refs or typed context relations add locator keys to `accountedKeys`. Effective leaf chunks not in that set produce `INCOMPLETE_SOURCE_COVERAGE`. Thus a mixed context+duty provision can pass after only its context is represented; multiple claims within one locator cannot be distinguished.
16. API validate and submit share this validator (`ValidateComplianceRuleSetHandler`, `SubmitComplianceRuleSetHandler`). Activation transaction persists only valid children, supersedes ACTIVE only on valid submission, completes the run, and writes outbox/audit. Native `PreparationCompletionMiddleware` prevents a normal model stop from substituting for explicit validation/submission; NO_PROGRESS and governed fallback/summarization are separate runtime guards.
17. `rule_set_preparation/instructions.md` still includes ancestor/citation completion language alongside newer operative-leaf instructions. `tools.py` draft sections are Requirements, AssessmentRules and contextRelations; generated packet schema comes from `packages/contracts/scripts/export-rule-set-preparation-schema.ts`. Source/claim architecture must precede prompt changes.
18. 114 baseline migration directories observed; latest `20261016050000_rule_set_operative_propositions` adds nullable JSON preserving old packets. Other recent source management/effect migrations preserve immutable ACTIVE documents/chunks; target-Requirement and resolved-fact raw composite FKs must survive schema diff generation. Developer graph integrations (`codebase-memory-mcp`, Graft, Graphify) describe application code, not legal-source domain authority. They must not become legal document storage.

## Minimum architectural delta and affected scope

* Add revisioned derived document materialization, deterministic nodes/tree, explicit references with resolution state, and chunk-node mappings. Retain existing chunk provenance and all immutable historical rows. Parent FK represents one direction; derive inverse/ordering. Index source/revision/parent/order and forward/reverse references.
* Parse source structure without legal classification. New managed ingestion retains extracted structure; legacy immutable chunks need an explicit provenance-preserving structural adapter, with limitations reported. Stable node identity uses version/document/structural path/content fingerprint, independent of pages/windows/revision.
* Add bounded source graph read/search/traversal and idempotent supported materialization. No Rule Set/Preparation/provider dependency in derived-index lifecycle.
* Add Agent-authored claim nodes/relations, source-node inspections/accounting, and explicit claim-to-Requirement field/proposition bindings. Claim coverage is separate from retrieval and structural inspections. Require V2 for new authoring; historical reads remain supported without fabricated claims.
* Extend shared contracts/generated tool schema, API snapshot/claim/validation/activation/read models, native source tools/draft/progress/instructions, fixture factories and source/semantic/DB integration tests. Extend downstream authority to evidence surfaces. Keep pinning, activation, billing, provider routing and external code graphs unchanged.
* Completion V2 checks structure -> claim accounting -> Requirement integrity -> parent fidelity -> downstream authority -> provenance. It validates declared semantic structure, never raw-text legal meaning or whether the Agent discovered every latent claim.
* Coherent local stages: persistence, parser/materializer, retrieval, claims/accounting/bindings, downstream authority, Gate V2, compatibility, deterministic scale/DB/full suites. No model-based Preparation until all local/deployed prerequisites pass.

Production at baseline: trusted ACTIVE `30f83523-f8a4-40d9-ab8f-3c4e878d8c60`, rejected `43eaa343-9fbe-40ef-a6a9-935249bbcb1e` SUPERSEDED; Preparation count 33; active Preparations/leases/native runs/unpublished outbox all zero. API/Web/Agent all 200. No production mutation performed.


## Implemented contracts and compatibility

New authoring requires LEGAL_GRAPH_V2. Canonical provenance is Requirement claim binding -> claim source-node join -> revisioned AST -> immutable version/document. Legacy chunk citations remain available and validated when supplied. Empty legacy citations do not block source-node accounting. Recorded effect metadata propagates through source structure; conflicting or absent status remains UNKNOWN. Relevant claims require EFFECTIVE source nodes and recorded status provenance.

The derived service has no provider, Preparation writer, Rule Set writer, consumer bootstrap or outbox dependency. Supported rebuild: `pnpm --filter @lcsp/api exec tsx scripts/materialize-legal-document-graph.ts <version-uuid>`. It preserves existing source documents/chunks and digests. New derived retrieval windows can be regenerated without changing legal node identity or rewriting immutable historical chunks.

Requirement relation mappings preserve the richer persisted claim graph: CONDITION -> SCOPE, TEMPORALLY_LIMITS -> QUALIFIER, INCORPORATES -> CROSS_REFERENCE. Other kinds retain their name. Direction and kind are checked. Downstream legal predicates and evidence requests derive from linked structured criteria. Narrow investigation focus, graph queries, API/library hints and patterns are explicitly non-normative suggestions.

The two additive migrations introduce materialization, nodes, references, legacy mappings, derived windows, semantic graph/claims/source joins/relations and Requirement claim bindings, plus nullable Requirement semanticContext. Composite FKs enforce source/materialization/Rule Set membership. Indexes cover hierarchy/order, locators, references in both directions and resolution, source-node claims and Requirement bindings. Semantic tables use the existing immutable Rule Set child trigger. Existing raw FKs and historical pins remain intact.

Historical Rule Sets retain their original accepted digests, reads and reactivation. No fabricated historical claims. Old sources without retained extraction use explicit LEGACY_CHUNK_ADAPTER, with missing physical coordinates kept null. New authoring has no flat fallback. A legacy unstructured block with conflicting recorded effects stays UNKNOWN rather than guessing which text has effect.

Developer graph analysis excludes report/temp source copies and uses one AST worker. It remains independent from legal source and semantic authority.
