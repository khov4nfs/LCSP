# T31 — Báo cáo hoàn tất phần kỹ thuật Phase 2

- Ngày: **04/11/2026**.
- Trạng thái: **TECHNICAL_HARDENING_VERIFIED** cho P1, P2 và bộ kiểm thử E2E có kiểm soát.
- Repository: `LCSP`, nhánh `develop`, HEAD nền `aa2ce4f3f7c5b1b6375eaf659bee0197aa61803b`.
- Thay đổi nằm trong working tree hiện có. Các thay đổi có sẵn được giữ nguyên; chưa commit, push hoặc triển khai.

## 1. Kết quả và phạm vi

Đã hoàn tất đường xử lý câu trả lời UNKNOWN, cơ chế một câu hỏi/fact dùng cho nhiều rule được liên kết rõ ràng, và các nhánh phục hồi checkpoint khi tiến trình lỗi. Kiểm chứng cuối đạt **146 kiểm thử API**, **106 kiểm thử Python**, và **7/7 kịch bản E2E với 206 assertion**. API build, TypeScript và các kiểm tra chính sách tài liệu/contracts/import đều đạt.

Bộ E2E sử dụng Nest API qua HTTP, PostgreSQL đã chạy đầy đủ migration, PostgreSQL checkpoint của LangGraph và các tiến trình Python riêng. Phản hồi mô hình được lập sẵn; không có lần gọi nhà cung cấp mô hình trả phí. Đây là bằng chứng về lifecycle, persistence và quyền thực thi trong phạm vi đã kiểm thử. Kết quả chưa xác nhận chất lượng suy luận pháp lý của mô hình, đánh giá trên repository T31 thật hoặc kết quả benchmark toàn bộ 243 rule.

Bằng chứng chi tiết:

- [Biên bản E2E, các invariant và thông tin môi trường](../implementation-artifacts/lcsp-t31-phase2-hitl-e2e-20261104.json).
- [Kết quả kiểm thử, build, policy gate và SHA-256 của các file triển khai](../implementation-artifacts/lcsp-t31-phase2-verification-20261104.json).

## 2. P1 — UNKNOWN có đường review hợp lệ

### Root cause

Câu trả lời `doesNotKnow=true` được ghi lại nhưng không tạo accepted fact. Khi Root đang dừng ở native interrupt, hệ thống thiếu quyền review riêng cho phản hồi đó. Vì vậy request có thể tiếp tục OPEN mà Root không có đường hợp lệ để xác định cần chờ thêm hay chuyển sang `BLOCKED / HUMAN_FACT_UNRESOLVABLE`.

Ngoài ra, checkpoint của request được bảo vệ như giá trị bất biến. Khi một lần review hợp lệ tạo điểm chờ mới, lớp ứng dụng và trigger database chưa thống nhất về trường hợp được phép đổi checkpoint.

### Fix

- Mỗi câu trả lời lưu checkpoint gốc trong audit history. API chỉ cấp quyền review khi toàn bộ request OPEN hiện tại có phản hồi UNKNOWN mới nhất đúng checkpoint và đúng request revision, chưa có resolved fact.
- Việc lập lịch review được bảo vệ bằng idempotency. Phản hồi UNKNOWN vẫn giữ request OPEN, không tạo accepted fact, không tăng case revision và không tự sinh quyết định tuân thủ.
- Root nhận `humanRequests` riêng với accepted facts và phải kiểm tra quyền do server cấp trước khi dùng phản hồi UNKNOWN.
- Nếu evidence đã được hệ thống chấp nhận chứng minh fact không thể cung cấp, Root có thể báo tình trạng không thể giải quyết trên chính request hiện có, với rationale và evidence IDs.
- Nếu chưa đủ cơ sở, Root tạo một native wait mới. Không mở thêm câu hỏi trùng chỉ để tiếp tục chờ.
- Checkpoint mới làm phản hồi UNKNOWN cũ hết khả năng tự cấp thêm một lượt review. Một lần phát lại thông thường không tạo vòng lặp review vô hạn.
- Quyền review không mở quyền ghi fact, quyết định hoặc final report vốn yêu cầu lifecycle ACTIVE.

