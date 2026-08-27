---
name: legal-rule-triage
description: Use when reviewing approved LegalRule chunks to decide whether they can become reusable EngineeringRules and when translating accepted candidates into bounded, evidence-verifiable engineering investigation rules.
---

# Legal Rule Triage and EngineeringRule Conversion

Use this skill only in LCSP legal-data preparation. The goal is not to decide whether a customer is compliant. The goal is to decide whether an approved legal chunk expresses a sufficiently concrete obligation to justify an EngineeringRule, then preserve that legal intent while translating the candidate into a reusable technical investigation contract.

## Core boundary

Keep these decisions separate:

1. **Legal applicability** asks whether a LegalRule applies to a particular Assessment. Triage does not answer this.
2. **Legal chunk triage** asks whether a referenced legal chunk is suitable source material for a technical rule.
3. **EngineeringRule compilation** translates only accepted candidates into reusable technical investigation rules.
4. **Investigation and compliance evaluation** later test a pinned EngineeringRule against customer evidence. Triage and compilation do not issue COMPLIANT, NON_COMPLIANT, or risk verdicts.

Never use Assessment business context, customer source code, repository findings, or prior compliance outcomes to make the triage decision. Triage must remain reusable across Assessments.

## Decision procedure

For every approved LegalRule chunk, reason in this order.

### 1. Establish the legal proposition

Identify the smallest proposition actually stated by the chunk:

- **actor** — who has the duty, prohibition, permission, or responsibility;
- **modality** — must, must not, shall, required to, permitted to, or equivalent;
- **action/control** — what must exist, happen, be prevented, recorded, reviewed, retained, disclosed, monitored, or governed;
- **condition/trigger** — when or under what circumstance it applies;
- **timing/order** — before, after, continuously, on request, within a period, before a final decision, etc.;
- **object/outcome** — what system behavior, control, record, information, or safeguard the requirement concerns.

Do not add a proposition that the text does not contain.

### 2. Apply the concreteness test

A chunk is a strong EngineeringRule candidate only when the legal proposition can be translated into something that technical evidence could support or refute.

Ask:

1. Is there a specific obligation or prohibition, not merely a topic or principle?
2. Can the obligation imply an observable control, flow, state, record, configuration, or operational mechanism?
3. Can an investigator describe what positive evidence would support the control?
4. Can an investigator describe what negative evidence or absence would matter without treating missing evidence as automatic proof of violation?
5. Can the obligation be tested without inventing Assessment-specific facts?

If the answer to these questions is materially incomplete, do not promote the chunk merely because it contains words such as AI, risk, transparency, security, privacy, monitoring, or human control.

## Classification rules

### ENGINEERING_RULE_CANDIDATE

Use only when the chunk contains a concrete operational or technical obligation that can lead to bounded evidence investigation.

Typical evidence-verifiable obligations include:

- required human review before a consequential action;
- ability for a human to intervene, reject, override, or stop an AI-driven action;
- audit logging or traceability requirements;
- monitoring, incident handling, retention, access control, reporting, safety checks, or data-governance controls;
- required disclosure or information presentation where implementation evidence can be inspected;
- explicit process ordering such as review-before-release or approval-before-finalization.

For a Candidate, produce:

- a short grounded reason;
- one concise **engineering obligation** that preserves the legal meaning;
- concrete **verification targets** describing evidence surfaces to investigate.

The engineering obligation is a bridge to compilation, not a compliance conclusion.

### CONTEXT_ONLY

Use when the chunk helps interpret the law but does not itself establish a sufficiently concrete technical obligation.

Examples:

- definitions and terminology;
- scope or applicability explanation;
- general principles or policy objectives;
- broad statements such as “ensure appropriate oversight” without an operative requirement explaining what oversight must do;
- explanatory text that supports another operative clause.

Context can support interpretation of a Candidate, but context must not become its own EngineeringRule merely because it uses technically suggestive language.

### REJECT

Use when the chunk is not useful substantive source material for EngineeringRule preparation.

Examples:

- headings, chapter titles, signatures, document boilerplate;
- navigation or formatting fragments;
- preamble text with no operative or interpretive value for the rule being prepared;
- corrupted or clearly unrelated text.

### Insufficient basis / review needed

