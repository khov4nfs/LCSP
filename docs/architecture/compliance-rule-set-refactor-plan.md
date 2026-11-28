# Kế hoạch refactor module `compliance-rule-set`

**Ngày lập:** 2026-11-28
**Trạng thái:** Đang triển khai. Luồng hủy bền vững và chặn reactivation đã qua unit test; suite PostgreSQL riêng cho Admin preparation đạt 18/18 khi chạy trên container test tạm. Hai handler lớn đã dùng chung ranh giới khóa run và parser; Claim Inventory đã tách phép dựng inventory từ review thành hàm domain thuần. Các thao tác persistence còn lại chưa được tách hết.
**Phạm vi:** Sửa luồng hủy preparation, chặn reactivation khi còn run chưa giải quyết, rồi tách hai handler lớn theo ranh giới Clean Architecture. Không viết lại toàn bộ module.

## 1. Mục tiêu và hiện trạng đã kiểm chứng

Module sở hữu vòng đời chuẩn bị, kiểm tra, xuất bản và đọc bộ quy tắc pháp lý dùng chung. Admin có thể hủy một preparation hoặc kích hoạt lại Rule Set cũ; worker có các API để claim, ghi kết quả, validate và submit.

| Vấn đề | Bằng chứng hiện tại | Kết quả mong muốn |
| --- | --- | --- |
| Hủy runtime nằm trong transaction đang khóa dòng `RuleSetPreparationRun` | `cancel-rule-set-preparation.handler.ts`: gọi `runtime.cancel()` trước `updateMany()` và commit. RED test cho thấy runtime đã bị gọi dù CAS trả `count = 0`. | Không gọi Agent Server trong transaction. Trạng thái DB và việc hủy runtime có thể khôi phục sau lỗi hoặc restart. |
| Reactivation bỏ sót preparation chưa giải quyết | `reactivate-compliance-rule-set.handler.ts` chỉ đếm `QUEUED`/`RUNNING`; availability loader còn coi `PAUSED`/`INTERRUPTED` là đang tiến hành. Hai RED test đã tái hiện. | Không reactivation khi còn run có thể tiếp tục hoặc đang chờ hủy. |
| Hai application handler chứa nhiều thao tác persistence và quyết định nghiệp vụ trong một hàm | `source-review.handler.ts` và `claim-inventory.handler.ts` truy cập Prisma trực tiếp, điều phối nhiều bước trong transaction dài. | Tách truy cập DB khỏi quyết định nghiệp vụ, giữ nguyên thứ tự khóa, transaction và kết quả API. |

**Đính chính review:** `RuleSetPreparationRun` không có `failureReason` hay `completedAt`, nên phản hồi của fail handler không sai contract. Agent Server hiện tại trả toàn bộ run và bỏ qua query `limit=100`; chưa có bằng chứng lỗi phân trang trên runtime đang dùng. Không lấy hai nhận định cũ này làm yêu cầu sửa production.

## 2. Thiết kế hủy bền vững

### 2.1 Trạng thái và contract

1. Thêm `CANCEL_REQUESTED` vào `AGENT_EXECUTION_STATES`, Prisma `AgentExecutionState` và các schema/mapping liên quan. Tạo migration PostgreSQL. Đây là trạng thái **chưa kết thúc**: Admin thấy yêu cầu hủy đã được nhận, nhưng không được hiểu là worker đã dừng.
2. Giữ nguyên route `POST /admin/compliance-rule-sets/preparations/:preparationRunId/cancel`, HTTP `202` và success envelope. Kết quả `RuleSetPreparationRun.executionState` là `CANCEL_REQUESTED` cho run đang `RUNNING`, `CANCELLED` cho run `QUEUED`/`PAUSED` không có native execution cần dừng. Gọi lặp lại trên `CANCEL_REQUESTED` hoặc `CANCELLED` trả cùng trạng thái, không tạo thêm yêu cầu.
3. Duy trì một nguồn giá trị trạng thái chuẩn từ `packages/contracts`; Prisma enum chỉ được dùng ở persistence boundary. Cập nhật state transition map và mọi consumer của `agentExecutionStateSchema` để không coi `CANCEL_REQUESTED` là terminal hoặc có thể resume/claim.

