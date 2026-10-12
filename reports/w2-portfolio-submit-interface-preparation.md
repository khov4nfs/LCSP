# W2 portfolio submit interface preparation

**Status: DRAFT, preparation only.** This is a source-verified mapping for a future single complete-portfolio submit boundary; it is not a production/shared-contract proposal, an architecture-freeze decision, or W2 acceptance. No code, fixture, contract, schema, migration, API, Python, Web, prompt, i18n, skill, entrypoint, or other report was changed.

The frozen flow is one legal-preparation output bound to one immutable corpus and portfolio, followed by deterministic completeness/integrity validation and atomic activation. The agent supplies meaning; it does not mint authority. Do not consume unaccepted W1 values or bypass the current independent W1 gate.

## Source-verified field and authority mapping

| Existing source seam | Actual fields and semantics | Future complete-submit disposition |
|---|---|---|
| `EngineeringRule` and `GraphQueryTemplate` in `deepagents/tools/legal/corpus/engineering_rules/contract/models.py:25-53` | `engineering_rule_id`, `legal_rule_id`, `legal_rule_catalog_version_id`, `legal_corpus_version_id`, `concept`, `legal_intent`, `investigation_goals`, `starting_node_types`, `target_node_types`, `edge_strategies`, `graph_queries`, `keywords`, `common_apis`, `common_libraries`, `patterns`, `required_evidence`, `supporting_evidence`, `negative_evidence`, `unresolved_conditions`, `source_chunk_ids`, `source_locators`, `legal_reasoning_contract`, `source_fingerprint`, `compiler_model`, `compiler_version`, `prompt_version`, `schema_version`; graph query fields are `name`, `start_node_types`, `direction`, `follow_edges`, `stop_node_types`, `semantic_types`. | Reuse the semantic investigation/evidence/query field groups as agent-authored meaning. Treat rule IDs as scoped proposal labels only. Server supplies or verifies portfolio/corpus identity, exact sources, fingerprints, compiler/prompt provenance, and canonical IDs. Do not carry the permissive snake/camel `from_dict` aliases into a future strict shared boundary without an owner decision. `legal_rule_catalog_version_id` is a V1 catalog pin, not the future portfolio pin. |
| Pydantic proposal shapes in `deepagents/tools/triage/legal_rule_triage/code.py:29-95` | `LegalChunkAnalysisInput` is strict (`extra="forbid"`) with `chunkId`, `verdict` (`ENGINEERING_RULE_CANDIDATE\|CONTEXT_ONLY\|REJECT`), `reason`, `engineeringObligation`, and `verificationTargets`. `EngineeringGraphQueryInput` has `name`, `startNodeTypes`, `direction` (`FORWARD\|BACKWARD\|BOTH`), `followEdges`, `stopNodeTypes`, and `semanticTypes`. `EngineeringRuleProposalInput` is strict with optional `engineeringRuleId`, `concept`, `legalIntent`, `investigationGoals`, `startingNodeTypes`, `targetNodeTypes`, `edgeStrategies`, `graphQueries`, `keywords`, `commonApis`, `commonLibraries`, `patterns`, `requiredEvidence`, `supportingEvidence`, `negativeEvidence`, and `unresolvedConditions`. | Reuse only `EngineeringRuleProposalInput` semantic fields as the agent-owned engineering portion, with server-side identity/source/provenance injection. Do not reuse the per-chunk verdict or obligation surface in a complete packet. Preserve strict extras in the future boundary and choose one exact casing instead of the current Python JSON aliasing. |
| V1 persistence handoff shape `PersistLegalRuleTriageResultInput` in `deepagents/tools/triage/legal_rule_triage/code.py:98-189` | Wrapper fields are `triage_execution_id`, `legal_rule_id`, `legal_rule_catalog_version_id`, `legal_corpus_version_id`, `chunk_analyses`, `engineering_rules`, `workflow_run_id`, and `correlation_id`; its validator couples candidate chunk verdicts to submitted EngineeringRules. | Reject this per-rule triage wrapper for the complete packet. The future request context supplies one preparation execution/run and selected corpus/portfolio; the packet covers the complete portfolio, not a singleton rule and not agent-owned runtime lineage. |
| `LegalReasoningContract` and builder in `deepagents/tools/legal/corpus/engineering_rules/contract/legal_reasoning_contract.py:8-20,27-66,69-138` | `legal_rule_id`, `applicability_criteria`, `required_evidence`, `accepted_evidence_types`, `negative_evidence_types`, citation entries (`id`, `documentId`, `locator`, `legalStatus`, `contentSha256`, `role`), `jurisdiction`, `effective_date`, `legal_corpus_version_id`, `legal_rule_catalog_version_id`, `validation_policy`, `schema_version`. Existing policy includes `noCitationNoLegalClaim`, `noSourceAnchorNoRepoClaim`, fail-closed behavior, and `humanLegalSignoffRequired`. | Reuse the mechanical citation/evidence/criteria consistency checks and exact citation-set concept. Agent may author criteria/interpretation and evidence intent; server binds IDs, source hashes, legal status, and corpus. Drop/rewrite V1 approval semantics, especially `humanLegalSignoffRequired`; no human signoff is a future agent output authority. |
| `validate_engineering_rule` in `deepagents/tools/legal/corpus/engineering_rules/contract/validator.py:12-41` | Requires schema, EngineeringRule/LegalRule IDs, catalog/corpus pins, source chunk IDs, source fingerprint, and reasoning contract; checks matching IDs/pins, source chunks contained in citation chunks, graph vocabulary, query direction `FORWARD\|BACKWARD\|BOTH`, and unique query names. | Reuse as a lower-level mechanical validator after the server has injected trusted identity and exact source context. It is not a semantic legal/compliance evaluator and does not authorize an agent-supplied identity or activation. |
| `_materialize_engineering_rules` in `deepagents/tools/legal/corpus/engineering_rules/orchestration/service.py:354-413` | Takes a LegalRule, catalog/corpus IDs, legal context, source fingerprint, and agent rows; injects IDs, source chunk/locator context, reasoning contract, compiler model/version, prompt version, and schema version before validation. | Reuse the inject-then-validate pattern, but replace the per-rule triage caller. Server-owned context must override or reject agent-supplied identity, source, fingerprint, compiler, and prompt metadata. |
| `resolve_source_identity` in `.../engineering_rules/orchestration/service.py:295-338` | Retrieves exact context for selected chunk IDs, rejects missing context and `REPEALED`, maps chunk IDs to `contentSha256`, and fingerprints corpus ID plus chunk hashes and compiler/schema inputs. | Reuse exact-context, hash, and repealed-source mechanics. Bind them to the selected request-context corpus/portfolio; do not use cache, bundle, or assessment-time compilation as authority. |
| `build_official_source_payload` in `deepagents/tools/legal/sources/ingest/official_source_payload.py:14-101` and `parse_chunks` in `deepagents/tools/legal/sources/scripts/build_reviewed_legal_corpus.py:238-360,430-438,553-560` | Payload is `version`, `sourceManifest`, and `documents[]`; `sourceManifest` carries `reviewRequired`, `trustPolicy`, `normalizationWarnings`, `materializedRelationships`, `sourceArtifacts` (document/artifact/text refs and their SHA-256 values), and `partialUpdateContexts`. Documents carry `documentId`, `title`, `sourceUrl`, `sourceSha256`, `sourceEffectStatus`, `effectiveDate`, `snapshotPath`, and chunks. Chunks carry `id`, `locator`, `content`, `contentSha256`, `hierarchy`, `legalStatus`; locators include article/clause/point hierarchy and parent links. | Preserve source identity, locator hierarchy, content hash, effect status, and exact chunk context. These are server-acquired and server-verified facts. `reviewRequired` and `trustPolicy` in `sourceManifest` are acquisition provenance, not an agent approval field. |
| `LegalSourceIngestEnvelope` / `OfficialSourceSnapshotResult` in `deepagents/tools/legal/sources/ingest/legal_source_ingest_boundary.py:24-122,145-211` and `official_source_snapshot.py:25-165` | Envelope carries `document_id`, `catalog_source_ref`, `admin_catalog_version`, `corpus_version_id`, `idempotency_key`, `actor_ref`, source URL/limits, expected document identity, and optional gateway/effect fields. Snapshot result carries snapshot/provenance refs, source/content hashes, content metadata, retrieval time, document identity, effect status, and registry payload fields. | Treat acquisition envelope, snapshot, registry, and retrieval provenance as server/request context. The legal-preparation agent cannot self-assert document identity, source hash, retrieval actor, gateway ref, or trust policy. |
| API `LegalCorpusChunkInput`, `LegalCorpusDocumentInput`, `IngestLegalCorpusRequest` in `apps/api/src/modules/legal-rule-catalog/application/contracts/legal-corpus.contract.ts:1-47` | Ingest shape is `version`, `sourceManifest`, `documents[]`, optional `retrievedAt` and `ingestionRunId`; documents/chunks carry the same source/document/chunk IDs, locator, content, SHA, hierarchy, status, and page fields. `LegalCorpusService.ingestDraft` and `validateIngest` perform document/chunk/hash checks (`.../legal-corpus.service.ts:141-231,947-1095`). | Reuse exact document/chunk/hash validation ideas. The future submit is one complete portfolio packet, not the current split draft/index/activate path. `requireApprovedReviewSignoff`, approval records, and separate corpus activation are V1 approval seams to rewrite or reject for the new path; historical rows/FKs remain historical until later gates. |
| V1 `LegalRule` / draft and active catalog shapes in `apps/api/prisma/schema.prisma:1146-1161`, `apps/api/src/modules/legal-rule-catalog/application/contracts/draft-legal-rule.contract.ts:1-18`, and `.../get-active-rule-catalog.handler.ts:15-127` | Meaning-bearing fields include `ruleFamily`, `requiredFacts`, `optionalFacts`, `blockingFacts`, `unknownFactPolicy`, and `citationLocatorRefs`; V1 also carries `status`, `authoredBy`, and catalog-version ownership. | Use the meaning-bearing fields only as source vocabulary for the future complete LegalRule proposition/criteria/context packet. Reject manual draft/approval ownership, `status`, `authoredBy`, and V1 active-catalog reads as future agent authority. `CitationLocatorValidatorService` (`.../citation-locator-validator.service.ts:1-76`) is reusable for exact corpus, locator existence, and repealed checks. |
| Accepted W1 `RuleDecision` shapes in `packages/contracts/src/assessment/agentic-runtime.ts:590-703` | `RuleDecisionLegalContextReference` is exactly `{ legalContextId }`; `decisionScopeShape` pins `engineeringRuleId`, `engineeringRuleVersion`, `scopeId`, `legalPortfolioVersionId`, `repositorySnapshotId`, `repositoryCommit`, `caseRevision`, and `legalContextRefs`. Criteria carry `criterionId`, outcome, rationale, and references; confirmed-fact refs pin `caseRevision`. | This is a downstream compatibility target, not the submit envelope. Do not invent a different W1 `LegalContextReference`, consume unaccepted W1 values, or bypass the independent gate. Future submit context must produce server-validated context IDs that can later bind to these exact W1 names; the W1 `legalPortfolioVersionId` is the relevant portfolio pin, not the V1 catalog ID. |

