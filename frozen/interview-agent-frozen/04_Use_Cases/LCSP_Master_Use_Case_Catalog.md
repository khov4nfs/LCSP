# LCSP — Master Use Case Catalog

**Document type:** Business Analysis / Use Case Catalog  
**Purpose:** Leader Review  
**Status:** Approved  
**Scope:** LCSP end-to-end flow, gồm Customer flow, Assessment flow, Interview Agent, Code Remediation và Admin/Legal Governance.

[ADD] **Change marker convention:** `[DELETE]` = nội dung gốc bị loại bỏ; `[UPDATED]` = nội dung thay thế/cập nhật; `[ADD]` = nội dung mới bổ sung.

---

## 1. Mục đích tài liệu

Tài liệu này dùng để Leader review và chốt **ranh giới Use Case của toàn LCSP** trước khi BA viết Use Case Specification chi tiết.

Tài liệu tập trung trả lời 4 câu hỏi:

1. LCSP hiện có những **Actor** nào?
2. Mỗi Actor có thể đạt được những **business goal** nào trên hệ thống?
3. Các Use Case được nhóm vào module nào?
4. Những bước nào chỉ là **internal system behavior**, không nên tách thành Use Case riêng?

> **Nguyên tắc:** Use Case mô tả mục tiêu có ý nghĩa đối với Actor. Các internal component như Scanner, PGE Builder, Planner, Investigator, Orchestrator, Evaluator, Gap Analyzer... không phải Actor và không được tách thành Use Case chỉ vì chúng là một bước trong backend flow.

---

## 2. Baseline đang dùng

### 2.1 Assessment flow

```text
Create Assessment
→ Configure Source
→ Start Scan
→ Scanner / PGE
→ Initial Interview
→ CONTEXT_READY
→ EngineeringRule stage
→ Planner
→ Investigator
→ Deterministic Evaluation
→ AI Risk Classification
→ Gap / Remediation Analysis
→ Report
```

Nếu Investigator thiếu business context:

```text
Investigator
→ NEEDS_BUSINESS_CONTEXT
→ Interview Agent
→ CONTEXT_RESOLVED / BLOCKED_OR_UNRESOLVED
→ Orchestrator validate continuation / downstream impact
→ resume Investigator nếu continuation còn valid
```

### 2.2 Code Remediation flow

```text
Gap có thể sửa bằng code
→ Customer Start Code Remediation
→ Generate / Verify Patch
→ Customer Review & Approve
→ Push / Update PR
→ Re-scan affected source
→ Re-investigate / Re-evaluate
→ Verified hoặc Unresolved
```

Hệ thống **không auto-retry remediation**. Nếu chưa resolve, Customer chủ động chọn tiếp tục vòng remediation mới.

### 2.3 Legal Governance flow

[DELETE] ```text
[DELETE] Legal Source
[DELETE] → LegalRule
[DELETE] → Triage
[DELETE] → EngineeringRule Candidate
[DELETE] → EngineeringRule Preparation / Review
[DELETE] → READY EngineeringRule
[DELETE] → Assessment sử dụng downstream
[DELETE] ```

[UPDATED] ```text
[UPDATED] Legal Source
[UPDATED] → LegalRule
[UPDATED] → Triage
[UPDATED] → EngineeringRule Candidate
[UPDATED] → EngineeringRule Preparation / Validation
[UPDATED] → READY khi governed readiness criteria được thỏa mãn
[UPDATED] → Assessment sử dụng downstream
[UPDATED] ```

Assessment **không tự generate EngineeringRule live**.

[ADD] **Business Rule:** `READY` không yêu cầu mandatory Human approval gate. Admin có thể review/chỉnh sửa theo quyền, nhưng readiness không phụ thuộc vào một action Approve riêng.

---

# 3. Actors

| Actor | Định nghĩa | Phạm vi chính |
| --- | --- | --- |
| **Customer** | Người dùng doanh nghiệp sử dụng LCSP để đánh giá hệ thống AI của mình. | Assessment, source, scan, Interview, review findings, report, reassessment, remediation. |
| **Admin** | Người quản trị phần governance / legal-maintenance của LCSP theo quyền được cấp. | Workspace admin, Legal Source, LegalRule, Triage, EngineeringRule, maintenance, governance audit. |
| **Git Provider** | Hệ thống bên ngoài như GitHub/GitLab cung cấp repository/source và nhận branch/PR khi remediation. | Repository authorization, source retrieval, write access, pull request. |

### Actor boundary cần giữ

- **Interview Agent chỉ có Customer là business actor trực tiếp.** Admin không tham gia trả lời Interview.
- Planner / Investigator / Orchestrator / Scanner / Evaluator là **internal system component**, không phải Actor.
- Git Provider là **secondary external actor**, không phải người dùng chính của LCSP.
[ADD] - **Authorization rule:** `Primary Actor: Customer` chỉ xác định actor có thể đạt goal đó; hệ thống vẫn phải kiểm tra **permission cụ thể của action trong đúng Workspace/Assessment scope**. Không mặc định mọi Customer đều có quyền thực hiện mọi Customer Use Case.
[ADD] - **Admin boundary — Confirmed:** Admin không tham gia Initial Interview hoặc Targeted Business Clarification của Customer.

---

# 4. Module Overview

