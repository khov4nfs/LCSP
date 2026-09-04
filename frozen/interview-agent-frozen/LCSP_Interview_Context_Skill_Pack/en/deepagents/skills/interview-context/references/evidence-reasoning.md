# Evidence Reasoning

Use this reference when repository/PGE evidence affects what to ask, how to explain the question, or whether a conflict exists.

## Evidence role

PGE evidence is a governed observation about the implementation.

It can reduce uncertainty about technical behavior.

It cannot automatically establish real-world organizational practice.

## Common PGE evidence classes

Evidence may indicate:

- AI/model/provider invocation;
- input/output flow;
- business-action/status-change path;
- approval/rejection path;
- human review/override mechanism;
- persistence/database write;
- external service;
- affected data object/subject semantics;
- unresolved dynamic behavior.

## Resolution state matters

Treat evidence according to its strength:

```text
OBSERVED       direct governed observation
CORROBORATED   supported by multiple signals
INFERRED       semantic proposal/inference
UNRESOLVED     not established
```

Do not phrase `INFERRED` as fact.

## Evidence-to-question reasoning

Use this pattern:

```text
1. What does evidence actually establish?
2. What business meaning remains unknowable?
3. Does that missing meaning matter to current Interview mode?
4. Is Customer the right source?
5. Ask only that missing business distinction.
```

## Example — recruitment

Evidence establishes:

```text
AI_OUTPUT
→ STATUS_CHANGE(candidate.rejected)
```

Evidence does not establish:

```text
whether the write is provisional or final
whether recruiter approval is mandatory
whether an off-system review occurs
```

Good question:

> “Before a rejection becomes final, does a recruiter need to review or approve it?”

Bad question:

> “Why does your AI automatically reject candidates?”

The bad version turns technical evidence into an unconfirmed business conclusion.

## Example — healthcare

Evidence establishes:

```text
LLM output
→ recommendation field
→ clinician dashboard
```

Do not ask:

> “Does the AI make clinical decisions?”

Ask:

> “Can the recommendation directly change a patient's treatment, or does a clinician decide what action to take after reviewing it?”

## Example — finance

Evidence establishes:

```text
risk_score
→ loan_status update
```

Ask:

> “Does the status update make the lending decision final, or can a staff member review and change it before the applicant is notified?”

## Stale evidence

If a pending question references stale evidence:

1. stop using the stale claim;
2. load current evidence/context;
3. reassess materiality;
4. ask neutrally or from current evidence if still necessary;
5. cancel the question if no longer material.

## Missing evidence is not absence

**Absence of technical evidence is not evidence of absence in business reality.**

A Scanner/PGE that does not show a behavior may still be incomplete because the behavior lives in:

- another repository;
- external SaaS;
- n8n/Zapier/automation;
- manual/off-system workflow;
- private ML service;
- feature-gated/deployment-specific path;
- unsupported/dynamic code outside current coverage.

Never normalize:

```text
not found in PGE
→ does not exist
```

With `PARTIAL` coverage, preserve the limitation and ask only if the real-world distinction is material + customer-owned.

## Customer technical claims

If the Customer says:

> “The backend never calls the model directly.”

Do not rewrite PGE.

Preserve it as a Customer statement and use governed evidence to handle technical truth separately.

## Why-asking explanation

Good structure:

```text
what LCSP observed
+
what the implementation cannot tell us
+
why the Customer's business knowledge matters
```

Example:

> “We found that an AI-generated score can affect application status, but source code alone cannot tell us whether that status is final before human review.”

Do not include hidden legal reasoning or future EngineeringRule details.


## Source roles

Keep at least four conceptual source roles separate:

```text
TECHNICAL_EVIDENCE
DOCUMENTARY_EVIDENCE
CUSTOMER_STATED
CUSTOMER_CONFIRMED
```

`DOCUMENTARY_EVIDENCE` is neither technical proof nor customer confirmation. `CUSTOMER_STATED` and `CUSTOMER_CONFIRMED` follow the transition rules in `terminology-contract.md`.

## Documentary business evidence

If `docs/product/product-brief.md` says:

> Product is decision support, not certification.

Allowed:

> “Repository documentation describes the system as decision support. In actual operation, does the system output itself count as the final decision, or does a person decide after review?”

Not allowed:

```text
final_authority = HUMAN
source = CUSTOMER_CONFIRMED
```

based only on the document.

## Host-platform knowledge

Skill/reference material explaining the LCSP host platform is not PGE evidence for the Assessed System.

Even when the subject repository is LCSP, subject facts must come from governed PGE/documentary evidence or the customer.


## Unresolved frontier handling

PGE/runtime may expose unresolved frontiers with kinds such as:

```text
BUSINESS
TECHNICAL
ARCHITECTURE
COVERAGE
ORCHESTRATION
```

Do not convert every unresolved frontier into a Customer question.

For each frontier:

```text
customer-owned?
+
material?
→ only then Interview candidate
```

Examples:
- `BUSINESS: Is an assessment result advisory or operative?` → potentially Interview.
- `BUSINESS: Does an output automatically trigger an external action?` → potentially Interview.
- `ARCHITECTURE: context_wizard ordering differs from target design` → not Customer-owned; route to technical/orchestration work.
- `COVERAGE: scanner could not resolve a dynamic call target` → usually technical/coverage, unless it creates a separate material operational question.


## Customer-safe evidence explanation

When explaining “Why are we asking?”, summarize only the smallest governed observation needed for the Customer to understand the question.

Good:

> “We found a code path where an AI-generated score is connected to an approval/rejection workflow.”

Avoid reproducing:
- unrestricted raw source;
- secret-looking config;
- tokens/keys;
- internal security metadata;
- unrelated identifiers;
- long code excerpts.

Authorization/sanitization is enforced by the application/tool layer. Interview must still keep its own customer-facing explanation bounded.
