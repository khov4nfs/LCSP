# Business Context Resolution

Use this reference whenever Interview is entered in `BUSINESS_CONTEXT_RESOLUTION` mode: a rule analysis
reported one `BUSINESS_CONTEXT_REQUIRED` need that only the Customer can answer.

## Mental model

A rule analysis examined repository evidence and reached one business fact that cannot be established
reliably from technical evidence. The runtime stored it as a bounded need (`targetedNeed`).

Your job is narrow: clarify that one customer-owned distinction with the Customer, one distinction at
a time. You do not analyze code, read repository source, understand or re-plan the underlying
EngineeringRule, or decide any rule outcome.

After the Customer answers, the runtime validates the confirmed statements and deterministically
reassesses the same rule with that context. You never resume, restart or route anything yourself.

## Expected model-visible handoff

```text
mode: BUSINESS_CONTEXT_RESOLUTION
targetedNeed:
  needId
  question        # customer-safe wording of the distinction to establish
  observation     # neutral, bounded description of what evidence could not settle
  resolutionCriterionIds
originatingRuleAnalysisReference
currentConfirmedBusinessContext
relevantInterviewHistory
```

Do not require or expose:

```text
EngineeringRule text, legal intent, IDs or citations
legal applicability
compliance criteria
repository source code or file paths
```

## Required runtime fields

This mode requires model-visible `targetedNeed` (with `needId`, `question`, `observation`,
`resolutionCriterionIds`) and `originatingRuleAnalysisReference`. If any is missing, return `FAILED`
with the corresponding limitation code.

The opaque continuation/checkpoint remains with Assessment Orchestration and is not Interview
reasoning context.

## What your answer feeds

The confirmed statement you resolve here does not stay inside Interview. The runtime binds it to the
`needId` and its `resolutionCriterionIds`, then the same rule is reassessed deterministically with that
customer context. A vague or unresolved statement leaves the criterion unresolved.

So when you return `CONTEXT_RESOLVED`:

- Persist one confirmed statement per `resolutionCriterionIds` entry, each with
  `resolvesCriterionId` set to that exact id, as a concrete, machine-matchable fact (exact and
  referenceable, never a restatement of the question).
- Do not return `CONTEXT_RESOLVED` for a fact that is directionally true but not concretely
  confirmed; the runtime does not supply missing precision and does not accept an approximate statement.

## Flow

```text
rule analysis reports BUSINESS_CONTEXT_REQUIRED
        ↓
runtime persists targetedNeed (needId)
        ↓
Interview Agent asks one customer-owned distinction
        ↓
Customer answers
        ↓
CONTEXT_RESOLVED (statements with resolvesCriterionId)
        ↓
runtime validates the answer against the need
        ↓
deterministic reassessment of the same rule
```

## Scope test

Before asking, check:

> Does this question directly help resolve `targetedNeed.question`?

If no, do not ask it in this mode unless the Customer's answer creates a directly coupled clarification
required to interpret the target. Ask one distinction per turn.

## Good example

Handoff:

```text
targetedNeed.question:
Determine whether the candidate-status write is the final rejection
or a provisional status awaiting recruiter approval.

targetedNeed.observation:
An AI score can flow to candidate.status = REJECTED.
```

Good question:

> “When the system sets a candidate to rejected, is that already the final decision, or does a recruiter need to approve the rejection before it takes effect?”

## Bad example — rule leakage

> “To evaluate our human-oversight EngineeringRule, does your system satisfy a mandatory recruiter approval requirement?”

Why wrong:

- exposes downstream rule framing (rule ids, citations and legal framing never reach the Customer);
- encourages Customer to answer toward compliance;
- makes Interview reason about a rule rather than business reality.

## Bad example — scope expansion

After asking about finality, do not suddenly ask:

> “What personal data do you collect?”

unless that is necessary to interpret the exact bounded clarification.

## Completion

Return `CONTEXT_RESOLVED` only when the bounded need is established **and** every
`resolutionCriterionIds` entry is covered by a `CUSTOMER_CONFIRMED` statement.

If Customer reality remains unknown or materially ambiguous:

```text
outcome = BLOCKED_OR_UNRESOLVED
```

Do not call an unresolved limitation “resolved.”

If the clarification also materially changes existing confirmed context:

```text
flags += DOWNSTREAM_IMPACT
```

`DOWNSTREAM_IMPACT` is not an outcome and may coexist with `CONTEXT_RESOLVED`.

## Same-rule reassessment

Do not decide to:

- restart or re-plan any analysis;
- reselect EngineeringRules;
- skip gates;
- change compliance outcome.

Return the resolved context and `originatingRuleAnalysisReference`. Do not return the opaque continuation.

The runtime resolves the continuation from the originating reference and validates whether
reassessment of the same rule remains safe.

## Material context change

If the clarification changes existing confirmed business context materially:

1. confirm the new meaning;
2. persist/return the context update;
3. flag downstream impact;
4. preserve the originating rule-analysis reference;
5. do not assume reassessment is automatic;
6. let Orchestration determine selective invalidation/rerun.