| Module | Tên module | Số Use Case |
| --- | --- | ---: |
| **M01** | Authentication & Workspace | 4 |
| **M02** | Assessment Setup & Source | 4 |
[DELETE] | **M03** | Repository Scan & Technical Evidence | 4 |
[UPDATED] | **M03** | Repository Scan & Technical Evidence | 3 |
[DELETE] | **M04** | Business Context & Interview | 5 |
[UPDATED] | **M04** | Business Context & Interview | 4 |
[DELETE] | **M05** | EngineeringRule, Investigation & Evaluation | 4 |
[UPDATED] | **M05** | EngineeringRule, Investigation & Evaluation | 3 |
[DELETE] | **M06** | Gap Analysis & Reporting | 4 |
[UPDATED] | **M06** | Gap Analysis & Reporting | 3 |
[DELETE] | **M07** | Assessment Lifecycle & Reassessment | 4 |
[UPDATED] | **M07** | Assessment Lifecycle & Reassessment | 3 |
[DELETE] | **M08** | Code Remediation | 6 |
[UPDATED] | **M08** | Code Remediation | 4 |
[DELETE] | **M09** | Legal Governance & EngineeringRule Management | 6 |
[UPDATED] | **M09** | Legal Governance & EngineeringRule Management | 5 |
| **M10** | Legal Maintenance & Administration | 3 |
[DELETE] |  | **Tổng** | **44** |
[UPDATED] |  | **Tổng** | **36** |

---

# 5. Use Case Catalog

## M01 — Authentication & Workspace

### UC-M01-01 — Sign In

- **Primary Actor:** Customer / Admin
- **Goal:** Đăng nhập vào LCSP bằng account hợp lệ và nhận đúng phạm vi quyền.
- **Trigger:** User chọn Sign In.
- **Precondition:** User có account hợp lệ.
- **Success Outcome:** User vào được Workspace phù hợp với quyền.
- **Key Note:** Không được nhìn thấy Workspace/Assessment ngoài quyền.

### UC-M01-02 — Sign Out

- **Primary Actor:** Customer / Admin
- **Goal:** Kết thúc phiên làm việc hiện tại.
- **Trigger:** User chọn Sign Out.
- **Success Outcome:** Session hiện tại không còn được dùng cho action yêu cầu authentication.

### UC-M01-03 — View Workspace

- **Primary Actor:** Customer / Admin
- **Goal:** Xem Workspace và các Assessment / governance item mà user được phép truy cập.
- **Trigger:** User mở Workspace.
- **Success Outcome:** Hiển thị đúng dữ liệu theo quyền.

### UC-M01-04 — Manage Workspace Settings

- **Primary Actor:** Admin
- **Goal:** Quản lý các cấu hình thuộc phạm vi Workspace.
- **Trigger:** Admin mở Workspace Settings.
- **Success Outcome:** Cấu hình hợp lệ được cập nhật và audit.
- **Boundary:** LegalRule/EngineeringRule không quản lý trong UC này.

---

## M02 — Assessment Setup & Source

### UC-M02-01 — Create Assessment

- **Primary Actor:** Customer
- **Goal:** Tạo một Assessment mới cho một hệ thống/project cần đánh giá.
- **Trigger:** Customer chọn Create Assessment.
- **Precondition:** Customer có quyền tạo Assessment trong Workspace.
[ADD] - **Main Scope — Minimal Project Setup:** Establish assessed system/project identity → establish Workspace context → establish source scope tối thiểu → create Assessment.
[ADD] - **Boundary:** Đây là setup tối thiểu để xác định đúng đối tượng Assessment, **không phải Business Questionnaire/Wizard** và không thay thế Initial Interview.
- **Success Outcome:** Assessment mới được tạo và sẵn sàng cho source configuration.

### UC-M02-02 — View Assessment

- **Primary Actor:** Customer
- **Goal:** Xem trạng thái hiện tại của Assessment.
- **Trigger:** Customer mở một Assessment.
- **Success Outcome:** Hiển thị source version, Workflow Run, scan/interview/investigation/evaluation/report/remediation state tương ứng.

### UC-M02-03 — Connect Git Provider

- **Primary Actor:** Customer
- **Secondary Actor:** Git Provider
- **Goal:** Cấp quyền cho LCSP truy cập repository được phép.
- **Trigger:** Customer chọn Connect Git Provider.
- **Success Outcome:** LCSP có authorization hợp lệ trong phạm vi được cấp.

### UC-M02-04 — Configure Assessment Source

- **Primary Actor:** Customer
- **Secondary Actor:** Git Provider
- **Goal:** Chọn chính xác source/version được Assessment sử dụng.
- **Main Scope:** Repository → Branch → Commit/Source Version → Confirm → Pin.
- **Success Outcome:** Assessment gắn với source version rõ ràng.
- **Business Rule:** Technical Evidence luôn phải trace được về source version tương ứng.

---

## M03 — Repository Scan & Technical Evidence

### UC-M03-01 — Start Repository Scan

- **Primary Actor:** Customer
- **Goal:** Bắt đầu technical scan cho source version đã pin.
- **Trigger:** Customer bấm **Start Scan**.
- **Precondition:** Assessment đã có source hợp lệ.
- **Success Outcome:** Scan run được tạo và Scanner bắt đầu xử lý.

### UC-M03-02 — Monitor Scan Progress

