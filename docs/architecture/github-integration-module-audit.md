# Audit module `github-integration` — LCSP-999

Ngày: 2026-11-28. Nhánh audit: `review/LCSP-999-github-integration`.

## Phạm vi và phương pháp

- Đọc source, contracts và test của `apps/api/src/modules/github-integration`, các ranh giới `assessment`, audit và outbox liên quan. Dùng Graphify để định vị quan hệ; mọi kết luận bên dưới dựa vào source hiện tại, không dựa riêng vào cạnh suy luận của graph.
- Áp dụng các checklist của `lcsp-module-refactor-cleaner`, `lcsp-security-production-grade`, `bmad-review-adversarial-general` và `bmad-code-review` cho **toàn module**. Workflow `bmad-code-review` vốn yêu cầu một diff cụ thể; nhánh audit mới chưa có diff, nên đây là review toàn source theo các lớp kiểm tra của skill, chưa phải verdict trên một bản vá.
- Baseline trước test mới: **44 suites / 315 tests PASS**, 7 suites / 24 tests skipped bởi điều kiện sẵn có. Chưa sửa production code.

## Biên lai RED sau audit

Đã thêm **11 ca tái hiện** cho GI-01 đến GI-09 (GI-04 và GI-05/GI-06 có các biến thể riêng). Chạy `NODE_OPTIONS=--experimental-vm-modules pnpm --filter @lcsp/api exec jest --config ./jest.config.ts src/modules/github-integration --runInBand --watchman=false`: **11 failed đúng assertion nghiệp vụ, 315 passed, 24 skipped**; không có lỗi import hay compile. API `tsc --noEmit`, ESLint các test đã sửa và `git diff --check` đều PASS. GI-08 khóa quy tắc cùng PAT không tự kéo dài expiry đang được nêu trong JSDoc của handler; nếu product muốn cho phép đổi ngày theo khai báo, cần đổi đặc tả trước khi sửa code.

Tại mốc RED ban đầu, GI-01/GI-02 chỉ dùng fake persistence và chưa chứng minh rollback PostgreSQL; GI-04/GI-07 cũng chưa có đủ kiểm chứng race/stream. Các bằng chứng GREEN bổ sung được ghi ở phần **Tiến độ bản vá local sau RED** bên dưới. Không đổi expectation cũ chỉ để làm RED biến mất.

## Findings cần xử lý

### GI-01 — P1: Pin snapshot và audit không nguyên tử

**Root cause.** `PinSnapshotHandler.execute()` gọi `saveWithCreatedEvent()` rồi mới gọi `auditWriter.write()`. Repository chỉ đặt `RepositorySnapshot` và outbox trong một transaction; audit ở ngoài. Nếu audit thất bại, API báo lỗi nhưng snapshot và outbox đã commit. Retry có thể tạo snapshot thứ hai.

**Bằng chứng:** `apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.handler.ts:230-271`; `apps/api/src/modules/github-integration/infrastructure/persistence/prisma-repository-snapshot.repository.ts:47-67`.

**RED test:** ép audit insert thất bại trên PostgreSQL sau khi provider trả commit; khẳng định không còn snapshot/outbox và không có success response. Sau đó kiểm tra retry không tạo trùng.

**Hướng sửa:** đưa snapshot, outbox và audit vào cùng transaction, giữ external provider call ở ngoài transaction; khóa/revalidate thẩm quyền ngay trước commit.

### GI-02 — P1: Disconnect credential có thể mất audit vĩnh viễn

**Root cause.** Transaction đã hủy secret, revoke credential và connection trước khi `auditWriter.write()`. Nếu ghi audit thất bại, client nhận lỗi; retry thấy không còn active credential và không ghi audit nữa.

**Bằng chứng:** `apps/api/src/modules/github-integration/application/commands/disconnect-provider-credential/disconnect-provider-credential.handler.ts:65-118`.

**RED test:** làm audit sink thất bại; kiểm tra transaction rollback toàn bộ, hoặc một durable audit intent được commit và có thể phục hồi. Kiểm tra retry không bỏ qua audit.

