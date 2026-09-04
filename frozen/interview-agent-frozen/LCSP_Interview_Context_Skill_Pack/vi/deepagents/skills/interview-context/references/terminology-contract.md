# Terminology Contract

Reference này là vocabulary contract chuẩn của Interview Agent.

Dùng các definition này thống nhất giữa Skill, runtime contract, tools, eval và UI adapter.

## Runtime vocabulary

### `INITIAL_INTERVIEW`

**Definition:** Canonical runtime/semantic mode cho Initial Interview.

**Semantics:** Chạy sau Scanner/PGE và trước bước EngineeringRule.

### `PRE_PLANNER`

**Definition:** Legacy compatibility alias của `INITIAL_INTERVIEW`.

**Decision rule:** Normalize `PRE_PLANNER → INITIAL_INTERVIEW` trước Interview reasoning. Contract/prose mới ưu tiên `INITIAL_INTERVIEW`.

### `INVESTIGATOR_RESOLUTION`

**Definition:** Targeted Interview mode chỉ chạy khi existing Investigator cần một bounded business clarification.

**Không phải:** Initial Interview lần hai.

**Decision rule:** Mọi câu hỏi phải trực tiếp resolve `businessContextNeed` hoặc ambiguity liên quan trực tiếp cần để hiểu target đó.

### `WAITING_FOR_CUSTOMER`

**Definition:** Runtime outcome khi Interview đã có customer-facing question và đang cần Customer input.

**Contract:** Nếu `question != null` thì outcome phải là `WAITING_FOR_CUSTOMER`.

### `CONTEXT_READY`

**Definition:** Initial Interview outcome cho biết hiện không còn material customer-owned uncertainty cần clarify trước khi handoff sang EngineeringRule stage.

**Không có nghĩa:** Đã biết toàn bộ business facts.

### `CONTEXT_RESOLVED`

**Definition:** Investigator-resolution outcome cho biết đúng business distinction được yêu cầu đã được xác lập đủ specificity cho originating investigation và không còn directly coupled ambiguity làm thay đổi interpretation đó.

**Không có nghĩa:** Đã hỏi nhưng vẫn không biết.

Nếu không thể xác lập business reality, dùng `BLOCKED_OR_UNRESOLVED`.

### `BLOCKED_OR_UNRESOLVED`

**Definition:** Interview không thể xác lập một material business fact đủ tin cậy để READY/RESOLVED.

Ví dụ: Customer không biết; team sở hữu process không available; ambiguity/conflict không reconcile được.

### `FAILED`

**Definition:** Runtime/system contract failure, không phải business uncertainty.

Ví dụ: thiếu required `subjectSystemIdentity`, mode invalid, payload contract malformed.

### `DOWNSTREAM_IMPACT`

**Definition:** **Flag**, không phải outcome.

Set khi confirmed context update có thể làm downstream work stale hoặc cần reconsideration.

Có thể đi cùng outcome bình thường:

```json
{
  "outcome": "CONTEXT_RESOLVED",
  "flags": ["DOWNSTREAM_IMPACT"]
}
```

### `FAILED` vs `BLOCKED_OR_UNRESOLVED`

Dùng `FAILED` chỉ cho runtime/system/contract failure.

Ví dụ:
- thiếu required runtime identity/version/mode;
- unsupported mode;
- invalid assessment binding;
- malformed required Investigator handoff.

Ghi vào:

```text
limitations[]
```

Dùng `BLOCKED_OR_UNRESOLVED` chỉ khi Interview runtime valid nhưng material Customer-owned business fact không establish được.

Ví dụ:
- Customer không biết;
- responsible team unavailable;
- material ambiguity/conflict còn lại sau reasonable clarification.

Ghi vào:

```text
unresolved[]
```

Không dùng `FAILED` như synonym của business uncertainty, và không dùng `BLOCKED_OR_UNRESOLVED` để che broken runtime contract.

## Question vocabulary

### `ASK`

**Definition:** `question.intent` cho một material business uncertainty mới.

Không phải runtime outcome.

### `CLARIFY`

**Definition:** `question.intent` chỉ dùng khi prior Customer answer có relevant business content nhưng meaning vẫn ambiguous, internally contradictory, scope quá hẹp cho material need hoặc conflict với source khác.

Dùng `CLARIFY` khi question refine **existing answer content**.

Không dùng `CLARIFY` chỉ vì:
- Customer không trả lời business question;
- Customer prompt-injection;
- Customer đổi chủ đề;
- runtime input invalid.

Nếu material question vẫn chưa được answer và không có usable business answer để refine, hỏi/re-ask bằng:

```text
question.intent = ASK
```

`ASK` và `CLARIFY` không phải runtime outcome.

## Evidence authority vocabulary

### `TECHNICAL_EVIDENCE`

Governed evidence về implementation behavior, structure, data/AI flow hoặc code/runtime path.

### `DOCUMENTARY_EVIDENCE`

Business-semantic information trong README, product brief, ADR, comment hoặc specification của repository.

**Không đồng nghĩa:** Customer-confirmed operational reality.

### `CUSTOMER_STATED`

Raw hoặc semantically equivalent Customer statement mà normalized business meaning chưa an toàn để coi là confirmed.

Dùng khi:
- wording hedged/ambiguous;
- normalization thêm meaning;
- timing, scope, necessity, authority hoặc universality chưa rõ.

Ví dụ:

> “Thường có người check.”

Câu này **không xác nhận** mandatory approval trước finalization.

### `CUSTOMER_CONFIRMED`

Normalized business fact có meaning:

1. **directly explicit** trong Customer answer và normalization semantically lossless; hoặc
2. là **non-trivial interpretation** đã được Customer explicit confirm.

Direct example:

> “Recruiter bắt buộc approve mọi rejection trước khi nó có hiệu lực.”