- **Primary Actor:** Customer
- **Goal:** Theo dõi scan và PGE processing qua Workflow Run.
- **Possible Status:** Waiting / Scanning / Building PGE / Processing / Completed / Failed.
[ADD] - **Technical Coverage State:** Workflow Run có thể hiển thị `READY / PARTIAL / UNAVAILABLE` khi trạng thái coverage đã được Orchestrator/scanner workflow xác định.
[ADD] - **Business Rule:** `PARTIAL` không tự động block Initial Interview; chỉ khi coverage gap làm một material handoff-relevant frontier không thể xác lập an toàn mới ảnh hưởng readiness. `UNAVAILABLE` thuộc technical recovery/retry flow, không biến thành Customer business question.
- **Success Outcome:** Customer biết hệ thống đang ở stage nào và có cần action hay không.

### UC-M03-03 — Review Technical Evidence

- **Primary Actor:** Customer
- **Goal:** Xem LCSP đang quan sát được gì từ repository/source.
- **Success Outcome:** Customer xem được bounded evidence explanation, evidence relationship, source/version và coverage limitation liên quan.
- **Business Rule:** Technical Evidence không tự động trở thành Business Truth.
[ADD] - **Business Rule:** Không tìm thấy Technical Evidence **không đồng nghĩa** behavior không tồn tại trong business reality.
[ADD] - **Customer-safe Evidence:** Evidence hiển thị cho Customer phải bounded/authorized/sanitized; không mặc định expose raw source, secret, restricted technical detail hoặc cross-tenant information.

[DELETE] ### UC-M03-04 — Review Technical Coverage

[DELETE] - **Primary Actor:** Customer
[DELETE] - **Goal:** Hiểu technical coverage hiện tại của scan.
[DELETE] - **States:** READY / PARTIAL / UNAVAILABLE.
[DELETE] - **Success Outcome:** Customer thấy limitation nếu coverage chưa đầy đủ.
[DELETE] - **Business Rule:** Không tìm thấy evidence không đồng nghĩa behavior không tồn tại trong business reality.

---

## M04 — Business Context & Interview

[ADD] **Common Business Rule — Actor/Audit Provenance:** Mọi Customer statement và mọi material confirmation/correction/supersession phải trace được về **authenticated respondent**, timestamp, assessment/source version và related Interview turn; evidence refs được giữ khi áp dụng.
[ADD] **Identity Boundary:** Actor identity đến từ authenticated application/runtime context, **không được suy ra chỉ từ nội dung prompt/customer text**.

### UC-M04-01 — Provide Initial Assessment Context

- **Primary Actor:** Customer
- **Goal:** Cung cấp/làm rõ đủ business context nền để Assessment chuyển sang EngineeringRule stage.
- **Trigger:** Scanner/PGE đã usable và Initial Interview bắt đầu.
- **Key Behavior:** Interview Agent tự chọn material customer-owned uncertainty cần hỏi; không chạy fixed questionnaire.
[ADD] - **Possible Outcomes:**
[ADD]   - `WAITING_FOR_CUSTOMER`
[ADD]   - `CONTEXT_READY`
[ADD]   - `BLOCKED_OR_UNRESOLVED`
[ADD]   - `FAILED`
[UPDATED] - **Success Outcome:** `CONTEXT_READY` khi baseline business context đủ để downstream tiếp tục mà không invent material Customer assumption.
[ADD] - **Alternate Flow — Save & Exit / Resume:** Customer có thể Save & Exit; khi quay lại, hệ thống revalidate PGE/context/pending question và resume đúng Interview thread nếu còn valid, không restart toàn Interview.
- **Boundary:** `CONTEXT_READY` không có nghĩa toàn bộ possible business topic đã được hỏi.

[DELETE] ### UC-M04-02 — Resume Pending Interview

[DELETE] - **Primary Actor:** Customer
[DELETE] - **Goal:** Tiếp tục một Interview chưa hoàn thành sau Save & Exit / return.
[DELETE] - **Trigger:** Customer mở lại Assessment đang waiting for input.
[DELETE] - **Key Behavior:** Revalidate PGE/context/pending question trước khi resume.
[DELETE] - **Success Outcome:** Resume đúng Interview thread nếu còn valid.
[DELETE] - **Must Not:** Restart toàn Interview chỉ vì Customer quay lại.

[DELETE] ### UC-M04-03 — Review Confirmed Business Context
[UPDATED] ### UC-M04-02 — Review Confirmed Business Context

- **Primary Actor:** Customer
- **Goal:** Xem LCSP hiện đang dùng business context nào làm authoritative downstream input.
[DELETE] - **Success Outcome:** Hiển thị các context item ở trạng thái Customer-confirmed/CONFIRMED cùng history/provenance phù hợp.
[UPDATED] - **Success Outcome:** Hiển thị authoritative context với hai dimension tách biệt: `source = CUSTOMER_CONFIRMED` và `resolutionState = CONFIRMED`, cùng history/provenance phù hợp.

[DELETE] ### UC-M04-04 — Update Confirmed Business Context
[UPDATED] ### UC-M04-03 — Update Confirmed Business Context

