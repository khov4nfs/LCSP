# A1 — Ma trận đóng finding Assessment (đang đối chiếu)

Ngày bắt đầu: 28/11/2026. Nguồn yêu cầu: `assessment-module-audit-red-test-handoff.md`; nguồn tiến độ: `assessment-hardening-overnight-report-2026-11-28.md` và `assessment-prompt8-technical-gate-status.md`. “Có biên lai” chưa đồng nghĩa đã chạy lại trên working tree hiện tại.

| Finding | Phân loại | Gói thực hiện | Trạng thái đối chiếu | Bằng chứng cần chốt |
| --- | --- | --- | --- | --- |
| ASM-01, 02, 07 | Withdrawn | Không triển khai | Đóng theo quyết định | Xác nhận không phát sinh PBAC/organization hoặc thay zero-retention. |
| ASM-03, 18 | Accepted design | Không đổi hành vi | Đóng theo quyết định | Một worker key; DELETE fail/retry idempotent. |
| ASM-14 | Đã xử lý trước audit | Regression | Scoped GREEN | Runtime authority và root-context suites: 28/28. |
| ASM-04, 08 | Behavioral | Prompt 4 | Scoped GREEN | RBAC guard/preflight và event appender trong biên lai 11 suite. |
| ASM-05, 06, 11, 12, 13 | Behavioral | Prompt 1 | Scoped GREEN | Delete, detail loader và repository RED specs trong biên lai 11 suite. |
| ASM-09 | Behavioral | Prompt 5 | Scoped GREEN | `test_assessment_runtime_client_retries.py`: 31/31. |
| ASM-15 | Behavioral | Prompt 6 | Scoped GREEN | Rule audit suite trong biên lai 11 suite. |
| ASM-16, 17 | Behavioral | Prompt 3 | Scoped GREEN | Submit-report và report-loader suites trong biên lai 11 suite. |
| ASM-19 | Behavioral | Prompt 7 | Scoped GREEN | Legal-search suite trong biên lai 11 suite. |
| ASM-23 | Behavioral | Prompt 2 | Scoped GREEN | Admin RBAC và detail-loader suites trong biên lai 11 suite. |
| ASM-24 | Kiến trúc và vận hành | Prompt 8 | Chưa đóng | A2–A4 và G-01..G-07; debit vẫn OFF. |
| ASM-10, 20, 21, 22 | Report-only | Prompt 9 | Chưa làm | Characterization → refactor lát cắt → regression. |

## Việc kế tiếp trong A1

Biên lai chạy lại 28/11/2026: 11 Jest suites liên quan Prompt 1–4, 6–7 đạt **127/127**; Python runtime-client suite Prompt 5 đạt **31/31**. Đây là scoped GREEN của test đã chọn, chưa thay thế E2E hay review Prompt 10.

ASM-14: hai Jest suites runtime authority/root context đạt **28/28**. A2 phát hiện thêm suite token-budget legacy 3/6 RED do thiếu server execution context; sau khi chuyển fixture test và rehearsal sang offline server-issued authority, suite đạt **6/6** và script độc lập trả `OFFLINE_ADMISSION_PASS` với 7 physical handler calls, 0 paid model calls.

A2 local-journal parity: middleware test dùng SQLite thật tái hiện RED việc server đã xác nhận `CONFIRMED_NO_USAGE` nhưng local exposure vẫn bị giữ. Bản vá truyền `runId` từ request đã xác minh và chỉ đóng local attempt khi server trả `slotReleased=true`; hủy/consume mơ hồ vẫn giữ exposure và encrypted envelope. Middleware test terminal/nonterminal và 5 suite liên quan đạt **136/136**. Mục local reservation liveness trước dispatch được đóng ở phạm vi kỹ thuật này; recovery sau crash vẫn thuộc G-06/G-07 vận hành.

A3 `ModelOutputEvaluation`: Người dùng chốt chỉ ghi `DOMAIN_REJECTED` khi evaluator có bằng chứng nghiệp vụ gắn đúng physical `invocationId`; các call khác giữ `NOT_EVALUATED`. Settlement tạo row `NOT_EVALUATED` riêng trong cùng transaction với receipt, không tự đánh dấu `ACCEPTED`. PostgreSQL E2E RED thiếu row → GREEN, toàn suite Phase C **14/14**. Writer verdict downstream và cơ chế causation qua retry/fallback vẫn OPEN.

