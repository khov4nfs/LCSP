# Kế hoạch hoàn tất Assessment module hardening — 28/11/2026

## Đích hoàn thành và ranh giới

**Mốc A — Hoàn thành triển khai và bàn giao review:** mọi finding còn hiệu lực của Prompt 1–8 có implementation hoặc quyết định rút/supersede được đối chiếu; RED/GREEN, tích hợp, review bảo mật, QA và tài liệu đủ bằng chứng; Prompt 9–10 hoàn tất theo điều kiện của chúng. Đây là mốc hoàn thành công việc kỹ thuật của Assessment.

**Mốc B — Cho phép bật debit production:** thêm bằng chứng vận hành và phê duyệt GREEN cho G-01..G-07 theo `docs/product/addendum.md`; Product, Finance và Release Authority quyết định go/no-go. Mốc A không tự động đạt Mốc B. Cho đến lúc đó giữ `MODEL_USAGE_DEBIT=OFF`, `PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF`, không cutover ví thật. Test có ghi DB chỉ dùng database test chuyên dụng; `lcsp_local` chỉ đọc khi thu thập bằng chứng.

Không thêm PBAC/organization, không triển khai worker API key rotation, giữ một `WORKER_API_KEY`. Không commit/push/PR khi chưa có lệnh của người dùng. Giữ nguyên thay đổi sẵn có trong working tree.

## Baseline đã có, không làm lại

- Prompt 1–7 đã có implementation và test receipt; cần **đối chiếu acceptance cuối**, không tái triển khai từ đầu. Các finding withdrawn/superseded và accepted design phải được kiểm tra theo audit report.
- Prompt 8 đã có pricing snapshot, admission, SHADOW/ON settlement code, reconciliation/compensation, PAYMENT_REQUIRED và worker recovery. Debit production vẫn OFF. Các gate G-01..G-07 chưa GREEN.
- Ba nhóm test Python legacy A/B/C vừa được chuyển sang server-issued admission: 197/197 test liên quan đạt. NestJS admission E2E 30/30 đạt. Lỗi giữ slot sau local denial và thiếu tariff trả 500 đã có RED/GREEN.
- Các số test và gate cũ trong tài liệu là biên lai tại thời điểm ghi; mỗi mốc dưới đây cần chạy lại suite tương ứng trên HEAD đang xét.

## Trình tự thực hiện đến Mốc A

| Mốc | Công việc bắt buộc | Bằng chứng để đóng | Phụ thuộc |
| --- | --- | --- | --- |
| A1. Chốt baseline | Lập ma trận ASM finding → test → code → trạng thái; đối chiếu Prompt 1–7, accepted/withdrawn/superseded; ghi snapshot git status và phân loại lỗi lint hiện tại. | Một ma trận không còn finding hiệu lực “không rõ trạng thái”; lỗi lint mới và tồn đọng được phân biệt, không xóa kỳ vọng hợp lệ. | Bắt đầu ngay. |
| A2. Chốt worker/admission | Chuyển script diễn tập `deepagents/tests/vertical/bounded_admission_rehearsal.py` hoặc ghi rõ lý do retire; kiểm tra local reservation còn bị giữ sau server consume/cancel không chắc chắn; kiểm chứng request → consume → provider → settle/recovery ở cả sync/async và retry/fallback, không nới fail-closed. | Test scoped RED/GREEN cho lỗi mới, rehearsal chạy được, không có đường provider tính phí vượt admission; Python suites liên quan GREEN. | A1. |
| A3. Chốt WP8 chức năng | Chọn và ghi rõ authority của `ModelOutputEvaluation` theo physical `invocationId` qua retry/fallback; triển khai writer và replay nếu còn trong phạm vi đã duyệt. Hoàn thiện Admin reconciliation decision/compensation UI, bảo vệ RBAC/BOLA, i18n, BFF; chạy browser thật. Diễn tập crash tại settlement → checkpoint → Continue để bảo đảm không dispatch lại call đã trả phí. | Contract/API/Python/Web test và browser flow GREEN; evaluator gắn đúng invocation; Admin mutation có audit/idempotency; crash recovery không double-call/double-debit. | A2; quyết định evaluator trước khi sửa writer. |
| A4. Chốt chất lượng WP8 | Xử lý lint trên đúng file thay đổi mà không format tràn lan làm mất diff; chạy typecheck, lint scoped, docs gate, architecture/import checks, `git diff --check`; review độc lập tài chính, bảo mật, concurrency và failure paths. | Từng lỗi P0/P1/P2 được sửa bằng RED/GREEN hoặc ghi quyết định có thẩm quyền; các gate kỹ thuật đạt, diff được review. | A2–A3. |
| A5. Prompt 9 | Sau khi các behavioral fixes Prompt 1–8 đạt GREEN kỹ thuật, xử lý ASM-10/20/21/22 theo lát cắt nhỏ: characterization test → refactor → review → regression. Không mở rộng phạm vi. | Mỗi lát cắt giữ nguyên behavior/API, architecture/import checks đạt; không còn finding report-only được chấp nhận nhưng chưa xử lý. | A4; điều kiện Prompt 9 trong work-package document. |
| A6. Prompt 10 và bàn giao | Review độc lập Security, Code, Edge Case, Adversarial, QA trên toàn bộ Assessment và adjacent billing/worker/web; chạy acceptance matrix, test, lint/type/docs/architecture/import, browser flow; đối chiếu git diff và lập exception register. | Báo cáo cuối có từng ASM finding, test receipt, file thay đổi, rủi ro còn lại và phán quyết `TECHNICAL_COMPLETE` hoặc `REQUEST_CHANGES`. Không tự ghi gate vận hành GREEN. | A5. |

