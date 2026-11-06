# T31 — Chạy lại bằng key Google mới, ngày 06/11/2026

Múi giờ: **Asia/Saigon (UTC+7)**.  
Repository: `/Users/nguyenanh/Documents/Capstone/LCSP` · nhánh `develop` · HEAD `aa2ce4f3f7c5b1b6375eaf659bee0197aa61803b`.

## 1. Kết quả chính

**Đã chạy lại pilot bằng key Google mới. Một request tới gemini-3.5-flash-lite hoàn tất thành công, trả tool call get_assessment_context và báo 14.858 input / 12 output tokens.**

Sau khi tool trả context, attempt thứ hai bị bộ giới hạn pilot từ chối trước dispatch với `INPUT_BOUND_UNVERIFIED`. Execution kết thúc FAILED; chưa có evidence, decision hoặc yêu cầu HITL. Đây là điểm chặn về kích thước đầu vào của pilot, khác với lỗi HTTP 402 của Inception ở lượt trước.

Trạng thái bàn giao: **GOOGLE_REQUEST_VERIFIED_CONTEXT_INPUT_BOUND_BLOCKED**.  
Receipt: [lcsp-t31-google-pilot-20261106.json](../implementation-artifacts/lcsp-t31-google-pilot-20261106.json).

| Phép kiểm | Kết quả |
|---|---|
| Key Google mới | Được chấp nhận ở metadata và generation |
| Request metadata Google | 1 models.get; không sinh nội dung |
| Request mô hình thật | **1**, hoàn tất và SETTLED |
| Attempt thứ hai | **DENIED**, chưa vào IN_FLIGHT |
| Usage chính thức | **14.858 input + 12 output = 14.870 tokens** |
| Usage chưa rõ trong lượt mới | **0 attempt** |
| Giá trị tiền/chi phí | Chưa có số liệu; các trường charge vẫn null |
| Case revision | **0** |
| Facts / evidence / decisions / HITL | **0 / 0 / 0 / 0** |
| Coverage | **243 PENDING**, 0 current decisions |
| Thời gian gồm hydration | **76,71 giây** |

Usage đã đối chiếu giữa receipt, SQLite và API. Một model response thành công không có nghĩa là assessment đã hoàn tất: phản hồi đầu chỉ yêu cầu đọc context.

## 2. Root cause — key mới và route chính chưa khớp

Key mới người dùng bổ sung thuộc **GOOGLE_API_KEY**. Pool Google hiện có một credential mới, không trùng sáu credential Google trong ngân sách cũ. Inception vẫn có 14 credential cũ; slot đầu chính là credential đã trả HTTP 402.

Cấu hình chung vẫn gán assessment-root/repository-researcher vào route assessment của Inception. Bộ chạy cũ luôn đặt LCSP_MODEL_ROUTES_FILE về YAML chung nên việc bổ sung key Google chưa làm pilot chọn Google.

Không hiển thị giá trị key hoặc fingerprint credential. Một phép kiểm metadata qua Google SDK xác nhận model `models/gemini-3.5-flash-lite` có thể được truy cập bằng key mới; kiểm tra này không được dùng thay cho bằng chứng generation sau đó.

### Fix — chọn route riêng cho một pilot

Bổ sung tùy chọn:

```text
--primary-route fallback-01
```

Route fallback-01 đã tồn tại trong cấu hình: provider/protocol google_genai, model gemini-3.5-flash-lite.

Tùy chọn tạo một bản YAML riêng, quyền 0600, trong thư mục pilot. Chỉ hai binding assessment-root và repository-researcher được đổi; source YAML chung, definitions, options, các role khác và fallback mappings giữ nguyên. Researcher và các bước tóm tắt nhận model của Root theo cơ chế hiện có.

Route Google này không có outgoing fallback chain. Vì vậy, pilot này dùng Google và không chuyển sang provider khác. Cơ chế governance, credential rotation, đo input, metering và admission vẫn được giữ.

Bản riêng được tạo một lần, chỉ được dùng lại khi nội dung khớp chính xác. Từ chối route không tồn tại, chọn lại profile của execution đã chạy, symlink/hardlink, file không hợp lệ, quyền quá rộng hoặc profile drift. Path và bytes của YAML riêng được đưa vào runtime digest; admission kiểm tra lại digest trước dispatch. Khi copy mất/đổi/không còn an toàn, admission từ chối với RUNTIME_CODE_CHANGED; lỗi tại preflight có thể dừng trước khi journal tồn tại.

## 3. Preflight, case và giới hạn đã pin

| Thuộc tính | Giá trị |
|---|---|
| Assessment mới | `a54910c8-0adf-4799-a5fd-10ef734167ec` |
| Snapshot | `8b06c9a1-6fe0-405d-97f7-8c09fb02481c` |
| Scan job | `e12987d6-b6b9-432c-b3bc-1cdd1a920ad4` |
| Execution | `3d3334ff-16ff-4ebb-bbe4-c6a512fafe00` |
| Thread | `5559f811-e981-4b1f-8070-3c838e573ef3` |
| Checkpoint cuối | `1f1d97bb-e4cb-6376-801f-b83c99e8cc04` |
| Repository | `tkhudson/AI-Powered-Customer-Support-Chatbot` |
| Commit | `65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b` |
| Source prefix | `tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot` |
| Baseline | `97004ff3-9240-4e37-8a94-9ade8832c00a` |