- **Primary Actor:** Customer
- **Goal:** Sửa một business context đã confirmed khi business reality thay đổi hoặc giá trị cũ không còn đúng.
- **Key Behavior:** Giữ history, tạo context revision mới, Confirm/Adjust nếu interpretation material/non-trivial.
- **If Material:** Interview chỉ flag `DOWNSTREAM_IMPACT`; Orchestrator quyết định selective rerun/rescope.
- **Success Outcome:** Context mới được lưu có traceability; value cũ vẫn audit được.

[DELETE] ### UC-M04-05 — Resolve Targeted Business Clarification
[UPDATED] ### UC-M04-04 — Resolve Targeted Business Clarification

- **Primary Actor:** Customer
- **Goal:** Làm rõ đúng business ambiguity đang chặn một Investigator run.
- **Trigger:** Investigator trả `NEEDS_BUSINESS_CONTEXT`.
- **Interview Input:** `businessContextNeed`, `resolutionCriteria`, optional `whyNeeded`, governed evidence refs, `originatingInvestigationReference`.
[DELETE] - **Possible Outcome:**
[DELETE]   - `WAITING_FOR_CUSTOMER`
[DELETE]   - `CONTEXT_RESOLVED`
[DELETE]   - `BLOCKED_OR_UNRESOLVED`
[UPDATED] - **Possible Outcomes:**
[UPDATED]   - `WAITING_FOR_CUSTOMER`
[UPDATED]   - `CONTEXT_RESOLVED`
[UPDATED]   - `BLOCKED_OR_UNRESOLVED`
[UPDATED]   - `FAILED`
- **Success Outcome:** `CONTEXT_RESOLVED` khi `resolutionCriteria` đã được thỏa mãn bằng confirmed context.
- **Boundary:** Không restart Initial Interview; không nhận EngineeringRule detail; opaque continuation vẫn do Orchestrator giữ.
[ADD] - **Alternate Flow — Save & Exit / Resume:** Resume đúng targeted clarification thread nếu origin/context/evidence còn valid; opaque continuation/checkpoint vẫn do Orchestrator sở hữu.

---

## M05 — EngineeringRule, Investigation & Evaluation

[DELETE] ### UC-M05-01 — Review Applicable EngineeringRules

[DELETE] - **Primary Actor:** Customer
[DELETE] - **Goal:** Xem những EngineeringRule nào đang được dùng cho Assessment.
[DELETE] - **System Behavior bên dưới:** Check READY rules → Determine Applicable EngineeringRules → Pin applicable versions.
[DELETE] - **Success Outcome:** Customer thấy đúng rule set của Assessment.
[DELETE] - **Boundary:** Không phải mọi READY EngineeringRule trong DB đều áp dụng cho Assessment.

[DELETE] ### UC-M05-02 — Review Investigation Findings
[UPDATED] ### UC-M05-01 — Review Investigation Findings

- **Primary Actor:** Customer
- **Goal:** Xem findings/evidence claims do technical investigation tạo ra.
- **Trigger:** Planner/Investigator đã chạy.
- **Success Outcome:** Customer xem được finding, evidence, limitation và EngineeringRule liên quan.
- **Boundary:** Planner/Investigator tự chạy; Customer không cần Start Investigation.

[DELETE] ### UC-M05-03 — Review Compliance Evaluation
[UPDATED] ### UC-M05-02 — Review Compliance Evaluation

- **Primary Actor:** Customer
- **Goal:** Xem deterministic evaluation result của từng EngineeringRule.
- **Result:** COMPLIANT / NON_COMPLIANT / UNKNOWN.
- **Success Outcome:** Customer thấy result và căn cứ/limitation tương ứng.
[ADD] - **Assessment Basis / Traceability:** Hiển thị applicable EngineeringRule/version, evidence, result và limitation khi phù hợp; EngineeringRule không cần Customer-facing Use Case riêng.
- **Note:** `UNKNOWN` ở evaluation khác với business uncertainty trong Interview.

[DELETE] ### UC-M05-04 — Review AI Risk Classification
[UPDATED] ### UC-M05-03 — Review AI Risk Classification

- **Primary Actor:** Customer
- **Goal:** Xem AI Risk Classification của Assessment sau evaluation.
- **Success Outcome:** Customer xem classification và supporting assessment context/result.
- **Boundary:** Interview Agent không quyết định AI Risk Classification.

---

## M06 — Gap Analysis & Reporting

### UC-M06-01 — Review Compliance Gaps

- **Primary Actor:** Customer
- **Goal:** Xem các compliance gap được xác định từ Assessment.
- **Traceability:** EngineeringRule → Evidence → Evaluation → Gap.
- **Success Outcome:** Customer hiểu gap là gì và vì sao gap tồn tại.

### UC-M06-02 — Review Remediation Recommendations

- **Primary Actor:** Customer
- **Goal:** Xem hướng xử lý phù hợp cho từng gap.
- **Possible Recommendation:** Code remediation / Process change / Governance action / Additional clarification.
- **Boundary:** Không phải gap nào cũng sửa được bằng code.

[DELETE] ### UC-M06-03 — Generate Assessment Report

[DELETE] - **Primary Actor:** Customer
[DELETE] - **Goal:** Tạo report từ authoritative Assessment state tại thời điểm generation.
[DELETE] - **Report Input:** Source version, confirmed context, applicable ERs, evidence, evaluation, AI Risk Classification, gap, remediation status, limitations.
[DELETE] - **Success Outcome:** Report revision được tạo và trace được về Assessment state tương ứng.

