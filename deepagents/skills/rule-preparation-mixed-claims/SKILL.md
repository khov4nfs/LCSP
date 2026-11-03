---
name: rule-preparation-mixed-claims
description: Atomize multi-actor and multi-modality legal clauses while retaining the ancestor scope and legal relations.
---

# Mixed legal proposition decomposition

## Inputs
Whole pinned Article including clause lead-in, each point and all supporting definitions, legal effects and cross references.

## Procedure
1. Identify every operative proposition as actor, modality, act, object, trigger, qualifier, exception and temporal branch; quote the relevant source.
2. Encode real claim types only: DUTY, PROHIBITION, PERMISSION, DEFINITION, SCOPE, CONDITION, QUALIFIER, EXCEPTION, CROSS_REFERENCE, TEMPORAL_RULE, TRANSITION_RULE, CONTEXT. The development-scope classification is *metadata*, not a claim type.
3. Split a clause containing permission and duty, multiple actors or distinct legal stages into separately supported claims; do not erase any legal obligation, even if operation-only.
4. Bind modifiers to the specific claims they alter via CONDITION_OF, QUALIFIES, EXCEPTION_TO, TEMPORALLY_APPLIES_TO, DEFINED_BY and other valid relations. Inherit scope from the parent, never copy it as another operative duty.
5. For MIXED assessability, retain both repositoryObservableAspect and externalFulfillmentAspect. Repository observability cannot substitute for actual physical, organizational or administrative performance.
6. For the scoped catalog, show the development portion only after a server-approved projection. Keep the other operative claims in the full-source ledger.

## Negative controls
Law 134 Art 10(2): permission to inherit classification and duties must remain distinct. Law 134 Art 12(1): the developer cannot be dropped because user/deployer also appears. Law 134 Art 14(1) source lead-in cannot be counted as a duplicate duty alongside points a/b/d.

## Output
Typed claims, exact support, graph relations, stage classification, unresolved cases and an auditable mapping back to each canonical source locator.