A3 checkpoint crash: test graph thật tái hiện RED hai provider calls khi replay model node sau terminal settlement nhưng trước checkpoint. `logicalOperationId` nay dùng LangGraph `task_id` ổn định qua replay; server replay `SETTLED` bị chặn trước consume/provider. Focused 21/21 và adjacent 57/57 PASS. Bản vá ngăn double dispatch/debit, chưa tự phục hồi response bị mất; run fail closed và recovery UX/operations vẫn OPEN.

A3 response recovery (28/11): người dùng chọn kho response mã hóa. Worker nay lưu `ModelResponse` vào SQLite AES-GCM trước settlement, AAD gắn admission, physical invocation, run và graph step; server `SETTLED` replay phải khớp cả hai ID trước khi trả lại response. Test graph thật qua checkpoint giả lập crash trước commit: trả lại câu trả lời gốc với **1 provider call, 1 settlement**; test serializer riêng giữ tool calls/usage. Startup sweeper chỉ đánh dấu response terminal khi server xác nhận; store/sweeper test **10/10** bao gồm collision, hoán đổi row, expiry, startup purge, migration unique fail-closed và tool-call causation. `MeasuredPostgresSaver.put_writes` xóa sau native model write thành công khi run/task/physical ID và message khớp; test graph thật bắt được `deque` writes và cùng suite đạt **20/20**. Postgres saver integration trên DB test chuyên dụng **3/3 PASS** (xóa đúng output, giữ khi sai invocation hoặc ghi native thất bại). **Chưa đóng G-07 vận hành**: chưa có diễn tập restart toàn worker trên deployment; TTL tạm 24 giờ và startup purge chưa chứng minh secure erasure khỏi mọi WAL/backup. Response không đi vào ledger/audit/telemetry.

A3 evaluator causation: worker đã ghi đè response marker `_lcsp_physical_invocation_id` bằng ID do server cấp; test retry/fallback xác nhận không giữ ID giả hoặc ID attempt trước, 48/48 Python PASS. Chưa ghi `DOMAIN_REJECTED`: tool preflight chỉ có `model_turn`/`tool_call_id`, chưa có sự kiện đánh giá bền vững gắn marker vật lý; giữ `NOT_EVALUATED` theo quyết định người dùng. Cần callback verdict có xác thực admission/run và idempotency sau khi có evaluator event thực.

A3 causation bổ sung: worker đã lưu bền vững ánh xạ `(runId, toolCallId) → invocationId` từ model response được đóng dấu bởi server; 3/3 test mapping và bộ liên quan 66/66 PASS. Đây là chỉ mục local, chưa phải chứng cứ server chấp thuận verdict. [Đặc tả causation](assessment-output-evaluation-causation-spec-2026-11-28.md) ghi sáu kịch bản RED cho callback có xác thực, chống claim tùy ý, nhiều tool call, idempotency và không sửa billing; writer `DOMAIN_REJECTED` vẫn OPEN.

A3 receipt causation: settlement `COMPLETED` ghim danh sách `toolCallIds` từ model response vật lý vào `ModelUsageReceipt` bất biến; fingerprint giữ tương thích replay receipt cũ khi danh sách vắng mặt. Contract, worker, recovery sweeper và PostgreSQL CHECK dùng cùng tập ID printable ASCII, tối đa 64, dài 1–200, sắp xếp và không trùng. E2E Phase C sau migration **16/16 PASS** trên DB test chuyên dụng; direct DB constraint test RED→GREEN. Rule-preparation `CUSTOM_PROGRESS` rejection event đã được xác nhận lưu với event ID do worker cung cấp, run/preparation scope và `toolCallId`; ID này chưa đủ thẩm quyền verdict.
A3 điều chỉnh thẩm quyền verdict: `CUSTOM_PROGRESS.eventId` có thể do worker cung cấp, không phải ID do server tạo. Review tìm thấy hai lỗ hổng P1: một `toolCallId` có thể có trong hai receipt cùng run, và journal JSON eventId chưa unique/immutable nên callback có thể chọn nhầm hoặc bị race. Route/writer thử nghiệm đã bị tháo khỏi module/allowlist; test acceptance giữ pending, mọi verdict tiếp tục `NOT_EVALUATED`. Cần DB row ID bất biến, một receipt duy nhất cho `(runId, toolCallId)` và E2E race trước khi mở writer. Bốn route Admin reconciliation/compensation hiện hữu đã bổ sung allowlist; route test RED 3/4 → GREEN **4/4**.