**Hướng sửa:** ghi audit trong cùng unit of work hoặc commit durable outbox/audit intent cùng revocation; chỉ báo thành công khi có dấu vết bền vững.

### GI-03 — P1: Tạo connection mới dùng credential đã bị thay thế

**Root cause.** `ConnectAssessmentRepositoryHandler` chụp `metadata.id/currentVersion`, gọi provider bên ngoài, rồi nhánh tạo mới ghi `ACTIVE` mà không kiểm tra lại credential trong transaction. Nhánh rebind connection cũ có kiểm tra này. Rotation hoặc disconnect trong lúc provider call có thể để lại connection ACTIVE với binding stale.

**Bằng chứng:** `apps/api/src/modules/github-integration/application/commands/connect-assessment-repository/connect-assessment-repository.handler.ts:110-138,159-185,231-260`. Test hiện có chỉ xác nhận phiên bản được ghi bằng phiên bản dùng để validate, chưa kiểm tra phiên bản đó vẫn active lúc commit.

**RED test:** chặn provider promise, rotate/revoke credential, rồi cho provider trả thành công; nhánh tạo mới phải từ chối và không tạo ACTIVE connection.

**Hướng sửa:** revalidate ID, version, status, expiry của credential dưới cùng transaction/lock với insert, hoặc dùng CAS/foreign authority constraint phù hợp.

### GI-04 — P1/P2: Thẩm quyền assessment có thể cũ sau provider I/O

**Root cause.** Connect chỉ đọc owner và lifecycle trước provider validation; pin snapshot chỉ đọc owner trước resolve commit. Không có transaction-time recheck trước insert. Trong khi chờ provider, assessment có thể chuyển sang trạng thái không còn cho phép kết nối/pin, bị xóa hoặc đổi owner qua đường quản trị/dữ liệu; mutation vẫn dùng kết quả đọc cũ. Trường hợp đổi owner cần xác nhận đường mutation thực tế; lifecycle transition là đường có sẵn.

**Bằng chứng:** `connect-assessment-repository.handler.ts:72-95,231-260`; `pin-snapshot.handler.ts:104-123,230-251` trong cùng module.

**RED test:** pause provider, chuyển assessment khỏi trạng thái editable hoặc bắt đầu deletion, rồi resume; không được tạo connection/snapshot. Thử owner reassignment nếu hệ thống thực sự cho phép.

**Hướng sửa:** khóa/revalidate assessment và connection ngay trong transaction ghi, điều kiện owner + lifecycle được kiểm tra tại thời điểm commit.

### GI-05 — P2: Hai instance cache archive xóa dữ liệu của nhau

**Root cause.** Cache mặc định dùng một thư mục tạm chung. `onModuleDestroy()` xóa đệ quy toàn thư mục; startup xóa mọi `.tmp` trong thư mục, kể cả file một process khác đang ghi.

**Bằng chứng:** `apps/api/src/modules/github-integration/infrastructure/github/snapshot-archive-cache.ts:83-105,260-269`.

**RED test:** hai instance cùng cache root; instance B đang capture, instance A shutdown/restart; B vẫn phải hoàn tất và entry còn đọc được.

**Hướng sửa:** cấp thư mục con riêng cho mỗi process hoặc dùng ownership marker để chỉ dọn file của chính instance; xác định rõ chính sách chia sẻ cache giữa replicas.

### GI-06 — P2: Capture lỗi có thể xóa entry thành công cùng key

**Root cause.** Hai capture cùng snapshot/commit dùng chung canonical key. Catch của capture thất bại gọi `removeEntry(key)`, xóa cả archive/metadata mà capture khác vừa publish thành công.

**Bằng chứng:** `snapshot-archive-cache.ts:164-214,225-227` trong cùng module.

**RED test:** cho capture A thành công và B cùng key thất bại sau đó; entry A phải còn nguyên và đọc được.

**Hướng sửa:** serialize publisher theo key hoặc chỉ dọn file tạm thuộc request thất bại; canonical entry chỉ được xóa khi chứng minh nó thuộc attempt đó.

### GI-07 — P2: Stream thành công nhưng hydration ticket còn RUNNING