### 2.2 Ranh giới transaction và xử lý nền

1. Trong một transaction: khóa đúng run; kiểm tra chưa có Rule Set xuất bản và trạng thái hợp lệ; với `RUNNING`, CAS sang `CANCEL_REQUESTED`; với `QUEUED`/`PAUSED`, CAS sang `CANCELLED`. Không gọi HTTP/Agent Server khi transaction còn mở. Ghi audit có actor Admin hoặc actor đã được xác thực ở cùng transaction; giữ correlation ID. Route selected-rule hiện gọi chung command nên phải truyền actor qua cùng ranh giới này.
2. Một poller nhỏ trong module quét có giới hạn các run `CANCEL_REQUESTED` sau commit và khi API khởi động lại. Nó gọi `AgentServerPreparationControl.cancel()` ngoài transaction. Khi runtime xác nhận đã dừng hoặc chắc chắn không còn run hoạt động, poller khóa lại run và CAS `CANCEL_REQUESTED → CANCELLED`, ghi `completedAt`, rồi phát activity event. Nhiều poller có thể thử cùng run; lệnh hủy và CAS phải idempotent, chỉ một lần hoàn tất được ghi.
3. Nếu Agent Server lỗi, timeout hoặc kết quả không xác định, giữ `CANCEL_REQUESTED` để lần quét sau thử lại; không báo `CANCELLED`. Log lỗi với run ID và correlation ID nhưng không log payload nhạy cảm. Không giữ DB lock trong lúc đợi mạng. Dùng khoảng quét và batch size hữu hạn từ cấu hình module, có mặc định rõ ràng; không mở API mới chỉ để điều khiển poller.
4. Mọi đường worker claim/fail/validate/submit và Admin retry/resume phải từ chối `CANCEL_REQUESTED`. Đường publication phải kiểm tra lại trạng thái dưới cùng khóa run trước khi ghi Rule Set, bảo đảm kết quả đến muộn không thắng quyết định hủy đã commit. Nếu publication thắng trước khi Admin giữ khóa, API cancel trả conflict và không hủy runtime.
5. `AgentServerPreparationControl` không được coi HTTP `409` bất kỳ là đã hủy; phân biệt kết quả native run đã kết thúc với lỗi xung đột còn chạy. Kiểm chứng với API của Agent Server đang dùng. Không triển khai pagination chỉ để đáp ứng RED test giả định: bỏ hoặc thay test đó bằng kịch bản hơn 100 run trên runtime thật.

### 2.3 Reactivation

Định nghĩa một predicate chung cho trạng thái preparation chưa giải quyết: `QUEUED`, `RUNNING`, `INTERRUPTED`, `PAUSED`, `CANCEL_REQUESTED`. Reactivation và availability dùng cùng quy tắc; khi còn bất kỳ run thuộc tập này, reactivation trả conflict `PREPARATION_IN_PROGRESS` và không đổi Rule Set, AuditEvent hoặc outbox. Kiểm tra và thay đổi authority vẫn phải nằm trong cùng transaction/khóa kích hoạt hiện tại.

## 3. Refactor hai handler lớn

Thực hiện **sau khi các lỗi hành vi đã GREEN**, theo từng bước nhỏ để dễ đối chiếu:

1. Ghi lại input/output và thứ tự lock/transaction hiện tại của `SourceReviewHandler.execute` và `ClaimInventoryHandler.execute` bằng các test scoped đang có. Không thay đổi contract hoặc payload worker.
2. Chuyển các truy vấn và thao tác ghi Prisma sang adapter/repository trong `infrastructure/persistence`; application gọi qua port có tên theo nghiệp vụ. Parser JSON dùng chung (ví dụ `reviewPayload`) chuyển khỏi handler để tránh một command import implementation của command khác.
3. Tách phép kiểm tra frontier, dependency, semantic validation và draft transition thành các hàm/domain service thuần khi có thể. Giữ một transaction owner rõ ràng cho mỗi operation; adapter nhận transaction context thay vì tự mở transaction lồng nhau.
4. Sau mỗi lần tách, chạy test của nhánh vừa đổi và so sánh kết quả trả về, audit, outbox và thứ tự ghi. Không xóa file/export chỉ vì Knip báo nghi ngờ; xác minh toàn bộ import và consumer trước khi xóa.
5. Bổ sung JSDoc 5 mục và explanatory comments cho mọi business function được sửa theo `AGENTS.md`. Không đưa PBAC hoặc organization trở lại; phân quyền hiện hành chỉ dùng RBAC.