[DELETE] ### UC-M06-04 — View / Export Assessment Report

[DELETE] - **Primary Actor:** Customer
[DELETE] - **Goal:** Xem hoặc export report theo format được LCSP hỗ trợ.
[DELETE] - **Success Outcome:** Customer truy cập đúng report revision và biết report được tạo từ state nào.

[UPDATED] ### UC-M06-03 — Review / Download Assessment Report

[UPDATED] - **Primary Actor:** Customer
[UPDATED] - **Goal:** Xem Assessment result được tổng hợp tại một report revision cụ thể và download theo **fixed format** được LCSP hỗ trợ trong MVP.
[ADD] - **System Behavior:** Hệ thống generate report revision từ authoritative Assessment state sau Evaluation → AI Risk Classification → Gap/Remediation Analysis; Customer không cần một Use Case riêng để trigger report generation.
[ADD] - **Report Input:** Source version, confirmed context, applicable ERs, evidence, evaluation, AI Risk Classification, gap, remediation status, limitations.
[UPDATED] - **Possible Action:** View / Download.
[UPDATED] - **Success Outcome:** Customer truy cập/download đúng report revision và biết report được tạo từ Assessment state nào.
[ADD] - **MVP Boundary:** Chưa hỗ trợ generalized export hoặc lựa chọn nhiều export format.

---

## M07 — Assessment Lifecycle & Reassessment

### UC-M07-01 — Review Assessment History

- **Primary Actor:** Customer
- **Goal:** Xem lịch sử thay đổi của Assessment.
- **History Scope:** Source version, context revision, EngineeringRule version, evaluation, report, remediation iteration, workflow events.
- **Business Rule:** Không silent overwrite lịch sử cũ.

### UC-M07-02 — Resume Assessment

- **Primary Actor:** Customer
- **Goal:** Tiếp tục Assessment chưa hoàn thành.
- **Trigger:** Customer quay lại một incomplete Assessment.
- **Key Behavior:** Load checkpoint → validate current dependencies/state → resume appropriate point.
[ADD] - **Alternate Flow — Dependency Changed:** Orchestrator computes impact → Workflow Run informs Customer → selective rerun/rescope → resume appropriate point.
[ADD] - **Boundary:** Customer không quyết định dependency graph hoặc rerun granularity.
- **Boundary:** Không mặc định restart Assessment từ đầu.

### UC-M07-03 — Reassess with New Source Version

- **Primary Actor:** Customer
- **Goal:** Đánh giá lại hệ thống với commit/source version mới.
- **Main Scope:** Select new source → Pin → Scan again → Build new evidence/PGE → rerun affected assessment stages.
- **Business Rule:** Evidence của source version cũ không silent reuse cho source version mới.

[DELETE] ### UC-M07-04 — Review Assessment Impact After Dependency Change

[DELETE] - **Primary Actor:** Customer
[DELETE] - **Goal:** Hiểu Assessment bị ảnh hưởng gì khi dependency thay đổi trong lúc workflow đang pause/running.
[DELETE] - **Example Dependency:** Source version, business context revision, EngineeringRule version, legal baseline.
[DELETE] - **Success Outcome:** Customer thấy phần nào đang cần re-evaluate/re-run trước khi workflow tiếp tục.
[DELETE] - **Boundary:** Orchestrator quyết định selective rerun/rescope.

---

## M08 — Code Remediation

### UC-M08-01 — Start Code Remediation

- **Primary Actor:** Customer
- **Goal:** Bắt đầu remediation cho một technical gap có thể xử lý bằng code.
- **Trigger:** Customer chọn Start Code Remediation.
- **Success Outcome:** Remediation run được tạo với scope rõ ràng.
[ADD] - **Alternate/Subflow — Write Access:** Nếu write permission chưa đủ, hệ thống yêu cầu Customer authorize/escalate đúng repository scope với Git Provider, validate access rồi tiếp tục remediation.

[DELETE] ### UC-M08-02 — Provide Repository Write Access

[DELETE] - **Primary Actor:** Customer
[DELETE] - **Secondary Actor:** Git Provider
[DELETE] - **Goal:** Cấp quyền cần thiết để LCSP có thể push/update branch/PR.
[DELETE] - **Trigger:** Remediation cần write access nhưng quyền hiện tại chưa đủ.
[DELETE] - **Success Outcome:** Write access được validate.

[DELETE] ### UC-M08-03 — Review Proposed Code Patch
[UPDATED] ### UC-M08-02 — Review Proposed Code Patch

- **Primary Actor:** Customer
- **Goal:** Xem patch được đề xuất trước khi bất kỳ thay đổi nào được push.
- **Success Outcome:** Customer thấy file/patch/gap liên quan và verification information.

[DELETE] ### UC-M08-04 — Approve or Reject Code Patch
[UPDATED] ### UC-M08-03 — Approve or Reject Code Patch

- **Primary Actor:** Customer
- **Goal:** Thực hiện Human approval gate trước push/update PR.
- **Outcome:** Approve hoặc Reject.
- **Business Rule:** Patch thay đổi sau approval → approval cũ không tự động áp dụng cho patch mới.

[DELETE] ### UC-M08-05 — Review Pull Request