Bootstrap có 29/29 bảng baseline khớp export và 9/9 request khách hàng thành công. Case bắt đầu revision 0, không kế thừa facts/evidence/decisions. Baseline có 633 LegalRequirement và 243 AssessmentRule; candidate pháp lý đang chờ review không được nhập/kích hoạt.

Preflight READY, chỉ liệt kê route Google được chọn. Giới hạn giữ nguyên:

| Giới hạn | Giá trị |
|---|---:|
| Physical model attempts tối đa | 8 |
| Tổng input trong sổ giới hạn | 120.000 |
| Tổng output | 16.384 |
| Dự phòng input mỗi attempt | 90.000 |
| Output mỗi attempt | 4.096 |
| Model-work sau chuẩn bị source | 180 giây |
| Chuẩn bị source | 600 giây |
| Provider read/inactivity | 45 giây |

Input được kiểm tra theo UTF-8 bytes cộng framing bảo thủ; đây không phải số token provider báo. Các giới hạn không phải dollar cap; 180 giây không phải tổng wall time hay bảo đảm dừng request từ xa.

Runtime digest được rà soát trước dispatch:

`121686319a765710007bda27f4cf5dd03c3b33a1d9a3a009b99a0776ea071694`.

Digest mới bao gồm thay đổi launcher và path/bytes của profile riêng. Không dùng lại digest cũ của lượt Inception.

## 4. Source đã hydrate đúng phạm vi

Kiểm tra marker và filesystem trong đúng container thuộc thread mới:

- **16.715 regular source files**, tất cả trong prefix được duyệt.
- **0 file ngoài scope**, **0 symlink được giữ lại**.
- 147 entry ngoài scope chủ động loại; mẫu danh sách tối đa 100, có cờ truncated.
- 9 mục trong scope bị loại theo chính sách: 3 symlink và 6 file venv lớn hơn 10 MiB.
- coverageLimited=true; source preparation được xác minh với giới hạn đã khai báo.
- app.py và README.md có hash khớp lượt trước.

Marker `/workspace/repository/.lcsp/repository.json`, 15.803 byte:

`2083825f86847f59313c6b57077751b78fc62f28eae25e3d6977f548e0da916a`.

Container dùng đúng image lcsp-agent-runtime:dev, network none, privileged false, không có host mounts/binds. Các file source trong Docker không phải file code sửa trong repository LCSP.

## 5. Root cause — input sau get_assessment_context vượt bound của pilot

Lượt model đầu diễn ra lúc 07:48:09–07:48:12. Nó trả một tool call hợp lệ: get_assessment_context. Tool đã đọc context và trả kết quả; attempt mô hình tiếp theo chưa được gửi.

| Số đo | Giá trị | Ý nghĩa |
|---|---:|---|
| Serialized input trước request đầu | 70.286 byte | Đo tại admission boundary |
| Framing trước request đầu | 9.216 units | Khoản cộng bảo thủ của pilot |
| Upper bound request đầu | **79.502 units** | Nằm dưới bound 90.000 |
| Input token request đầu | **14.858** | Provider báo, đã SETTLED |
| ToolMessage get_assessment_context | **56.064 UTF-8 byte** | Nội dung JSON được lưu trong checkpoint |
| Riêng coverage trong ToolMessage | **53.173 byte**, khoảng 94,8% | 243 hàng PENDING |
| repositoryView trong ToolMessage | **2.440 byte** | Metadata source/coverage |
| Diagnostic đầu vào trước attempt hai | **128.392 estimated input bytes** | Diagnostic riêng, không phải exact admission measurement |

Initial HumanMessage chỉ dài 132 byte, hướng dẫn gọi get_assessment_context trước. Nó chưa nhúng sẵn toàn bộ coverage. Vì vậy, đây là tăng kích thước bình thường khi đọc context lần đầu, không có bằng chứng coverage bị lặp lại từ initial user packet.

Exact measurement của attempt bị từ chối không được journal hóa: hiện tại measurement evidence được ghi sau khi admission thành công. Reason INPUT_BOUND_UNVERIFIED chứng minh measurement đã vượt bound 90.000; không gán số diagnostic 128.392 thành exact measurement hoặc provider token count. Attempt thứ hai chưa gửi nên không có provider usage cho nó.

Giới hạn thử nghiệm ban đầu chưa đủ cho context sau tool call này. Guard làm đúng nhiệm vụ ngăn dispatch vượt bound đã pin. Không phải Google từ chối key hoặc hết quota trong lượt vừa quan sát.

### Hướng xử lý tiếp theo — chưa thực hiện trong lượt này

Có hai hướng cần đánh giá trên cùng dữ liệu đo:

1. Hiệu chỉnh bound mỗi request và tổng ngân sách của pilot một cách nhất quán với payload thực tế; ghi nhận cho lượt mới, giữ nguyên ledger đã kết thúc.
2. Thiết kế projection/pagination cho phần coverage/context, giữ pins, authority và khả năng truy cập đủ catalog 243 rule; cần kiểm thử contract và tính đầy đủ trước khi thay đổi production tool.