## 4. RED → GREEN và tiêu chí nghiệm thu

### Test bắt buộc

- Giữ RED test hiện có: DB CAS hủy thất bại không được gọi Agent Server; reactivation từ chối `PAUSED` và `INTERRUPTED`.
- Thêm test: `RUNNING → CANCEL_REQUESTED → CANCELLED`; Agent Server lỗi giữ `CANCEL_REQUESTED`; restart poller tiếp tục hủy; hai poller tranh nhau chỉ một lần hoàn tất; cancel lặp lại idempotent; submission và cancel tranh khóa thì chỉ một kết quả thắng; `CANCEL_REQUESTED` chặn reactivation, claim, resume và submit.
- Test integration trên PostgreSQL chuyên dụng cho ranh giới commit/CAS/audit. Test runtime thực với hơn 100 run xác nhận việc tìm/hủy native run; nếu runtime trả toàn bộ run, xóa test phân trang giả định đang RED.
- Sau tách kiến trúc, giữ nguyên các test source review và claim inventory hiện hành; thêm test ở các pure function/adapter chỉ khi chúng xác nhận một ranh giới nghiệp vụ hoặc transaction thực sự.

### Cổng kiểm chứng

1. Chạy test scoped trước và sau từng thay đổi. Test mới phải quan sát RED đúng nguyên nhân trước khi sửa production, rồi GREEN sau sửa; không đổi expectation hợp lệ để làm xanh.
2. Build `@lcsp/contracts` trước `pnpm --filter @lcsp/api exec tsc --noEmit` vì lần typecheck gần nhất bị lệch bản `dist` contracts. Chạy ESLint file đổi, `pnpm run check:imports`, `pnpm run check:business-logic-docs`, `pnpm run test:business-logic-docs` và `git diff --check`.
3. Chạy integration DB trên database test riêng theo guard của repo; không dùng `lcsp_local` cho test có cleanup. Nếu môi trường không mở được `127.0.0.1:55432`, báo rõ test nào chưa chạy, không đánh dấu gate GREEN dựa trên unit test.
4. Bảo toàn mọi file dirty hiện tại. Không commit, push hoặc tạo PR khi chưa có yêu cầu riêng.

## 5. Thứ tự thực hiện và bàn giao

1. Chuẩn hóa RED tests: giữ 3 ca hợp lệ, thay ca phân trang giả định bằng test runtime hơn 100 run.
2. Thêm contract/migration `CANCEL_REQUESTED`, transaction hủy và poller; chứng minh RED → GREEN, rồi chạy integration cho cancel/publish race.
3. Đồng bộ predicate in-progress và đóng hai RED test reactivation bằng unit + PostgreSQL integration.
4. Refactor `SourceReviewHandler` rồi `ClaimInventoryHandler`, chạy test sau từng nhánh nhỏ.
5. Review độc lập bảo mật, edge case và Clean Architecture; sửa phát hiện có bằng chứng, chạy lại các gate và bàn giao biên lai test cùng giới hạn môi trường.

## 6. Biên lai tiến độ 2026-11-28

