# Engineering Rule Specification

## Status
AUTHORITATIVE — LCSP-999

## Purpose
An `EngineeringRule` translates one approved legal applicability contract into reusable technical investigation intent. It is machine-generated, deterministically validated, versioned and cached. It is not legal authority and cannot decide compliance or risk level.

## Source authority

Input is an `APPROVED LegalRule` plus exact chunks from an `APPROVED LegalCorpusVersion`. Retrieval is vectorless: exact chunk IDs plus structural parent/reference context. Embeddings/similarity search are not part of the compliance critical path.

## Compilation

```text
Approved LegalRule + exact legal context
 -> LLM Legal-to-Engineering Compiler
 -> EngineeringRuleDraft[]
 -> canonical node/edge/schema/provenance validation
 -> EngineeringRule[]
 -> persistent exact-fingerprint cache
```

A legal rule may compile into multiple EngineeringRules when distinct technical controls require separate investigations.

## Cache fingerprint

Fingerprint includes legal-rule content, legal corpus version, referenced chunk hashes, EngineeringRule schema version, compiler version and compiler prompt version. Same fingerprint is a cache hit and performs no LLM call. Changed referenced legal text or compiler contract creates a new fingerprint. Repealed source chunks block compilation.

## Rule content

Each rule contains identity/provenance, semantic concept/legal intent, investigation goals, starting/target node types, allowed graph edges, deterministic graph-query templates, discovery hints, and evidence contract (`required`, `supporting`, `negative`, `unresolved`). Keywords/APIs/library names are hints only.

## Validation

Compilation fails closed for unknown graph node/edge vocabulary, duplicate/invalid query definitions, missing legal source provenance, unsupported schema or unresolved/repealed citation basis. An LLM-generated identifier cannot extend the graph vocabulary.

## Investigation

One Repository Analyst Deep Agent task analyzes each eligible EngineeringRule directly in the pinned repository; no graph query is pre-executed on its behalf. The agent's output is a governed per-criterion assessment (`submit_rule_assessment`), not a legal verdict; LCSP converts accepted criteria into `EvidenceClaim`s. Evidence refs are runtime-minted and revalidated deterministically. See `deepagents/FLOW.md`.
