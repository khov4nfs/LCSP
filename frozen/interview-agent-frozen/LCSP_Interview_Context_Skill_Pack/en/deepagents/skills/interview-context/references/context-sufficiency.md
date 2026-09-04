# Context Sufficiency

Use this reference for READY / RESOLVED / unresolved decisions.

Read `terminology-contract.md` first if `material`, `customer-owned`, `bounded`, or `sufficient` is unclear.

## Core principle

Sufficiency is not completeness.

Do not fill a Business Fact Catalog.

The question is whether a **material customer-owned uncertainty** still needs clarification at the current boundary.

## Counterfactual Materiality Test

For a candidate uncertainty:

1. Imagine plausible Customer answer **A**.
2. Imagine a meaningfully different plausible answer **B**.
3. Compare the effects.

The uncertainty is material now if A vs B would change at least one of:

- a handoff-relevant normalized business fact;
- Initial Interview readiness/resolution;
- the relevance, meaning, or priority of another material frontier;
- interpretation of a consequential business action/decision;
- Investigator continuation eligibility;
- whether downstream work may require reconsideration.

Descriptive detail alone is not material merely because stored text would differ.

If none changes, the distinction is probably not material now.

This test guides reasoning. It is not a fixed questionnaire.

## Initial Interview (`PRE_PLANNER` runtime alias)

Question:

> Is there any open material customer-owned uncertainty that reasonably needs clarification before Interview hands off to the EngineeringRule stage?

### `CONTEXT_READY` requires all of:

- no open material customer-owned uncertainty needs clarification now;
- no Protected Sufficiency Guardrail remains unsatisfied;
- asking another question would only add non-material detail or generic completeness.

### Protected Sufficiency Guardrails — Must Not Ready

Do **not** return `CONTEXT_READY` when any of these remain true:

1. an open material + customer-owned uncertainty remains;
2. readiness depends on a non-trivial Customer interpretation that is not confirmed;
3. a material evidence/Customer conflict remains unresolved or unpreserved as blocking uncertainty;
4. stale/invalid evidence is being used to justify readiness;
5. documentary evidence is being treated as Customer-confirmed operational reality;
6. a known technical coverage limitation leaves a handoff-relevant business frontier materially unknowable/unsafe to assume;
7. readiness requires inventing a business assumption.

These are generic invariants, not domain-specific required fields and not a fixed questionnaire.

### Continue Initial Interview when any of:

- different plausible Customer answers would materially change stored business meaning;
- current interpretation requires an unsupported business assumption;
- a consequential action/status has unclear operative meaning;
- a material direct statement is still hedged/ambiguous;
- a material conflict/correction needs clarification.

## Investigator resolution

Question:

> Has the supplied `businessContextNeed` been established to the specificity required by the originating investigation?

### `CONTEXT_RESOLVED` requires all of:

- the exact `businessContextNeed` is established;
- the supplied business-operational `resolutionCriteria` is satisfied;
- the required bounded context is `CUSTOMER_CONFIRMED`;
- directly coupled ambiguity no longer changes the interpretation;
- the originating investigation reference/runtime remains valid for Orchestration to evaluate resume.

If the Customer cannot establish the requested business reality:

```text
BLOCKED_OR_UNRESOLVED
```

Do **not** return `CONTEXT_RESOLVED` merely because the Agent asked enough times.

## False-ready traps

Do not return READY/RESOLVED merely because:

- a field contains text;
- the Customer answered once;
- evidence strongly suggests the answer;
- a similar assessment had a common pattern;
- a Verified Episode suggests a likely answer;
- the Agent wants fewer turns;
- most attention dimensions are known.

## Over-interview traps

Stop asking when:

- A vs B would not change current business meaning/readiness/continuation;
- the topic is already explicit and confirmed;
- the question is only “nice to know”;
- PGE can establish the technical fact directly and no business meaning is missing;
- the question belongs to EngineeringRule/legal evaluation rather than business context;
- Investigator's bounded need is already resolved.

## Examples

### Material

PGE:

```text
AI-generated price
→ customer invoice draft
```

Unknown:
- price is automatically sent to customer; or
- employee reviews/edits before sending.

Different answers change the operative business action.

Material: yes.

### Probably non-material now

Customer already confirms:
- report is internally reviewed;
- a human submits it to the regulator.

Unknown:
- whether the reviewer usually checks in the morning or afternoon.

No meaningful change to stored business meaning/readiness.

Material: no.

### Investigator unresolved

Investigator needs:
> whether an account restriction takes effect immediately or after analyst approval.

Customer:
> “I don't know; another team owns that.”

Result:
`BLOCKED_OR_UNRESOLVED`, not `CONTEXT_RESOLVED`.


### Non-material descriptive detail

Customer confirms a required review happens before submission.

Unknown:
- reviewers usually perform it in the morning or afternoon.

Unless timing-of-day changes the handoff semantics, this is descriptive detail only.

Do not ask it.


## Technical coverage and sufficiency

Coverage state is not a substitute for business reasoning.

```text
READY
→ normal reasoning

PARTIAL
→ preserve limitations
→ absence in PGE is not absence in business reality
→ READY is still possible if no handoff-relevant material uncertainty remains

UNAVAILABLE
→ Orchestration recovery before Interview
```

A partial coverage limitation blocks readiness only when it leaves a handoff-relevant Customer-owned uncertainty materially unresolved/unsafe to assume.
