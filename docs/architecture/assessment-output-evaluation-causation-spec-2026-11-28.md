# A3 — Bằng chứng cho verdict `ModelOutputEvaluation`

## Quyết định phạm vi hiện tại

Đóng hạng mục verdict trong Assessment hardening với hành vi **chỉ ghi `NOT_EVALUATED`** cho một physical invocation đã settlement. Settlement không suy ra chất lượng câu trả lời từ usage của provider; rule rejection không tự đổi verdict hoặc số tiền. `DOMAIN_REJECTED` là tính năng theo dõi chất lượng để triển khai riêng khi có event evaluator được lưu và gắn chắc với đúng physical invocation. Callback thử nghiệm tiếp tục không đăng ký route production. Quyết định này không tuyên bố tính năng `DOMAIN_REJECTED` đã hoạt động.

Acceptance hiện tại được khóa bởi `billing-settlement.e2e-spec.ts`: receipt `SETTLED` tạo evaluation row đúng `admissionId` và `invocationId` với `NOT_EVALUATED`; billing receipt, ledger và ví chỉ thay đổi theo usage/settlement, không theo verdict. Các kịch bản callback bên dưới là backlog cho tính năng tương lai, không là điều kiện đóng PR hardening hiện tại.

## Trạng thái

`DOMAIN_REJECTED` chưa được phép ghi. Settlement chỉ tạo `NOT_EVALUATED` cho đúng `admissionId` và physical `invocationId`. Đường rejection hiện có `modelTurn` và `toolCallId`; worker ghi ánh xạ local `(runId, toolCallId) → invocationId`. Một response có thể tạo nhiều tool calls, nên `modelTurn` không đủ để suy ra invocation.

**Checkpoint 2026-11-28:** Đã kiểm tra callback mẫu qua PostgreSQL E2E và phát hiện ranh giới chưa an toàn. `AssessmentRuntimeEvent.outputSummaryJson.agentStreamEvent.eventId` là giá trị worker gửi, không phải khóa hàng do server cấp. Partial unique index nay chặn ID trùng trong cùng run cho rejection event, nhưng cùng `toolCallId` vẫn có thể nằm trong hai receipt. Callback route và writer được tháo khỏi BillingModule/route allowlist. Acceptance scenario A3 được giữ `skip` vì chưa có production caller và chưa chốt vòng đời bằng chứng; không được tính là GREEN.

**Slice đã triển khai:** Worker lấy `toolCallIds` từ response thực, chỉ gửi danh sách ID chuẩn hóa trong `COMPLETED` settlement; NestJS ghim danh sách vào `ModelUsageReceipt` bất biến và settlement fingerprint. Hợp đồng chặn danh sách quá 64 ID, ID rỗng/dài quá 200 ký tự, trùng, sai thứ tự hoặc có whitespace đầu/cuối. PostgreSQL E2E đã quan sát RED (receipt không có field) rồi GREEN (receipt giữ hai ID, replay đổi ID trả 409). Đây là bằng chứng do worker xác nhận và server đóng băng; không phải bằng chứng độc lập từ provider.

**Checkpoint journal authority:** Migration `20261128123000_wp8_a3_rejection_journal_authority` thêm unique index một phần cho `(runId, agentStreamEvent.eventId)` trên các journal row `RULE_SET_PREPARATION` có `activity_kind = RULE_AUTHORING_TOOL_REJECTED`, kiểm tra event ID không rỗng và chặn `UPDATE`. Migration tiếp theo `20261128131500_wp8_a3_rejection_journal_deletion_lifecycle` cho phép `DELETE` để không chặn xóa Legal Source hợp lệ; direct PostgreSQL test đạt 4/4 gồm parent cascade. ID của event vẫn do worker gửi; chỉ row ID `AssessmentRuntimeEvent.id` do DB cấp mới có thể làm identity callback khi row còn tồn tại. Kết quả này chưa mở writer `DOMAIN_REJECTED` hoặc chuyển G-07 sang GREEN.

### Điều kiện triển khai migration trên dữ liệu thật

