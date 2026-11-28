---
name: rule-preparation-scope-quality
description: Run bounded positive and negative legal-semantic controls for unified Preparation rule sets.
---

# Unified semantic and provenance gate

## Preconditions
A fully pinned and source-accounted LegalSourceVersion; frozen or validated claims/candidates; and verified source provenance. A mock response or agent-made scope string cannot authorize activation.

## Controls
1. Preserve every source unit and every real legal duty in the authoritative ledger across development, deployment, and operation.
2. Reject any omission represented by NO_REQUIREMENT, NOT_APPLICABLE, or REPEALED when a real obligation exists.
3. Require a supported legal actor, action, normative predicate, canonical source locator, applicable definitions, risk conditions, qualifiers, exceptions and dates for each proposed rule.
4. Reject false positives from government authority, encouragement and optional permissions.
5. Detect mixed clauses with omitted duties and duplicate obligations caused by both parent clause and points.
6. Limit technical criteria to the law's actual predicate; neither a named library, API nor file is mandatory without a legal basis.
7. Keep repository evidence separate from true external performance; do not fabricate customer context.
8. Verify semantic correspondence between each AssessmentRule criterion, its parent LegalRequirement, and the pinned legal source before marking `semanticValidation` as PASSED.

## Negative control corpus
Use source-independent controls: a lead-in that governs several points versus a standalone obligation; a mixed developer/operator clause; a statutory permission versus a duty; a public-authority power versus a private obligation; Vietnamese Unicode point đ; a section heading accidentally joined to the preceding clause; and unresolved, expired or stale references. Named-law examples belong exclusively to source-pinned evaluation cases.

## Output
Review gate report with source coverage, retainedDevelopment, splitMixed, excludedStages, materialContext, errors, unresolved and gateOutcome. A PASS applies to the selected target/version, not to the whole law.

## Source-level acceptance examples and decision checks

A positive candidate is not approved merely because its topic is security or data quality. For every selected development criterion, capture a source-to-proposition trace: pinned legal source version, exact canonical locator, cited text, operative actor, action and modality, source-defined risk/cohort condition, material ancestor chain, and any external-fulfillment limitation. A rule with a missing operative source or a criterion invented from a framework fails semantic review even when syntactically valid.

**Must keep:** all system-relevant obligations across development, deployment, and operation (design-time safety, training/data governance, deployment configuration, logging, monitoring, operational controls), along with the scope/risk threshold in a parent lead-in.

**Must exclude from AssessmentRules:** an administrative power held solely by a public authority, an optional sandbox permission, a voluntary recommendation, or a purely external/physical act with no system-verifiable aspect (preserve as `NON_ASSESSABLE` with factual `nonAssessableReason`).

**Must split:** a mixed clause with separately regulated technical and external/administrative duties. Keep every operative source claim in the full ledger and attach the correct context.

**Negative controls:** camera/video with bounding boxes is not automatically synthetic AI-generated audiovisual output; the legal source's content category and pipeline facts control transparency duties. A missing file in a repository cannot prove that an organizational approval, report, notification or physical act was never performed. An unresolved role/trigger requires investigation or human review later, not automatic APPLICABLE or NOT_APPLICABLE.

## Unverified context and material link gate

An AssessmentRule fails semantic validation if any criterion relies on an unverified or unrelated Article/clause/point. A dependency may survive only as a source-backed definition, scope condition, exception, timing or legal effect with a verified directed edge to the parent LegalRequirement.

A pending/unknown context edge does not satisfy the exception. If a mixed clause has not yet been atomized, flag `LEGAL_REVIEW_REQUIRED:` and do not publish its raw mixed text.

## Additional gate — oversight mechanisms are not repository document duties

Before accepting a development AssessmentRule: (a) verify the exact source wording, ancestor lead-in and actual addressee; (b) separate public supervision/inspection from deployer operation, external organizational records and genuine developer-controlled design duties; (c) require an independently source-supported developer predicate before proposing code investigation; (d) reject duplicated criteria or invented report types, reporting cadence, retention, file paths and required-evidence checklists; (e) passive wording that a system “is supervised through reports, sample inspection or independent assessment” does not itself obligate a developer to produce or retain those documents. If an external duty has a grounded actor, preserve it as NON_ASSESSABLE without an AssessmentRule. If the actor is not established, record a legal-review gap instead of inventing one to satisfy a schema. Out-of-scope is not NOT_APPLICABLE.

## INPUT — OUTPUT — PROCESS quality check

Accept a proposed obligation only after verifying (1) **INPUT**: pinned regulated object, data category, risk/actor threshold, trigger, timing and exceptions; (2) **OUTPUT**: the actual source-required or forbidden software result, if any, distinct from a report, inspection record or other evidence artifact; and (3) **PROCESS**: the legally responsible actor, regulated lifecycle step and whether a repository can substantiate that act or external evidence is required. Unknown customer facts never silently satisfy a conditional trigger. Every criterion must trace to an independently supported parent duty; never multiply AssessmentRules by report categories, alternative oversight methods or repository file searches. Public-authority review and external processes are not automatically developer actions. Preserve proven external-only legal obligations as NON_ASSESSABLE without a repository rule; if actor/duty is not grounded, record a legal-review gap rather than creating a false LegalRequirement.
