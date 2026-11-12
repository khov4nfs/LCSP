---
name: rule-preparation-scope-quality
description: Run bounded positive and negative legal-semantic controls for development-only Preparation projections.
---

# Development-only semantic and provenance gate

## Preconditions
A fully pinned and source-accounted LegalSourceVersion; frozen or validated claims/candidates; a server-owned target scope and an authorized projection contract. A mock response or agent-made scope string cannot authorize activation.

## Controls
1. Preserve every source unit and every real legal duty in the authoritative ledger, even when not selected for development.
2. Reject any out-of-scope omission represented by NO_REQUIREMENT, NOT_APPLICABLE, NON_ASSESSABLE or REPEALED when a real obligation exists.
3. Require a supported legal actor, action, development-stage predicate, canonical source locator, applicable definitions, risk conditions, qualifiers, exceptions and dates for each proposed development rule.
4. Reject false positives from deployment, operational use, commercial manufacturing, government authority, encouragement and optional permissions.
5. Detect mixed clauses with omitted developer duties and duplicate obligations caused by both parent clause and points.
6. Limit technical criteria to the law's actual predicate; neither a named library, API nor file is mandatory without a legal basis.
7. Keep repository evidence separate from true external performance; do not fabricate customer context.
8. Do not activate development-only output until the server's versioned scope-decision ledger and validator exist.

## Negative control corpus
Use source-independent controls: a lead-in that governs several points versus a standalone obligation; a mixed developer/operator clause; a statutory permission versus a duty; a public-authority power versus a private obligation; Vietnamese Unicode point đ; a section heading accidentally joined to the preceding clause; and unresolved, expired or stale references. Named-law examples belong exclusively to source-pinned evaluation cases.

## Output
Review gate report with source coverage, retainedDevelopment, splitMixed, excludedStages, materialContext, errors, unresolved and gateOutcome. A PASS applies to the selected target/version, not to the whole law.

## Source-level acceptance examples and decision checks

A positive candidate is not approved merely because its topic is security or data quality. For every selected development criterion, capture a source-to-proposition trace: pinned legal source version, exact canonical locator, cited text, operative actor, action and modality, source-defined risk/cohort condition, material ancestor chain, and any external-fulfillment limitation. A rule with a missing operative source or a criterion invented from a framework fails semantic review even when syntactically valid.

**Must keep:** a provider's actual design-time safety obligation even if a clause sets a deadline before commercial use; a developer's separate duty when a clause also addresses operators or users; the scope/risk threshold in a parent lead-in.

**Must exclude from a development output:** a duty that belongs exclusively to an operational actor, an administrative power held by a public authority, an optional sandbox permission, or a voluntary recommendation. Exclusion from product scope never means the legal duty is repealed.

**Must split:** a mixed clause with separately regulated technical development and commercial operation. Keep every operative source claim in the full ledger, attach the correct context, and present only the developer-facing part in a properly validated projection.

**Negative controls:** camera/video with bounding boxes is not automatically synthetic AI-generated audiovisual output; the legal source's content category and pipeline facts control transparency duties. A missing file in a repository cannot prove that an organizational approval, report, notification or physical act was never performed. An unresolved role/trigger requires investigation or human review later, not automatic APPLICABLE or NOT_APPLICABLE.

If the scope ledger, server validation and human approval are absent, report **REVIEW_REQUIRED**, not a successful development-only activation. The listed outcomes are review labels, not existing API enums.

## Deployment-context leak gate

A DEVELOPMENT_ONLY output fails if any deployment-only Article/clause/point, operational task, use-stage criterion or unrelated deployment narrative remains in its rule list or model-facing context. A dependency may survive only as a minimal source-backed definition, scope condition, exception, timing or legal effect with a verified directed edge to an included development claim.

A pending/unknown context edge does not satisfy the exception. If a mixed clause has not yet been atomized, flag REVIEW_REQUIRED and do not publish its raw mixed text in the development review view. Check the absence of suppressed sourceText, not merely the absence of operational AssessmentRule IDs.