**Root cause.** Sau `pipeline(stream, response)`, controller ghi `COMPLETED`. Nếu bước ghi này thất bại, controller chỉ log, trong khi HTTP 200 và archive đã được gửi. Lượt tải sau bị từ chối vì ticket vẫn RUNNING; endpoint reconcile hiện có phụ thuộc điều kiện Root terminal, nên không thay thế được việc hoàn tất ngay.

**Bằng chứng:** `apps/api/src/modules/github-integration/presentation/http/internal-snapshot.controller.ts:126-145`; `application/queries/stream-snapshot-archive/stream-snapshot-archive.handler.ts:150-160`.

**RED test:** stream bytes thành công nhưng finalizer lỗi; kiểm tra có durable recovery/receipt để ticket đạt trạng thái đúng mà không phát lại archive hoặc suy diễn sai kết quả.

**Hướng sửa:** ghi durable completion intent/retry có giới hạn và đối soát idempotent; expose trạng thái thực cho worker khi cần, vì HTTP status đã không thể đổi sau khi stream kết thúc.

### GI-08 — P2: Có thể kéo dài expiry của cùng một PAT bằng khai báo mới

**Root cause.** Handler nói cùng PAT giữ declared expiry, nhưng nhánh `submittedExpiry !== undefined` ghi đè expiry ngay cả khi secret giống hệt. Client có thể khai báo ngày muộn hơn mà không đổi PAT.

**Bằng chứng:** `apps/api/src/modules/github-integration/application/commands/configure-provider-credential/configure-provider-credential.handler.ts:47-50,145-154`.

**RED test:** cấu hình PAT với expiry T1, gửi lại cùng PAT với expiry T2 > T1, xác nhận expiry không được âm thầm kéo dài theo chính sách đã duyệt.

**Hướng sửa:** chốt rõ chính sách: cùng secret giữ expiry cũ hoặc xác minh expiry mới bằng bằng chứng provider; test cả rotation thật và replay cùng secret.

### GI-09 — P3: Rate-limit map không được dọn

**Root cause.** Guard giữ một entry cho mỗi user trong `Map`; chỉ thay entry khi chính user đó gửi request tiếp, không xóa user đã rời đi. Map tăng theo số tài khoản từng dùng endpoint và giới hạn không chia sẻ giữa replicas.

**Bằng chứng:** `apps/api/src/modules/github-integration/presentation/http/github-credential-request.guard.ts:20-65`.

**RED test:** nhiều user, advance clock qua window; kiểm tra entries hết hạn được dọn và giới hạn vẫn đúng. Kiểm tra cách giới hạn hoạt động trên hai replicas nếu đây là security rate-limit chính.

**Hướng sửa:** dùng store có TTL/cap; nếu cần hard limit liên replica thì dùng backend rate-limit chung.

## Thứ tự đề xuất

1. GI-01 đến GI-04: transaction, audit và thẩm quyền. Viết RED PostgreSQL race/failure trước khi sửa.
2. GI-05 đến GI-07: độ tin cậy archive/hydration, kiểm tra multi-instance và stream completion.
3. GI-08: chốt chính sách expiry với product/security trước khi đổi hành vi; GI-09 xử lý cùng rate-limit hardening.

Các finding là kết luận tại thời điểm audit source; baseline xanh khi đó chưa chứng minh các race và lỗi audit đã được bao phủ. Ở lượt audit/RED ban đầu chưa đổi production và không commit/push.

## Tiến độ bản vá local sau RED