## Draft boundary notation (not a contract)

The following notation is deliberately not a JSON schema, shared type, API name, lifecycle value, or acceptance commitment. Exact casing and names remain contract-owner decisions.

```text
complete portfolio submit (DRAFT; one packet)
  trusted request context, supplied/derived by server:
    authenticated worker and tenant authorization
    preparation execution/run and correlation/idempotency identity
    selected immutable corpus/source version, document/chunk records, hashes
    target portfolio identity/version/digest and canonical scope

  agent-authored packet, meaning only:
    legalRules[]:
      proposition/meaning, criteria, applicability/context declarations,
      source-reference claims, coverage declarations,
      non-assessable reason where a source duty cannot be assessed
    engineeringRules[]:
      concept, legal intent, investigation goals, graph queries,
      evidence requirements, supporting/negative evidence, unresolved conditions
    contextRelations[]:
      relationship meaning between proposed rules/context, with source claims

  server-derived result:
    exact validated source/context bindings, canonical IDs/fingerprints,
    complete-portfolio integrity outcome, and one atomic activation decision
```

“Source-reference claims” and “coverage declarations” are agent meaning/proof proposals, not trusted hashes or completeness facts. The server must resolve every claim against its selected corpus and derive the final source/chunk/hash relation before any activation decision.

