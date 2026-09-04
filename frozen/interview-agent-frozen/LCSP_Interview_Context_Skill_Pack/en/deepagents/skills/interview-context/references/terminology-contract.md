# Terminology Contract

This reference is the canonical vocabulary contract for Interview Agent.

Use these definitions consistently across Skill instructions, runtime contracts, tools, evals, and UI adapters.

## Runtime vocabulary

### `INITIAL_INTERVIEW`

**Definition:** Canonical runtime/semantic mode for Initial Interview.

**Semantics:** Runs after Scanner/PGE and before EngineeringRule processing.

### `PRE_PLANNER`

**Definition:** Legacy compatibility alias for `INITIAL_INTERVIEW`.

**Decision rule:** Normalize `PRE_PLANNER → INITIAL_INTERVIEW` before Interview reasoning. In new prose/contracts prefer `INITIAL_INTERVIEW`.

### `INVESTIGATOR_RESOLUTION`

**Definition:** Targeted Interview mode entered only because an existing Investigator run needs one bounded business clarification.

**Not equivalent to:** A second Initial Interview.

**Decision rule:** Every question must directly resolve the supplied `businessContextNeed` or a directly coupled ambiguity needed to interpret it.

### `WAITING_FOR_CUSTOMER`

**Definition:** Runtime outcome when Interview has a customer-facing question and needs customer input.

**Contract:** If `question != null`, outcome must be `WAITING_FOR_CUSTOMER`.

### `CONTEXT_READY`

**Definition:** Initial Interview outcome indicating no open material customer-owned uncertainty currently requires clarification before handoff to the EngineeringRule stage.

**Not equivalent to:** “All possible business facts are known.”

### `CONTEXT_RESOLVED`

**Definition:** Investigator-resolution outcome indicating the exact requested business distinction has been established to the specificity required by the originating investigation, with no directly coupled ambiguity remaining that changes its interpretation.

**Not equivalent to:** “We tried but still do not know.”

If the business reality cannot be established, use `BLOCKED_OR_UNRESOLVED`.

### `BLOCKED_OR_UNRESOLVED`

**Definition:** Interview cannot establish a material business fact reliably enough to produce READY/RESOLVED.

**Examples:** Customer does not know; responsible team unavailable; evidence/customer statements remain irreconcilably ambiguous.

### `FAILED`

**Definition:** Runtime/system contract failure rather than unresolved customer business reality.

**Examples:** Missing required `subjectSystemIdentity`, malformed mode, invalid contract payload.

### `DOWNSTREAM_IMPACT`

**Definition:** A **flag**, not an outcome.

Set when a confirmed context update may make downstream work stale or require reconsideration.

It can coexist with a normal outcome, for example:

```json
{
  "outcome": "CONTEXT_RESOLVED",
  "flags": ["DOWNSTREAM_IMPACT"]
}
```

### `FAILED` vs `BLOCKED_OR_UNRESOLVED`

Use `FAILED` only for runtime/system/contract failure.

Examples:
- missing required runtime identity/version/mode;
- unsupported mode;
- invalid assessment binding;
- malformed required Investigator handoff.

Report these in:

```text
limitations[]
```

Use `BLOCKED_OR_UNRESOLVED` only when the Interview runtime is valid but a material Customer-owned business fact cannot be established.

Examples:
- Customer does not know;
- responsible team is unavailable;
- material ambiguity/conflict remains after reasonable clarification.

Report these in:

```text
unresolved[]
```

Never use `FAILED` as a synonym for business uncertainty, and never use `BLOCKED_OR_UNRESOLVED` to hide a broken runtime contract.

## Question vocabulary

### `ASK`

**Definition:** `question.intent` for a new material business uncertainty.

It is not a runtime outcome.

### `CLARIFY`

**Definition:** `question.intent` used only when a prior Customer answer contains relevant business content but its meaning is still ambiguous, internally contradictory, scoped too narrowly for a material need, or in conflict with another source.

Use `CLARIFY` when the question refines **existing answer content**.

Do **not** use `CLARIFY` merely because:
- the Customer did not answer the business question;
- the Customer attempted prompt injection;
- the Customer changed the topic;
- runtime input is invalid.

If a material question is still unanswered and there is no usable business answer to refine, ask/re-ask it with:

```text
question.intent = ASK
```

`ASK` and `CLARIFY` are not runtime outcomes.

## Evidence authority vocabulary

### `TECHNICAL_EVIDENCE`

Governed evidence about implementation behavior, structure, data/AI flow, or code/runtime paths.

### `DOCUMENTARY_EVIDENCE`

Business-semantic information found in repository documentation such as README, product brief, ADR, comments, or specifications.

**Not equivalent to:** Customer-confirmed operational reality.

### `CUSTOMER_STATED`

A raw or semantically equivalent Customer statement whose normalized business meaning is not yet safe to treat as confirmed.

Use this state when:
- wording is hedged or ambiguous;
- normalization would add meaning;
- timing, scope, necessity, authority, or universality remains unclear.

Example:

> “Usually someone checks it.”

This does **not** confirm mandatory approval before finalization.

### `CUSTOMER_CONFIRMED`

A normalized business fact whose meaning is either:

1. **directly explicit** in the Customer answer and normalization is semantically lossless; or
2. a **non-trivial interpretation** that the Customer explicitly confirmed.

