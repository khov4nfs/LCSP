# Story 3.6: Repository Analysis Failure and Evidence Acceptance Policy

Status: review

## Story

As LCSP, I want repository-analysis failures, coverage limitations, and evidence eligibility classified by a canonical policy, so downstream flows can distinguish accepted evidence, accepted-with-limitation evidence, retryable runtime failure, insufficient evidence, and terminal failure without relying on retired scanner-tool semantics.

## Acceptance Criteria

1. **Given** repository analysis completes with complete material coverage
   **When** source-grounded evidence passes schema, privacy, provenance, and integrity checks
   **Then** the result is eligible for TechnicalEvidenceReport acceptance.

2. **Given** repository analysis has a bounded non-material limitation
   **When** the remaining limitation does not invalidate the decided claim
   **Then** LCSP may accept the result with an explicit limitation
   **And** the limitation remains attached to downstream evidence.

3. **Given** a material coverage frontier remains unresolved
   **When** the result would otherwise support an exhaustive or absence conclusion
   **Then** evidence is insufficient or partial for that conclusion
   **And** absence gates such as `AI_ABSENT_CONFIRMED` remain closed.

4. **Given** LCSP Agent Runtime, repository hydration, Codebase Memory assistance, or another runtime dependency fails transiently
   **When** retry policy permits recovery
   **Then** the run is classified retryable without mutating prior accepted evidence.

5. **Given** source safety, authorization, snapshot integrity, schema, or privacy invariants fail
   **When** evidence eligibility is evaluated
   **Then** the result is terminal/rejected for downstream use
   **And** only safe diagnostic metadata is audited.

## Canonical Policy Inputs

- commit-pinned snapshot identity;
- repository-analysis runtime/config identity;
- source anchors and source-grounding status;
- global and AI coverage state;
- unresolved material frontiers;
- privacy/redaction outcome;
- schema and integrity validation;
- retryability and managed runtime failure class.

## Explicitly Retired Inputs

Tool-specific Semgrep/Syft/Knip/Deptry severity tables, ruleset hashes, AST parser stages, and language-specific scanner coverage are not active acceptance authority.

## Verification

- repository-analysis coverage and AI-gate tests;
- managed runtime retry/failure tests;
- TechnicalEvidenceReport schema/privacy/provenance tests;
- immutable rerun/history tests;
- API callback rejection/acceptance E2E tests.

## References

- `docs/architecture/repository-deep-agent-analysis.md`
- `docs/specs/non-functional-requirements.md`
- `docs/specs/program-evidence-graph-spec.md`
- `docs/implementation/queue-implementation.md`
- `docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md`
- `deepagents/tools/common/capabilities/evidence/repository_analysis/`