[DELETE] - **Primary Actor:** Customer
[DELETE] - **Secondary Actor:** Git Provider
[DELETE] - **Goal:** Xem branch/PR được tạo hoặc cập nhật sau approval.
[DELETE] - **Success Outcome:** Customer có link/status PR và có thể tiếp tục review ngoài Git Provider nếu cần.

[DELETE] ### UC-M08-06 — Review and Continue Remediation
[UPDATED] ### UC-M08-04 — Review and Continue Remediation

- **Primary Actor:** Customer
- **Goal:** Xem kết quả verification sau remediation và quyết định có tiếp tục vòng tiếp theo hay không.
- **Possible Result:** REMEDIATION VERIFIED / Unresolved.
[ADD] - **PR Flow:** Patch approved → push/update branch/PR → expose PR link/status → verify → `REMEDIATION VERIFIED` hoặc `Unresolved`.
[ADD] - **Boundary:** Nếu LCSP chỉ hiển thị PR link/status và detailed review diễn ra trên Git Provider, không tách `Review Pull Request` thành Use Case riêng.
- **Business Rule:** Hệ thống không auto-retry. Nếu unresolved, Customer chủ động chọn Continue Remediation.

---

## M09 — Legal Governance & EngineeringRule Management

[ADD] **Module Boundary:** M09 trả lời **“What sources/rules are governed?”** — sở hữu Legal Source identity, provenance, version, active state; LegalRule; Triage; EngineeringRule governance. M09 không sở hữu maintenance schedule/run execution policy.

### UC-M09-01 — Manage Legal Sources

- **Primary Actor:** Admin
- **Goal:** Quản lý authoritative legal sources dùng cho governance.
[DELETE] - **Scope:** Add / Update / Activate / Deactivate / Review provenance.
[UPDATED] - **Scope:** Add / Update / Activate / Deactivate / Review **Legal Source identity, provenance, version và active state**.
- **Success Outcome:** Legal source được quản lý có version/status/provenance rõ ràng.

### UC-M09-02 — Review Legal Source Content

- **Primary Actor:** Admin
- **Goal:** Review nội dung legal source đã ingest/crawl trước khi dùng cho LegalRule governance.
- **Success Outcome:** Admin xác nhận nội dung/source phù hợp để tiếp tục xử lý hoặc yêu cầu correction.
- **Boundary:** Scraped text không tự động trở thành LegalRule.

### UC-M09-03 — Manage LegalRules

- **Primary Actor:** Admin
- **Goal:** Quản lý structured LegalRule có traceability về legal source.
- **Expected Information:** Source reference, version, status, legal text/reference, provenance.
- **Success Outcome:** LegalRule revision được quản trị rõ ràng.

### UC-M09-04 — Review Legal Rule Triage

- **Primary Actor:** Admin
- **Goal:** Review kết quả Triage của LegalRule/content.
- **Classification:**
  - ENGINEERING_RULE_CANDIDATE
  - CONTEXT_ONLY
  - REJECT
- **Boundary:** Triage không đọc Assessment source code để chọn rule áp dụng cho Assessment.

### UC-M09-05 — Manage EngineeringRules

- **Primary Actor:** Admin
- **Goal:** Tạo/cập nhật/quản lý EngineeringRule từ governed candidate.
[DELETE] - **Flow:** Candidate → Preparation → Review → Version → READY.
[UPDATED] - **Flow:** Candidate → Preparation → Validation/Review → Version → `READY` khi governed readiness criteria được thỏa mãn.
[ADD] - **Business Rule:** `READY` không yêu cầu mandatory Human approval gate; Admin có thể review/chỉnh sửa theo quyền nhưng không có action Approve bắt buộc.
- **Success Outcome:** EngineeringRule có version/status/source trace đầy đủ.

[DELETE] ### UC-M09-06 — Review / Approve EngineeringRule Version

[DELETE] - **Primary Actor:** Admin
[DELETE] - **Goal:** Review một EngineeringRule version và quyết định có đủ điều kiện `READY` hay không.
[DELETE] - **Review Scope:** Legal/source trace, technical requirement, expected evidence, scope, version/history.
[DELETE] - **Outcome:** Approve → READY / Reject or Needs Update → not READY.

---

## M10 — Legal Maintenance & Administration

[ADD] **Module Boundary:** M10 trả lời **“How/when are governed Legal Sources refreshed?”** — sở hữu maintenance configuration và execution lifecycle: source assignment/reference, schedule, enable/disable và run status. M10 không quản lại Legal Source identity/provenance/version/active governance state, LegalRule hoặc EngineeringRule.

[DELETE] ### UC-M10-01 — Configure Legal Maintenance

[DELETE] - **Primary Actor:** Admin
[DELETE] - **Goal:** Cấu hình nguồn/schedule/status cho legal maintenance.
[DELETE] - **Success Outcome:** Maintenance configuration được lưu và audit.
[DELETE] - **Business Rule:** Legal change không tự động overwrite LegalRule/EngineeringRule đang active.

[UPDATED] ### UC-M10-01 — Configure Legal Maintenance

[UPDATED] - **Primary Actor:** Admin
[UPDATED] - **Goal:** Chủ động cấu hình/chỉnh sửa maintenance cho governed Legal Sources: source assignment/reference, schedule, enable/disable và maintenance status.
[UPDATED] - **Success Outcome:** Maintenance configuration được validate, lưu và audit; thay đổi áp dụng cho maintenance runs tiếp theo.
[UPDATED] - **Business Rule:** Legal change không tự động overwrite LegalRule/EngineeringRule đang active.
[ADD] - **Boundary:** Add/update Legal Source identity, provenance, version hoặc active governance state vẫn thuộc M09.