**Quy tắc vòng lặp:** chỉ mở bug từ assertion hoặc bằng chứng cụ thể; viết reproducer RED trước production fix, sửa tối thiểu, chạy GREEN, review và đóng đúng mục trong ma trận. Không quay lại audit toàn repo sau mỗi lát cắt. Nếu A6 tìm lỗi, trả về mốc sở hữu lỗi rồi chạy lại đúng các suite bị ảnh hưởng.

**Ước lượng ban đầu đã lỗi thời sau A1/A2.** Theo dõi bằng danh sách công việc và biên lai bên dưới thay vì hứa ngày đóng Mốc A. Mốc B không có ngày hứa trước khi có pilot telemetry, dữ liệu staging đại diện và lịch phê duyệt của các chủ gate.

## Tiến độ đối chiếu ngày 28/11/2026

| Mốc | Trạng thái hiện tại | Việc còn phải làm để đóng |
| --- | --- | --- |
| A1 | Inventory 24/24 finding; Prompt 1–7 đạt scoped GREEN, toàn module Assessment 782/782 trong môi trường có socket. | Đối chiếu từng assertion với từng finding trong ma trận; review diff cuối để chuyển `Scoped GREEN` thành `VERIFIED` hoặc `OPEN`. |
| A2 | Rehearsal offline server-issued và local reservation liveness đã có RED/GREEN; 136/136 Python test liên quan. | Tích hợp chứng cứ loss recovery vào A3/G-06; xác nhận mọi route deployment thực tế khi có manifest. |
| A3 | Admin reconciliation UI đã có; settlement tạo `NOT_EVALUATED`; response mã hóa replay qua graph crash test với một provider call và một settlement. Postgres saver test 3/3 xác nhận xóa response sau checkpoint ack đúng, giữ lại nếu ghi thất bại hoặc sai invocation. | Callback verdict có chứng cứ server xác minh, diễn tập restart worker và live mutation browser flow. |
| A4 | Bốn file Billing trọng tâm đã scoped ESLint sạch; typecheck/docs/diff checks có biên lai. | Review diff rộng, chạy lại gate trên working tree cuối sau A3/A5; xử lý P0/P1/P2 được phát hiện, không suy rộng từ các biên lai cũ. |
| A5 | Đã lập inventory Prompt 9, chưa sửa production. | Characterization → refactor từng ASM-10/20/21/22 → regression, sau khi A3/A4 đủ ổn định. |
| A6 | Chưa bắt đầu. | Review độc lập Security/Code/Edge/Adversarial/QA và ma trận acceptance cuối; lập exception register. |

A4 review bổ sung: expiry replay của admission có race với consume. Focused handler test đã RED 422 trước fix, GREEN 2/2 sau CAS `id + ADMITTED + version + expiresAt` và reread khi thua; API typecheck, scoped ESLint và docs gate đạt. Test này mô phỏng cạnh tranh trong mock repository; chưa có biên lai PostgreSQL concurrent E2E cho đúng race này, nên giữ mục đó trong QA cuối.

A3 verdict blocker sau review bảo mật: `AssessmentRuntimeEvent.outputSummaryJson.agentStreamEvent.eventId` có thể do worker cung cấp, chưa có DB uniqueness/immutability. Hai event trùng có thể xuất hiện sau callback đã đọc một event; một `toolCallId` cũng có thể nằm trong hai receipt cùng preparation run. Không được đặt UNIQUE `(runId, toolCallId)` ở settlement vì provider có thể tái dùng ID trong một lần gọi hợp lệ khác sau khi đã tính phí. Route ghi `DOMAIN_REJECTED` phải giữ fail-closed cho đến khi journal unique/immutable, rejection event mang đúng physical `invocationId` do server cấp, và callback kiểm tra event/receipt/admission dưới test cạnh tranh. Receipt `toolCallIds` đã ghim và CHECK canonical là nền tảng, chưa đủ tự nó cấp quyền verdict.

