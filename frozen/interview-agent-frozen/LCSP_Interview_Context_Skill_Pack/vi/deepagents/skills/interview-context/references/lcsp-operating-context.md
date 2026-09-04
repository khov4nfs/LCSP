# LCSP Operating Context

Để dùng canonical runtime/evidence/reasoning vocabulary, đọc `terminology-contract.md`.


Dùng reference này để hiểu môi trường mà Interview Agent đang hoạt động.

## 1. LCSP

LCSP là **host software assessment platform** nơi Interview Agent chạy.

Customer kết nối software system hoặc repository. LCSP scan implementation, xây evidence về cách system hoạt động, hỏi Customer về business reality mà code không thể chứng minh đáng tin cậy, sau đó thực hiện downstream legal/technical assessment.

Interview Agent là một specialist trong flow lớn đó.

## 1.1. Assessed System

**Assessed System** là software/repository hiện đang được LCSP đánh giá.

Đây là subject của PGE và business context.

Ví dụ:

```text
host platform:
LCSP

assessed system:
github:customer/recruitment-ai@abc123
```

Dogfooding/self-hosting có thể có:

```text
host platform:
LCSP

assessed system:
github:khovan123/LCSP@0298ef4
```

Tên trùng nhau không làm authority trộn lẫn.

Knowledge trong Skill/reference mô tả LCSP host platform **không phải** evidence hay Customer-confirmed fact của Assessed System.

Runtime phải truyền identity rõ, ví dụ `subjectSystemIdentity`, snapshot/commit hoặc assessment-bound system reference.

## 2. Assessment

**Assessment** là một governed evaluation của software/source version đã kết nối.

Một Assessment có:

- customer/tenant boundary;
- current repository/source identity;
- scan/PGE artifact version;
- structured business context;
- downstream legal/EngineeringRule/investigation state;
- checkpoint/resume state;
- audit history.

Interview Agent phải ở trong current Assessment boundary.

## 3. Customer

**Customer** là authenticated organization user trả lời business-context question của LCSP.

Customer là source authority cho real operational practice, ví dụ:

- ai thực sự approve decision;
- AI output chỉ advisory hay final;
- có manual review ngoài repository không;
- staff dùng feature như thế nào;
- ai bị ảnh hưởng bởi outcome.

Customer không tự động là authority cho repository fact mà governed evidence có thể establish trực tiếp.

Giữ source role tách biệt.

## 4. Scanner

**Scanner** phân tích connected software implementation trước Initial Interview.

Nó có thể khám phá technical facts như:

- source structure;
- routes/calls/events;
- data movement;
- AI provider/model invocation;
- status change;
- approval/rejection path;
- human-review/override path;
- unresolved dynamic behavior.

Interview Agent không tự explore repository. Chỉ consume bounded governed evidence.

## 5. Program Evidence Graph (PGE)

**Program Evidence Graph** là provenance-backed graph của system evidence.

Current architecture có các logical semantic layer trong cùng graph, gồm:

- source/provenance;
- code structure;
- runtime/framework boundary;
- data lineage;
- AI system/model lifecycle;
- business-process semantics;
- decision influence/human oversight;
- evidence confidence/origin/resolution state.

Evidence có thể ở state:

- `OBSERVED`;
- `CORROBORATED`;
- `INFERRED`;
- `UNRESOLVED`.

LLM-derived business semantic trong PGE không tự động là Customer-confirmed business reality.

Repository documentation cũng có thể trở thành documentary business evidence. Đây là evidence về điều repository **mô tả**, không phải proof rằng tổ chức đang vận hành đúng như tài liệu đó.

PGE không establish legal applicability.

## 5.1. Documentary business evidence

**Documentary business evidence** là business-semantic statement xuất phát từ repository artifact như:

- README;
- product brief;
- ADR;
- design document;
- comments;
- configuration/documented workflow;
- specification nằm trong repository.

Ví dụ repository ghi:

> “System is decision support only.”

Điều đó support observation:

```text
repository documentation describes the system as decision support
```

Nó **không tự động support**:

```text
Customer confirmed the system is actually operated as decision support
```

Interview Agent có thể dùng documentary evidence để:

- tránh hỏi quá generic;
- xác nhận intent có còn đúng trong vận hành thực tế không;
- phát hiện drift giữa docs và operation;
- tạo focused question.

Không được normalize documentary evidence thành confirmed business context nếu Customer chưa xác nhận.

## 6. Business context

**Business context** là structured knowledge về cách system thực sự được dùng và action của nó có meaning gì trong tổ chức Customer.

Ví dụ:

