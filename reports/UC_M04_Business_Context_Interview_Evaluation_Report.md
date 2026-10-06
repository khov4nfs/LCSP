# BÁO CÁO ĐÁNH GIÁ TÀI LIỆU USE CASE (UC)
## Module: M04 — BUSINESS CONTEXT & INTERVIEW
*(Đối chiếu trực tiếp giữa Tài liệu UC M04, Module M02 Assessment Setup, M03 Repository Scan và Hiện trạng Codebase LCSP)*

**Hệ thống:** LCSP (Legal Compliance Software Platform)  
**Tài liệu đánh giá:** [Business Use Case Specification · M04](https://docs.google.com/document/d/1Kgffmn2quys3I3aW_bw_jIu6KEz69NHD6-EljHyv6Vw/edit?tab=t.0)  
**Ngày đánh giá:** 05/10/2026  
**Người thực hiện:** Antigravity AI Engineering & Architecture Review  

---

## 1. TỔNG QUAN ĐÁNH GIÁ

Tài liệu đặc tả Use Case **M04 — BUSINESS CONTEXT & INTERVIEW** đã mô tả đúng tư duy nghiệp vụ hiện đại của hệ thống LCSP:
- **Tập trung và tinh gọn:** Không bắt Customer trả lời bảng câu hỏi cố định dài dòng (no static questionnaire); chỉ phỏng vấn làm rõ các điểm mù nghiệp vụ (*business uncertainty*) mà mã nguồn không thể tự chứng minh.
- **Hỗ trợ 0-question flow:** Cho phép kết thúc ngay với `CONTEXT_READY` nếu Technical Evidence từ bước Quét mã nguồn (M03) đã đủ rõ ràng.
- **Phân định ranh giới rõ ràng:** Technical Evidence là cơ sở gợi ý câu hỏi, nhưng Customer mới là nguồn xác thực sự thật nghiệp vụ (*Business Reality*).
- **Phân tách 2 chế độ phỏng vấn:** Initial Interview (phỏng vấn ban đầu - `UC-M04-01`) và Targeted Clarification (làm rõ đích danh trong quá trình điều tra - `UC-M04-02`).

Tuy nhiên, khi đối chiếu tài liệu với **chuỗi liên kết từ Module M02 (Assessment Setup), M03 (Repository Scan)** và **Kiến trúc hệ thống thực tế** (Contracts `@lcsp/contracts`, Backend NestJS CQRS, Frontend Next.js, DeepAgents Orchestration Engine), tài liệu vẫn còn **nhiều điểm chưa thực hiện tốt, xung đột thuật ngữ, nhầm lẫn khái niệm và thiếu sót các luồng xử lý kỹ thuật quan trọng**.

---

## 2. CÁC PHẦN CHƯA THỰC HIỆN TỐT & ĐIỂM HẠN CHẾ

### 2.1. Nhầm lẫn giữa Trigger và Precondition & Chưa chuẩn hóa điều kiện Hand-off từ M02/M03
* **Vấn đề trong tài liệu:**
  - Tại **UC-M04-01**, phần Trigger ghi: *"Sau khi Technical Evidence đủ điều kiện để tiếp tục Assessment, hệ thống bắt đầu bước Interview..."* (chính tài liệu đang có các comment thắc mắc `[a]`, `[b]`, `[c]` về việc đi lạc giữa Precondition và Trigger).
  - Phần Precondition chỉ ghi chung chung: *"Technical Evidence đã đủ điều kiện để bắt đầu Interview theo rule của hệ thống"*.
* **Hạn chế kỹ thuật & thực tế hệ thống:**
  - **Trigger** phải là một sự kiện hoặc hành động cụ thể: *Sự kiện quét mã nguồn hoàn tất (Stage chuyển sang `INTERVIEW` sau khi `evidenceAccepted = true` và `evidenceGraphReady = true` ở M03)* hoặc *Customer truy cập vào Assessment đang ở trạng thái chờ phỏng vấn*.
  - "Technical Evidence đủ điều kiện" là **Precondition (Tiền điều kiện)**. Cụ thể theo kiến trúc LCSP:
    - Báo cáo kỹ thuật của Snapshot hiện tại phải ở trạng thái `ACCEPTED`.
    - Độ phủ kỹ thuật `TechnicalCoverage` phải là `READY` hoặc `PARTIAL` (được duyệt bởi `PartialCoveragePolicyDecision`). Nếu là `UNAVAILABLE` hoặc vi phạm điều kiện tối thiểu (`INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE`), hệ thống không được phép kích hoạt Interview.

---

### 2.2. Xung đột Naming Convention & Vi phạm Chuẩn Contract (`packages/contracts`)
* **Sai lệch tên Reasoning Mode (ALN-M04-06 & UI Traceability):**
  - Tài liệu UC gọi tên mode của Targeted Clarification là `INVESTIGATOR_RESOLUTION`.
  - Trong Contract chuẩn của dự án (`packages/contracts/src/evidence/assessment-interview.ts`), enum chuẩn bắt buộc là:
    ```ts
    export const ASSESSMENT_INTERVIEW_MODES = {
      initialInterview: "INITIAL_INTERVIEW",
      businessContextResolution: "BUSINESS_CONTEXT_RESOLUTION",
    } as const;
    ```
  - Việc dùng tên tự phát `INVESTIGATOR_RESOLUTION` vi phạm quy tắc `as const` và làm sai lệch hợp đồng giao tiếp giữa API và AI Agent.
* **Sử dụng mã giả định `[MSG-xxx]` thay vì Problem Codes & i18n Keys:**
  - Tài liệu đưa ra hàng loạt mã `[MSG-039]` đến `[MSG-046]`.
  - Quy tắc toàn dự án yêu cầu dùng mã `SCREAMING_SNAKE_CASE` (như `INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE`, `INVALID_INTERVIEW_STATE`, `STALE_SESSION_REVISION`, `INTERVIEW_RUNTIME_FAILED`) kết hợp key đa ngôn ngữ `@lcsp/i18n` (như `pages.assessmentFlow.interview.errors.*`).

---

### 2.3. Bỏ sót Tính năng Xem Dẫn chứng Mã nguồn (Source Code Snippet Inspection)
* **Vấn đề thực tế:**
  - Hệ thống LCSP cung cấp tính năng cốt lõi giúp tăng độ tin cậy: Khi hiển thị câu hỏi ("Tại sao chúng tôi hỏi câu này?"), hệ thống cho phép Customer xem đoạn mã nguồn dẫn chứng liên quan (`snippetRef`, `AssessmentInterviewSourceSnippet`, API `GET .../interview/questions/:questionId/source-snippet`).
  - Dữ liệu mã nguồn này được bảo vệ nghiêm ngặt (không lưu raw code trong state phỏng vấn, hỗ trợ che giấu mã độc/nhạy cảm `redacted: true`).
* **Hạn chế trong tài liệu:**
  - Cả **Normal Flow** và **Alternative Flows** của `UC-M04-01` và `UC-M04-02` đều **hoàn toàn bỏ qua hành vi xem Snippet mã nguồn** của người dùng.

---

### 2.4. Thiếu Cơ chế Kiểm soát Đồng thời & Xung đột Phiên (Optimistic Concurrency & Session Revision)
* **Vấn đề thực tế:**
  - Khi Customer gửi câu trả lời (`SubmitInterviewAnswerCommand`), hệ thống yêu cầu gửi kèm `expectedSessionRevision` và `clientRequestId`.
  - Nếu có 2 người dùng cùng thao tác hoặc mạng chập chờn gây gửi đúp, hệ thống sử dụng cơ chế khóa lạc quan (Optimistic Concurrency) để chặn ghi đè câu trả lời cũ (trả về lỗi `STALE_SESSION_REVISION` / HTTP 409).
* **Hạn chế trong tài liệu:**
  - Tài liệu không mô tả cơ chế kiểm soát phiên (`sessionRevision`, `contextRevision`), dẫn đến thiếu các ngoại lệ khi có xung đột dữ liệu giữa Client và Server.

---

### 2.5. Xóa bỏ hoàn toàn Use Case Xem & Cập nhật Business Context đã xác nhận (ALN-M04-01)
* **Vấn đề trong tài liệu:**
  - Mục `ALN-M04-01` quyết định loại bỏ `Review Confirmed Business Context` và `Update Confirmed Business Context` với lý do "UI Figma W03/W04 chỉ hiển thị dạng card summary chứ chưa có nút Edit riêng".
* **Hạn chế kiến trúc:**
  - Việc xóa hẳn làm mất đi khả năng mô tả vòng đời dữ liệu ngữ cảnh nghiệp vụ:
    1. **Xem lại Context đã chốt:** Người dùng cần có quyền xem danh sách các nhận định nghiệp vụ đã xác nhận (`currentConfirmedBusinessContext`), lịch sử sửa đổi (`contextRevision`) và các câu hỏi đang mở (*Open Questions*).
    2. **Cập nhật/Đính chính:** Trong thực tế, nếu người dùng trả lời sai ở lượt trước hoặc môi trường nghiệp vụ thay đổi, hệ thống cho phép tiếp nhận đính chính. Việc đính chính này sẽ kích hoạt cờ `DOWNSTREAM_IMPACT`, dẫn đến Orchestrator thực hiện chạy lại có chọn lọc (`SELECTIVE_RERUN_RESCOPE`). Nếu không có UC này, toàn bộ luồng Re-assessment khi context thay đổi sẽ bị mất gốc.

---

### 2.6. Mâu thuẫn về Trạng thái Bế tắc & Nút Tạm dừng (ALN-M04-05 vs Contracts)
* **Mâu thuẫn:**
  - `ALN-M04-05` ghi *"Không invent nút Save & Exit"*.
  - Tuy nhiên, trong `@lcsp/contracts` (`ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS`), hệ thống chính thức định nghĩa 3 hành động cứu cánh khi người dùng không thể trả lời hoặc bị bế tắc (`BLOCKED_OR_UNRESOLVED`):
    1. `PROVIDE_MORE_CONTEXT`: Cung cấp thêm tài liệu/ngữ cảnh.
    2. `CHECK_INTERNALLY`: Đánh dấu để trao đổi nội bộ với team nghiệp vụ/tech lead.
    3. `SAVE_AND_EXIT`: Tạm dừng phỏng vấn và quay lại sau (hệ thống có API `/interview/pause` và `/interview/resume`).
  - Việc tài liệu bỏ qua các Blocked Actions này khiến luồng ngoại lệ `A7` (khi người dùng không biết câu trả lời) bị cụt, không có lối thoát nghiệp vụ rõ ràng.

---

### 2.7. Thiếu Đặc tả Cấu trúc Dữ liệu Đích danh của Targeted Clarification (UC-M04-02)
* **Vấn đề thực tế:**
  - `UC-M04-02` (Targeted Clarification) không chạy độc lập mà phục vụ trực tiếp cho một tiêu chí điều tra cụ thể (`BusinessContextNeed`), bao gồm: `needId`, `engineeringRuleId`, `criterionId`, `resolutionCriterionIds`, `evidenceRefs`.
  - Sau khi Customer trả lời thành công (`CONTEXT_RESOLVED`), Orchestrator phải đưa ra quyết định tiếp theo (`OrchestratorAction`): `RESUME_SAME_RULE` (tiếp tục quy tắc cũ) hoặc `SELECTIVE_RERUN_RESCOPE` (nếu có cờ `DOWNSTREAM_IMPACT`).
* **Hạn chế trong tài liệu:**
  - `UC-M04-02` mô tả luồng quá trừu tượng, thiếu liên kết với cấu trúc `BusinessContextNeed` và thiếu định nghĩa về các hành vi điều phối tiếp theo của Orchestrator.

---

## 3. PHƯƠNG HƯỚNG XỬ LÝ & ĐỀ XUẤT ĐIỀU CHỈNH

| STT | Vấn đề phát hiện | Phương hướng xử lý đề xuất trong Tài liệu UC |
| :---: | :--- | :--- |
| **1** | **Chuẩn hóa Trigger & Precondition (Khớp nối M02/M03 ➔ M04)** | • **Tách bạch Trigger:** Trigger là sự kiện hoàn tất quét mã nguồn tại M03 (`evidenceAccepted = true` và `evidenceGraphReady = true`) hoặc Customer chủ động vào bước Interview.<br>• **Quy định Precondition rõ ràng:** Yêu cầu `TechnicalCoverage` phải ở trạng thái `READY` hoặc `PARTIAL`. Nếu `UNAVAILABLE`, hệ thống chặn khởi tạo với lỗi `INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE`. |
| **2** | **Đồng bộ hóa Naming & Problem Codes với `@lcsp/contracts`** | • Sửa tên mode `INVESTIGATOR_RESOLUTION` thành **`BUSINESS_CONTEXT_RESOLUTION`**.<br>• Thay toàn bộ `[MSG-039]` đến `[MSG-046]` bằng Problem Codes chuẩn (`INTERVIEW_MINIMUM_CONTEXT_INCOMPLETE`, `INVALID_INTERVIEW_STATE`, `STALE_SESSION_REVISION`, `INTERVIEW_RUNTIME_FAILED`) và ánh xạ tương ứng vào `@lcsp/i18n`. |
| **3** | **Bổ sung Luồng Xem Snippet Dẫn chứng Mã nguồn** | • Bổ sung vào `UC-M04-01` và `UC-M04-02` luồng phụ (Alternative Flow): *Customer chọn xem đoạn mã nguồn liên quan để hiểu rõ căn cứ câu hỏi*.<br>• Nêu rõ quy tắc an toàn: Snippet hiển thị theo dòng, có thể được che giấu dữ liệu nhạy cảm (`redacted`) và truy xuất trực tiếp từ Snapshot đã pin ở M02. |
| **4** | **Đặc tả Quản lý Phiên & Khóa lạc quan (Concurrency)** | • Thêm Business Rule về kiểm soát phiên (`sessionRevision`, `contextRevision`). Khi gửi câu trả lời, nếu `sessionRevision` bị lệch (do nhiều người cùng thao tác), hệ thống trả về thông báo xung đột và yêu cầu tải lại dữ liệu mới nhất. |
| **5** | **Khôi phục Use Case Quản lý Business Context (Review & Clarify)** | • Đưa `Review Confirmed Business Context` thành Use Case hỗ trợ (hoặc tiểu mục trong UC-M04-01): Cho phép Customer mở Side Drawer xem toàn bộ các Business Context đã xác nhận, mức độ tin cậy và nguồn gốc.<br>• Mô tả luồng cập nhật context phát sinh cờ `DOWNSTREAM_IMPACT` và kích hoạt `SELECTIVE_RERUN_RESCOPE`. |
| **6** | **Hoàn thiện Đặc tả Trạng thái Bế tắc & Blocked Actions** | • Cập nhật Luồng A7: Khi rơi vào `BLOCKED_OR_UNRESOLVED`, hệ thống cung cấp 3 lựa chọn hành động chuẩn (`PROVIDE_MORE_CONTEXT`, `CHECK_INTERNALLY`, `SAVE_AND_EXIT`).<br>• Ghi nhận chính xác cơ chế Tạm dừng (`/interview/pause`) và Tiếp tục (`/interview/resume`). |
| **7** | **Chi tiết hóa Liên kết `BusinessContextNeed` trong UC-M04-02** | • Bổ sung vào Preconditions của `UC-M04-02`: Yêu cầu phải xác định rõ `engineeringRuleId`, `criterionId` và `needId`.<br>• Nêu rõ 2 kịch bản sau `CONTEXT_RESOLVED`: (1) Không ảnh hưởng downstream ➔ `RESUME_SAME_RULE`; (2) Có thay đổi ngữ cảnh quan trọng (`DOWNSTREAM_IMPACT`) ➔ `SELECTIVE_RERUN_RESCOPE`. |

---

## 4. KẾT LUẬN

Tài liệu UC của module **M04 (Business Context & Interview)** đã nắm bắt xuất sắc bản chất của một hệ thống phỏng vấn thông minh dựa trên bằng chứng kỹ thuật (AI-driven adaptive interview). 

Tuy nhiên, để tài liệu hoàn chỉnh, không mâu thuẫn với codebase và đạt tiêu chuẩn **Production-ready / Freeze**, nhóm BA cần:
1. Sửa dứt điểm các lỗi nhầm lẫn giữa Trigger và Precondition (đóng các comment `[a]`, `[b]`, `[c]`).
2. Chuẩn hóa toàn bộ thuật ngữ enum (`BUSINESS_CONTEXT_RESOLUTION`) và mã lỗi theo `@lcsp/contracts`.
3. Bổ sung các luồng giao tiếp tương tác phong phú đã có trong hệ thống: Xem Snippet mã nguồn dẫn chứng, các Blocked Actions (`SAVE_AND_EXIT`, `CHECK_INTERNALLY`), và cơ chế xem/cập nhật Business Context.
4. Làm rõ sự kết nối mạch lạc trong chuỗi luồng: **M02 (Setup & Snapshot)** ➔ **M03 (Scan & Evidence Graph)** ➔ **M04 (Interview & Context Authority)** ➔ **M05 (Engineering Rules Execution)**.
