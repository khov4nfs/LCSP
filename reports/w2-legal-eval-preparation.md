# W2 Legal Preparation evaluation preparation

Status: **PASS — preparation only.** Semantic agent quality, portfolio persistence/activation, and production acceptance remain **NOT PROVEN**.

This preparation stays in the explicit W1.1-after lane while W1.3 closure proceeds. It adds no production prompt, skill, entrypoint, registration, contract, schema, runtime, API, or web change.

## Assets

New files only:

- `deepagents/tests/fixtures/legal_preparation_eval/cases.json` — compact reviewed synthetic candidate set.
- `deepagents/tests/fixtures/legal_preparation_eval/rubric.json` — semantic review dimensions and deterministic integrity boundary.
- `deepagents/tests/test_legal_preparation_eval_fixtures.py` — stdlib identity/relationship consistency checks.

The candidate set references, but does not copy, `deepagents/tests/fixtures/legal_portfolio_context/{pins.json,synthetic-notice-v1.txt,synthetic-notice-v2.txt}`. It records the accepted V1/V2 source hash and byte-length pins, checks representative exact text, and verifies that only `art-5::cl-1` changes between the accepted corpus versions. The new test does not import or rerun the accepted parser test.

Coverage is represented by five agent-review candidates: definition, qualifier, exception, cross-reference context, and a non-repository duty. The invalid set explicitly covers fake, stale-hash, repealed, duplicate-ID, orphan-relation, coverage-gap, mixed-corpus-version, and failed-preparation/previous-active-preservation cases.

## Rubric boundary

The rubric assigns meaning to the **Legal Preparation agent**. It assigns only mechanical checks to the future **portfolio integrity boundary**: exact source/hash/version identity, resolvable references, same-version relationships, duplicate/orphan rejection, complete source coverage, and preservation of the earlier active pointer when submission fails.

The focused test asserts fixture identity, accepted pin/hash/text identity, reference/version relationships, and declared invalid expectations. It does not assert legal interpretation, model/provider behavior, persistence, activation, customer facts, repository facts, or semantic quality.

## Draft Legal Preparation instruction/tool-boundary packet

This is a draft for review after the future portfolio-submit contract is frozen; it is not a production prompt.

**Inputs.** One immutable acquired corpus snapshot: corpus version, source document identity, exact source bytes and hashes, legal effect status, hierarchy/chunk locators and hashes, and source/provenance references. The agent may read only this pinned legal context.

**Agent responsibilities.** Read operative provisions in context; preserve definitions, actors, modalities, timing, qualifiers, exceptions, and cross-references; author the complete LegalRule/context graph and EngineeringRules; represent duties that are not repository-observable; cite exact source locators; and submit one complete portfolio packet. The agent owns legal meaning and does not receive assessment, customer, answer, repository, runtime, or prior-result context.

**Draft tools.** A read-only `read_pinned_corpus` operation; one future worker-authenticated `submit_legal_portfolio` operation carrying the corpus/version/hash/provenance pins, LegalRule/context relations, EngineeringRules, and coverage declaration; and no direct database, activation, approval, retry-fallback, assessment, repository, or customer tool. The server-side boundary validates identity and structure, then atomically persists/activates a valid packet. A failed packet leaves the prior active portfolio pointer unchanged.

**Deterministic boundary.** Reject missing or mixed corpus pins, hash/source drift, fake/stale/repealed references, duplicate IDs, orphan relations, missing source coverage, invalid provenance, and malformed packets. It must not classify legal meaning, choose applicability, author rules, or act as a semantic judge. No human approval or review handoff is part of this packet.

**Future output.** A single versioned LegalRule + context-relation + EngineeringRule portfolio with exact corpus/source/hash/citation lineage and explicit coverage. The packet does not define new lifecycle/status values.

## Current source boundaries and production targets

Direct source confirmation was made against the current checkout; these are targets for the future W2 implementation, not changes in this task.

### Keep/rewrite source acquisition and API integrity

- `deepagents/tools/legal/sources/recovery/legal_corpus_recovery_driver.py:88` `LegalCorpusRecoveryDriver.run` and `:149` `_run_locked` currently own the locked recovery flow, callback failure handling, ingest, retrieval validation, activation, catalog recovery, and waiting-run resume. Rewrite the flow to acquire/pin source material once, invoke Legal Preparation, submit one portfolio, and remove assessment resume/recovery branches after the W2 vertical is accepted.
- `.../legal_corpus_recovery_driver.py:496` `_run_source_crawl_pipeline` and `:584` `_build_official_source_payload` are the actual official-source request/manifest, source-artifact hash, effect-status, chunk, and provenance boundary. Keep their source identity/hash/hierarchy mechanics; route the resulting pinned corpus to the future submit boundary.
- `.../legal_corpus_recovery_driver.py:444` `_recover_legal_rule_catalog` is the mechanical approved LegalRule factory and `:743`, `:765`, `:786`, `:805` store recovery/index/activation/catalog artifacts. Replace the catalog factory with portfolio submission and delete rule/cache artifact authority after the database portfolio is authoritative.
- `apps/api/src/modules/legal-rule-catalog/application/services/admin-corpus-versions.service.ts:274` `resolvePreparationSources` resolves latest source snapshots and governed crawl request metadata; `:319` `completePreparation` only terminally updates corpus preparation/readiness metadata. Replace these preparation callbacks with the portfolio submit contract once its schema and transaction semantics are frozen.
- `apps/api/src/modules/legal-rule-catalog/application/services/legal-corpus.service.ts:141` `ingestDraft` and `:233` `activateValidatedCorpusVersion`, plus controller routes `legal-rule-catalog.controller.ts:86`, `:98`, `:119`, `:141`, are the current separate ingest/index/activation path. Preserve source/hash/retrieval validation, but replace the split corpus-only write path with the one portfolio submit/validate/activate boundary; remove approval-record semantics from the target path.
- `apps/api/src/modules/legal-rule-catalog/application/services/rule-catalog-version.service.ts:93` `recoverApprovedRulesFromActiveCorpus` is the current mechanical LegalRule recovery path. Delete it after portfolio ingest is available; do not promote existing AUTO/approved rows as agent-authored W2 meaning.

