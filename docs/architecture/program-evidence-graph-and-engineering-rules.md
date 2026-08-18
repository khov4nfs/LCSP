# Program Evidence Graph and Engineering Rule Architecture

## Status

AUTHORITATIVE — LCSP-999 BIG RE-ARCHITECTURE

## Purpose

LCSP scans the complete statically resolvable repository, builds an immutable Program Evidence Graph, maps governed legal source chunks to reusable Engineering Rules, lets a bounded LLM investigator query that graph, and deterministically evaluates each Engineering Rule as `COMPLIANT`, `NON_COMPLIANT`, or `UNKNOWN`.

The canonical runtime is code-centric. `TechnicalProfile`, `AIUsageFlow`, `VerifiedProfile`, and `LegalRuleMatch` are no longer execution stages. Historical rows and endpoints may remain temporarily for migration/read compatibility, but new assessments must not depend on them.

## Ownership

- Python Worker owns scanner execution, semantic IR, graph construction/query, legal-to-engineering compilation, graph investigation, EvidenceClaim validation, EngineeringRule evaluation, remediation synthesis, and document generation inputs.
- NestJS owns CQRS persistence/read boundaries, PBAC/authority, HTTP/internal APIs, outbox/events, protected mutations, and persistence of the direct EngineeringRule assessment result.
- TypeScript/JavaScript semantic parsing may run as a `ts-morph` subprocess owned and invoked by the Python Scanner Worker; it does not own orchestration or evidence decisions.
- LLM Gateway remains the only model-provider boundary.

## Canonical end-to-end flow

```text
LEGAL SOURCE SIDE

Approved Legal Corpus
  -> Legal document chunks with exact provenance
  -> governed LegalRule identity + citation locator refs
  -> exact vectorless legal context retrieval
  -> LLM Legal-to-Engineering Compiler (only on cache miss)
  -> deterministic EngineeringRule validation
  -> versioned/fingerprinted EngineeringRule cache

REPOSITORY SIDE

RepositorySnapshot
  -> full static/semantic scan
  -> language-neutral Semantic IR
  -> ProgramEvidenceGraph

ASSESSMENT SIDE

ProgramEvidenceGraph
  + EngineeringRule
  -> deterministic seed graph queries
  -> orchestrator-owned EvidenceLedger (full per-run observations)
  -> bounded LLM working-context/tool loop
       search_nodes
       trace_static_flow
       inspect_data_path
       inspect_decision_path
       inspect_human_review_path
       symbol_context
       provider_invocations
       list_observations
       inspect_observation
       finish(observationRefs[])
  -> LCSP derives graph/source provenance from observationRefs
  -> validated EvidenceClaims
  -> deterministic EngineeringRuleEvaluator
       COMPLIANT
       NON_COMPLIANT
       UNKNOWN
  -> direct ClassificationResult assessment artifact
  -> gap/remediation
  -> final report
```

Wizard answers are optional supplemental context for facts that cannot be proven from repository evidence. They are not a gate between scan and EngineeringRule evaluation. When present they are stored as investigation state instead of being repeatedly copied into every prompt. When repository evidence is insufficient or an external/dynamic boundary prevents proof, the result remains `UNKNOWN` rather than inventing a fact.

## Program Evidence Graph

The graph represents repository structure and statically resolvable behavior, including dependencies/package usage, imports/exports/references/definitions, symbols and arguments, assignments/data derivation, calls/returns/data flow, decisions/business actions, parsers/validators/transforms, routes/events/queues/CQRS boundaries, persistence operations, external APIs/model invocations, sensitive-data semantics, human review/approval/override controls, and explicit unresolved dynamic boundaries.

Raw source is read only inside the restricted ephemeral workspace. Persisted graph evidence contains source anchors (`snapshot`, `commit`, `file`, `symbol`, `line range`, `source hash`) and normalized semantic relationships, never complete source bodies, full ASTs, secrets, prompts containing sensitive literals, or literal personal data.

## Legal chunk -> LegalRule -> EngineeringRule

`LegalRule` is the governed identity and legal-source provenance boundary. It is not evaluated against a `VerifiedProfile` in the canonical repository assessment runtime.

`EngineeringRule` is the technical investigation contract derived from the LegalRule and exact approved legal chunks. It defines what the investigator should look for in the Program Evidence Graph: goals, starting/target node types, graph queries, edge strategies, evidence expectations, negative evidence, and unresolved conditions.

Engineering Rules are cached by immutable fingerprint over LegalRule content, legal corpus/catalog versions, referenced chunk hashes, EngineeringRule schema, compiler version, and prompt version. Repository scans reuse the cache and do not recompile unchanged rules.