### UC-M10-02 — Review Legal Update Results

- **Primary Actor:** Admin
- **Goal:** Review kết quả legal maintenance run và impact tới LegalRule/EngineeringRule.
- **Success Outcome:** Admin biết source nào thay đổi, rule nào bị ảnh hưởng và cần governance action nào.
- **Business Rule:** Crawl fail không được hiểu thành “không có thay đổi”.

### UC-M10-03 — Review Governance / Audit History

- **Primary Actor:** Admin
- **Goal:** Xem lịch sử governance và maintenance.
- **History Scope:** Legal Source revision, LegalRule change, EngineeringRule version/approval, maintenance run, governance action.
- **Success Outcome:** Có audit trail đủ để truy vết thay đổi governance.

---

# 6. Actor → Module Mapping

| Actor | Module chính |
| --- | --- |
| **Customer** | M01, M02, M03, M04, M05, M06, M07, M08 |
| **Admin** | M01, M09, M10; có thể xem Workspace theo quyền |
| **Git Provider** | M02, M08 với vai trò secondary actor |

[ADD] **Authorization Note:** Actor→Module mapping không đồng nghĩa role-wide authorization. Mỗi Customer/Admin action vẫn phải pass permission check trong đúng Workspace/resource scope.

---

# 7. Internal behavior KHÔNG tách thành Use Case riêng

Các bước sau cần được mô tả trong Normal Flow / System Behavior của UC tương ứng, **không tạo Actor/UC riêng**:

- Scanner execution
- Build Program Evidence Graph
- Technical Coverage calculation
- Context Sufficiency reasoning
- Check READY EngineeringRules
- Determine Applicable EngineeringRules
- Pin EngineeringRules
- Planner execution
- Investigator execution
- `NEEDS_BUSINESS_CONTEXT` detection
- Deterministic Evaluation
- AI Risk Classification engine
- Gap Analyzer
- Generate Patch
- Verify Patch
- Selective rerun / rescope
- Root / Assessment Orchestrator
- Legal crawler
- Triage engine
- EngineeringRule preparation agent/component

Ví dụ:

```text
Check READY EngineeringRules
→ Determine Applicable EngineeringRules
→ Pin applicable ERs
```

[DELETE] là internal system behavior của Assessment. Business goal của Customer là **Review Applicable EngineeringRules**, không phải “Check READY EngineeringRules”.
[UPDATED] là internal system behavior của Assessment. Customer **không có Use Case riêng** để review applicable rule set; applicable EngineeringRule/version được surface như traceability trong Investigation/Evaluation/Report khi phù hợp.

[ADD] Các behavior sau cũng được giữ dưới UC tương ứng thay vì tách thành UC riêng:
[ADD] - Technical Coverage state/limitation → `Monitor Scan Progress` + `Review Technical Evidence`.
[ADD] - Resume Interview/checkpoint revalidation → Initial/Targeted Interview alternate flow.
[ADD] - Report generation → internal system behavior trước `Review / Download Assessment Report`.
[ADD] - Dependency impact/selective rerun → `Resume Assessment` + Workflow Run.
[ADD] - Repository write authorization → `Start Code Remediation` subflow.
[ADD] - PR link/status → `Review and Continue Remediation`.

---

# 8. Các điểm Leader cần review / confirm

[DELETE] Để BA freeze Master Use Case Catalog và bắt đầu viết Use Case Specification chi tiết, đề nghị Leader review các điểm sau:

[DELETE] 1. **Actor scope:** Customer / Admin / Git Provider đã đủ chưa? Có actor nghiệp vụ nào khác cần xuất hiện ở level này không?
[UPDATED] 1. **Actor scope — CONFIRMED:** Customer / Admin / Git Provider là actor set ở Master Use Case level. Mỗi action vẫn phải pass permission check cụ thể trong đúng Workspace/Assessment/resource scope.

[DELETE] 2. **Admin boundary:** Admin có đúng chỉ quản Governance/Legal Maintenance và không tham gia Customer Interview flow không?
[UPDATED] 2. **Admin boundary — CONFIRMED:** Admin quản Governance/Legal Maintenance theo quyền và không tham gia Customer Interview flow.

[DELETE] 3. **Module grouping:** Có đồng ý tách M09 `Legal Governance & EngineeringRule Management` và M10 `Legal Maintenance & Administration` hay muốn merge thành một module Governance?
[UPDATED] 3. **Module grouping — CONFIRMED:** Giữ M09/M10 tách riêng. M09 = governed source/rule artifacts; M10 = maintenance configuration/execution lifecycle.

[DELETE] 4. **Customer visibility:** Customer có cần UC riêng `Review Applicable EngineeringRules`, hay EngineeringRule chỉ nên là technical detail nằm trong Findings/Report?
[UPDATED] 4. **Customer visibility — CONFIRMED:** Không có UC riêng `Review Applicable EngineeringRules`; rule/version được hiển thị như assessment traceability trong Investigation/Evaluation/Report.