## Trust partition

| Agent may author | Server request context / server derives | Deterministic boundary must validate |
|---|---|---|
| Legal propositions, rule meaning, criteria, applicability interpretation, context-relation meaning, engineering concepts, investigation scope, graph/evidence strategy, source-reference claims, coverage declarations, and non-repository duty representation. | Authenticated tenant/worker; preparation execution/run; target corpus/source and portfolio pins; document/chunk content and hashes; source effect/repeal status; repository-independent provenance; canonical rule identity scope; source fingerprint; compiler/prompt/schema provenance; idempotency/correlation and activation transaction identity. | Strict packet shape; required/forbidden fields; unique IDs; exact document/locator/hash resolution; one corpus/version; no repealed/fake/stale refs; source-chunk/citation consistency; graph vocab and query uniqueness; context relation referential integrity; complete coverage or explicit validated non-assessable reason; idempotent replay/CAS/lock/transaction/outbox behavior; failed attempt preserves the prior canonical pointer. |

The server returns one mechanical result for the packet. Deterministic validation may reject malformed, stale, incomplete, or unauthorised input; it does not prove that an agent’s legal interpretation is correct, and it must not turn agent output into final legal/risk authority.

## Reuse versus reject

| Reuse narrowly | Reject/retire from the new submit path |
|---|---|
| `EngineeringRule`, `GraphQueryTemplate`, `validate_engineering_rule`, `LegalReasoningContract`, exact source-context/hash resolution, citation locator validation, parser chunk identity, API document/chunk hash checks, and the existing transaction/advisory-lock/replay/audit/outbox mechanics as mechanical building blocks. | `LegalChunkAnalysisInput` (`ENGINEERING_RULE_CANDIDATE\|CONTEXT_ONLY\|REJECT`) as a per-chunk decision surface; `PersistLegalRuleTriageResultInput` (`triage_execution_id`, per-rule IDs, `workflow_run_id`, `correlation_id`) as a wrapper; `LegalRuleTriageService.get_work_items/persist_result/finish_or_drain`; `prepare_from_triage`; cache/artifact writers; precompiled bundles; retarget/recovery paths. |
| `OfficialSourceSnapshotResult.to_registry_payload` and the source ingest envelope as acquisition/provenance inputs; `CitationLocatorValidatorService` for exact existence/status checks. | V1 manual draft/approval/signoff fields and callers: `reviewRequired` as agent authority, `humanLegalSignoffRequired`, `authoredBy`, `status`, `DraftLegalRuleCommand`, `recoverApprovedRulesFromActiveCorpus`, and a split corpus-only activation writer. Preserve historical V1 tables/FKs, but no new canonical writer may alias or dual-write them. |

