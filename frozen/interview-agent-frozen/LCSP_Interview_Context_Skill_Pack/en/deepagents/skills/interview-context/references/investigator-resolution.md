# Investigator Resolution

Use this reference whenever Interview is entered because an existing Investigator run needs customer business clarification.

## Mental model

Investigator is a bounded technical evidence specialist.

It already has a technical investigation plan.

It encountered one business fact that cannot be established reliably from technical evidence.

Interview Agent's job is to clarify that fact with the Customer, not to understand or re-plan the underlying EngineeringRule.

## Expected model-visible handoff

Conceptually:

```text
mode: INVESTIGATOR_RESOLUTION
businessContextNeed
resolutionCriteria
whyNeeded? / relatedEvidenceRefs?
relevantEvidenceContext / refs
currentConfirmedBusinessContext
relevantInterviewHistory
originatingInvestigationReference
```

Do not require:

```text
EngineeringRule text
EngineeringRule legal intent
EngineeringRule IDs for reasoning
legal applicability
compliance criteria
```

If rule IDs are needed for audit, keep them outside the Interview model's reasoning context.

## Required runtime fields

This mode requires model-visible:

```text
businessContextNeed
resolutionCriteria
originatingInvestigationReference
```

If any required field is missing, return `FAILED` with the corresponding limitation code.

The opaque continuation/checkpoint remains with Assessment Orchestration and is not Interview reasoning context.

## Flow

```text
Investigator
        ↓
NEEDS_BUSINESS_CONTEXT
        ↓
businessContextNeed
        ↓
Interview Agent
        ↓
Customer clarification
        ↓
context update
        ↓
CONTEXT_RESOLVED
        ↓
Assessment Orchestration validates         ↓
resume exact Investigator point
```

## Scope test

Before asking, check:

> Does this question directly help resolve the supplied `businessContextNeed`?

If no, do not ask it in this mode unless the Customer's answer creates a directly coupled clarification required to interpret the target.

## Good example

Handoff:

```text
businessContextNeed:
Determine whether the candidate-status write is the final rejection
or a provisional status awaiting recruiter approval.

resolutionCriteria:
Establish whether recruiter approval is required before the rejection
becomes the operative business outcome.

evidence:
AI score can flow to candidate.status = REJECTED
```

Good question:

> “When the system sets a candidate to rejected, is that already the final decision, or does a recruiter need to approve the rejection before it takes effect?”

## Bad example — rule leakage

> “To evaluate our human-oversight EngineeringRule, does your system satisfy a mandatory recruiter approval requirement?”

Why wrong:

- exposes downstream rule framing;
- encourages Customer to answer toward compliance;
- makes Interview reason about a rule rather than business reality.

## Bad example — scope expansion

After asking about finality, do not suddenly ask:

> “What personal data do you collect?”

unless that is necessary to interpret the exact bounded clarification.

## Completion

Return `CONTEXT_RESOLVED` only when the bounded `businessContextNeed` is established **and** the supplied business-operational `resolutionCriteria` is satisfied by the required `CUSTOMER_CONFIRMED` context.

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

## Exact resume

Do not decide to:

- restart Planner;
- restart all investigation;
- reselect EngineeringRules;
- skip gates;
- change compliance outcome.

Return the resolved context and `originatingInvestigationReference`. Do not return the opaque continuation.

Orchestration resolves the opaque continuation from the originating reference and validates whether resume remains safe.

## Material context change

If the clarification changes existing confirmed business context materially:

1. confirm the new meaning;
2. persist/return the context update;
3. flag downstream impact;
4. preserve the originating investigation reference;
5. do not blindly resume it;
6. let Orchestration determine selective invalidation/re-plan/re-run.