“Needs review” is not a fourth final classification. When the text is too ambiguous to classify reliably, do not manufacture certainty. Preserve the limitation in the reason/handoff and fail closed rather than promoting the chunk to Candidate. A workflow that supports a review-needed state should route it there; a workflow with only final verdicts must not disguise uncertainty as technical certainty.

## Candidate-to-EngineeringRule conversion

Compile only chunks that passed both the deterministic normative gate and LLM triage.

For each Candidate:

### Preserve legal intent

- Keep the actor, required action/control, condition, and timing from the source.
- Do not strengthen “reasonable” into “absolute”, “may” into “must”, or a general objective into a mandatory technical mechanism.
- Do not narrow a legal requirement to one library, framework, cloud provider, or coding pattern unless the legal source explicitly requires it.

### Split by independently testable control

Create separate EngineeringRules when a legal chunk contains multiple controls that could be investigated independently.

Example: a clause requiring both **human review before final action** and **ability to override the AI output** may justify two investigation goals or separate EngineeringRules when their evidence surfaces differ.

Do not split one obligation into many near-duplicate rules merely because several keywords are present.

### Translate into evidence questions

An EngineeringRule should answer: **what technical facts must an investigator establish?**

Derive:

- `concept` — stable technical concept, not a legal verdict;
- `legalIntent` — bounded representation of the source obligation;
- `investigationGoals` — precise questions the evidence investigation must answer;
- `startingNodeTypes` / `targetNodeTypes` — only vocabulary supported by LCSP graph schema;
- `edgeStrategies` / `graphQueries` — bounded traversal strategy, not prose disguised as edge names;
- `keywords`, `commonApis`, `commonLibraries`, `patterns` — discovery hints only;
- `requiredEvidence` — facts necessary to evaluate the control;
- `supportingEvidence` — useful corroboration that is not independently sufficient;
- `negativeEvidence` — bounded evidence that may support absence of a control;
- `unresolvedConditions` — dynamic behavior, external systems, configuration, runtime state, or legal ambiguity that static evidence may not resolve.

Keywords and common libraries are never proof by themselves.

## Evidence reasoning discipline

Use these distinctions:

- **Positive evidence target**: what implementation artifact could demonstrate the required control exists.
- **Negative evidence target**: what bounded search result could support that the control is missing.
- **Limitation**: what the available evidence cannot establish.

Never convert “not found” into “does not exist” unless the search boundary is complete and the deterministic evaluator permits that inference.

## Traceability requirements

Every resulting EngineeringRule must remain traceable to:

- the exact `legalRuleId`;
- the exact source chunk IDs and locators;
- the legal corpus/catalog versions;
- the source fingerprint and prompt/compiler versions.

Do not merge unrelated chunks in a way that makes it impossible to identify which legal proposition created a technical requirement.

## Decision examples

### Human oversight — Candidate

Legal meaning: a human must be able to review and intervene before an AI-driven final decision.

Decision: `ENGINEERING_RULE_CANDIDATE`.

Engineering obligation: preserve a human review/intervention control before consequential finalization.

Useful verification targets: approval/rejection gates, override paths, review state transitions, authorization checks, audit trail of the intervention.

### General oversight principle — Context Only

Legal meaning: systems should ensure appropriate human oversight, with no operative detail.

Decision: `CONTEXT_ONLY` unless another referenced clause supplies the concrete obligation.

Reason: topic and intent are relevant, but the chunk does not yet define a bounded control that technical evidence can verify.

### Definition of AI system — Context Only

Decision: `CONTEXT_ONLY`.

Reason: terminology may support interpretation but does not itself require an implementation control.

### Chapter title / signature — Reject

Decision: `REJECT`.

Reason: no substantive legal proposition for technical preparation.

## Final self-check before emitting a decision

Before returning a Candidate or EngineeringRule, verify:

- Am I using only approved legal content supplied to this run?
- Did I identify an actual obligation rather than a keyword or topic?
- Can I name observable evidence surfaces without reading customer evidence now?
- Did I preserve the legal strength, condition, and timing instead of inventing them?
- Did I separate context from operative requirements?
- Did I avoid a compliance/applicability/risk verdict?
- Can every technical requirement be traced back to exact legal chunks?
- Did I record uncertainty instead of filling gaps with assumptions?

If any answer is no, narrow the output or fail closed.