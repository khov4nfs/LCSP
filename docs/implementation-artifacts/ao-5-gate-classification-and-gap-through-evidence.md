# Story AO-5: Gate Classification and Gap Through Evidence

Status: ready-for-dev

Jira: [LCSP-162 — Classification & Gap Gates](https://minhpnq1807.atlassian.net/browse/LCSP-162)

## Story

As a compliance workflow,
I want classification and gap proposals to pass evidence and citation gates,
so that downstream conclusions are traceable and do not overclaim.

## Acceptance Criteria

1. Each classification proposal has an immutable technical-evidence chain and policy-profile version; every conclusion cites its evidence.
2. Legal corpus and citation allow-list verification are gates, not advisory checks.
3. Proposals remain non-final until all gates pass; unsupported/conflicted inputs resolve to `UNKNOWN`, `NEEDS_INPUT`, or `BLOCKED`.
4. Every gap row includes status, evidence, clause, rationale, remediation state, and independent closure validation; remediation cannot close itself.

## Tasks / Subtasks

- [ ] Model immutable evidence-chain/policy-profile inputs and proposal-only classification/gap contracts. (AC: 1, 3)
- [ ] Implement approved-corpus retrieval and citation allow-list gates with explicit unsupported/conflict outcomes. (AC: 2, 3)
- [ ] Implement traceable gap matrix, remediation lifecycle, and independent validation; add citation, policy-version, non-final, and anti-self-close tests. (AC: 1, 2, 4)

## Dev Notes

- Official execution artifact: `docs/implementation-artifacts/ao-5-gate-classification-and-gap-through-evidence.md`.
- Classification uses immutable technical evidence and an approved legal corpus version; neither LLM confidence nor a provider response is sufficient evidence by itself.
- Gate outputs are explicit state transitions. Do not convert a missing citation, stale corpus, limited evidence, or conflict into a final classification/gap status.
- Persist proposal/version/reference metadata, not raw source or unbounded legal text. Citation references must be resolvable through the corpus allow-list.
- Separate generation from validation. The actor/process proposing remediation cannot mark the same gap closed.

### Tool Catalog Coverage

- Legal/classification tools: `get_legal_corpus_readiness`, `retrieve_legal_basis`, `get_legal_rule_match`, `validate_citation_set`, `get_classification_baseline`, and `validate_classification_proposal`.
- Gap tools: `get_gap_requirements`, `evaluate_gap_matrix`, `get_gap_evidence_trace`, and `propose_gap_remediation`.
- `validate_citation_set` and `validate_classification_proposal` are deterministic gates; `propose_gap_remediation` is proposal-only and can never close a gap.
- Per-tool implementation tasks: `docs/implementation/tasks/modules/agentic-evidence-tools/legal-classification-gap-tools.md`.

### Expected Files

- `packages/contracts/src/*` for classification, gap, and gate contracts
- `apps/api/src/modules/classification/*` and `apps/api/src/modules/gap-analysis/*`
- legal retrieval/citation validator modules and focused integration tests
- workflow/audit persistence adapters as required

### Verification Requirements

- Test immutable evidence/policy version linking, missing/stale/unauthorized citations, incomplete evidence, conflicts, and proposal-only persistence.
- Test every gap row has traceable clause/evidence/rationale and requires an independent closure validator.
- Run relevant API, worker, legal retrieval, and contract suites.

### References

- [Source: docs/specs/spec-agentic-evidence-orchestration/SPEC.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/orchestration-state-machine.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md]
- [Source: docs/specs/legal-corpus-source-spec.md]
- [Source: docs/specs/domain-state-machines.md]
- [Source: docs/implementation/legal-corpus-ingestion-implementation.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Completion Notes List

- Created from the LCSP-162 Jira Story and evidence/citation gate specifications.

### File List

- docs/implementation-artifacts/ao-5-gate-classification-and-gap-through-evidence.md

## Change Log

- 2026-08-11: Created AO-5 execution artifact.
