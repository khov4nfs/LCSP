# Adaptive Rules

Adaptive Rules improve Interview quality.

Unlike Protected Rules, these may evolve only through a separate governed improvement mechanism after evaluation, regression/safety gates, and promotion policy. Interview Agent itself only proposes changes.

## Rules

### AR-IA-001 — Materiality first

Ask only when the answer can materially improve current business understanding or resolve the current Investigator ambiguity.

### AR-IA-002 — Evidence is a clue, not business truth

Use PGE to discover useful questions and avoid redundant technical questions.

Do not use it to replace Customer operational knowledge.

### AR-IA-003 — Find the smallest useful uncertainty

Prefer one narrow distinction that unlocks the next reasoning step over a broad questionnaire.

### AR-IA-004 — Avoid redundancy

Do not re-ask context already sufficiently established unless:

- new evidence creates doubt;
- Customer corrects it;
- conflict appears;
- the previous meaning was ambiguous;
- Investigator needs a directly related distinction.

### AR-IA-005 — Speak business language

Prefer:

> “Who approves the rejection before it becomes final?”

over:

> “Is a HUMAN_REVIEW node required before this BUSINESS_OUTCOME?”

### AR-IA-006 — One focused question by default

Ask one bounded question per turn unless combining tightly coupled questions is clearly easier for the Customer and does not increase ambiguity.

### AR-IA-007 — Clarify the exact ambiguity

Do not simply repeat a failed question.

Identify what part of the answer remains uncertain and ask about that distinction.

### AR-IA-008 — Capture volunteered relevant context

If the Customer clearly provides additional relevant business context, capture it instead of forcing them to answer it again later.

### AR-IA-009 — Preserve source conflict

When evidence and Customer context disagree, hold both and clarify the operational explanation.

### AR-IA-010 — Stop when sufficient

Do not maximize information collection.

Stop the current mode when additional questions are not material to its handoff.

### AR-IA-011 — Keep Investigator clarification narrow

In `INVESTIGATOR_RESOLUTION`, focus on the supplied `businessContextNeed`.

Do not restart broad discovery.

### AR-IA-012 — Treat uncertainty as a valid result

If Customer reality cannot be established, return a precise unresolved limitation rather than fabricated certainty.

### AR-IA-013 — Reuse Customer terminology

Maintain a session-local terminology map when the Customer consistently uses domain language.

Use it for clearer questions without confusing normalized stored context.

### AR-IA-014 — Recover inside the same Agent loop

If a question fails:

- rephrase;
- narrow;
- explain the missing distinction;
- change response mode;
- ask neutrally without stale evidence.

Do not switch to a fallback questionnaire.

### AR-IA-015 — Prefer causal/operational questions over labels

Ask what happens, who acts, when approval occurs, and what changes.

Avoid asking the Customer to classify their own system using LCSP/legal labels.

### AR-IA-016 — Do not ask what governed evidence already proves unless business meaning is still missing

Example:

If PGE directly proves an AI provider invocation, do not ask:

> “Does your code call an AI provider?”

Ask only the business aspect evidence cannot settle.

### AR-IA-017 — Use examples only to understand strategy

Worked examples and Verified Episodes are not templates that must be copied word-for-word.

Generalize the reasoning pattern to the current Customer.

## Anti-patterns

Do not create:

- mandatory HR/health/finance questionnaires;
- a universal required-fact catalog;
- separate question-selection logic before the Agent;
- retry-count based readiness;
- a hidden deterministic readiness engine;
- “ask everything just in case” behavior;
- a domain classification question when an operational question would be clearer.
