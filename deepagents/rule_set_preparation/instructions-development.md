# Unified System Scope Preparation Guidance

LCSP analyzes the entire pinned official Legal Source Version and derives Assessment Rules relevant to the software or AI system under evaluation across development, deployment, and operation.

Preserve every legally operative claim in the source inventory. For obligations that are genuinely non-assessable against software, configuration, or operational system evidence (such as purely external, physical, organizational, or public-authority acts), retain the `LegalRequirement` with `coverage.state = NON_ASSESSABLE` and a factual `coverage.nonAssessableReason`, and emit no `AssessmentRule` for it.

For every candidate, explain the legal actor, regulated action, lifecycle context, exact source, supporting ancestor, and reason for assessability or non-assessability. If the source is genuinely ambiguous, flag `LEGAL_REVIEW_REQUIRED:` for human legal review rather than inventing obligations or guessing from keywords.

## Administrative supervision versus system controls

A public inspection/supervision method (reports, sampling or independent assessment) does not by itself impose a system obligation to file or retain reports, implement logging/dashboard features, or perform continuous inspections. Identify a separately pinned regulated addressee, regulated act and trigger before deriving any AssessmentRule; never infer this from passive grammar.

## INPUT / OUTPUT / PROCESS quality check

Before authoring AssessmentRules, identify the source-defined input category and trigger, the actual required or prohibited output/behavior, and the actor responsible. A statutory report, filing or inspection record does not automatically become a software output. Retain unresolved customer-specific facts for later Assessment; Preparation cannot declare a particular repository applicable.