The W2 replacement path removes old production approval/recovery/cache paths only after its replacement gates pass, not as live writers through W7. Audited ALCS `SUPERSEDED`-to-`ACTIVE` rollback remains legal; no new lifecycle vocabulary is proposed here.

## Mechanical prepared fixture cases

These are the existing prepared cases in `deepagents/tests/fixtures/legal_preparation_eval/cases.json` (`fixtureId: legal-preparation-reviewed-candidate`, `fixtureVersion: W2-EVAL-CANDIDATE-1`, synthetic-only), with mechanical assertions in `deepagents/tests/test_legal_preparation_eval_fixtures.py:19-224` and hashes/locators in `pins.json`. The two corpus pins use the same synthetic document; only `art-5::cl-1` changes between the V1 and V2 content hashes. They are not new fixtures and do not prove semantic or production acceptance.

| Prepared valid candidate | Source/coverage declaration |
|---|---|
| `definition-retained` (`LP-V1-DEF-RECORD`) | Primary `art-1`; definition remains represented. |
| `qualifier-retained` (`LP-V1-RETENTION-QUALIFIED`) | Primary `art-5`; context `art-2` and `art-3`. |
| `exception-retained` (`LP-V1-RETENTION-EXCEPTION`) | Primary `art-3`; context `art-5` and `art-6`. |
| `cross-reference-context` (`LP-V1-CROSS-REFERENCE`) | Primary `art-4`; context `art-1`, `art-2`, and `art-3`. |
| `non-repository-duty-represented` (`LP-V1-IN-PERSON-DUTY`) | Primary `art-6`; must remain represented in the complete portfolio. |