- **Audit trùng lịch sử trước deploy:** Kiểm kê các row hiện có theo đúng predicate của partial index và nhóm theo `(runId, agentStreamEvent.eventId)`. Nếu có ID rỗng hoặc nhóm trùng, dừng deploy để điều tra và xử lý theo quy trình audit/retention được phê duyệt; không tự xóa hoặc viết lại bằng chứng. Migration từng thất bại trên test DB vì fixture lịch sử trùng ID, nên không thể giả định dữ liệu thật sạch.
- **Chính sách lưu giữ và xóa dữ liệu:** `DELETE` hiện được phép để giữ vòng đời xóa Legal Source hợp lệ. Trước khi bật writer verdict, cần quyết định có lưu snapshot/hash audit tối thiểu của rejection hay không; journal row có thể biến mất sau xóa hợp lệ. Không coi row hiện tại là bằng chứng lưu giữ vĩnh viễn.
- **Giới hạn thẩm quyền:** Unique index và trigger chỉ bảo vệ identity/tính bất biến của journal đã lưu; chúng không chứng minh event phản ánh đúng quyết định nghiệp vụ, cũng không giải quyết việc một `toolCallId` xuất hiện trong hai physical invocations. Callback phải kiểm tra `physicalInvocationId` chính xác với settled receipt và fail closed khi thiếu hoặc mơ hồ.

## Ranh giới thẩm quyền cần có trước implementation

1. Khi callback đến, server xác minh `admissionId`, `invocationId`, `runId`, trạng thái `SETTLED` và `toolCallId` thuộc danh sách đã ghim trong receipt bất biến. Cùng `toolCallId` được replay y hệt là idempotent; đổi physical ID phải bị từ chối.
2. Evaluator phát sự kiện rejection nghiệp vụ chứa `runId`, `toolCallId`, reason code thuộc tập đã duyệt, evaluator version và event ID. Server xác thực nguồn evaluator, đối chiếu causation đã lưu và trạng thái admission. Worker API key chung một mình không chứng minh nội dung quyết định nghiệp vụ.
3. Chỉ khi cả hai sự kiện khớp, server mới chuyển đúng một row `ModelOutputEvaluation` từ `NOT_EVALUATED` sang `DOMAIN_REJECTED` bằng CAS/idempotency. Không thay đổi `ModelUsageReceipt`, ledger, wallet hoặc settlement. Không ghi `ACCEPTED` từ provider completion.
4. Nếu thiếu causation, có nhiều invocation ứng viên, run/lease lệch, event replay khác payload hoặc reason không được hỗ trợ: giữ `NOT_EVALUATED`, lưu lỗi/đối soát theo chính sách được duyệt; không tự đoán verdict.

## Bộ RED acceptance cần viết trước production

- Cùng model turn có hai tool calls thuộc hai physical attempts; rejection của tool B chỉ cập nhật invocation B.
- Tool feedback không có physical marker hoặc thiếu mapping server → không có verdict.
- Mapping `(runId, toolCallId)` replay cùng payload → một bản ghi; đổi `invocationId` → 409, không ghi verdict.
- Rejection event replay cùng fingerprint → một verdict; cùng event ID với reason khác → 409.
- Worker key hợp lệ nhưng run/admission/lease không khớp → 403/409, `NOT_EVALUATED` giữ nguyên.
- Sau verdict, `ModelUsageReceipt` và ví giữ nguyên tuyệt đối; chỉ row evaluation và audit/outbox được thay đổi.

## Quyết định còn mở

Xác định actor thực sự phát event evaluator và cơ chế xác thực event đó tại server. `WorkerApiKeyGuard` cộng receipt membership xác thực **nguồn worker và causation**, nhưng không tự chứng minh rejection nghiệp vụ là thật. Có thể chấp nhận event worker-attested trong trust model hiện tại nếu event ID, reason, evaluator version và hash/artifact của rejection được lưu audit với idempotency; phải mô tả mức tin cậy này tường minh. Không thêm writer chỉ dựa vào một callback tự khai báo `DOMAIN_REJECTED` thiếu evidence event. Đó là ranh giới giữ đúng quyết định của người dùng: chỉ ghi verdict có bằng chứng.

Để mở writer: dùng `AssessmentRuntimeEvent.id` do DB cấp làm identity callback, khóa tính bất biến của row bằng DB constraint/trigger, trả ID đó trong publish ack và bảo đảm worker giữ nó qua retry. Callback phải kiểm tra duy nhất một settled receipt chứa `(preparationRunId, runId, toolCallId)`, liên kết event row với receipt/admission/invocation, và kiểm thử race duplicate/UPDATE, cross-run event replay, CAS idempotency. Nếu hai receipt cùng chứa ID, giữ `NOT_EVALUATED` và từ chối vì không thể suy ra đúng physical invocation.
