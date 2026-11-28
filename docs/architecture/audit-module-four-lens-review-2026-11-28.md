# Review module `audit` — 28/11/2026

## Phạm vi

Nhánh `chore/LCSP-999-audit-four-lens-review`, tạo từ `develop` tại `1393c51bb`. Đã đọc controller, CQRS handlers, storage/signing, redactor, Prisma schema, audit writer và test của `apps/api/src/modules/audit`.

Bốn skill được báo cáo platform nêu tên là `/bmad-review-adversarial-general`, `/bmad-code-review`, `/lcsp-nest-clean-architecture`, `/lcsp-security-production-grade`. Các `SKILL.md` này không có trong catalog cục bộ, nên báo cáo áp dụng **bốn rubric tương ứng**, không khẳng định đã chạy các skill. Findings dưới đây dựa trên source và test hiện tại; chưa có kiểm thử tải hoặc PostgreSQL đồng thời.

## Findings theo mức ưu tiên

### AU-01 — Cao — Khóa ký URL tải có fallback cố định

`AuditExportStorageService.secret()` dùng chuỗi hardcode khi cả hai biến môi trường vắng mặt ([source](../../apps/api/src/modules/audit/infrastructure/storage/audit-export-storage.service.ts#L102)). Route tải không yêu cầu `RbacGuard`, chỉ xác minh token HMAC ([controller](../../apps/api/src/modules/audit/presentation/http/audit.controller.ts#L158)). Một triển khai thiếu cấu hình bí mật sẽ cho phép bên biết chuỗi mặc định tự ký URL tải bất kỳ export ID nào. Không thấy startup validation bắt buộc cho hai biến này trong `apps/api/src`.

**Đề xuất:** Bắt buộc secret có entropy đủ mạnh tại startup ở môi trường triển khai; không dùng fallback cố định. Kiểm thử cấu hình thiếu secret và token giả mạo qua route HTTP.

### AU-02 — Cao — Export đồng bộ không giới hạn số sự kiện hoặc kích thước artifact

Khoảng ngày được phép tới 365 ngày, rồi `auditEvent.findMany()` tải mọi hàng phù hợp vào bộ nhớ, `map()` và `JSON.stringify()` toàn bộ artifact trước khi ghi JSON vào DB ([handler](../../apps/api/src/modules/audit/application/commands/export-audit-trail/export-audit-trail.handler.ts#L83)). Một Admin hợp lệ có thể gây truy vấn dài, dùng nhiều RAM và tạo JSON vượt khả năng lưu trữ. Download cũng stringify toàn bộ artifact lần nữa ([controller](../../apps/api/src/modules/audit/presentation/http/audit.controller.ts#L183)).

**Đề xuất:** Giới hạn số event/byte và xuất theo trang hoặc job có giới hạn bộ nhớ; xác định chính sách từ chối/truncate rõ ràng. Test dataset lớn và tải đồng thời.

### AU-03 — Cao — Export READY được commit trước audit event

Handler `create()` export READY rồi mới gọi `auditWriter.write()` bằng Prisma client độc lập ([handler](../../apps/api/src/modules/audit/application/commands/export-audit-trail/export-audit-trail.handler.ts#L136), [writer](../../apps/api/src/platform/audit/audit-writer.service.ts#L27)). Nếu audit write thất bại, request trả lỗi nhưng artifact READY vẫn tồn tại và có thể đọc/tải sau đó; hành động xuất không có bằng chứng audit tương ứng.

**Đề xuất:** Commit artifact và event trong một transaction qua `writeInTx`; thêm test buộc audit write lỗi và xác nhận rollback export.

### AU-04 — Trung bình — Checksum được công bố nhưng không được xác minh khi tải

Export lưu SHA-256 của base artifact cùng `contentJson` ([handler](../../apps/api/src/modules/audit/application/commands/export-audit-trail/export-audit-trail.handler.ts#L128)). Query tải chỉ kiểm tra một vài kiểu trường JSON, không so checksum, không đối chiếu `export_request_id` với record, và không kiểm tra status READY ([handler](../../apps/api/src/modules/audit/application/queries/get-audit-export-artifact/get-audit-export-artifact.handler.ts#L32)). Artifact bị sửa hoặc không đồng bộ có thể được phát ra mà vẫn mang checksum cũ. Đây là rủi ro toàn vẹn dữ liệu lưu trữ, chưa có bằng chứng attacker có quyền sửa DB.

**Đề xuất:** Đọc record metadata và status, xác minh ID/version/checksum với JSON trước khi trả bytes; test artifact bị đổi một event hoặc identity.

### AU-05 — Trung bình — Version được cấp bằng đọc lớn nhất rồi cộng một

Hai export đồng thời có thể cùng đọc `latest.version` và cùng ghi version kế tiếp vì `version` không có unique constraint và không có lock/transaction cấp số ([handler](../../apps/api/src/modules/audit/application/commands/export-audit-trail/export-audit-trail.handler.ts#L83), [schema](../../apps/api/prisma/schema.prisma#L721)). Vì version là metadata public của artifact, chuỗi version không còn duy nhất và việc đối chiếu lịch sử trở nên mơ hồ.

**Đề xuất:** Cấp version bằng counter giao dịch/lock hoặc sequence DB và thêm test hai writer đồng thời trên PostgreSQL. Nếu version chỉ là nhãn phi duy nhất, đổi contract và tài liệu cho đúng nghĩa.

### AU-06 — Trung bình — Phân trang audit list không ổn định và có thể overflow offset

List chỉ `orderBy: createdAt desc`, không có tie-breaker ID ([handler](../../apps/api/src/modules/audit/application/queries/list-audit-events/list-audit-events.handler.ts#L94)). Events cùng timestamp có thể đổi vị trí giữa các trang. `page` chỉ được kiểm tra là integer dương; `skip = (page - 1) * pageSize` có thể vượt safe integer/giới hạn Prisma với input lớn ([handler](../../apps/api/src/modules/audit/application/queries/list-audit-events/list-audit-events.handler.ts#L137)).

**Đề xuất:** Sắp xếp `createdAt, id` ổn định và giới hạn offset hoặc chuyển sang cursor; test timestamp trùng và page cực lớn.

## Bốn góc review

1. **Adversarial:** AU-01 cho phép giả token khi secret mặc định được dùng; AU-02 là đường làm cạn tài nguyên từ request hợp lệ.
2. **Code review:** AU-04 và AU-05 làm sai ý nghĩa checksum/version; AU-06 gây phân trang không xác định. Các unit test chủ yếu dùng mock nhỏ và không chứng minh concurrency/integrity.
3. **Nest Clean Architecture:** Controller list/export/status chuyển qua CQRS, không gọi Prisma. Download kiểm tra token và gửi bytes trong controller; phần xác minh artifact nằm ở query nhưng hiện chỉ kiểm tra shape. `AuditExportBody` là TypeScript interface, không có decorator class-validator nên không được validation pipe kiểm tra ở ingress ([controller](../../apps/api/src/modules/audit/presentation/http/audit.controller.ts#L31)). Handler tự parse date, nhưng body thiếu có thể gây TypeError trước khi thành problem chuẩn.
4. **Security production:** List/export/status có `RbacGuard` và ADMIN role. Download là bearer URL có TTL 5 phút; cần bảo vệ secret và kiểm tra artifact vì route không có session guard. Chưa có audit event cho lần tải; kiểm tra yêu cầu traceability trước khi thêm vì URL ký có thể được chia sẻ có chủ đích.

## Verification

- `NODE_OPTIONS=--experimental-vm-modules pnpm --filter @lcsp/api exec jest --config ./jest.config.ts src/modules/audit --runInBand --watchman=false`: **7 suites, 33 tests passed**.
- Lần chạy thiếu `NODE_OPTIONS` không khởi tạo được Jest ESM (`jest-env.ts`), không phải test logic thất bại.
- Giai đoạn review ban đầu chỉ thêm báo cáo; phần khắc phục và xác minh được ghi bên dưới. Nhánh vẫn chưa commit hoặc push.

## Khắc phục trên nhánh review

- **AU-01:** Signing key bắt buộc tối thiểu 32 byte, kiểm tra lúc Nest khởi động; `.env.example` có biến cấu hình. Không còn fallback cố định.
- **AU-02:** PostgreSQL đếm tối đa 10.001 event trước, chỉ tính tổng byte payload nếu phạm vi dưới 10.000 event, rồi API đọc keyset page tối đa 100 event. Payload vượt 5 MiB bị từ chối trước khi chuyển JSON sang API; artifact sau redaction cũng có ngưỡng 5 MiB. Chưa có job cho export lớn, nên request vượt ngưỡng nhận problem rõ ràng.
- **AU-03/AU-05:** Version được cấp sau PostgreSQL advisory lock trong transaction; export READY và audit event ghi trong cùng transaction. Test PostgreSQL cho rollback/race đã thêm, chỉ chạy khi bật `LCSP_AUDIT_POSTGRES_TEST=1` trên DB test riêng.
- **AU-04:** Digest mới chuẩn hóa thứ tự khóa JSON để chịu được JSONB; query đối chiếu status, ID, version, event count và digest trước tải. Digest cũ được xác minh bằng cách dựng lại thứ tự field gốc; nếu thứ tự khóa bên trong payload lịch sử đã đổi trước khi lưu thì export đó vẫn bị từ chối và cần backfill có kiểm soát.
- **AU-06:** Sắp xếp `createdAt` rồi `id`, giới hạn offset 100.000.
- **Ingress và download audit:** Body export được parse strict trước CQRS; lần tải signed URL ghi AuditEvent bền vững trước khi trả bytes. URL bearer không có danh tính người dùng nên event ghi actor null, gắn export ID và correlation ID.

**RED/GREEN:** 7 assertions đầu tiên thất bại theo AU-01 đến AU-06; thêm RED cho body thiếu ngày, audit download thất bại, checksum lịch sử sau JSONB reorder và preflight payload quá lớn. Sau sửa, toàn bộ module Audit trên PostgreSQL test tạm đạt **9 suites / 49 tests**. Suite DB xác nhận rollback, hai export đồng thời, checksum mới/cũ sau JSONB round-trip và payload 6 MiB bị từ chối. Job API CI chạy suite PostgreSQL riêng trên DB test; schema có index `(createdAt,id)` cho preflight/keyset. Staging cấp khóa signing ngẫu nhiên và tài liệu PM2 hướng dẫn cấu hình. API TypeScript typecheck, ESLint phạm vi thay đổi, business-logic docs, import policy, contract literal policy và architecture gate đều pass (architecture còn ba cảnh báo circular cũ ngoài module Audit). Chưa có browser flow vì thay đổi chỉ ở API.

**Giới hạn xác minh:** Fixture checksum cũ được tạo từ một AuditEvent đã qua JSONB và đọc lại từ PostgreSQL; không có quyền truy cập dữ liệu export của môi trường triển khai để kiểm kê từng artifact lịch sử. URL cũ còn hạn sẽ vô hiệu nếu operator thay khóa signing khi rollout; giữ khóa ổn định trong `.env.pm2`.