```text
purpose:
AI xếp hạng job application.

decision role:
AI recommend ranking; không ra final hiring decision.

final authority:
Recruiter quyết định reject applicant hay không.

human review:
Mọi rejection phải được review trước khi final.

affected subjects:
Job applicants.

off-system process:
Senior role còn có phone review không nằm trong code.
```

Business context có thể chứa uncertainty/conflict.

Không bắt buộc mọi topic có value.

## 7. Structured Assessment Context

**Structured Assessment Context** là persisted representation authoritative của business context đã được Customer xác lập và downstream stage sử dụng.

Conversation không tự nó là authoritative context.

Raw answer có thể cần interpretation/confirmation trước khi trở thành confirmed structured context.

Giữ history khi value được correction/supersede.

## 8. EngineeringRule

**EngineeringRule** là reusable technical investigation contract được chuẩn bị từ governed legal material.

Nó translate legal/operational obligation thành bounded technical question và evidence target.

Ví dụ downstream EngineeringRule concern có thể là:

- human review control có tồn tại trước consequential final action không;
- có override path không;
- logging/traceability control có tồn tại không.

EngineeringRule nằm downstream Initial Interview.

Interview Agent không:

- chọn EngineeringRule;
- determine applicability;
- đọc rule để chọn Customer question;
- quyết định rule satisfied hay không.

Tách biệt này ngăn Interview biến thành hidden legal/applicability agent.

## 9. EngineeringRule stage

Sau Initial Interview return `CONTEXT_READY`, LCSP thực hiện governed EngineeringRule/legal-readiness/applicability preparation theo assessment architecture.

Xem đây là downstream boundary.

Interview handoff business context; không tham gia rule selection.

## 10. Planner

**Planner** là downstream technical specialist.

Planner nhận applicable/pinned EngineeringRule work cùng relevant assessment/PGE context rồi tạo bounded technical investigation plan nhỏ nhất.

Planner không sở hữu Customer Interview.

## 11. Investigator

**Investigator** thực thi bounded technical investigation của Planner bằng governed PGE/evidence tools.

Nhiệm vụ là establish provenance-backed technical facts.

Khi một necessary fact là business-operational, không phải technical, và evidence không establish được, Investigator có thể return:

```text
NEEDS_BUSINESS_CONTEXT
```

Originating side chuyển điều đó thành bounded Customer clarification request.

Interview Agent nhận business need, không nhận EngineeringRule.

## 12. Assessment Orchestrator

**Assessment Orchestrator** sở hữu workflow mechanics:

- stage nào chạy;
- checkpoint;
- waiting/resume;
- exact investigation reference;
- stale context/evidence check;
- downstream invalidation/re-run routing;
- audit correlation.

Interview Agent signal outcome/downstream impact nhưng không tùy ý chọn next pipeline stage.

## 13. Verified Interview Episode

**Verified Interview Episode** là ví dụ đã validate về Interview strategy thành công.

Nó có thể dạy:

- clarification pattern hữu ích;
- question ordering hiệu quả;
- ambiguity pattern thường gặp.

Nó không bao giờ là factual evidence cho current Customer Assessment.

Không copy business fact của Customer khác vào current context.

## 14. Authority map

```text
Host Skill / LCSP operating context
    authority cho cách Interview Agent vận hành
            │
            │ không mô tả Assessed System
            ▼
Repository/PGE evidence
    authority cho governed technical/documentary observation
            │
            │ có thể tạo lý do hỏi
            ▼
Interview Agent + Customer
    authority cho Customer-confirmed business context
            │
            ▼
EngineeringRule / Planner / Investigator
    authority cho downstream technical investigation work
            │
            ▼
Governed evaluator
    authority cho compliance/evaluation outcome
```

Không layer nào âm thầm lấy authority của layer khác.

## 15. Canonical Interview handoff

### Initial Interview

Conceptual input:

```text
assessment identity
PGE/evidence context
current confirmed business context
Interview history
Interview guidance version
```

Output outcome:

```text
WAITING_FOR_CUSTOMER
or CONTEXT_READY
or BLOCKED_OR_UNRESOLVED
or FAILED
```

Optional flag:

```text
DOWNSTREAM_IMPACT
```

### Investigator clarification

Conceptual input:

```text
businessContextNeed
relevant evidence refs/context
current confirmed business context
Interview history
originating investigation reference
```

Output outcome:

```text
WAITING_FOR_CUSTOMER
or CONTEXT_RESOLVED
or BLOCKED_OR_UNRESOLVED
or FAILED
```

Optional flag:

```text
DOWNSTREAM_IMPACT
```

EngineeringRule text/ID không cần trong model-visible Interview reasoning.
