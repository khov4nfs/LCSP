# Context Sufficiency

Dùng reference này cho quyết định READY / RESOLVED / unresolved.

Đọc `terminology-contract.md` trước nếu `material`, `customer-owned`, `bounded`, or `sufficient` chưa rõ.

## Core principle

Sufficiency không phải completeness.

Không fill Business Fact Catalog.

Câu hỏi là current boundary còn **material customer-owned uncertainty** cần clarification hay không.

## Counterfactual Materiality Test

Với một candidate uncertainty:

1. Giả sử plausible Customer answer **A**.
2. Giả sử plausible answer **B** khác meaningfully.
3. So sánh effect.

Uncertainty chỉ material khi A vs B làm thay đổi ít nhất một trong:

- **handoff-relevant normalized business fact**;
- Interview readiness/resolution;
- relevance, meaning hoặc priority của material frontier khác;
- interpretation của consequential business action/decision;
- Investigator continuation eligibility;
- downstream work có cần reconsider hay không.

**Descriptive detail không material** chỉ vì stored text sẽ khác.

Nếu không có gì trên thay đổi, distinction có lẽ không material lúc này.

Test này hướng reasoning, không phải fixed questionnaire.

## Initial Interview (`PRE_PLANNER` runtime alias)

Câu hỏi:

> Còn open material customer-owned uncertainty nào hợp lý cần clarify trước khi Interview handoff sang EngineeringRule stage không?

### `CONTEXT_READY` cần tất cả:

- không còn open material customer-owned uncertainty cần clarify;
- không còn Protected Sufficiency Guardrail unsatisfied;
- hỏi thêm chỉ bổ sung non-material detail hoặc generic completeness.

### Protected Sufficiency Guardrails — Must Not Ready

Không return `CONTEXT_READY` nếu còn một trong các điều kiện:

1. còn open material + customer-owned uncertainty;
2. readiness phụ thuộc non-trivial Customer interpretation chưa confirmed;
3. material evidence/Customer conflict chưa resolved hoặc chưa preserve như blocking uncertainty;
4. stale/invalid evidence đang được dùng để justify readiness;
5. documentary evidence bị coi như Customer-confirmed operational reality;
6. technical coverage limitation làm handoff-relevant business frontier vẫn materially unknowable/unsafe to assume;
7. readiness cần invent business assumption.

Đây là generic invariants, không phải domain-specific required fields và không phải fixed questionnaire.

### Tiếp tục Initial Interview nếu có một trong:

- plausible Customer answer khác nhau sẽ material change handoff-relevant normalized business fact/readiness/frontier interpretation;
- current interpretation cần unsupported business assumption;
- consequential action/status có operative meaning chưa rõ;
- material direct statement vẫn hedged/ambiguous;
- material conflict/correction cần clarification.

## Investigator resolution

Câu hỏi:

> Supplied `businessContextNeed` đã establish đủ specificity cho originating investigation chưa?

### `CONTEXT_RESOLVED` cần tất cả:

- exact `businessContextNeed` đã establish;
- supplied business-operational `resolutionCriteria` đã satisfied;
- bounded context cần thiết là `CUSTOMER_CONFIRMED`;
- directly coupled ambiguity không còn đổi interpretation;
- originating investigation reference/runtime còn valid để Orchestration evaluate resume.

Nếu Customer không thể establish requested business reality:

```text
BLOCKED_OR_UNRESOLVED
```

Không return `CONTEXT_RESOLVED` chỉ vì Agent đã hỏi đủ nhiều lần.

## False-ready traps

Không READY/RESOLVED chỉ vì:

- a field contains text;
- the Customer answered once;
- evidence strongly suggests the answer;
- a similar assessment had a common pattern;
- a Verified Episode suggests a likely answer;
- the Agent wants fewer turns;
- most attention dimensions are known.

## Over-interview traps

Dừng hỏi khi:

- A vs B would not change current business meaning/readiness/continuation;
- the topic is already explicit and confirmed;
- the question is only “nice to know”;
- PGE can establish the technical fact directly and no business meaning is missing;
- the question belongs to EngineeringRule/legal evaluation rather than business context;
- Investigator's bounded need is already resolved.

## Ví dụ

### Material

PGE:

```text
AI-generated price
→ customer invoice draft
```

Unknown:
- price is automatically sent to customer; or
- employee reviews/edits before sending.

Answer khác nhau làm đổi operative business action.

Material: yes.

### Có lẽ non-material lúc này

Customer already confirms:
- report is internally reviewed;
- a human submits it to the regulator.

Unknown:
- whether the reviewer usually checks in the morning or afternoon.

Không meaningful change tới handoff-relevant normalized business fact/readiness.

Material: no.

### Investigator unresolved

Investigator cần:
> whether an account restriction takes effect immediately or after analyst approval.

Customer:
> “I don't know; another team owns that.”

Result:
`BLOCKED_OR_UNRESOLVED`, not `CONTEXT_RESOLVED`.


### Non-material descriptive detail

Customer confirm required review xảy ra trước submission.

Unknown:
- reviewer thường làm vào buổi sáng hay chiều.

Nếu time-of-day không đổi handoff semantics thì đây chỉ là descriptive detail.

Không hỏi.


## Technical coverage and sufficiency

Coverage state không thay business reasoning.

```text
READY
→ normal reasoning

PARTIAL
→ preserve limitation
→ absence trong PGE không phải absence trong business reality
→ vẫn có thể READY nếu không còn handoff-relevant material uncertainty

UNAVAILABLE
→ Orchestration recovery trước Interview
```

PARTIAL chỉ block readiness khi limitation làm handoff-relevant Customer-owned uncertainty vẫn material unresolved/unsafe to assume.
