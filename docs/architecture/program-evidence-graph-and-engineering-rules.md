# Program Evidence Graph and Engineering Rule Architecture

## Status

AUTHORITATIVE — LCSP-999 BIG RE-ARCHITECTURE

## Purpose

LCSP scans the complete statically resolvable repository before LLM investigation, builds an immutable Program Evidence Graph, compiles approved legal rules into cached Engineering Rules, and uses Python-owned agentic investigation to produce evidence-backed claims, gaps, remediation, and version-pinned dossiers.

## Ownership

- Python Worker owns scanner execution, semantic IR, graph construction/query, legal-to-engineering compilation, investigation, source-evidence projection, remediation synthesis, and dossier construction.
- NestJS owns CQRS persistence/read boundaries, PBAC/authority, HTTP/internal APIs, outbox/events, and protected mutations.
- TypeScript/JavaScript semantic parsing may run as a `ts-morph` subprocess owned and invoked by the Python Scanner Worker; it does not own orchestration or evidence decisions.
- LLM Gateway remains the only provider boundary and is unchanged by this architecture.

## End-to-end flow

```text
Approved Legal Corpus + Approved LegalRule
  -> exact vectorless retrieval (primary + parent + referenced chunks)
  -> LLM Legal-to-Engineering Compiler
  -> deterministic EngineeringRule validation
  -> versioned/fingerprinted EngineeringRule cache

RepositorySnapshot
  -> full static/semantic scan
  -> language-neutral Semantic IR
  -> ProgramEvidenceGraph
  -> deterministic EngineeringRule graph queries
  -> LLM investigation only for unresolved/semantic synthesis
  -> EvidenceClaim validation
  -> TechnicalEvidenceReport / TechnicalProfile / AIUsageFlow
  -> Reconciliation / VerifiedProfile
  -> deterministic LegalRule applicability + risk classification
  -> gap/remediation
  -> Dossier Engine
```

## Program Evidence Graph

The graph is not an AI-call graph. It represents repository structure and statically resolvable behavior, including dependencies, imports/exports, symbols, parameters, variables/properties, assignments/aliases, calls, arguments, returns, parsers/serializers/validators/transforms, routes, events/queues/CQRS, persistence, external APIs, AI invocations, sensitive-data categories, business actions, human controls, and explicit unresolved dynamic boundaries.

Raw source is read only inside the restricted ephemeral workspace. Persisted graph evidence contains source anchors (`snapshot`, `commit`, `file`, `symbol`, `line range`, `source hash`) and normalized semantic relationships, never source bodies, full ASTs, prompts, secrets, or literal personal data.

## Legal-to-Engineering compilation

`LegalRule` remains a legally governed and approved applicability contract. It is not replaced by LLM-generated legal truth. `EngineeringRule` is a machine-generated technical investigation contract derived from an approved `LegalRule` plus exact approved legal-corpus context.

Engineering Rules are cached by immutable fingerprint over legal-rule content, legal corpus/rule catalog versions, referenced chunk hashes, EngineeringRule schema, compiler version, and prompt version. Repository scans reuse the cache and do not recompile unchanged law.

## Vectorless legal retrieval

Critical-path legal retrieval remains exact and structural. ChromaDB embeddings/similarity are not used. Citation IDs select primary chunks and their parent/referenced structural context. EngineeringRule compilation and dossier explanations pin the same exact legal provenance.

## Evidence and conclusions

LLM investigation emits `EvidenceClaim`, not legal verdicts. Claims must reference graph/source evidence and pass deterministic validation. `VerifiedProfile` remains the evidence-backed input to deterministic legal applicability. Risk classification is based on system characteristics/impact and is not computed from violation counts.

## Remediation and dossiers

Remediation points to the affected source/graph locations, explains why the gap matters, proposes a change, and defines re-scan verification. A suggestion never closes a finding by itself.

`DossierEngine` is generic. The first dossier type is `AI_RISK_CLASSIFICATION`; future types reuse the same verified artifact chain rather than implementing separate scanner logic.

## Tool invariant

Every canonical tool has a public exact-same-name Python entrypoint and one explicit central binding. Technical processing tools are Python-local. NestJS-bound tools are limited to CQRS reads, protected commands, persistence, authority, and system integration. Dead/duplicate technical Nest handlers are removed after Python migration.
