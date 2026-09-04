# Question Strategy

Dùng reference này để chọn, phrase, rephrase và structure Customer question.

## Objective

Hỏi câu nhỏ nhất dễ hiểu giúp resolve highest-value current business uncertainty.

## Selection procedure

Trước khi hỏi:

1. xác định open uncertainty;
2. chạy Counterfactual Materiality Test;
3. xác nhận fact là customer-owned;
4. xác nhận fact chưa explicit/confirmed;
5. xem relevant evidence/history;
6. chọn customer-facing wording đơn giản nhất;
7. chọn response mode không làm méo meaning.

## Prioritizing multiple material uncertainties

Nếu nhiều candidate question đều pass materiality/customer-owned test, không chọn tùy ý.

Chỉ sau khi tất cả candidate đã pass hai test đó, dùng tie-breaker:

1. **dependency/branching blocker** — hỏi uncertainty trước nếu answer của nó làm thay đổi meaning, relevance hoặc priority của các material uncertainty khác;
2. authority/timing/effect chưa rõ của consequential business action/decision;
3. material conflict/ambiguity trong context đang được relied on;
4. feature có thực sự được dùng trong real-world/customer workflow liên quan không;
5. material data/deployment/operational scope cần cho handoff;
6. material business context khác.

Trong cùng level, ưu tiên câu hỏi nhỏ nhất, evidence grounding mạnh nhất và expected reduction of material uncertainty cao nhất.

Đây là default priority heuristic, không phải required-fact catalog. Dependency/branching blocker thắng khi answer của nó quyết định frontier khác có relevant hay không. Không force category ordering nếu current assessment context cho thấy uncertainty khác thực sự consequential hơn.

Trong `INVESTIGATOR_RESOLUTION`, supplied `businessContextNeed` luôn ưu tiên cao nhất.

## Internal vocabulary không được leak

| Internal concept | Không nên hỏi Customer | Nên hỏi |
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

Chỉ dùng cho operational fact thực sự binary và không che nuance.

Example:
> “Is approval required before this action takes effect?”

### `SINGLE_SELECT`

Dùng khi:
- choice mutually exclusive;
- set cover plausible meaning thực;
- Customer hiểu được.

Nếu set có thể incomplete, thêm:
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

Dùng khi nhiều role/step có thể cùng đúng.

### `FREE_TEXT`

Dùng khi workflow/process nuance không thể represent an toàn bằng fixed choice.

## One focused question

Default:
```text
question_count = 1
```

Chỉ combine tightly coupled distinction khi hỏi tách làm interpretation tệ hơn.

Không render generic questionnaire.

## `ASK` vs `CLARIFY`

Use:

```text
question.intent = ASK
```

cho material uncertainty mới.

Use:

```text
question.intent = CLARIFY
```

khi refine prior answer/conflict.

Đây không phải runtime outcome.

## Direct statement — không over-confirm

Customer:

> “A recruiter must approve every rejection before it takes effect.”

Do not ask:

> “Just to confirm, is recruiter approval mandatory?”

Statement đủ explicit để lossless normalize thành `CUSTOMER_CONFIRMED`.

## Ambiguous statement — clarify

Customer:

> “Usually someone checks it.”

Không infer mandatory approval.

Ask:
> “When they check it, do they need to approve the action before it takes effect, or do they review it afterward?”

## Tránh leading question

Bad:
> “Which recruiter approves the AI rejection?”

Better:
> “Before a rejection takes effect, does anyone need to approve it?”

## Không hỏi technical fact Customer không cần cung cấp

Nếu PGE trực tiếp establish external-model call, không hỏi:
> “Does the code call an external model?”

Chỉ hỏi missing operational meaning, ví dụ:
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

Không nhắc EngineeringRule/legal reasoning.

## Failed question recovery

Nếu question fail:
- xác định exact ambiguity;
- bỏ jargon;
- thu hẹp scope;
- đổi response mode;
- giữ hedging;
- giữ unresolved nếu Customer không thể biết.

Không có fallback questionnaire.