| Tình huống | Hành vi đã kiểm chứng |
| --- | --- |
| Người dùng trả lời không biết | Request OPEN; không có accepted fact hoặc case revision mới |
| UNKNOWN có evidence được chấp nhận về việc không thể cung cấp fact | Chuyển sang BLOCKED trên request hiện tại |
| UNKNOWN chưa đủ cơ sở kết luận không thể cung cấp fact | Tạo checkpoint chờ mới |
| Người dùng cung cấp câu trả lời có giá trị sau đó | Tiếp tục cùng request/thread và tạo fact theo luồng trả lời hợp lệ |
| Cố sửa checkpoint trực tiếp ngoài review đã được cấp quyền | Database từ chối |

UNKNOWN vẫn là thiếu dữ kiện. Nó không được diễn giải thành `NO`, `NOT_APPLICABLE`, hoặc một khẳng định thực tế.

## 3. P2 — Một fact dùng cho nhiều rule với dependency tường minh

### Root cause

Liên kết request trước đây xoay quanh một rule chính. Cùng một dữ kiện cần cho nhiều rule dễ dẫn đến câu hỏi lặp hoặc coverage không được cập nhật đầy đủ. Ghép theo chủ đề hoặc độ giống của câu hỏi không đủ bảo đảm hai rule thực sự cần cùng một fact.

### Fix

- Thêm bảng `AssessmentHumanRequestDependency` cho liên kết request–rule–criteria; giữ trường rule chính để tương thích và backfill dependency cho request hiện có.
- Thêm receipt `AssessmentHumanRequestRegistration` để replay đăng ký dependency có cùng idempotency key không tạo tác dụng phụ lặp.
- API kiểm tra tất cả rule và criterion theo rule set đã được pin; các khóa ngoại bảo vệ phạm vi cùng assessment.
- Reuse yêu cầu `sourceRequestId` tường minh và kiểm tra cùng assessment/thread, cùng nội dung câu hỏi, unresolved fact, control và choices. Không dùng khớp nghĩa mơ hồ.
- Source còn OPEN chỉ được reuse trong phạm vi case revision được cho phép. Source đã RESOLVED phải có fact `HUMAN_PROVIDED` và evidence `HUMAN_ANSWER` hợp lệ tại commit đã pin. Source bị hủy, thay thế, invalidated hoặc ngoài phạm vi bị từ chối.
- Một câu trả lời hợp lệ tạo một fact, một answer evidence và một lần tăng case revision. Mỗi rule phụ thuộc vẫn có coverage riêng và được cập nhật theo các request còn mở của chính rule đó.
- Reuse source đã RESOLVED cho rule khác không tạo câu hỏi, fact, evidence, revision hoặc human wait mới.

Phạm vi chia sẻ là dữ kiện thực tế. Quyết định áp dụng, tuân thủ và giải thích cho từng rule vẫn được xử lý riêng.

## 4. Phục hồi sau lỗi và checkpoint

Trong review, checkpoint gốc của câu trả lời UNKNOWN có thể là A, còn native execution đã đi tới B trước khi lỗi. Bản sửa giữ riêng ba thông tin: checkpoint đang tiếp tục B, checkpoint cấp quyền review A và execution đã tạo B. Khi retry sau `finish(FAILED, B)`, server cấp execution mới nhưng vẫn xác thực quyền gốc và toàn bộ request OPEN hiện tại.

Runner kiểm tra assessment, thread, rule set, snapshot, commit, case revision phù hợp và quan hệ tổ tiên native checkpoint trước khi tiếp tục. Các trường hợp checkpoint sai producer, sai scope, thiếu quyền hoặc không thuộc chuỗi checkpoint hợp lệ bị từ chối.

Hai cửa sổ lỗi đã được xử lý và có regression:

1. Native wait/BLOCK checkpoint đã lưu nhưng API finish chưa hoàn tất: worker thay thế xác nhận checkpoint đã có và hoàn tất bước settlement, không gọi mô hình thêm.
2. API đã ghi BLOCKED nhưng native interrupt chưa lưu: chỉ cho replay phần công việc của node `tools` chứa reporter của request OPEN hiện tại hoặc công cụ chờ. Call sang request khác, quyết định hoặc batch trộn công việc bị từ chối. Replay dùng `interrupt_before=["model"]` để chặn việc chạy mô hình ngoài phạm vi.