- **GI-01, GI-02:** Đưa audit vào cùng transaction với snapshot/outbox hoặc thu hồi credential. Repository snapshot khóa và đọc lại assessment cùng connection trước khi ghi. PostgreSQL test DB riêng `127.0.0.1:55490/github_integration_test` đã xác nhận lỗi audit làm rollback snapshot + outbox và rollback credential revocation + secret destruction.
- **GI-03, GI-04:** Cả nhánh tạo mới và rebind connection khóa assessment/credential trong write transaction, đọc lại owner, lifecycle, credential ID/version/status/expiry sau provider I/O. Pin snapshot đọc lại owner và connection sau khi khóa. PostgreSQL test xác nhận stale lifecycle/credential bị từ chối; hai race thực giữ `Assessment FOR UPDATE` và `AssessmentRuntime FOR UPDATE`, cho mutation đợi rồi commit trạng thái mới, kết quả không có connection hoặc ticket reconciliation sai.
- **GI-05, GI-06:** Mỗi cache instance sở hữu thư mục riêng; capture lỗi chỉ dọn file tạm của chính attempt. Hai ca tranh chấp cache đã GREEN.
- **GI-07:** Thêm retry idempotent phía server và header ticket chỉ cho trusted hydration. Sau khi kiểm tra bytes/metadata, worker gọi ACK idempotent qua route có `WorkerApiKeyGuard`; ACK lỗi hoặc ticket ID không khớp thì worker không trả bytes cho Root. Khi lần GET kế tiếp gặp ticket `RUNNING`, query handler chỉ cho phép chuyển về `FAILED`/retry sau khi lifecycle xác minh Root terminal; Root còn hoạt động vẫn bị chặn. Nest route và Python client tests đã GREEN. PostgreSQL test dùng lifecycle instance mới để mô phỏng API restart: lease Root đang hoạt động vẫn giữ ticket `RUNNING`; sau khi Root kết thúc, instance mới chuyển ticket sang `FAILED` với lý do `OUTCOME_UNPROVEN`.
- **GI-08, GI-09:** Cùng PAT giữ nguyên declared expiry đã ghim; rate guard dọn window hết hạn. RED tests đã GREEN.

Biên lai cuối: module Jest + route suite **334 passed / 30 skipped** khi không bật DB opt-in; riêng provenance PostgreSQL integration **13/13 passed** trên DB test riêng, 194 migrations đã áp dụng. Python snapshot client **16/16 passed**. API `tsc --noEmit`, ESLint module, import policy, business-logic documentation và `git diff --check` đạt. Architecture check thoát 0 với ba cảnh báo vòng import cũ ở `compliance-rule-set`, ngoài phạm vi module này. Chưa commit/push.

### GI-07 — Biên lai diễn tập crash hai process trên DB test riêng

- Môi trường: `127.0.0.1:55490/github_integration_test`; `.env` đang cấu hình `MODEL_USAGE_DEBIT=SHADOW`, nhưng harness này không khởi chạy billing hay thao tác ví. Fixture Root đã kết thúc và ticket trusted hydration được đặt `RUNNING` trước diễn tập. Không truy cập `lcsp_local`.
- Process Node chạy **`InternalSnapshotController.streamArchive()` thật** qua HTTP loopback; QueryBus trả archive fixture, còn CommandBus mô phỏng lỗi PostgreSQL ở cả hai lần finalization sau khi bytes được gửi. Process Python chạy **`RepositorySnapshotClient.download_archive_with_metadata()` thật** và dừng bằng hook test ngay trước `httpx.post()` ACK. Worker báo `WORKER_BEFORE_ACK`, chứng minh đã nhận và xác thực response nhưng chưa ACK.
- Gửi `SIGKILL` tới đúng hai PID của harness. Truy vấn PostgreSQL ngay sau đó trả `RUNNING|NULL`: không có completion giả hoặc ACK ngầm. Process Node mới gọi **`RuntimeHydrationTicketLifecycle.reconcileTerminalRuntime()` thật** và nhận `{status: "FAILED", changed: true}`; DB trả `FAILED|RUNTIME_HYDRATION_OUTCOME_UNPROVEN`. Test PostgreSQL khác đã chứng minh Root còn lease thì reconciliation bị từ chối và ticket giữ `RUNNING`.
- Giới hạn bằng chứng: harness dùng QueryBus/CommandBus fixture để điều khiển đúng crash window, không boot toàn bộ Nest AppModule hoặc liên lạc với Git provider. Kết quả chứng minh phục hồi bền vững qua hai process bị giết và process mới trên PostgreSQL thật; kiểm chứng triển khai nhiều replica và provider thật vẫn thuộc nghiệm thu vận hành môi trường đích. Ticket có thể giữ `RUNNING` cho tới khi Root kết thúc và có GET/reconcile tiếp theo; đây là hành vi fail-closed đã thiết kế.