Không cắt bỏ evidence, policy hoặc coverage để làm số đo nhỏ đi. Không tự coi 14.858 provider tokens là cùng đơn vị với bound 90.000 của phép đo bảo thủ. Chưa tăng giới hạn, reset journal hoặc phát sinh thêm generation sau denial.

## 6. Trạng thái dữ liệu và usage

Audit độc lập dùng transaction REPEATABLE READ READ ONLY ở cả API/checkpoint database; SQLite mode=ro, query_only=1, WAL bằng 0, hash không đổi sau kiểm tra.

- Assessment ACTIVE, lifecycleRevision 2, caseRevision 0.
- Execution FAILED / PaidAdmissionError / INPUT_BOUND_UNVERIFIED.
- Lease token và lease expiry đã được giải phóng.
- Facts, fact-evidence links, evidence, decisions, human requests/dependencies/registrations và artifacts: đều 0.
- 243 coverage rows PENDING, không có current decision.
- Native checkpoint: 33 checkpoints, 3 blobs, 36 writes, gồm một error write.
- Thread và checkpoint cuối khớp API/receipt.
- RuntimeTurn=COMPLETED mô tả việc ghi nhận turn; không chuyển execution FAILED thành thành công.

Admission có hai attempt rows: một ADMITTED → IN_FLIGHT → SETTLED và một DENIED. Lượt mới không có OUTCOME_UNKNOWN. Settled input/output là 14.858/12.

Hai usage envelopes STARTED/COMPLETED đều DELIVERED và hợp nhất vào một LlmUsageEvent SETTLED. Không có pending hoặc dead-letter usage deliveries. Token count khớp cả ba nguồn; monetary charge vẫn null nên chưa có bằng chứng chi phí tiền bằng 0.

Lượt Inception trước vẫn giữ nguyên execution/budget/ledger/result và unresolved exposure 90.000 input / 4.096 output. Usage đã biết của Google không được dùng để quyết toán thay cho request Inception.

## 7. Kiểm chứng và phạm vi file

Chỉ sửa hai file hiện có trong lượt này:

| File | Mục đích |
|---|---|
| `deepagents/scripts/run_t31_scoped_pilot.py` | Chọn route riêng cho pilot, pin profile và kiểm tra drift |
| `deepagents/tests/test_t31_scoped_pilot.py` | Kiểm thử routing/isolation/immutability và giữ kiểm thử limiter |

Thêm hai file bàn giao: báo cáo này và JSON receipt. Cấu hình routing chung, operator archive profile 256 MiB và production handlers không được thay đổi trong lượt này.

| Kiểm chứng | Kết quả |
|---|---|
| Bộ test pilot | **43/43 PASS**, 6,03 giây |
| Phân rã test | 23 test limiter/native SDK trước đó + 20 case route-selection |
| Provider calls từ test | 0; native HTTP dùng MockTransport |
| Business documentation | 3.030 functions / 779 files, **0 missing/invalid** |
| Checker tests | **5/5 PASS** |
| Rà soát độc lập trước dispatch | Không có finding chặn chạy |
| Project routing YAML | Hash giữ nguyên |
| Ledger/budget lượt Inception cũ | Hash giữ nguyên |

SHA mới của launcher: `4f5e956c5ab1b6debfc6c3e9e8c9b8ab35b61085c9f0667ec0d5ad2878f935d5`.  
SHA mới của test: `dfd8944dbe119d1f83e2c72766021cac6fcc05f50e228ee7e2a15c754510a967`.  
Project routing SHA: `7bbc2551cc4424f2ef675f74893fb7a66fcbc682529ac8584c5de607e5862116`.  
Profile riêng SHA: `3a13ea9f9c2c2ef06ee6dfe74b482e5eb81093d3b4bbe767e3f9f11de8e757b6`.

Workspace vẫn có các thay đổi chưa commit từ công việc trước. Phạm vi lượt này được xác định bằng hash và manifest, không lấy toàn bộ dirty tree làm danh sách thay đổi mới. Không commit, push hoặc deploy production.

## 8. Thu dọn và trạng thái bàn giao

Đã dừng đúng container mới sau khi xác minh lại ownership; container được giữ ở trạng thái exited. Đã thu hồi process pilot và API thử nghiệm. PostgreSQL riêng được dừng sạch bằng pg_ctl fast, exit 0; log xác nhận database system is shut down.

Lúc **07:57:31 ngày 06/11/2026**, TCP xác nhận cổng **57479 và 64303 đóng**. Database, checkpoint, budget, usage ledger, execution marker, profile riêng và receipts được giữ. Private runtime/credentials không nằm trong bộ bàn giao.

**Key Google đã được kiểm chứng bằng generation thật. Phần đánh giá tiếp theo còn bị chặn ở bound input của pilot; chưa có HITL hoặc kết quả 243 rule để nghiệm thu.** Candidate pháp lý vẫn LEGAL_REVIEW_PENDING.