[DELETE] 5. **Code Remediation:** 6 UC trong M08 có nằm trong scope release hiện tại không hay một phần nên đánh dấu Phase 2?
[UPDATED] 5. **Code Remediation — CONFIRMED:** Giữ trong release hiện tại, giảm granularity **6 → 4 UC**; write access là subflow, PR link/status merge vào remediation continuation/result.

[DELETE] 6. **Report Export:** `View / Export Assessment Report` có cần export thực sự ở MVP hay chỉ View/Download một format cố định?
[UPDATED] 6. **Report delivery — CONFIRMED:** MVP = **View + Download fixed format**; chưa hỗ trợ generalized/multi-format export. Report generation là system behavior, không tách Customer UC riêng.

[DELETE] 7. **Reassessment:** `Review Assessment Impact After Dependency Change` có cần Customer-facing UC riêng hay chỉ là system behavior + notification trong Resume Assessment?
[UPDATED] 7. **Dependency impact — CONFIRMED:** Không có UC riêng; Orchestrator tính impact/selective rerun-rescope và Workflow Run/Resume Assessment hiển thị cho Customer.

[DELETE] 8. **Admin approval:** `Review / Approve EngineeringRule Version` có phải explicit Human Gate bắt buộc trước `READY` không?
[UPDATED] 8. **EngineeringRule READY — CONFIRMED:** Không yêu cầu mandatory Human approval gate. Rule chuyển `READY` khi governed readiness criteria được thỏa mãn.

[DELETE] 9. **Legal Maintenance:** Scheduling là action Admin cấu hình hay system schedule đã fixed và Admin chỉ review results?
[UPDATED] 9. **Legal Maintenance — CONFIRMED:** Admin thực sự được cấu hình/chỉnh sửa source assignment/reference, schedule, enable/disable và maintenance status; source governance identity/provenance vẫn thuộc M09.

[DELETE] 10. **Final count:** Sau khi các điểm trên được chốt, BA sẽ freeze catalog trước khi viết full UC Specification.
[UPDATED] 10. **Final count — UPDATED:** Sau các merge/remove/renumber đã chốt, Master Catalog còn **36 Use Case**.

[ADD] **Additional review decisions applied:**
[ADD] - M03 Technical Coverage không đứng thành UC riêng; merge vào Scan Progress/Evidence.
[ADD] - M04 Resume Pending Interview không đứng thành UC riêng; merge vào Initial/Targeted Interview alternate flow.
[ADD] - M04 Initial Interview có đủ `WAITING_FOR_CUSTOMER / CONTEXT_READY / BLOCKED_OR_UNRESOLVED / FAILED`; Targeted Clarification bổ sung `FAILED`.
[ADD] - M04 Customer statement/material confirmation phải có authenticated actor/audit provenance.
[ADD] - M06 Generate Report không đứng thành Customer UC riêng; report generation là system behavior.
[ADD] - M02 Create Assessment bao gồm Minimal Project Setup tối thiểu, không phải questionnaire.

---

# 9. Đề xuất thứ tự viết Use Case Specification chi tiết

Nếu catalog được approve, nên viết chi tiết theo thứ tự phụ thuộc flow:

```text
M02 Assessment Setup
→ M03 Scan / Evidence
→ M04 Interview
→ M05 Investigation / Evaluation
→ M06 Gap / Report
→ M07 Lifecycle
→ M08 Remediation
→ M09-M10 Admin Governance
→ M01 common/auth cuối cùng nếu auth đã có sẵn
```

Ưu tiên đầu tiên nên là các UC ảnh hưởng trực tiếp architecture hiện tại:

- UC-M02-01 Create Assessment
- UC-M02-04 Configure Assessment Source
- UC-M03-01 Start Repository Scan
- UC-M04-01 Provide Initial Assessment Context
[DELETE] - UC-M04-05 Resolve Targeted Business Clarification
[UPDATED] - UC-M04-04 Resolve Targeted Business Clarification
[DELETE] - UC-M05-01 Review Applicable EngineeringRules
[DELETE] - UC-M05-02 Review Investigation Findings
[UPDATED] - UC-M05-01 Review Investigation Findings
[DELETE] - UC-M05-03 Review Compliance Evaluation
[UPDATED] - UC-M05-02 Review Compliance Evaluation
[DELETE] - UC-M06-03 Generate Assessment Report
[UPDATED] - UC-M06-03 Review / Download Assessment Report
[DELETE] - UC-M08-04 Approve or Reject Code Patch
[UPDATED] - UC-M08-03 Approve or Reject Code Patch
- UC-M09-04 Review Legal Rule Triage
[DELETE] - UC-M09-06 Review / Approve EngineeringRule Version

---

## 10. Review Result

[DELETE] **Leader Decision:** _Pending_  
[UPDATED] **Leader Decision:** Approved decisions applied; catalog revised with marked changes.  

[DELETE] **Approved module structure:** _Pending_  
[UPDATED] **Approved module structure:** M01–M10 retained; M09/M10 remain separate with clarified boundaries.  

[DELETE] **Approved UC count:** _Pending_  
[UPDATED] **Approved UC count:** **36 Use Cases** after confirmed merge/remove/renumber decisions.  

[DELETE] **Notes:** _Pending_
[ADD] **Notes:** Use Case granularity now follows Actor business goals; merged technical/resume/generation/authorization behaviors remain documented as System Behavior / Alternate Flow / Subflow rather than standalone Use Cases.

