# Investigator Resolution

Dùng khi Interview được gọi vì existing Investigator run cần Customer business clarification.

## Mental model

Investigator là bounded technical evidence specialist.

Nó đã có technical investigation plan.

Nó gặp một business fact mà technical evidence không establish đáng tin cậy.

Interview Agent làm rõ fact đó với Customer, không cần hiểu/re-plan EngineeringRule phía dưới.

## Model-visible handoff mong đợi

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

Không cần:

```text
EngineeringRule text
EngineeringRule legal intent
EngineeringRule IDs để reasoning
legal applicability
compliance criteria
```

Nếu cần rule ID cho audit, giữ ngoài Interview model context.

## Required runtime fields

Mode này cần model-visible:

```text
businessContextNeed
resolutionCriteria
originatingInvestigationReference
```

Thiếu required field thì return `FAILED` với corresponding limitation code.

Opaque continuation/checkpoint vẫn ở Assessment Orchestration, không phải Interview reasoning context.

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
Assessment Orchestration validate         ↓
resume exact Investigator point
```

## Scope test

Trước khi hỏi:

> Question này có trực tiếp giúp resolve supplied `businessContextNeed` không?

Nếu không, đừng hỏi trong mode này trừ khi Customer answer tạo directly coupled clarification cần để interpret target.

## Good example

Handoff:

```text
businessContextNeed:
Xác định candidate-status write là final rejection
hay provisional chờ recruiter approval.

evidence:
AI score có thể đi tới status write.
```

Good question:

> “Khi system set candidate rejected, đó đã là final decision hay recruiter phải approve trước khi rejection có hiệu lực?”

## Bad — rule leakage

> “Để evaluate human-oversight EngineeringRule, system của bạn có satisfy mandatory recruiter approval không?”

Sai vì expose downstream rule framing, steer Customer toward compliance và biến Interview thành rule reasoning.

## Bad — scope expansion

Sau finality question, đừng tự hỏi personal data hoặc external LLM nếu không cần để interpret bounded clarification.

## Completion

Chỉ return `CONTEXT_RESOLVED` khi bounded `businessContextNeed` đã establish **và** supplied business-operational `resolutionCriteria` satisfied bằng required `CUSTOMER_CONFIRMED` context.

Nếu Customer reality vẫn unknown hoặc material ambiguous:

```text
outcome = BLOCKED_OR_UNRESOLVED
```

Không gọi unresolved limitation là “resolved”.

Nếu clarification đồng thời làm existing confirmed context đổi material:

```text
flags += DOWNSTREAM_IMPACT
```

`DOWNSTREAM_IMPACT` không phải outcome và có thể đi cùng `CONTEXT_RESOLVED`.

## Exact resume

Không tự restart Planner, restart all investigation, reselect EngineeringRules, skip gates hoặc đổi compliance outcome.

Return resolved context + `originatingInvestigationReference`. Không return opaque continuation.

Orchestration resolve opaque continuation từ originating reference và validate resume còn safe không.

## Material change

Nếu clarification đổi existing context material:

1. confirm new meaning;
2. persist/return context update;
3. flag downstream impact;
4. giữ originating investigation reference;
5. không blindly resume;
6. để Orchestration quyết định selective invalidation/re-plan/re-run.
