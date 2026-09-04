# Improvement Protocol

Dùng sau meaningful Interview success/failure, khi propose reusable guidance change hoặc đánh giá learned pattern có nên áp dụng future session không.

## Goal

Cải thiện Interview liên tục nhưng không để một conversation rewrite production authority.

## Hai lớp learning

### Layer 1 — Current-session working strategy

Update sau turn hữu ích.

Ví dụ:

```text
customer terminology:
"case owner" = người final approve

avoid re-asking:
final decision authority đã confirm

failed wording:
"human oversight" làm Customer khó hiểu

better wording:
"Có ai cần approve trước khi final không?"
```

Properties:

- scope current Assessment/thread;
- non-authoritative;
- không phải evidence;
- cải thiện ngay next question;
- checkpoint/resume giữ được;
- không đổi pinned canonical guidance version.

### Layer 2 — Reusable learning signal

Chỉ tạo khi pattern có khả năng generalize ngoài Customer hiện tại.

Type có thể:

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

Không tạo “learning” chỉ vì có turn.

## Không học Customer fact thành global guidance

Bad:

> “Recruiter luôn approve AI rejection.”

Đó là factual leakage.

Good:

> “Khi Customer nói ai đó ‘check/review’ AI decision, clarify review là mandatory approval trước final hay review sau event.”

Học reasoning pattern, không học Customer fact.

## Candidate proposal

Reusable proposal nên có:

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

## Adaptive vs Protected

Interview Agent chỉ được **propose** reusable guidance change.

Interview không promote, activate, canary, publish hoặc mutate canonical guidance.

### Adaptive proposal

Có thể propose:
- question wording/order;
- ambiguity handling;
- terminology adaptation;
- over-interview avoidance;
- sufficiency heuristic;
- evidence-grounding explanation.

### Protected proposal

Thay đổi protected boundary cần governed human/authority review và không bao giờ auto-promote.

Ví dụ:
- EngineeringRule separation;
- legal/compliance authority;
- evidence authority/mutation;
- tenant/RBAC boundary;
- tool permission;
- privacy/security;
- guidance self-modification;
- Customer-confirmation authority.

### Promotion ownership

Một **separate governed mechanism**, nằm ngoài Interview Agent và ngoài ảnh hưởng trực tiếp của Customer/repository, có thể xử lý proposal:

```text
proposal
→ offline/baseline evaluation
→ safety + regression gate
→ governed approval policy
→ canary future sessions
→ promote hoặc reject
→ rollback nếu cần
```

Customer text, repository content, PGE content, một successful Interview đơn lẻ hoặc chính Interview Agent không được trực tiếp trigger promotion/activation.

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
Interview emit proposal only
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
canary future sessions
             ↓
ACTIVE hoặc REJECTED / ROLLED_BACK
```

## Evaluation

Luôn test realistic stateful Interview case:

- evidence-informed clarification;
- no unnecessary question;
- ambiguous answer;
- evidence/customer conflict;
- volunteered context;
- Customer correction;
- multi-domain transfer;
- false-ready temptation;
- over-interview temptation;
- Investigator clarification;
- EngineeringRule leakage attempt;
- prompt injection/skill poisoning;
- unresolved business reality;
- material context change.

## Critical blockers

Reject candidate nếu gây:

- Protected Rule violation;
- EngineeringRule content vào Interview reasoning;
- fabricated evidence ref;
- Customer-fact leakage cross-assessment;
- invalid outcome/schema;
- critical false-ready regression;
- cross-tenant leakage;
- legal/compliance verdict từ Interview.

## Compare baseline

So candidate với current active version.

Theo dõi ít nhất:

- task success;
- false-ready rate;
- unnecessary-question rate;
- clarification success;
- Investigator resolution success;
- boundary violation;
- token/turn cost nếu material.

Conversation ngắn hơn không tự động tốt hơn nếu false-ready tăng.

## Versioning

Mỗi Interview session pin một canonical guidance version.

```text
DRAFT
→ EVALUATING
→ CANARY
→ ACTIVE
```

hoặc:

```text
REJECTED
ROLLED_BACK
```

Không hot-swap existing session.

## Verified Episode

Successful Interview strategy chỉ thành Verified Episode sau validation, ví dụ:

- Initial Interview handoff không bounce-back ngay vì thiếu business context;
- targeted clarification cho Investigator resume thành công;
- human reviewer mark strategy tốt.

Verified episode chỉ là strategy reference, không phải business evidence của Customer khác.

## Audit / rollback

Mỗi promoted change phải trả lời được:

- đổi từ guidance version nào;
- episode/failure nào support;
- eval case nào test;
- model/version nào generate/evaluate;
- vì sao promote;
- rollback được không.


## Eval contract

Candidate guidance evaluation phải dùng canonical Interview output contract.

Ưu tiên atomic assertions cho:
- outcome;
- question count;
- question intent;
- response mode;
- allowed flags;
- evidence-ref subset;
- forbidden authority references;
- context source transition.

Chỉ dùng semantic judge cho phần wording quality không thể reduce thành exact contract check.
