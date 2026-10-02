# Program Evidence Graph and Engineering Rule Architecture

## Status

AUTHORITATIVE — LCSP-999 BIG RE-ARCHITECTURE

## Purpose

LCSP analyzes the commit-pinned repository through a repository-backed Repository Deep Agent, derives a compatibility Program Evidence Graph from inspected source, maps governed legal source chunks to reusable Engineering Rules, and evaluates each Engineering Rule with source-grounded evidence.

The canonical runtime is code-centric. `TechnicalProfile`, `AIUsageFlow`, `VerifiedProfile`, and `LegalRuleMatch` are no longer execution stages. Historical rows and endpoints may remain temporarily for migration/read compatibility, but new assessments must not depend on them.

## Ownership

- Repository Deep Agent owns repository exploration, source-grounded graph derivation, coverage/AI discovery, and technical investigation inputs; downstream workers retain governed legal/evaluation responsibilities.
- NestJS owns CQRS persistence/read boundaries, RBAC/authority, HTTP/internal APIs, outbox/events, protected mutations, and persistence of the direct EngineeringRule assessment result.
- Codebase Memory MCP may accelerate cross-language structural discovery, but direct source inspection is authoritative and no language-specific parser subprocess owns evidence decisions.
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

REPOSITORY SIDE (scan job)

RepositorySnapshot (pinned commit)
  -> hydrate once at /workspace/repository
  -> Codebase Memory index once (optional agent tool, never evidence)
  -> technical coverage
  -> ONE bounded AI-discovery Deep Agent task (independent prerequisite)

ASSESSMENT SIDE (deterministic per-rule loop)

pinned READY EngineeringRule
  -> deterministic legal applicability
  -> ONE repository-analyst Deep Agent task per eligible rule
       native filesystem/shell + codebase-memory tools
       cite_repository_source / get_code_snippet mint evidence refs
       submit_rule_assessment (governed validation + provenance stamp)
  -> per-rule ledger EngineeringRuleAssessment
  -> BusinessContextNeed -> Interview -> resume the same rule
  -> claims from accepted criteria
       (SUPPORTS_REQUIREMENT -> MET, DEMONSTRATES_VIOLATION -> NOT_MET, others UNRESOLVED)
  -> deterministic EngineeringRuleEvaluator + rule-completion gate
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

## Rule analysis and provenance

The context window is not the source of truth. The assessed repository (working database)
and the durable per-rule ledger are. A Repository Analyst explores the repository with the
native Deep Agents tools; LCSP does not prescribe how. Evidence refs are minted only by the
governed tools `cite_repository_source` and `get_code_snippet` (HMAC-bound to assessment, rule
and execution); the model never writes a ref. `submit_rule_assessment` validates identity,
version, commit, criterion ids, evidence liveness and limitation vocabulary, stamps
provenance and persists one `EngineeringRuleAssessment` row per rule.

Criterion statuses are `EVIDENCE_FOUND` (with `evidenceKind` `SUPPORTS_REQUIREMENT` or
`DEMONSTRATES_VIOLATION`), `BUSINESS_CONTEXT_REQUIRED`, `TECHNICAL_UNRESOLVED` and
`NOT_OBSERVED` ("not established", never absence). Finalization maps accepted criteria to
`RULE_REQUIREMENT_MET` / `RULE_REQUIREMENT_NOT_MET` (verified positive evidence only) /
`UNRESOLVED_ENGINEERING_FACT`. FINAL_ABSENCE stays disabled. The model never determines a
legal verdict, certification or risk tier.

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