- Đã thêm `CANCEL_REQUESTED` vào contracts, Prisma enum và migration. Admin cancel ghi trạng thái và audit actor trong cùng transaction; poller chỉ gọi Agent Server sau commit và chỉ đóng run khi native status đã kết thúc. Native HTTP 404, status lạ hoặc response vẫn `running` giữ yêu cầu ở trạng thái chờ. Poller quét theo batch có cursor để các yêu cầu lỗi đầu hàng không chặn các yêu cầu phía sau.
- Reactivation và availability dùng cùng tập trạng thái chưa giải quyết, gồm `PAUSED`, `INTERRUPTED` và `CANCEL_REQUESTED`. Parser source review đã chuyển sang domain để `ClaimInventoryHandler` không import từ handler khác.
- 6 suite unit liên quan đạt 34/34; contracts đạt 252/252; suite Admin preparation PostgreSQL đạt 18/18 trên database tạm `lcsp_admin_prepare_test` tại loopback cổng 55496 sau khi áp dụng 194 migrations. Container test đã dừng và xóa sau khi chạy. API typecheck, ESLint, import policy, business-logic-docs và `git diff --check` đạt.
- Đã gom transaction, khóa dòng `RuleSetPreparationRun` và lần đọc trạng thái sau khóa vào `withLockedPreparationRun`; cả Source Review và Claim Inventory dùng cùng adapter, giữ timeout 30 giây và transaction owner cũ. Đã đưa phép dựng inventory từ các review hoàn tất vào `projectCompletedReviewInventory`, đồng thời bỏ phụ thuộc Prisma khỏi parser domain. Unit scoped đạt 12/12; integration Source Review và Claim Inventory đạt 22/22 trên database test tạm `lcsp_review_frontier_test` tại cổng 55497 sau 194 migrations. API typecheck, ESLint file đổi, import policy, business-logic-docs và `git diff --check` đạt.
- Đã tách phép dựng frontier khởi đầu thành hàm domain thuần và dùng chung phép gán reference owner cho `INIT`/`EXPAND`. Đã chuyển command khởi tạo diagnostic sang handler riêng, giữ nguyên feature-flag và database-isolation guard; module và hai test bridge import handler mới. Unit scoped đạt 17/17; integration Source Review và Claim Inventory đạt 22/22 trên `lcsp_review_frontier_test`. Suite reactivation ban đầu bị fixture claim sai contract: run đã pin `DIRECT_DRAFT_V1` nhưng fixture chỉ mặc định hỗ trợ `CLAIM_INVENTORY_V1`. Sau khi khai báo đúng contract trong fixture, suite reactivation trên `lcsp_reactivation_test` đạt 17/17. Hai database đều nằm trong container PostgreSQL tạm cổng 55497.
- Đã tách phép tính chuyển counter và fingerprint của một review row thành `reviewFrontierTransition` thuần. Adapter `persistSourceReviewFrontierChange` đọc row sau thay đổi và ghi fingerprint/counter trong transaction do handler sở hữu; handler chỉ còn điều phối. Unit scoped đạt 10/10 và integration Source Review/Claim Inventory đạt 22/22 trên PostgreSQL test tạm cổng 55497 sau khi tách adapter. Typecheck, ESLint file đổi, import policy, business-logic-docs và `git diff --check` đạt. Thay đổi này đang ở working tree cục bộ, chưa commit/push theo yêu cầu mới nhất của người dùng.
- `ClaimInventoryHandler` hiện đọc frontier và các review row cùng revision qua `reviewEvidenceForInventory` trong transaction đang khóa run; adapter giữ thứ tự `ordinal` và không đọc row nếu frontier vắng mặt. Quyết định version của authoring draft được tách thành `authoringDraftSaveDecision` thuần: chỉ chấp nhận version hiện tại hoặc replay cùng nội dung của version ngay trước. Unit scoped 13/13 và integration Source Review/Claim Inventory 22/22 trên PostgreSQL test tạm cổng 55497. Typecheck, ESLint file đổi, import policy, contract literal policy, business-logic-docs và `git diff --check` đạt. Chưa commit/push.
- **Còn lại:** tách tiếp các truy cập Prisma và nhánh quyết định nghiệp vụ còn nằm trong hai handler lớn; review độc lập các thay đổi trước khi đóng refactor. PR tiếp tục ở trạng thái draft.

## 7. Đối chiếu sau review độc lập

