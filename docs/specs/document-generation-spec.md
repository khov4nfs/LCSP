# Document Generation Spec

## Status

AUTHORITATIVE

## Merged From

- Document output rules from `docs/architecture/repository-deep-agent-analysis.md`
- Citation requirements from `docs/specs/legal-matching-domain-spec.md`

## Purpose

Single source of truth for document-generation domain behavior and output guardrails.

## Canonical Rules

- No final legal output without citation traceability.
- Missing legal citation blocks or degrades output.
- Unresolved conflict blocks final document generation.
- Generated documents reference RiskClassification, GapAnalysis, citations, and evidence appendix.
- Document generation starts only after `event.gap-analysis.completed.v1` creates `command.document.requested.v1`.
- Document generation must not start directly from `event.classification.completed.v1`.
- Raw source, secrets, full prompts, and full AST bodies must not be included.

## Runtime Source

Runtime behavior is governed by `docs/specs/domain-state-machines.md`, `docs/specs/event-catalog.md`, `docs/specs/assessment-lifecycle-spec.md`, and the implementation specs in `docs/implementation/`.