Có thể normalize trực tiếp thành:

```text
approval_required = true
approval_role = recruiter
approval_timing = before_finalization
source = CUSTOMER_CONFIRMED
```

Interpretive example:

> “Thường có người check.”

Phải giữ `CUSTOMER_STATED` / ambiguous cho đến khi clarify distinction cần thiết nếu material.

### Evidence resolution states

- `OBSERVED` — direct governed observation.
- `CORROBORATED` — nhiều governed signal support.
- `INFERRED` — semantic inference/proposal; không phrase như established fact.
- `UNRESOLVED` — evidence không establish được claim.
- `STALE` — evidence thuộc state/version cũ, không được ground current claim.

### Source-provenance rule

Dùng đúng canonical source label:

```text
TECHNICAL_EVIDENCE
DOCUMENTARY_EVIDENCE
CUSTOMER_STATED
CUSTOMER_CONFIRMED
```

Không tạo alias như `EVIDENCE_OBSERVED`, `DOCUMENTARY_BUSINESS_EVIDENCE`, `CUSTOMER_STATEMENT` hoặc `CONFIRMED_BUSINESS_CONTEXT`.

Không gộp authority khác nhau thành source `MIXED`. Nếu technical evidence và Customer statement cùng tham gia conflict/clarification, giữ chúng thành các source-specific record/ref riêng.

Evidence resolution state (`OBSERVED`, `CORROBORATED`,...) là concept tách biệt với source type. Ví dụ:

```text
source = TECHNICAL_EVIDENCE
resolution_state = OBSERVED
```

## Reasoning vocabulary

### `material`

Một uncertainty/change chỉ **material ở thời điểm hiện tại** khi các plausible answer khác nhau về meaning làm thay đổi ít nhất một handoff-relevant decision hoặc normalized fact:

- một **handoff-relevant normalized business fact**;
- Interview readiness/resolution;
- relevance, meaning hoặc priority của material frontier khác;
- interpretation của consequential business action/decision;
- Investigator continuation eligibility;
- downstream work có thể cần reconsider hay không.

Descriptive detail **không material chỉ vì stored text sẽ khác**.

Ví dụ thường non-material:
- review vào buổi sáng hay chiều;
- wording preference;
- UI label ngẫu nhiên;
- process detail mô tả nhưng không đổi handoff semantics.

#### Counterfactual Materiality Test

Giả sử Customer trả lời **A**.
Giả sử Customer trả lời **B**.

Nếu A vs B không làm thay đổi:
- handoff-relevant normalized business fact;
- readiness/resolution;
- relevance/meaning/priority của material frontier khác;
- consequential-action interpretation;
- Investigator continuation eligibility;
- hoặc downstream reconsideration,

thì distinction đó có lẽ **không material lúc này**.

### `customer-owned`

Một fact là customer-owned khi nó mô tả real organizational operation/use/authority mà governed technical evidence không thể establish đáng tin cậy và Customer là source phù hợp.

Ví dụ:
- ai final approve;
- status có operationally final không;
- off-system review có mandatory không;
- feature dùng với real customer hay chỉ testing.

Không phải customer-owned:
- source file có call API không nếu PGE establish được;
- legal applicability;
- EngineeringRule có satisfied không.

### `bounded`

Question bounded khi chỉ hỏi distinction nhỏ nhất cần cho current Interview mode.

Trong Investigator resolution, phải trực tiếp resolve `businessContextNeed` hoặc directly coupled ambiguity.

### `final`

Internal meaning: outcome/status đã có hiệu lực như operative business decision/action của workflow.

Tránh hỏi Customer bằng keyword “final” nếu có thể nói rõ hơn:
> “Trạng thái này đã được xem là quyết định có hiệu lực chưa?”

### `provisional`

Internal meaning: temporary/non-operative state đang chờ required step trước khi business outcome có hiệu lực.

Tránh:
> “Nó có provisional không?”

Nên:
> “Đây chỉ là trạng thái tạm cho tới khi có người approve phải không?”

### `conflict`

Hai statement từ source có authority không thể cùng đúng dưới current scope nếu chưa có explanation thêm.

Không tự chọn winner.

### `correction`

Customer explicit thay đổi/supersede prior business context.

Giữ history và đánh giá downstream impact nếu material.

### `sufficient`

Một mode chỉ sufficient khi stop condition của mode đó thỏa.

Initial Interview:
- không còn open **material + customer-owned** uncertainty cần clarify lúc này.

Investigator resolution:
- supplied business distinction đã establish đủ specificity và không còn directly coupled ambiguity thay đổi interpretation.

### `downstream impact`

Confirmed business-context change có thể invalidate/alter/reconsider downstream EngineeringRule/Planner/Investigator/evaluation work.

Interview chỉ flag. Orchestration quyết định invalidate/rerun.


### `scope`

Boundary mà Customer statement được assert là đúng.

Ví dụ:
- “trong team của tôi” → team scoped;
- “với senior role” → case-set/workflow scoped;
- “mọi assessment trong tổ chức” → organization scoped.

Không broaden narrow statement thành organization-wide truth.

### `respondentRef`

Assessment-bound identity của Customer respondent cung cấp statement.

Dùng để phân biệt:
- explicit correction/supersession của một respondent;
- contradiction từ respondent khác.

Statement đến sau từ respondent khác không tự động là correction.

### `frontier`

Candidate unresolved item từ PGE/evidence/runtime.

Frontier kind có thể:

```text
BUSINESS
TECHNICAL
ARCHITECTURE
COVERAGE
ORCHESTRATION
```

Một frontier chỉ thành Interview candidate khi pass cả:
- `customer-owned?`
- `material?`

Chỉ vì frontier unresolved không có nghĩa phải hỏi Customer.
