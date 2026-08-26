---
id: SPEC-agentic-evidence-orchestration
companions:
  - tool-catalog.md
  - orchestration-state-machine.md
  - ../legal-corpus-source-spec.md
  - ../legal-matching-domain-spec.md
sources: []
---

> **Canonical contract.** This SPEC and its companions define the agentic evidence orchestration contract for LCSP.

# Agentic Evidence Orchestration

## Why

LCSP must verify Wizard targets and discover equivalent technical patterns without giving an LLM unrestricted source or execution access. The platform needs a durable way to resolve missing inputs, preserve evidence provenance, and recover legal-corpus context from Admin-managed official sources before classification and gap analysis proceed.

## Capabilities

- **CAP-1 — Mandatory evidence baseline**
  - **intent:** The system can produce a complete normalized technical evidence index and structural graph for every in-scope repository file before any LLM-assisted verification begins.
  - **success:** A scan records every eligible file as analyzed or explicitly limited, and `StructuralAugmentor` emits structural facts for every eligible file rather than stopping at an arbitrary file cap.

- **CAP-2 — Controlled technical investigation**
  - **intent:** Specialized agents can verify Wizard targets and discover analogous source patterns through bounded, evidence-backed tool calls.
  - **success:** Every technical claim candidate cites finding, graph, tool-provenance, and coverage references; no LLM request contains raw source, secrets, full prompts, or full AST bodies.

- **CAP-3 — Typed missing-input orchestration**
  - **intent:** Agents can state exactly what evidence is missing and the orchestrator can invoke only allowed resolvers, checkpoint progress, and resume safely.
  - **success:** Every non-terminal agent output is `READY`, `NEEDS_INPUT`, `CONFLICT`, `OUT_OF_COVERAGE`, `BLOCKED`, or `FAILED`, with a schema-valid resolution path or explicit terminal reason.

- **CAP-4 — Evidence-gated classification and gap analysis**
  - **intent:** The system can prepare classification and gap candidates from the versioned artifact chain, citation-backed legal matches, and coverage-aware requirement evaluation.
  - **success:** A material classification or closed gap cannot be persisted unless deterministic citation, overclaim, conflict, coverage, and state-transition gates pass.

- **CAP-5 — Automated official-corpus recovery**
  - **intent:** The system can recover missing legal context from an Admin-managed official-source catalog through extraction, OCR fallback, chunking, indexing, and integrity validation.
  - **success:** A waiting workflow resumes against a new immutable corpus version only after snapshot, hierarchy, chunk, index, and audit validation pass; no manual source approval is required.

## Constraints

- The Python Scanner Worker owns repository scan lifecycle; the API retains RBAC, artifact persistence, and trusted trigger boundaries.
- All model calls traverse the LLM Gateway and use sanitized, schema-constrained inputs.
- Tools are versioned, allow-listed, bounded by scope/time/cost, and cannot execute customer source, install dependencies, or call arbitrary URLs.
- Legal retrieval uses approved/active immutable corpus versions, stable hierarchical chunk IDs, and citation allowlists.
- Admin-managed source membership replaces manual source approval, not integrity, provenance, hierarchy, effective-status, chunk, or index validation.

## Non-goals

- Allowing agents to run arbitrary shell commands, fetch arbitrary URLs, or read raw repository source.
- Letting an LLM make a legal conclusion, activate a corpus, resolve a material conflict, or persist a final classification/gap decision.
- Replacing deterministic scanner, citation, RBAC, or state-machine enforcement with an LLM.

## Success signal

For an assessment with incomplete Wizard declarations and missing legal context, the workflow identifies the exact evidence/corpus requirement, runs only permitted recovery tools, resumes from its checkpoint, and emits a fully traceable classification and gap result or an explicit blocked/unknown outcome.

## Open Questions

- What maximum repository size, file count, and shard size preserve the requirement that StructuralAugmentor covers every eligible file?
- Which automated hierarchy/OCR quality thresholds may activate a corpus without a human correction task?
