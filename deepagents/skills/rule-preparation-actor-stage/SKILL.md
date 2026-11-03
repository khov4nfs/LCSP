---
name: rule-preparation-actor-stage
description: Classify legal actors and responsibility stages before selecting development-related assessment rules.
---

# Legal actor and activity-stage classification

## Inputs
Use only a pinned LegalSourceVersion, exact source node, canonical Điều/Khoản/Điểm, ancestor lead-in, qualifiers, exceptions and references. The assessment target scope is server-owned. Do not read repositories, customer data or assessments.

## Procedure
1. Extract the precise legal addressee, modality, action, object, trigger and timing for each operative proposition.
2. Distinguish developer, provider, deployer, user, government body and commercial manufacturer. A provider's obligation may require built-in development work even when it refers to later use; do not equate the legal roles.
3. Identify regulated stage: architecture, design, software/model development, data/model preparation, training, tests, integration and built-in safeguards, versus deployment, ongoing production operations, use, publication of outputs, industrial manufacture, or state management.
4. Classify the *proposition*, not the whole article, as DEVELOPMENT_CANDIDATE, SPLIT_DEV_AND_NONDEV, CONTEXT_ONLY_IF_LINKED, EXCLUDE_FROM_DEV_CATALOG or LEGAL_REVIEW_REQUIRED.
5. Record source quote, actor, regulated act, legal trigger, scope rationale and every material context dependency. Unknown legal meaning is for legal review.

## Negative controls
- "Development of national infrastructure" is not automatically a developer obligation.
- A provider's pre-use safeguard can belong to the development target despite mentioning deployment.
- Do not turn a deployer's post-release operation into a developer DUTY.
- Do not turn non-development scope exclusion into NOT_APPLICABLE, REPEALED or NO_REQUIREMENT.

## Output
A review-only decision with sourceNodeId, canonicalLocator, actor, modality, activity, stage, decision, exactSupport, materialContext and reviewStatus. This is not a new claim type or persisted activation permission.