A3 review tiếp theo: journal unique/UPDATE-immutable và callback hẹp đã có test tích hợp, nhưng trigger ban đầu chặn DELETE của rejection event, gây hồi quy xóa legal source/parent cascade. Direct PostgreSQL test RED và migration tiếp theo `20261128131500...` đã đổi trigger sang UPDATE-only; 4/4 DB test GREEN, parent cascade lại chạy. LegalSourceDeletionService suite riêng trên `55445/lcsp365_legal_source_deletion_test` chưa được chạy. Route verdict vẫn đóng vì chưa có production caller sau khi journal lưu, truy vấn callback còn phải lọc đúng loại event khi ID trùng với normal progress, và cần chính sách lưu/xóa evidence hoặc audit snapshot trước khi đánh dấu G-07. Giữ verdict `NOT_EVALUATED` đến khi delivery có test end-to-end.

Kho response đã nối runtime và test crash qua graph thật chứng minh khôi phục đáp án gốc với một provider call, một settlement; SQLite/sweeper test 10/10 đạt. Hook xóa sau native `put_writes` đã được test bằng graph thật với `deque` pending writes, cùng suite 20/20 đạt. Postgres saver thật trên database test chuyên dụng đạt 3/3: chỉ xóa sau ghi thành công đúng invocation; ghi thất bại hoặc sai invocation giữ envelope. Diễn tập restart worker trên deployment và bảo đảm xóa khỏi WAL/backup vẫn OPEN. TTL 24 giờ và startup purge là kiểm soát tạm. Vì vậy A3/G-06/G-07 chưa được gọi hoàn tất. `docs/architecture/assessment-completion-a1-matrix.md` là biên lai kỹ thuật cập nhật hơn các đoạn mô tả lịch sử trong `assessment-prompt8-technical-gate-status.md`.

## Đường đi từ Mốc A đến Mốc B: bảy gate vận hành

| Gate | Gói bằng chứng cuối cần tạo | Người phê duyệt theo addendum |
| --- | --- | --- |
| G-01 | Inventory route/model/bucket đang bật; coverage ACTIVE tariff; nguồn giá, bảng giá customer được duyệt và kế hoạch rollback tariff. Giá public/FX/infra/markup 1,2 chỉ là đầu vào soạn giá, không là settlement runtime. | Product + Finance. |
| G-02 | Threat model và E2E rebind owner/wallet/run/model/snapshot/receipt; kiểm tra BOLA, mass assignment và capability replay. | Engineering + Security. |
| G-03 | Reconciliation legacy ↔ microcredits trên dữ liệu đại diện, exception register, staging backfill/cutover/rollback rehearsal; không dùng ví thật để thử. | Data/Engineering + Finance. |
| G-04 | Chứng minh bounds của từng provider route cho cache/reasoning; property/boundary tests; telemetry soak cùng cửa sổ thời gian về exposure và slot rejection; policy số và version được duyệt. DB `lcsp_local` hiện không có mẫu, nên chỉ có thể dùng rehearsal/SHADOW pilot để thu thập số liệu mới. | Product + Finance + Security. |
| G-05 | Rehearsal publish/supersede/emergency tariff rollback, audit sample, database non-overlap/immutability evidence và runbook. | Finance + Engineering. |
| G-06 | Manifest route/fallback deployment, phân loại Jev gateway, một Root trace với claim/hydration thật qua HTTP/DB, telemetry chứng minh mọi physical call có admission/consume/outcome, key startup/rotation/loss recovery. | Engineering + QA. |
| G-07 | Provider evidence key authority độc lập và bền vững; queue SLO, Admin decision/compensation flow qua browser, encrypted envelope loss/terminal deletion rehearsal, late receipt/replay/concurrency và operations runbook. | Billing Operations + Finance + QA. |

Thu thập G-01/G-02/G-03/G-05/G-06/G-07 song song sau khi nền kỹ thuật tương ứng ổn định; G-04 cần thời gian đo pilot thực tế, không thể thay bằng test fixture. Chủ gate ký trên bằng chứng, ghi ngày và ngoại lệ; chỉ khi cả bảy GREEN mới xin quyết định bật debit. Không tự suy diễn approval từ test xanh.

## Thứ tự ưu tiên ngay lần làm việc tiếp theo

1. **A3:** thiết kế vòng đời bằng chứng rejection cùng chính sách xóa Legal Source; chỉ bật callback verdict sau khi có production caller và test race kiểm chứng event, receipt, physical `invocationId`. Giữ `NOT_EVALUATED` khi thiếu chứng cứ.
2. **A3/G-07:** diễn tập restart worker trên deployment, kiểm tra xóa envelope qua SQLite WAL/backup và chạy browser mutation Admin bằng tài khoản test.
3. **A4:** chạy PostgreSQL concurrent E2E cho race admission replay/consume, lint/type/docs/architecture và review diff cuối.
4. **A5–A6:** thực hiện Prompt 9 theo bốn finding report-only khi WP1–8 GREEN kỹ thuật, rồi QA/review toàn Assessment và adjacent billing/worker/web. Song song gom bằng chứng G-01..G-07; không giữ kỹ thuật chờ số liệu pilot.

Không gán phần trăm hoàn thành khi chưa có ma trận A1. Báo cáo tiến độ sau đây sẽ dùng số mục đã đóng/tổng mục và bằng chứng tương ứng, thay vì ước lượng cảm tính.
