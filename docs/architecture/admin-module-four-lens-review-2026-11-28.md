# Review module `admin` — 28/11/2026

## Phạm vi và phương pháp

Nhánh review: `chore/LCSP-999-admin-four-lens-review`, từ `develop` tại `9291fd680`. Đọc toàn bộ `apps/api/src/modules/admin`, các contract liên quan, Prisma schema, interceptor envelope và hai consumer dashboard trong `apps/web`. Chạy test module Admin: 4 suites, 23 tests đều pass.

Báo cáo platform trước đây nêu bốn skill `/bmad-review-adversarial-general`, `/bmad-code-review`, `/lcsp-nest-clean-architecture`, `/lcsp-security-production-grade`. Nội dung SKILL.md của chúng không có trong local skill catalog; SourceNerve plugin catalog trả lỗi nội bộ. Review này áp dụng bốn **góc kiểm tra tương ứng theo mô tả trong báo cáo**, không nhận là đã thực thi bốn skill đó. Các findings dưới đây được xác nhận từ source hiện tại; không suy diễn hành vi runtime từ graph hoặc test mock.

## Findings, xếp theo mức độ ưu tiên

### A-01 — Cao — Overview đọc toàn bộ Assessment trong 90 ngày

`GetAdminOverviewHandler.execute()` gọi `assessment.findMany()` với bộ lọc tối đa 90 ngày nhưng không có `take`, phân trang hay tổng hợp ở DB ([source](../../apps/api/src/modules/admin/application/queries/get-admin-overview/get-admin-overview.handler.ts#L110)). `buildActivityData()` lại quét toàn bộ mảng cho từng bucket, tối đa 14 lần ([source](../../apps/api/src/modules/admin/application/queries/get-admin-overview/get-admin-overview.handler.ts#L239)). Số bản ghi và bộ nhớ tăng theo tổng Assessment của toàn hệ thống; một Admin mở dashboard có thể gây tải lớn cho API/DB.

**Đề xuất:** Tổng hợp số lượng theo bucket trong PostgreSQL bằng truy vấn có giới hạn thời gian rõ ràng; chỉ trả số liệu bucket. Kiểm thử với catalog Assessment lớn, đối chiếu tổng started/completed và độ trễ.

### A-02 — Cao — “Completed trong kỳ” dùng `updatedAt`, không phải thời điểm chuyển sang COMPLETE

Summary lọc Assessment có trạng thái hiện tại `COMPLETE` và `updatedAt` trong kỳ ([source](../../apps/api/src/modules/admin/application/queries/get-admin-overview/get-admin-overview.handler.ts#L86)); timeline và total cũng dùng điều kiện ấy ([source](../../apps/api/src/modules/admin/application/queries/get-admin-overview/get-admin-overview.handler.ts#L254)). `Assessment.updatedAt` là trường `@updatedAt` chung, không phải timestamp hoàn thành ([schema](../../apps/api/prisma/schema.prisma#L405)). Một Assessment hoàn thành trước kỳ nhưng được sửa sau đó bị tính là hoàn thành trong kỳ; một Assessment đã hoàn thành rồi chuyển trạng thái cũng biến khỏi thống kê lịch sử.

**Đề xuất:** Dùng sự kiện chuyển trạng thái COMPLETE bất biến hoặc timestamp hoàn thành chuyên biệt; khóa trường hợp cập nhật sau khi hoàn thành bằng test.

### A-03 — Trung bình — Dashboard hiển thị số giả khi giá trị thực bằng 0

Consumer `AdminAssessmentActivityCard` dùng `totalUsersCount || 876`, `totalStarted || totalCompleted || 312`, và `totalCompleted || 270` ([source](../../apps/web/src/features/admin/components/molecules/admin-assessment-activity-card.tsx#L188)). Vì `0` là falsy, dashboard báo 876 users / 312 started / 270 completed khi API trả số 0. Đây là sai lệch số liệu trên bề mặt Admin, dù API trả đúng.

**Đề xuất:** Bỏ các fixture fallback trong production; chỉ dùng dữ liệu API và trạng thái loading/empty có bản địa hóa. Test consumer với ba giá trị 0.

### A-04 — Trung bình — `lastActiveAt` thực chất là thời điểm tạo session gần nhất

Danh sách người dùng lấy `_max.createdAt` của `AuthRecord` loại session ([source](../../apps/api/src/modules/admin/application/queries/list-admin-users/list-admin-users.handler.ts#L104)); detail làm tương tự ([source](../../apps/api/src/modules/admin/application/queries/get-admin-user-detail/get-admin-user-detail.handler.ts#L70)). UI hiển thị trường này như “last active” ([table](../../apps/web/src/features/admin/components/organisms/admin-user-table.tsx#L171)). Một session tồn tại nhiều ngày và được sử dụng hôm nay vẫn có `lastActiveAt` là ngày tạo session. Trường này chỉ chứng minh lần cấp session gần nhất.

**Đề xuất:** Đổi nhãn/contract thành “last sign in” nếu đó là ý định, hoặc lấy timestamp hoạt động đã được ghi bền vững.

### A-05 — Thấp — `:id` của Admin users thiếu ràng buộc định dạng ở HTTP boundary

Ba route detail/suspend/restore nhận `@Param("id")` trực tiếp ([source](../../apps/api/src/modules/admin/presentation/http/admin-users.controller.ts#L105)). Các payload khác dùng Zod, nhưng path parameter không có pipe. ID không hợp lệ đi vào query/transaction, gây thêm DB work và phụ thuộc vào kiểu cột/adapter để xác định lỗi. Test hiện tại gọi controller bằng ID mẫu, không kiểm tra HTTP invalid ID.

**Đề xuất:** Áp dụng validator đúng với định dạng ID được `User` sử dụng và kiểm thử problem 400 cùng correlation ID.

## Bốn góc review

1. **Adversarial:** A-01 là đường gây tải không giới hạn từ một request hợp lệ; A-05 là validation thiếu tại ingress. Chưa thấy SQL injection ở danh sách: tham số search/limit/offset được Prisma bind.
2. **Code review:** A-02/A-04 là sai khác giữa tên metric và dữ liệu đo; A-03 là regression rõ ràng ở consumer. Test Admin hiện tại chủ yếu kiểm tra happy path với mock nhỏ.
3. **Nest Clean Architecture:** Controller chuyển tiếp qua CQRS và không gọi Prisma; module đăng ký handler đúng folder. Success envelope được `ResponseTransformInterceptor` toàn cục bọc, nên controller trả DTO trực tiếp vẫn đáp ứng HTTP contract. Việc handler overview trực tiếp chứa truy vấn và mapping lớn làm khó cô lập read model, nhưng chưa phải lỗi boundary độc lập.
4. **Security production:** `RbacGuard` + `RequireRoles(ADMIN)` hiện diện trên các route; suspend/restore xác minh lại actor/session trong transaction, dùng optimistic version, row lock, receipt và audit. Không có bằng chứng BOLA ở các query Admin vì role Admin được phép xem toàn hệ thống. Chưa có test PostgreSQL đối kháng cho race giữa thay đổi quyền/session và mutation.

## Kết quả xử lý trên nhánh review

- **A-01/A-02:** Overview dùng read model PostgreSQL gom tối đa 14 bucket từ `Assessment.createdAt` và sự kiện `ASSESSMENT_LIFECYCLE_CHANGED` có `toState=COMPLETE`; không tải toàn bộ Assessment vào Node.js và không suy ra completion từ `updatedAt`. Thêm index cho `Assessment.createdAt` và `AssessmentEvent(eventType,timestamp)`.
- **A-03:** Bỏ số KPI và chart mẫu khi dữ liệu bằng 0; dùng bản dịch và Tooltip thay cho `title` trên các bar.
- **A-04:** Chọn nghĩa đo hiện có là **lần đăng nhập gần nhất** (session issuance), đổi nhãn Admin ở EN/VI. Field API `lastActiveAt` được giữ để tương thích; chưa có timestamp cho hoạt động thực tế trong session.
- **A-05:** Gắn `ParseUUIDPipe` vào `:id` của detail/suspend/restore trước CQRS dispatch.

## RED tests đã thêm

| Finding | Test                                                                                          | RED trước sửa                                                             |
| ------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| A-01    | `apps/api/src/modules/admin/application/queries/admin-overview.red.spec.ts`                   | FAIL: handler vẫn gọi `assessment.findMany` không giới hạn                |
| A-02    | Cùng spec overview                                                                            | FAIL: điều kiện đếm completion vẫn dựa vào `updatedAt`                    |
| A-03    | `apps/web/src/features/admin/components/molecules/admin-assessment-activity-card.red.test.ts` | FAIL: HTML của cohort rỗng vẫn chứa 876, 312, 270                         |
| A-05    | `apps/api/src/modules/admin/presentation/http/admin-user-id.red.spec.ts`                      | FAIL ở cả detail, suspend và restore: không có `ParseUUIDPipe` trên `:id` |

Chạy hai spec API bằng Jest: 5/5 assertions fail vì hành vi cần sửa (exit 1). Chạy spec frontend bằng `tsx --test`: 1/1 fail vì số giả (exit 1). Lint các file test và web typecheck đều pass. API typecheck hiện fail ở bốn tham chiếu `legalSourceCreated`/`legalSourceUpdated` có sẵn trong module `legal-source`, không liên quan các test mới; không có lỗi TypeScript trong test Admin mới.

A-04 có RED test riêng ở `packages/i18n/src/admin-last-sign-in.red.test.ts`: bản dịch cũ là “Last active” và “Hoạt động gần nhất”, còn timestamp thực là lúc tạo session. Sau khi chọn nghĩa “last sign in”, test đạt. Integration PostgreSQL dùng temporary shadow tables để kiểm tra A-01/A-02: một Assessment cũ được cập nhật gần đây không làm tăng completion; chỉ lifecycle event trong kỳ được đếm. Các test được giữ làm regression suite dù tên file còn hậu tố `.red` để lưu dấu giai đoạn tái hiện.

**GREEN sau sửa:** Toàn bộ module Admin đạt 7 suites / 29 tests, gồm integration PostgreSQL với 10.000 Assessment chỉ trả 7 bucket. Hai test render dashboard (zero metrics và bar thật có nhãn accessible) cùng test nhãn EN/VI đều pass. Playwright E2E mở trang `/admin` trong Chromium với response overview toàn số 0 và xác nhận không hiển thị số mẫu hoặc `title` cũ (1/1 pass). Playwright MCP không khả dụng nên dùng runner Playwright sẵn có trong repo. API/Web/i18n typecheck, schema Prisma validate, lint và business-logic documentation gate đều pass. Lần typecheck API đầu tiên gặp bốn lỗi `legal-source` do output contract build cũ; sau build i18n/contract trong workspace và chạy lại, API typecheck đạt.