A3 Admin reconciliation: case detail nay có `compensationPreview` nullable từ debit gốc ON/DEBIT_ENABLED, receipt và các compensation trước; backend compensation E2E **15/15**. Web có form quyết định và form bồi hoàn chỉ khi preview hợp lệ; BFF/UI chạy lại **10/10**, Web typecheck/lint/docs đạt. Chrome mock Admin hiển thị case và form; thử 701 trên remaining 700 bị chặn, 700 hợp lệ bật nút; không gửi mutation. Tab mới không có console error/warning. Đây là browser fixture evidence, chưa phải thao tác tài chính production.

Toàn bộ `src/modules/assessment` chạy lại với quyền truy cập socket/Chromium cục bộ đạt **78/78 suites, 782/782 tests**. Lần chạy trong sandbox mặc định nhận `EPERM` từ Supertest và Chromium launch failure (71/78 suites, 714/782 tests); đây là khác biệt quyền môi trường đã được phân biệt bằng lần chạy cùng lệnh ngoài sandbox. Bằng chứng này đóng baseline unit/integration trong module, không thay thế Prompt 10 hoặc các gate vận hành.

Baseline ESLint ba file Billing trọng tâm (28/11/2026): request-admission handler HEAD **423**, working tree **449** lỗi; admission E2E HEAD **37**, working tree **35**; settlement E2E HEAD **132**, working tree **0**. Tổng working tree **484** lỗi trên ba file, so với **592** tại HEAD. Các số này chưa quy kết 26 lỗi tăng ở handler là do một patch cụ thể; cần phân loại theo dòng và xử lý có kiểm soát, không gọi toàn bộ 484 lỗi là mới.

Cập nhật A3/A2 cuối lượt: rejection journal có partial unique theo run/event và chặn UPDATE. Trigger chặn DELETE ban đầu gây hồi quy xóa Legal Source; migration `20261128131500_wp8_a3_rejection_journal_deletion_lifecycle` cho phép DELETE theo vòng đời dữ liệu, direct PostgreSQL test **4/4 PASS** gồm parent cascade. Callback verdict vẫn tắt vì chưa có production caller và chính sách giữ snapshot bằng chứng sau khi journal bị xóa. Suite Legal Source riêng cần DB test `55445/lcsp365_legal_source_deletion_test` hiện chưa sẵn sàng. Fixture `test_claim_inventory_protocol.py` đã dùng server admission giả lập, context đầy đủ và ID riêng theo test; production guard giữ nguyên. Toàn file **21/21 PASS**; chạy chung với `test_server_issued_admission.py` và `test_paid_model_response_replay.py` đạt **47/47 PASS**.

Cập nhật lint sau A4 slice: request-admission handler **449→0** (447 formatting, 2 import thừa), admission E2E **35→0** (typed parsing của HTTP/Python fixtures), settlement E2E **0** sau test A3. API typecheck đạt; admission integration subset **4/4** và settlement **14/14** đạt. Formatting handler mở rộng diff nhưng không đổi logic; cần review diff ở Prompt 10.

1. Gắn từng hàng scoped GREEN với test và assertion cụ thể; chạy tích hợp liên tầng. Không suy ra hoàn tất toàn module chỉ từ unit test.
2. Đo lint trên danh sách file thay đổi; tách lỗi mới, lỗi đã có trong working tree và lỗi ngoài scope. Không chạy formatter tràn lan.
3. Khi đủ bằng chứng, cập nhật ma trận thành `VERIFIED` hoặc `OPEN` và bắt đầu A2. A1 hiện là **inventory 24/24 finding**, chưa phải nghiệm thu 24/24.