Kiểm thử Python bao gồm cả tiến trình bị mất đột ngột và exception được ghi nhận bằng `finish(FAILED)`. Trường hợp checkpoint A có case revision cũ do một câu trả lời hợp lệ khác đã được chấp nhận cũng có regression riêng.

## 5. Kết quả kiểm chứng

| Nhóm kiểm chứng | Kết quả |
| --- | --- |
| API: 9 suite tập trung vào runtime recovery, review authority, request sharing, context, completion và final report | **146/146 PASS** |
| Python: Root agent, completion, reliability, checkpoint durability | **106/106 PASS** |
| E2E có API/DB/checkpoint thật | **7/7 PASS; 206 assertion; exit 0** |
| API build, bao gồm contracts, i18n, Prisma Client và Nest | **PASS** |
| TypeScript API `tsc --noEmit` | **PASS** |
| Business logic documentation | **PASS; 0 missing/invalid** |
| Contract literal policy và import policy | **PASS** |
| `git diff --check` | **PASS** |

Các kịch bản E2E:

| # | Kịch bản | Kết quả |
| --- | --- | --- |
| 1 | UNKNOWN → review → BLOCKED có evidence → câu trả lời hợp lệ phục hồi | PASS |
| 2 | UNKNOWN chưa đủ cơ sở → native wait mới → từ chối tự review lại → câu trả lời hợp lệ phục hồi | PASS |
| 3 | Hai rule cùng một câu hỏi → một fact/evidence/revision → coverage độc lập | PASS |
| 4 | Crash sau checkpoint WAIT, trước finish → worker khác settlement, không gọi mô hình | PASS |
| 5 | Crash sau checkpoint BLOCK, trước finish → worker khác settlement, không gọi mô hình | PASS |
| 6 | Review thất bại sau khi checkpoint tiến lên → execution mới retry cùng thread và BLOCKED hợp lệ | PASS |
| 7 | Rule khác reuse source đã RESOLVED → không thêm fact/câu hỏi/revision/wait | PASS |

Trường `checks` trong từng dòng scenario của receipt là số assertion cộng dồn; tổng là 206, không phải tổng của bảy giá trị cộng dồn.

Một số script tiếp tục sau câu trả lời hợp lệ cố ý dừng trước quyết định từng rule và final report. Trạng thái execution `FAILED` ở những điểm đó là kết quả dự kiến để bảo đảm hệ thống không báo assessment COMPLETE khi chưa hoàn thành công việc; các assertion của gate vẫn PASS.

## 6. Migration, môi trường và giới hạn triển khai

Hai migration mới:

1. `20261104120000_shared_human_request_dependencies`: dependency chuẩn hóa, receipt đăng ký và backfill rule chính.
2. `20261104130000_human_answer_review_checkpoint_binding`: ngoại lệ đổi checkpoint có giới hạn cho review đã được cấp quyền.

Trigger mới giữ các điều kiện bảo vệ: request vẫn OPEN, audit/revision không đổi, chưa có resolved fact, UNKNOWN gắn đúng checkpoint cũ, runtime cùng assessment/thread đang RUNNING và còn lease, current turn đúng boundary, lifecycle hợp lệ và receipt review chứa đúng request/revision. E2E xác nhận sửa checkpoint trực tiếp khi thiếu quyền vẫn bị từ chối.

Database E2E cuối là database mới riêng cho lần chạy; checkpoint nằm trong một database riêng khác. **140 migration hoàn tất, 0 migration dang dở**. Không reset hoặc drop database có sẵn. API và các worker thử nghiệm đã dừng; tiến trình PostgreSQL riêng của task đã dừng và cổng 61989 được xác nhận đóng. Dữ liệu thử nghiệm còn trong thư mục tạm của task.

Môi trường đã xác nhận là PostgreSQL 14.20 với server timezone **UTC**. Lần khởi tạo native PostgreSQL ban đầu kế thừa Asia/Ho_Chi_Minh và làm điều kiện SQL kiểm tra live lease không khớp với cách fixture ghi timestamp. Lần chạy cuối đặt UTC, phù hợp giả định của fixture Docker hiện có. Không nới điều kiện lease và không thay cấu hình timezone production.

