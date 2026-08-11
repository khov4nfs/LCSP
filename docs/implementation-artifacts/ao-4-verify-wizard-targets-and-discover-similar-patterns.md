# Story AO-4: Verify Wizard Targets and Discover Similar Patterns

Status: ready-for-dev

Jira: [LCSP-161 — Wizard Target Verification](https://minhpnq1807.atlassian.net/browse/LCSP-161)

## Story

As a workflow agent,
I want to verify wizard targets against deterministic evidence and discover similar patterns,
so that target claims are grounded without silently changing wizard input.

## Acceptance Criteria

1. A target verification returns `SUPPORTED`, `CONTRADICTED`, `NOT_FOUND`, `UNKNOWN`, or `OUT_OF_COVERAGE` with evidence references and coverage.
2. Structural and semantic fingerprints return bounded similar candidates, clearly distinct from verified targets.
3. Contradictions create a conflict candidate and never mutate wizard data automatically.
4. Insufficient evidence remains `UNKNOWN` with a missing-evidence explanation, rather than being inferred as supported or absent.

## Tasks / Subtasks

- [ ] Define target, verification-result, fingerprint, similarity-candidate, conflict-candidate, and coverage contracts. (AC: 1, 2, 3, 4)
- [ ] Implement bounded retrieval/ranking from AO-2 evidence tools and deterministic verification against requested target attributes. (AC: 1, 2)
- [ ] Render/persist conflict candidates as reviewable proposals only; add golden tests for supported, contradicted, not-found, unknown, out-of-scope, and similar-but-unverified cases. (AC: 3, 4)

## Dev Notes

- Official execution artifact: `docs/implementation-artifacts/ao-4-verify-wizard-targets-and-discover-similar-patterns.md`.
- Wizard answers remain user-owned input. This story creates evidence-backed verification and conflict proposals, never background edits or auto-approval.
- Candidate ranking is an aid to investigation, not a verification result. Each candidate must carry its own scope, score/confidence, evidence refs, and coverage context.
- `NOT_FOUND` requires sufficient searched scope; limited coverage, unavailable tools, or ambiguous target mapping must resolve to `UNKNOWN` or `OUT_OF_COVERAGE`.
- Use AO-3 when a required tool/artifact/target field is missing; do not issue unrestricted searches.

### Tool Catalog Coverage

- Wizard/artifact tools: `get_assessment_context`, `compare_wizard_claim`, `propose_missing_targets`, `get_artifact_chain`, and `get_reconciliation_context`.
- Technical support tools: `search_evidence`, `get_symbol_context`, `get_evidence_subgraph`, `trace_static_flow`, and `find_similar_symbols`.
- `compare_wizard_claim` owns the verdict; `propose_missing_targets` and `find_similar_symbols` produce candidates only and cannot mutate a wizard target.
- Per-tool implementation tasks: `docs/implementation/tasks/modules/agentic-evidence-tools/artifact-wizard-conflict-tools.md` and `technical-evidence-query-tools.md`.

### Expected Files

- `packages/contracts/src/*` for verification and conflict contracts
- `apps/api/src/modules/assessment/*` or the owning workflow service
- `apps/web/src/features/*` only for review presentation, with no autonomous wizard mutation
- golden fixtures and API/UI contract tests

### Verification Requirements

- Golden cases assert every verification status, evidence/correlation chain, scope/coverage treatment, and candidate-versus-verdict distinction.
- Tests prove contradictory evidence yields a conflict proposal and leaves the original wizard record unchanged.
- Verify privacy-safe outputs and bounded similarity limits through the AO-2 tool boundary.

### References

- [Source: docs/specs/spec-agentic-evidence-orchestration/SPEC.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/orchestration-state-machine.md]
- [Source: docs/specs/domain-model.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Completion Notes List

- Created from the LCSP-161 Jira Story with wizard ownership and evidence-boundary guardrails.

### File List

- docs/implementation-artifacts/ao-4-verify-wizard-targets-and-discover-similar-patterns.md

## Change Log

- 2026-08-11: Created AO-4 execution artifact.
