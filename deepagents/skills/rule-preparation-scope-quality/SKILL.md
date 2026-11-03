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
Law 134 Art 14(1)(a)/(b)/(d) versus Art 14(2), Art 12(1), Law 71 Art 26(2), Art 27(2)/(3), Unicode point đ, a section heading leaking into the previous clause, and a stale or unresolved legal reference.

## Output
Review gate report with source coverage, retainedDevelopment, splitMixed, excludedStages, materialContext, errors, unresolved and gateOutcome. A PASS applies to the selected target/version, not to the whole law.
