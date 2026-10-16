# LCSP-360 frozen claim inventory protocol

## Boundary and root cause

The document AST, source/reference identities, parser, physical locators and chunk/node mapping are unchanged. See [FORENSICS.md](FORENSICS.md) and [validation-forensics.json](validation-forensics.json) for the 123 failed validations and the limits of the old telemetry.

One existing Managed Deep Agent owns interpretation in the same native thread/context. Source readers remain read-only. New Preparation authoring cannot use the old combined mutable packet tool. Its progression is:

`CLAIM_DISCOVERY -> CLAIM_INVENTORY_VALIDATION -> CLAIM_INVENTORY_READY -> RULE_AUTHORING -> RULE_VALIDATION -> SUBMISSION_READY -> COMPLETION`

Failed discovery validation returns to discovery; failed Rule validation returns to authoring. Validation phases are observable transient runtime states. READY, AUTHORING, SUBMISSION_READY and COMPLETION are recorded on the existing Preparation row. Rule validation is now a CQRS command because it records readiness, without publishing authority.

## Discovery and review

Typed incremental operations register/update/remove claims, link/remove semantic relations and review nodes/references. A stable semantic key plus Preparation ID, inventory revision and sorted source-node anchors determines a canonical SHA-256 claim identity. Identity does not use generated prose, random UUIDs, array position or model-call order. Updating wording/type during discovery preserves identity; correcting anchors requires an explicit corrected identity. Duplicate structured normative claims are rejected before freeze.

A source review enumerates every discovered claim anchored to the node, or an Agent-authored reason for no relevant material. Adding a new claim invalidates that node's review. Every source-bearing node requires review, including structural headings; deterministic code never decides the legal meaning of those headings. Material explicit references require resolved, correctly directed semantic relations; non-material references require an Agent-authored reason. A context claim cannot account for a separate normative claim.

Queries paginate status, unreviewed nodes, claims by node/ID, related claims, unaccounted claims and Requirements. Claim/node indexing avoids repeated full-claim scans during review. Model history keeps recent operations and phase transitions, while bounded inventory queries recover current IDs. The source graph is not appended to every model prompt.

## Freeze, revisions and persistence

`finalize_semantic_claim_inventory` validates identity, immutable source pinning/provenance, source review, relation endpoints and reference accounting WITHOUT requiring Requirements. Canonical graph ordering produces a cross-language inventory fingerprint.

The additive migration `20261017001000_preparation_claim_inventory` adds phase/revision/reopen reason to RuleSetPreparationRun and the append-only RuleSetPreparationClaimInventory table. `(preparationRunId,revision)` is the primary key; a Preparation foreign key, positive revision/hash/JSON shape checks, lookup index and immutable UPDATE/DELETE trigger protect frozen rows. Legal Source content/digests, historical Rule Sets, Assessment pins and authority rows are not rewritten. Old Rule Sets retain their historical model without fabricated inventories.

Finalization and explicit reopening serialize on the same Preparation row used by cancellation/publication. Finalization and authoring-start callbacks are idempotent; a replayed reopen returns the already-created revision. A reopen requires a reason, increments revision, preserves the previous immutable graph and clears all downstream runtime candidates. Claim and relation IDs are remapped for the new revision. Frozen claims never mutate in place.

## Rule authoring and accounting

Requirements explicitly target a frozen inventory revision. Typed authoring copies exact claim statements and actor/modality/action into their matching roles, and projects Agent-authored dependency direction into existing Requirement relations. It supports aggregation and legitimate investigation narrowing. Removing a mistaken downstream candidate records why and invalidates dependent candidates, without changing claims.

AssessmentRule authoring selects assessable Requirement parents. Existing shared contracts derive normative criteria, applicability, intent, goals and evidence requests; optional investigation focus remains a non-normative suggestion. Unsupported independent evidence obligations cannot be supplied by this tool. Canonical Completion Gate validation still rejects unsupported evidence from other callers.

Coverage is computed from valid explicit claim bindings, including separate condition, exception, context/definition and temporal roles. Retrieval metrics remain separate. Both validation and submission compare the complete candidate graph, inventory fingerprint and every Requirement revision with the current frozen revision. The publication transaction rechecks under the Preparation row lock, so reopening cannot race an old candidate into ACTIVE authority. Historical invalid-submission audit behavior remains non-authoritative.

## Convergence and evidence

Each inventory/Rule validation records safe candidate, inventory, Requirement, accounting, effective-state and gap fingerprints with phase/source/revision and gap counts. Repeated effective state yields NO_PROGRESS feedback; repeating it after feedback raises the existing NoProgressDetected. Observations survive intervening reads/notes and cycle revisits; cosmetic Requirement titles, concepts and investigation notes do not reset phase convergence. There is no model-call or validation-attempt budget.

Provider-free tests drive the actual native typed tools through real TypeScript schemas/domain validators, freeze, Rule repair, readiness and explicit scripted submission. Another test drives the real Managed Deep Agent graph with a scripted model; another proves that native graph validation terminates after ignored NO_PROGRESS feedback. No provider call, real Preparation dispatch or authority change is performed by these simulations. Pre-inventory packet/provider tests retain an explicit test-only legacy tool adapter; new production phase wiring is tested independently without it.

Regression fixtures retain multiple claims in one node, mixed context/duty, temporal/transition omission, exceptions, evidence authority, actor direction, qualifiers, dependencies, narrowing and aggregation. The isolated migrated PostgreSQL test proves immutability, callback replay, reopening and stale revision rejection. Scale checks use thousands of claims/relations and bounded reads. API migration tests run separately from legacy helpers that deliberately rebuild a schema using db push and remove migration-only constraints.

No live disposable Preparation is allowed until deterministic suites and deployed provider-free checks pass. This task permits exactly one subsequent isolated live Preparation, with failure stopping acceptance and prohibiting a second run. Production Preparations, authority changes and Assessment repinning remain unauthorized.

## Reusable deployed self-check

Run `PYTHONPATH=deepagents .venv/bin/python deepagents/tests/claim_protocol_harness.py` from the deployed repository. This reuses the deterministic test harness, actual incremental tools and real TypeScript domain validators with in-memory callback persistence. It asserts discovery feedback/termination, freeze, authoring, validation, readiness and scripted submission; it does not connect to a database, call a provider or create a Preparation. Running it twice verifies the canonical fingerprint. PostgreSQL persistence and cancellation/revision races are verified separately by the migrated DB suites.

The optional small live model test is skipped because the repository live lifecycle dispatches a Preparation; the authorized single final disposable run supplies real-provider evidence after deployed checks pass.