- Commit `71a466849` đã được push lên PR #632. Các sửa đổi sau commit đang ở working tree và chưa được commit/push.
- Review phát hiện route hủy selected-rule truyền actor hệ thống vào command dùng chung. Test controller → service xác nhận RED; route hiện chuyển `userId` Admin đã xác thực để AuditEvent ghi đúng người ra quyết định.
- `CANCEL_REQUESTED` trước đây còn bị bỏ sót trong submit/import selected-rule, danh sách/xóa catalog và Admin activity SSE. Các đường này đã dùng chung tập trạng thái chưa giải quyết hoặc giữ stream mở đến trạng thái cuối; test tái hiện đã quan sát RED trước bản sửa.
- Guard diagnostic trước đây đọc `process.env.DATABASE_URL` dù Prisma có thể dùng URL ưu tiên từ `ConfigService`. Guard hiện kiểm tra host và tên database đã rút gọn từ đúng cấu hình adapter Prisma; test tái hiện xác nhận không chạy export nếu hai URL khác nhau.
- Cần kiểm chứng lại các test tập trung, typecheck, lint, docs gate và browser flow của Admin trước khi coi các sửa đổi sau review hoàn tất. Việc tách thêm logic của hai handler lớn chỉ thực hiện nếu có lợi ích rõ và không làm đổi contract hoặc thứ tự khóa.
- Kiểm chứng browser 2026-11-28: Playwright mở trang Admin trong Chromium với API fixture riêng. Ca mới xác nhận `CANCEL_REQUESTED` được hiển thị, SSE vẫn mở, rồi đóng sau khi lịch sử chuyển sang `CANCELLED`; cùng suite đạt 2/2. Luồng selected-rule hiện có về mở activity, retry và so sánh revision đạt 1/1 trên Chromium. Đây là bằng chứng UI/browser, chưa thay thế kiểm thử PostgreSQL cho cancel/submit race.
- Browser run đầu tiên tái hiện lỗi build vì `packages/contracts/src/compliance-rule-set/constants.ts` import nội bộ `.js` trong khi Next tiêu thụ source `.ts`. Đã đổi sang `.ts` theo các import contract cùng thư mục; chạy lại browser đạt. Không commit/push các thay đổi của lượt này.

## 8. Biên lai review và PostgreSQL integration sau sửa đổi

- Database test dùng một lần: `lcsp_admin_prepare_test` và `lcsp_review_frontier_test` trên container PostgreSQL loopback cổng 55496; cả hai đã áp dụng đủ 194 migrations. Không dùng `lcsp_local`. Container đã dừng và tự xóa sau kiểm thử.
- Suite Admin preparation đạt 18/18 trên PostgreSQL. Ca race giữ native cancellation chậm xác nhận submit trả 409, không tạo Rule Set, LegalRequirement hoặc AssessmentRule dở dang; ca publication thắng trước xác nhận cancel bị từ chối. Đã bổ sung truy vấn `AuditEvent` ở cùng ca hủy `RUNNING`, xác nhận actor `test-admin` được commit cùng `CANCEL_REQUESTED` (ca tập trung đạt 1/1).
- Source Review và Claim Inventory integration đạt 22/22 trên PostgreSQL test riêng. Guard diagnostic có unit test tái hiện URL môi trường khác datasource adapter, không chạy graph export hoặc ghi DB khi target sai.
- Review diff mới không thấy thay đổi contract HTTP hoặc đường publish của hai handler. RED unit test xác nhận `deleteCatalog()` trước đây không lấy catalog row lock; bản sửa lấy cùng `FOR UPDATE` với submit trước khi kiểm tra run và xóa con. Unit test chuyển GREEN 1/1. PostgreSQL integration trên DB dùng một lần `lcsp_r2_activation` cổng 55448, đủ 194 migrations, đạt 2/2: transaction tạo run giữ lock, delete phải chờ, sau khi tạo `CANCEL_REQUESTED` thì delete trả lỗi và giữ cả catalog lẫn result.
- Các sửa đổi của mục này vẫn ở working tree, chưa commit/push. PR #632 tiếp tục ở trạng thái draft cho đến review cuối và các gate còn lại.