Development bootstrap LegalRules exist only to give precompiled EngineeringRules stable governed identities/fingerprints. Their sentinel facts are never injected into repository assessments and are never used as applicability predicates.

## Investigation state and LLM working context

The context window is **not** the investigation source of truth. LCSP owns a per-EngineeringRule `EvidenceLedger` containing the full seed-query and graph-tool observations for that run. The model receives a bounded index/working view with stable observation IDs such as `obs:0001`.

When more detail is needed the model uses `list_observations` and `inspect_observation` to page the existing ledger instead of forcing LCSP to resend every prior graph result. Full observations remain available to the orchestrator; a prompt-size guard may reject an unexpectedly oversized working view, but it must not silently delete historical observations to fit a provider context window.

This separates:

- **source of truth:** Program Evidence Graph + full EvidenceLedger;
- **working memory:** current rule contract, ledger index, recent tool result pages;
- **provider context window:** only the working view required for the current step.

The LLM does not receive unrestricted repository access. It can only invoke the declared deterministic Program Evidence Graph and EvidenceLedger tools.

## Evidence claims and provenance

The LLM emits engineering evidence claims only:

- `RULE_REQUIREMENT_MET`
- `RULE_REQUIREMENT_NOT_MET`
- `UNRESOLVED_ENGINEERING_FACT`

The provider-native `finish` tool accepts `observationRefs[]` rather than model-authored `evidenceRefs`, `graphPathRefs`, or `sourceAnchorRefs`. LCSP resolves those observation IDs against its own EvidenceLedger and deterministically derives immutable evidence/node/edge/source-anchor provenance. Unknown observation IDs fail closed instead of allowing invented graph identities into persisted claims.

The model does not author a separate claim `value`; LCSP derives it deterministically from `claimType` (`true`, `false`, or `null`). `limitations[]` accepts only enumerated machine codes. Free-form prose is not valid in claim/evaluation/top-level limitation arrays and is rejected or converted to a fail-closed unresolved result before persistence.

Narrative text is deliberately restricted to controlled fields such as optional top-level `notes` and deterministic `evaluations[].reason`. Overclaim validation scans those narrative fields only. IDs, provenance, canonical statuses, evidence refs, boolean/null claim values, and machine limitation codes are structured data and are not substring-scanned as prose.

A positive/negative claim must resolve to concrete ledger-derived graph evidence. Absence can support a negative claim only when the referenced observation demonstrates a bounded and complete search. Dynamic, external, truncated, conflicting, or otherwise insufficient paths remain unresolved.

The model never determines a legal verdict, certification, legal risk tier, or court-level violation conclusion.

## Deterministic EngineeringRule evaluation

The final gate is code, not the LLM:

- evidence-backed `RULE_REQUIREMENT_MET` with no unresolved contradiction -> `COMPLIANT`;
- evidence-backed `RULE_REQUIREMENT_NOT_MET` -> `NON_COMPLIANT`;
- missing, conflicting, dynamic or insufficient evidence -> `UNKNOWN`.

Every evaluation carries `engineering_rule_id`, `legal_rule_id`, concept, source chunk IDs/locators, graph/source evidence refs, confidence, rationale and machine-readable limitation codes.

## Persistence and reporting

The direct assessment artifact is persisted in `ClassificationResult.classificationData` with mode `ENGINEERING_RULE_EVALUATION` and a reference to the accepted `TechnicalEvidenceReport` and pinned snapshot.

`guardrailStatus` describes assessment integrity, not compliance status:

- `PASSED`: the EngineeringRule assessment completed;
- `DEGRADED`: results exist but one or more rules are `UNKNOWN` or runtime limitations were recorded;
- `BLOCKED`: no trustworthy EngineeringRule evaluation could be produced.

Gap analysis consumes `NON_COMPLIANT` and `UNKNOWN` EngineeringRule evaluations directly. Final reports consume the same direct artifact plus repository/legal-source provenance. Neither document runtime requires `TechnicalProfile`, `AIUsageFlow`, `VerifiedProfile`, or `LegalRuleMatch`.

## Removed canonical stages

The following chain is explicitly removed from new assessment execution:

```text
TechnicalProfile
  -> AIUsageFlow
  -> Conflict Detection / Reconciliation
  -> VerifiedProfile
  -> Legal Matching / LegalRuleMatch
```

These components may remain in the repository temporarily only for historical-data compatibility and safe migration. They must not be started by production PM2, must not be required by readiness, and must not be required to generate new assessment documents.

## Tool invariant

Every canonical technical tool has a public exact-same-name Python entrypoint and one explicit central binding. Technical processing tools are Python-local. NestJS-bound tools are limited to CQRS reads, protected commands, persistence, authority, and system integration.
