# Improvement Protocol

Use this reference after meaningful Interview successes/failures, when proposing reusable guidance changes, or when evaluating whether a learned pattern should affect future sessions.

## Goal

Improve Interview quality continuously without letting one conversation rewrite production authority.

## Learning layers

### Layer 1 — Current-session working strategy

Update after any useful turn.

Examples:

```text
customer terminology:
"case owner" means the person who gives final approval

avoid re-asking:
final decision authority already confirmed

failed wording:
"human oversight" confused the Customer

better wording:
"Does someone need to approve it before it becomes final?"
```

Properties:

- scoped to current Assessment/thread;
- non-authoritative;
- not evidence;
- may improve the next question immediately;
- checkpoint/resume should preserve it;
- never changes the pinned canonical guidance version.

### Layer 2 — Reusable learning signal

Create only when a pattern may generalize beyond this Customer.

Types may include:

```text
SUCCESS_PATTERN
FAILURE_PATTERN
AMBIGUITY_PATTERN
QUESTION_STRATEGY
SUFFICIENCY_ERROR
DOMAIN_LANGUAGE_PATTERN
ADAPTIVE_RULE_GAP
EVAL_CASE
```

Do not create “learning” merely because a turn happened.

## Do not learn Customer facts as global guidance

Bad reusable lesson:

> “Recruiters always approve AI rejection.”

That is Customer-specific factual leakage.

Good reusable lesson:

> “When a Customer says someone ‘checks’ an AI decision, clarify whether the check is mandatory approval before finalization or review after the event.”

Learn the reasoning pattern, not the Customer fact.

## Candidate proposal

A reusable proposal should state:

```text
based_on_guidance_version
target_skill_section_or_rule_id
observed_problem
supporting_episode_refs
proposed_change
expected_behavior_change
new_or_updated_eval_cases
protected_boundary_touched: yes/no
```

## Adaptive vs Protected change

Interview Agent may **propose** reusable guidance changes.

It never promotes, activates, canaries, publishes, or mutates canonical guidance.

### Adaptive proposal

May propose changes such as:
- question wording/order;
- ambiguity handling;
- terminology adaptation;
- over-interview avoidance;
- sufficiency heuristics;
- evidence-grounding explanations.

### Protected proposal

Protected-boundary changes require governed human/authority review and are never auto-promoted.

Examples:
- EngineeringRule separation;
- legal/compliance authority;
- evidence authority/mutation;
- tenant/RBAC boundaries;
- tool permissions;
- privacy/security;
- guidance self-modification;
- Customer-confirmation authority.

### Promotion ownership

A **separate governed mechanism**, outside Interview Agent and outside Customer/repository influence, may process a proposal:

```text
proposal
→ offline/baseline evaluation
→ safety + regression gate
→ governed approval policy
→ canary on future sessions
→ promote or reject
→ rollback if needed
```

Customer text, repository content, PGE content, a single successful Interview, or the Interview Agent itself must never directly trigger promotion/activation.

## Improvement cycle

```text
Interview turn/session
        ↓
working strategy update
        ↓
meaningful reusable signal?
        ├─ no → stop
        └─ yes
             ↓
Interview emits proposal only
             ↓
SEPARATE GOVERNED MECHANISM
             ↓
validated episode / failure case
             ↓
baseline vs candidate eval
             ↓
safety/regression gate
             ↓
governed approval policy
             ↓
canary on future sessions
             ↓
ACTIVE or REJECTED / ROLLED_BACK
```

## Evaluation principles

Test the skill against realistic stateful Interview situations, not generic prompts.

Always include cases for:

- evidence-informed clarification;
- no unnecessary question;
- ambiguous Customer answer;
- evidence/customer conflict;
- volunteered context;
- Customer correction;
- multi-domain transfer;
- false-ready temptation;
- over-interview temptation;
- Investigator clarification;
- EngineeringRule leakage attempt;
- prompt injection / skill poisoning;
- unresolved business reality;
- material context change.

## Critical blockers

Reject a candidate if it causes:

- Protected Rule violation;
- EngineeringRule content to enter Interview reasoning;
- fabricated evidence refs;
- customer-fact leakage across assessments;
- invalid outcome/schema;
- critical false-ready regression;
- cross-tenant leakage;
- legal/compliance verdict from Interview.

## Compare against baseline

Evaluate candidate guidance against the currently active version, not only in isolation.

Track at least:

- task success;
- false-ready rate;
- unnecessary-question rate;
- clarification success;
- Investigator resolution success;
- boundary violations;
- token/turn cost when material.

A shorter conversation is not automatically better if it increases false-ready behavior.

## Versioning

Every Interview session pins one canonical guidance version.

A new candidate may progress:

```text
DRAFT
→ EVALUATING
→ CANARY
→ ACTIVE
```

or:

```text
REJECTED
ROLLED_BACK
```

Never hot-swap an existing session.

## Verified episodes

A successful Interview strategy becomes a Verified Episode only after validation, for example:

- Initial Interview handoff proceeds without immediate business-context bounce-back;
- targeted clarification lets Investigator resume successfully;
- human review marks the strategy as a good example.

Verified episodes remain strategy references.

They are never business evidence for another Customer.

## Audit and rollback

For any promoted change, retain enough traceability to answer:

- Which prior guidance version did it change?
- Which episodes/failures supported it?
- Which eval cases tested it?
- Which model/version generated/evaluated it?
- Why was it promoted?
- Can it be rolled back?


## Eval contract

Candidate guidance evaluation must use the canonical Interview output contract.

Prefer atomic assertions for:
- outcome;
- question count;
- question intent;
- response mode;
- allowed flags;
- evidence-ref subset;
- forbidden authority references;
- context source transition.

Use semantic judging only where language quality cannot be reduced to exact contract checks.