### Replace Triage with Legal Preparation after the submit contract

- `deepagents/tools/triage/legal_rule_triage/service.py:22` `LegalRuleTriageService`; `:53` `get_work_items`; `:169` `persist_result`; `:231` `_load_sources`; and `:277` `_is_approved_rule` currently load approved catalog/chunks and persist per-rule cache/artifact results. Rewrite the boundary to load one pinned corpus and submit one complete portfolio; remove approved-catalog and per-rule readiness assumptions.
- `deepagents/tools/triage/legal_rule_triage/code.py:19-201` exposes the current work-item, Candidate/Context/Reject, EngineeringRule proposal, persist, and finish tools. Replace with the future portfolio packet schema only after the API contract is frozen; preserve exact source/version/provenance fields and delete the old per-rule tool surface.
- `deepagents/tools/triage/legal_rule_triage/boundary.py:19-110` `LegalRuleTriageBoundary.handle` is an `ENGINEERING_RULE_NOT_READY` RabbitMQ/readiness adapter that stores assessment checkpoints and dispatches `triage`. Delete the readiness callback path; the sole preparation command must be corpus/admin/source-change driven and must not see assessment context.
- `deepagents/subagents/triage/definition.py:1-166` (`TOOLS`, `SYSTEM_PROMPT`, `SUBAGENT`) is the current production Triage prompt/tool boundary. Replace it with a reviewed `legal_preparation` definition only after submit-contract acceptance; no production prompt/skill change is authorized here.
- `deepagents/schedules/legal_catalog_daily.py:5-30` `LEGAL_CATALOG_MAINTENANCE_PROMPT` currently describes the Triage singleton and assessment reconciliation. Rewrite it to enqueue the canonical preparation command after the contract is frozen; do not preserve a second legacy prompt path.
- `deepagents/agent.py:29`, `:74-105` `TRIAGE_SUBAGENT` registration and `create_root_agent`, `deepagents/subagents/__init__.py:12-29`, and `deepagents/tools/common/capabilities/agent_runtime/invocation.py:82-84` are registration/entrypoint targets. Change them only in the owned W2 implementation after the portfolio contract; no runtime registration changed here.
- `deepagents/middleware/triage_singleton.py:22-170` and `deepagents/orchestration/lifecycle.py:32-111` currently enforce Triage-specific singleton/reservation lifecycle. Keep only any generic execution/lease mechanics that the future contract needs; delete readiness/reconciliation-specific behavior after the W2 vertical passes.

### Remove duplicate EngineeringRule authorities

- `deepagents/tools/legal/corpus/engineering_rules/orchestration/service.py:46` `get_or_compile`, `:174` `prepare_from_triage`, `:295` `resolve_source_identity`, `:416` `_retarget_cached_rules`, and `:481`/`:508` artifact writers currently combine source identity with Chroma/cache, precompiled bundle, triage, and filesystem persistence. Keep/reuse source identity and mechanical validation; rewrite persistence to the portfolio submit boundary; delete assessment-time compile/cache/bundle recovery and retargeting once the DB portfolio is the sole reader.
- The imported `EngineeringRuleCache`, `PrecompiledEngineeringRuleRegistry`, `compilation/compiler.py`, `compilation/chunk_triage.py`, and normative regex meaning paths are duplicate generation/authority targets. Delete the LLM compiler, semantic regex classifier, precompiled/bundle/cache authority, and artifact restore paths after portfolio acceptance; retain only structural integrity mechanics with a W2 caller.

## Dependencies and non-claims

Blocked until the future portfolio-submit contract is frozen: portfolio envelope/schema, worker authorization, exact source/version/hash/provenance fields, coverage representation, atomic activation transaction, prior-active preservation on failure, idempotency, and the single runtime reader. W1.1 integration-gate acceptance and W1.3 closure remain prerequisites; this work does not add lifecycle values or claim either gate.

No model/provider call, user database, API activation, browser flow, or production vertical was run. The accepted corpus and existing source/tests remained read-only. The graph index was used for symbol discovery and direct source reads confirmed the production boundaries above; no full re-index or production source edit was performed.

## Verification

- `rtk python deepagents/tests/test_legal_preparation_eval_fixtures.py` — exit `0`; `Ran 4 tests ... OK`.
- `rtk python -m json.tool deepagents/tests/fixtures/legal_preparation_eval/cases.json` — exit `0`.
- `rtk python -m json.tool deepagents/tests/fixtures/legal_preparation_eval/rubric.json` — exit `0`.
- `rtk git diff --check` — exit `0`.
- `rtk git diff --name-only -- deepagents/tests/fixtures/legal_portfolio_context deepagents/tests/test_legal_source_context_fixture.py` — exit `0`, no output; accepted corpus assets and parser test were unchanged.
- `rtk git status --short --untracked-files=all | rg 'legal_preparation_eval|test_legal_preparation_eval_fixtures.py|w2-legal-eval-preparation.md'` — only the four owned new files listed above.
- The focused test recomputed both accepted source SHA-256 hashes and byte lengths, checked representative exact text, verified accepted V1/V2 chunk-pin drift, resolved every valid relationship, and checked all eight intentional invalid-case expectations.

Preparation acceptance is **PASS**. Semantic quality and production/W2 integration acceptance are **NOT PROVEN**.