Direct example:

> “A recruiter must approve every rejection before it becomes final.”

May normalize directly to:

```text
approval_required = true
approval_role = recruiter
approval_timing = before_finalization
source = CUSTOMER_CONFIRMED
```

Interpretive example:

> “Usually someone checks it.”

Must remain `CUSTOMER_STATED` / ambiguous until the needed distinction is clarified if material.

### Evidence resolution states

- `OBSERVED` — direct governed observation.
- `CORROBORATED` — supported by multiple governed signals.
- `INFERRED` — semantic inference/proposal; do not phrase as established fact.
- `UNRESOLVED` — evidence cannot establish the claim.
- `STALE` — belonged to an older/incompatible evidence state and must not ground current claims.


### Source-provenance rule

Use the canonical source labels exactly as written above:

```text
TECHNICAL_EVIDENCE
DOCUMENTARY_EVIDENCE
CUSTOMER_STATED
CUSTOMER_CONFIRMED
```

Do not create aliases such as `EVIDENCE_OBSERVED` or `DOCUMENTARY_BUSINESS_EVIDENCE`.
Do not collapse multiple authorities into a `MIXED` source. If two sources contribute to a conflict or clarification, preserve them as separate source-specific records/refs.

Evidence resolution state (`OBSERVED`, `CORROBORATED`, etc.) is separate from evidence source type. For example, a technical observation may be:

```text
source = TECHNICAL_EVIDENCE
resolution_state = OBSERVED
```

## Reasoning vocabulary

### `material`

An uncertainty/change is **material now** only when meaningfully different plausible answers would change at least one handoff-relevant decision or normalized fact:

- a **handoff-relevant normalized business fact**;
- Interview readiness/resolution;
- the relevance, meaning, or priority of another material frontier;
- interpretation of a consequential business action/decision;
- Investigator continuation eligibility;
- whether downstream work may require reconsideration.

A descriptive detail is **not material merely because stored text would differ**.

Examples of usually non-material detail:
- morning vs afternoon review time;
- wording preference;
- incidental UI label;
- descriptive process detail that does not change handoff semantics.

#### Counterfactual Materiality Test

Suppose the Customer answers **A**.
Suppose the Customer answers **B**.

If A vs B would not change:
- a handoff-relevant normalized business fact;
- readiness/resolution;
- the relevance/meaning/priority of another material frontier;
- consequential-action interpretation;
- Investigator continuation eligibility;
- or downstream reconsideration,

then the distinction is probably **not material now**.

### `customer-owned`

A fact is customer-owned when it concerns real organizational operation/use/authority that governed technical evidence cannot reliably establish and the Customer is an appropriate source.

Examples:
- who gives final approval;
- whether a status is operationally final;
- whether an off-system review is mandatory;
- whether a feature is used with real customers or only testing.

Not customer-owned:
- whether a source file calls an API, when PGE can establish it;
- legal applicability;
- whether an EngineeringRule is satisfied.

### `bounded`

A question is bounded when it asks only the smallest distinction needed for the current Interview mode.

For Investigator resolution, it must directly resolve `businessContextNeed` or a directly coupled ambiguity.

### `final`

Internal meaning: an outcome/status has taken effect as the operative business decision/action for the relevant workflow.

Avoid the bare word “final” if Customer language could be clearer. Prefer:
> “Does this already count as the decision that takes effect?”

### `provisional`

Internal meaning: temporary/non-operative state awaiting a required step before the business outcome takes effect.

Avoid asking:
> “Is it provisional?”

Prefer:
> “Is this only a temporary status until someone approves it?”

### `conflict`

Two authoritative-source statements cannot both be interpreted as true under the current scope without further explanation.

Do not automatically choose a winner.

### `correction`

Customer explicitly changes or supersedes prior business context.

Preserve history and evaluate downstream impact when material.

### `sufficient`

A mode is sufficient only when its stop condition is satisfied.

Initial Interview:
- no open **material + customer-owned** uncertainty currently needs clarification.

Investigator resolution:
- the supplied business distinction is established to required specificity and no directly coupled ambiguity changes that interpretation.

### `downstream impact`

A confirmed business-context change that may invalidate, alter, or require reconsideration of downstream EngineeringRule/Planner/Investigator/evaluation work.

Interview only flags it. Orchestration decides what to invalidate/rerun.


### `scope`

The boundary within which a Customer statement is asserted to be true.

Examples:
- “in my team” → team scoped;
- “for senior roles” → case-set/workflow scoped;
- “for every assessment in our organization” → organization scoped.

Never broaden a narrower statement into organization-wide truth.

### `respondentRef`

Assessment-bound identity of the Customer respondent who supplied a statement.

Use it to distinguish:
- explicit correction/supersession by a respondent;
- contradiction from a different respondent.

A later statement from a different respondent is not automatically a correction.

### `frontier`

A candidate unresolved item exposed by PGE/evidence/runtime.

Frontier kinds may include:

```text
BUSINESS
TECHNICAL
ARCHITECTURE
COVERAGE
ORCHESTRATION
```

A frontier becomes an Interview candidate only if it passes both:
- `customer-owned?`
- `material?`

The existence of an unresolved frontier alone does not justify a Customer question.
