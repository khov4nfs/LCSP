# Legal Classification Spec

## Status

AUTHORITATIVE

## Purpose

Single source of truth for direct EngineeringRule-based legal classification.

## Input Preconditions

- Accepted TechnicalEvidenceReport exists.
- WizardProfile, when present, is supplemental context and does not replace repository evidence.
- OpenWiki context, when present, is an unverified retrieval hint only.
- Legal corpus is versioned and citation traceability is available.
- Approved LegalRules compile to validated EngineeringRules or fail closed with diagnostics.

## EngineeringRule Investigation

- Plan and investigate EngineeringRules by evidence-backed technical scope, not provider/model presence alone.
- Every structured claim emitted by the investigator must carry provenance/evidence refs or it is ignored/fails closed.
- Every material legal conclusion requires citation coverage.
- Missing citation or missing evidence refs blocks or degrades classification/output.
- Policy-only documents cannot be treated as standalone mandatory legal obligations unless the spec identifies them as binding.
- The rule catalog itself (`LegalRule` entity, authoring, versioning, approval) is governed by `docs/specs/legal-rule-catalog-spec.md`, a separate artifact from the legal corpus (`docs/specs/legal-corpus-source-spec.md`). Rules are hand-authored and citation-validated against the corpus, then compiled into validated EngineeringRules for technical investigation.

## Risk Classification

Classification uses direct EngineeringRule evaluations, legal-rule provenance, citation-backed legal basis, evidence confidence, and uncertainty.

Classification must not use provider/model/framework presence alone, unverified Manager claims, evidence-less investigator claims, unresolved conflict, or missing citation as if it were sufficient legal basis.

## Gap Analysis

Gap Analysis is a first-class runtime component between classification and document generation.

Gap Analysis uses completed direct EngineeringRule classification, citation coverage and evidence refs to produce `GapAnalysis` items. It identifies missing obligations, missing evidence, citation gaps, blocked/degraded output reasons and prioritized remediation items.

Document generation must use `GapAnalysis` as an input and must not run directly from `event.classification.completed.v1`.

## Output

```json
{
  "riskClassificationId": "018f0000-0000-7000-8000-000000000611",
  "assessmentId": "018f0000-0000-7000-8000-000000000001",
  "riskLevel": "BLOCKED_OR_CLASSIFIED",
  "engineeringRuleEvaluations": ["rule-eval-018f0000"],
  "citationCoverage": "COMPLETE_CITATION | PARTIAL_CITATION | NO_CITATION",
  "blockingReasons": []
}
```

<!-- PHASE-5-5-CLASSIFICATION-TRIGGER:START -->

## Phase 5.5 Canonical Trigger Contract

Risk classification is triggered from accepted technical evidence through the managed EngineeringRule assessment boundary:

```text
event.technical-evidence.accepted.v1
-> engineering_assessment_requested
-> event.classification.completed.v1 | event.classification.blocked.v1
```

Classification must not depend on the retired `VerifiedProfile` approval or `LegalRuleMatch` callback gates. Legal support is carried by LegalRule/EngineeringRule provenance and citation traceability in the direct result.

Gap Analysis is triggered only after classification completes:

```text
event.classification.completed.v1
-> command.gap-analysis.requested.v1
```

Document generation is triggered only after gap analysis completes:

```text
event.gap-analysis.completed.v1
-> command.document.requested.v1
```

Document generation must not consume `event.classification.completed.v1` directly.
<!-- PHASE-5-5-CLASSIFICATION-TRIGGER:END -->