| Case | Mechanical packet failure | Required proof |
|---|---|---|
| `fake-reference` | `UNRESOLVED_SOURCE_REFERENCE` for `art-99::cl-1` | Locator cannot resolve in the selected document/corpus. |
| `stale-reference` | `STALE_SOURCE_HASH` for `art-5::cl-1` | Declared hash is from the other prepared corpus version; content/hash must be checked against the selected version. |
| `repealed-reference` | `REPEALED_SOURCE_REFERENCE` | Resolved source has `REPEALED` legal status and cannot support the packet. |
| `duplicate-rule-id` | `DUPLICATE_RULE_ID` | Complete packet must have unique rule identity within its scope. |
| `orphan-context-relation` | `ORPHAN_CONTEXT_RELATION` | Every relation endpoint must resolve to a submitted/validated rule or context. |
| `coverage-gap` | `INCOMPLETE_SOURCE_COVERAGE` | A required accepted locator (`art-6::cl-1` in the fixture) is neither covered nor given a valid non-assessable declaration. |
| `mixed-corpus-versions` | `MIXED_CORPUS_VERSION` | All source refs must bind to the one selected corpus version; V1/V2 mixing is rejected. |
| `failed-attempt-preserves-earlier-active` | `REJECT_AND_PRESERVE_PREVIOUS_ACTIVE` | A failed packet produces no replacement activation and leaves the prior canonical pointer unchanged. |

The same fixture set covers definitions, qualifiers, exceptions, cross-references, and a non-repository duty (`non-repository-duty-represented`). Its rubric assigns semantic interpretation to `LEGAL_PREPARATION_AGENT` and deterministic integrity to `PORTFOLIO_INTEGRITY_BOUNDARY`; the fixture test deliberately leaves semantic and production acceptance `NOT_PROVEN`.

## Contract-owner decisions still pending

1. Select one exact shared field naming/casing policy and remove the current Python snake/camel compatibility ambiguity; decide strict extra-field behavior.
2. Define the LegalRule proposition/criteria/context-relation shape and relation vocabulary; decide how V1 `requiredFacts`/`blockingFacts` map, if at all, without importing V1 approval semantics.
3. Define coverage declaration cardinality and the exact required non-assessable-reason shape for every uncovered provision and non-repository duty.
4. Decide whether the agent submits opaque source claims (`documentId`, `locator`, declared hash) or only server-issued context IDs, and how relation citations bind to exact chunks/effect status.
5. Define the trusted request-context fields and server minting rules for preparation execution/run, portfolio target/digest, canonical IDs, fingerprints, compiler/prompt provenance, idempotency, and correlation.
6. Define the one-packet result/error contract, replay semantics, atomic activation transaction, prior-pointer preservation, and any ALCS/AES state projection; do not introduce new lifecycle values here.
7. Decide when W1 `RuleDecisionLegalContextReference.legalContextId` and `RuleDecision.legalPortfolioVersionId` become bindable, strictly after the independent W1 gate.
8. Name the contract/API/persistence owners and the single runtime reader/cutover gate; explicitly retire V1 approval/triage/cache writers only when replacement gates pass.

## NOT_PROVEN

- W1 independent contract acceptance or any W1 integration, API, persistence, browser, or runtime gate.
- W2 shared submit-contract acceptance, architecture freeze, complete corpus-to-portfolio live vertical, atomic activation in production, exact production hash/pin enforcement, or exactly one runtime reader.
- Semantic correctness of LegalRule/EngineeringRule interpretation, legal quality, model/provider behavior, or customer-facing assessment behavior.
- Production transaction/idempotency/lease/outbox behavior, database/API integration, CI, browser proof, or live service behavior.
- Any semantic/legal meaning beyond the fixture’s mechanical identity, hash, locator, context, coverage, and invalid-packet assertions.
- No code or non-report artifacts were changed; this report is preparation material only.

Discovery used the indexed code graph first and then direct source reads; no full reindex, provider/network call, service, database, commit, or push was used.
