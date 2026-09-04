# Question Strategy

Use this reference to choose, phrase, rephrase, and structure Customer questions.

## Objective

Ask the smallest understandable question that resolves the highest-value current business uncertainty.

## Selection procedure

Before asking:

1. identify the open uncertainty;
2. run the Counterfactual Materiality Test;
3. confirm the fact is customer-owned;
4. confirm it is not already explicit/confirmed;
5. inspect relevant evidence/history;
6. choose the simplest customer-facing wording;
7. choose a response mode that does not distort meaning.


## Prioritizing multiple material uncertainties

If more than one candidate question passes the materiality/customer-owned test, do not choose arbitrarily. In Initial Interview, prefer the question that most directly changes the meaning of a consequential real-world action or decision.

Use this tie-breaker only after every candidate has already passed the materiality and customer-owned tests:

1. **dependency/branching blocker** — ask an uncertainty first when its answer changes the meaning, relevance, or priority of other material uncertainties;
2. unresolved authority/timing/effect of a consequential business action or decision;
3. a material conflict or ambiguity in context that is already being relied on;
4. whether the feature is actually used in the relevant real-world/customer workflow;
5. material data/deployment/operational scope needed for the handoff;
6. other material business context.

Within the same level, prefer the smallest question with the strongest current evidence grounding and highest expected reduction of material uncertainty.

This is a default prioritization heuristic, not a required-fact catalog. A dependency/branching blocker wins when resolving it determines whether another frontier is relevant at all. Do not force category ordering when the assessment context makes another uncertainty truly more consequential. In `INVESTIGATOR_RESOLUTION`, the supplied `businessContextNeed` always takes priority.

## Internal vocabulary must not leak

| Internal concept | Avoid asking Customer | Prefer |
| --- | --- | --- |
| operational authority | “What is the operational authority?” | “Does this result itself count as the decision that takes effect, or does someone decide after reviewing it?” |
| provisional | “Is it provisional?” | “Is this only a temporary status until someone approves it?” |
| downstream action | “Does it trigger downstream actions?” | “After this result is produced, does the system automatically do anything else?” |
| affected subject | “Who are the affected subjects?” | “Who can be affected by this decision or action?” |
| human oversight | “Is there human oversight?” | “Does someone need to review or approve it before it takes effect?” |
| deployment context | “What is your deployment context?” | “Who uses this system in practice—only your organization, separate customer organizations, or both?” |
| businessContextNeed | “Please resolve the businessContextNeed.” | Ask the actual operational distinction. |
| material | “Is this material?” | Ask the underlying real-world fact, never the internal label. |

## Response modes

### `BOOLEAN`

Use only for a genuinely binary operational fact where nuance is not being hidden.

Example:
> “Is approval required before this action takes effect?”

### `SINGLE_SELECT`

Use when:
- choices are mutually exclusive;
- the set represents the real plausible meanings;
- the Customer can understand them.

If the set may be incomplete, add:
> “Other / describe”

Example:

```text
What happens when the AI-generated price is created?
A. It is sent to the customer automatically.
B. A person must review/edit it before sending.
C. It depends on the case.
D. Other / describe.
```

### `MULTI_SELECT`

Use when multiple roles/steps can simultaneously be true.

### `FREE_TEXT`

Use when workflow/process nuance cannot be represented safely by fixed choices.

## One focused question

Default:
```text
question_count = 1
```

Combine only tightly coupled distinctions when separate questions would make interpretation worse.

Do not render a generic questionnaire.

## `ASK` vs `CLARIFY`

Use:

```text
question.intent = ASK
```

for a new material uncertainty.

Use:

```text
question.intent = CLARIFY
```

when refining a prior answer or conflict.

These are not runtime outcomes.

## Direct statement — do not over-confirm

Customer:

> “A recruiter must approve every rejection before it takes effect.”

Do not ask:

> “Just to confirm, is recruiter approval mandatory?”

The statement is explicit enough for lossless normalization to `CUSTOMER_CONFIRMED`.

## Ambiguous statement — clarify

Customer:

> “Usually someone checks it.”

Do not infer mandatory approval.

Ask:
> “When they check it, do they need to approve the action before it takes effect, or do they review it afterward?”

## Avoid leading questions

Bad:
> “Which recruiter approves the AI rejection?”

Better:
> “Before a rejection takes effect, does anyone need to approve it?”

## Avoid technical facts Customer should not have to provide

If PGE directly establishes an external-model call, do not ask:
> “Does the code call an external model?”

Ask only missing operational meaning, for example:
> “Is that feature used with real customer data, only internal test data, or both?”

## Why are we asking?

Use:
```text
what LCSP observed
+
what implementation cannot establish
```

Example:
> “The software writes a rejected status, but code alone cannot tell us whether that status already takes effect or still needs approval.”

Do not mention EngineeringRules/legal reasoning.

## Failed question recovery

If a question fails:
- identify the exact ambiguity;
- remove jargon;
- narrow scope;
- change response mode;
- preserve hedging;
- keep unresolved if Customer cannot know.

There is no fallback questionnaire.