Do đó, bằng chứng hiện tại chưa xác nhận hoạt động với mọi timezone database, cũng chưa xác nhận nâng cấp một database production đã có dữ liệu. Khi đưa sang staging, cần triển khai đồng bộ migrations, contracts, API và Python, rồi kiểm chứng đường nâng cấp trên dữ liệu đại diện cùng cấu hình thời gian thực tế.

## 7. Kiểm chứng giới hạn nguồn code

Fixture dùng `RuntimeRepositoryFilesystemBackend(read_only_repository=True)` và `activate_repository_backend` thật. Các assertion xác nhận:

- File source được phép nằm trong root đọc được.
- Sentinel của project sibling ngoài root không đọc được qua runtime backend.
- Ghi vào source bị từ chối.
- Nội dung `.lcsp` do khách hàng đặt trong archive bị loại và được ghi nhận bởi sanitizer thật.
- Marker snapshot/commit khớp assessment context từ API; source ổn định giữa các worker.

Source bytes là dữ liệu tổng hợp của fixture. Bằng chứng này giới hạn ở sanitizer và runtime filesystem boundary đã kiểm thử; chưa phải một lượt tải repository T31 thật và để mô hình điều tra nội dung đó.

## 8. Trạng thái bàn giao và phần tiếp theo

Phần P1/P2 và controlled E2E của đợt sửa kỹ thuật này đã hoàn tất. Hồ sơ đánh giá cũ, scenario và answer contract đã được duyệt không được thay thế bởi các fixture thử nghiệm.

[T31_LEGAL_RULESET_AUDIT.md](../../T31_LEGAL_RULESET_AUDIT.md) hiện vẫn ghi **LEGAL_REVIEW_PENDING / PARTIAL** cho corpus 243 rule. Báo cáo kỹ thuật này chỉ xác nhận trạng thái ghi trong file, không xác nhận lại các diễn giải pháp luật hoặc số lượng vi phạm nêu trong tài liệu đó. Candidate rule set chưa được kích hoạt trong task này.

Các mốc tiếp theo để đi tới nghiệm thu đầy đủ:

1. Kiểm chứng triển khai đồng bộ trên staging, bao gồm migration với dữ liệu đại diện và cấu hình timezone thực tế.
2. Hoàn tất review legal rule set còn pending và chốt version được phép dùng làm mốc đánh giá.
3. Chạy một lượt nhỏ trên repository T31 thật với mô hình thực, giữ đúng snapshot/commit và answer contract đã duyệt.
4. Sau các mốc trên, chạy benchmark 243 rule và đối chiếu coverage, HITL ledger, evidence, quyết định và final report.

Task hiện tại chưa triển khai production, chạy benchmark 243 rule hoặc đổi trạng thái phê duyệt legal rule set.

## 9. Tái chạy kiểm chứng

Chi tiết stdout/stderr, danh sách suite và fingerprint nguồn nằm trong verification JSON đi kèm. Lệnh E2E, khi một PostgreSQL thử nghiệm riêng với timezone UTC đã sẵn sàng:

```bash
TMPDIR="$PWD/.cache/phase2-harness-tmp" \
LCSP_TEST_PG_PORT=61989 \
node tests/assessment-hitl-phase2-vertical.mjs
```

Harness chọn API port loopback trống và tạo database tên riêng cho từng lần chạy. Nó không tự cho phép dùng database production, không reset database có sẵn và không gọi mô hình trả phí.

Các nhóm file chính:

- Contracts/schema: `packages/contracts/src/assessment-domain/schemas.ts`, `apps/api/prisma/schema.prisma`, hai migration nêu trên.
- API: answer/open request handlers, request/context projections, review authority, runtime recovery, dependency/provenance helpers và regression tests.
- Python Root: `deepagents/assessment_root/tools.py`, `runner.py`, `instructions.md` và `deepagents/tests/test_assessment_root_agent.py`.
- E2E: `tests/assessment-hitl-phase2-vertical.mjs`, `deepagents/tests/vertical/hitl_phase2_root.py`; kỳ vọng normal UNKNOWN của harness cũ được cập nhật để phản ánh việc lập lịch review.

SHA-256 chính xác của 24 file triển khai/kiểm thử có trong verification JSON. Manifest ghi nhận nội dung file cuối cùng; một số file vốn đã có thay đổi trước task, nên không dùng manifest để quy toàn bộ diff cho đợt sửa này.
