# T31 — thu gọn context, pilot Google và chốt trạng thái ngày 06/11/2026

## Kết quả chính

Đã sửa cơ chế đưa dữ liệu vào model, giữ nguyên bộ rule và các kiểm tra nghiệp vụ, rồi chạy **một pilot Google mới** trong giới hạn đã được chốt. Key Google hoạt động: có **3 lượt gọi thành công và được quyết toán usage**. Lượt thứ tư bị từ chối trước khi gửi tới nhà cung cấp với lý do `INPUT_BOUND_UNVERIFIED`.

Pilot chưa tới bước điều tra nguồn, quyết định rule hoặc đặt câu hỏi HITL. Case vẫn ở revision 0, có 243 rule `PENDING`, chưa có fact, evidence, decision, human request hay báo cáo cuối được tạo.

Sau khi đọc checkpoint, đã phát hiện model yêu cầu danh mục 50 rule trong một lần. Đã sửa tiếp điểm này bằng trần **4.096 byte cho toàn bộ phản hồi danh mục**, rồi kiểm thử ngoại tuyến. **Bản sửa cuối này chưa được chạy live.** Không mở pilot trả phí thứ hai, không reset budget và không sửa các ledger cũ.

Mã cuối cùng qua **273/273 kiểm thử**, cùng kiểm tra tài liệu nghiệp vụ: 0 hàm thiếu/không hợp lệ và 5/5 kiểm thử của bộ kiểm tra đạt.

## Phân biệt bản đã chạy và bản hiện tại

| Phiên bản | Trạng thái |
|---|---|
| Bản đã chạy live | Có compact context, coverage paging, bounded rule details, mô tả công cụ ngắn, prompt lập kế hoạch ngắn và khóa hash của instructions.md. Catalog mặc định 10 nhưng vẫn có thể trả 50 nếu model yêu cầu. |
| Bản hiện tại | Có thêm trần byte bắt buộc cho catalog; `limit` là số lượng tối đa được yêu cầu, `nextOffset` dựa trên số dòng thực sự trả về. Đã kiểm thử và đo ngoại tuyến. |
| Ledger của pilot | Giữ nguyên trạng thái dừng, 3 SETTLED và 1 DENIED. |
| Điều kiện cho một lần kiểm chứng mới | Cần runtime mới, preflight mới và budget được chốt cho mốc tiếp theo; không dùng hash cũ để dispatch mã mới. |

Runtime digest của bản thực sự đã chạy:

`a739744b191ec51368b8ec53760645cdaf6d405442415179ac669eec9c714a1e`

Digest của mã hiện tại khi tính với đường dẫn profile của lần chạy cũ, **chỉ để so sánh**:

`d947c76282aa1121f023960e8a302dc73073c4f96145ac4cf0ca866cc6fd5ec2`

Một runtime mới có đường dẫn profile khác sẽ cần tính lại digest. Bốn file runtime đã chạy được lưu nguyên byte tại thư mục `executed-source` trong thư mục pilot, cùng manifest hash. Chúng không bị thay bằng mã sau khi sửa.

## Root cause

### 1. Coverage và tài liệu công cụ làm phình yêu cầu đầu vào

Lượt Google trước đó nạp toàn bộ 243 dòng coverage trong một ToolMessage. Phản hồi context dài 56.064 byte; riêng coverage chiếm 53.173 byte. Yêu cầu đầu tiên đã đo được 79.502 đơn vị đầu vào bảo thủ, gần trần 90.000.

Các công cụ governed còn dùng nguyên docstring năm mục dành cho người phát triển làm mô tả gửi tới model. Một số công cụ native có nhiều ví dụ và hướng dẫn lặp lại. Dữ liệu này tiếp tục được gửi trong mỗi yêu cầu.

### 2. Một rule đầy đủ có thể quá lớn

Đo trên baseline thực tế cho thấy payload một rule có thể lên tới 81.458 byte. Giảm riêng coverage chưa đủ để model đọc rule và nguồn pháp lý trong cùng lịch sử hội thoại.

### 3. Mặc định nhỏ không phải trần bắt buộc

Checkpoint của pilot mới ghi đúng lời gọi:

```json
{"limit": 50, "offset": 0}
```

`get_pinned_rule_set` trả 50 dòng, 16.092 byte và `nextOffset: 50`. Sau đó model ghi ba việc cần làm; yêu cầu tiếp theo bị chặn. Lỗi này cho thấy đổi default thành 10 không ngăn model chọn giá trị lớn hơn vẫn hợp lệ trong schema.

### 4. Dấu vân tay runtime từng bỏ sót file hướng dẫn

Danh sách hash chỉ quét một số đuôi source/build, chưa đưa `instructions.md` mà Root thực sự đọc vào danh sách bắt buộc. Đã bổ sung file này trước pilot; kiểm thử xác nhận thay byte hoặc làm mất file sẽ bị chặn bằng `RUNTIME_CODE_CHANGED`.

## Fix

### Compact context và coverage đầy đủ theo trang

`get_assessment_context` vẫn đọc toàn bộ context có thẩm quyền từ API và cập nhật đầy đủ cache rule/version/decision revision. Phần gửi model thay coverage dài bằng tổng hợp và snapshot token.

Công cụ `get_assessment_coverage` trả mặc định 10, tối đa 25 dòng. Token gắn với assessment, thread, pins, scan job, decision scope, source prefix, case revision và toàn bộ năm trường của mỗi dòng coverage. Thay đổi decision hoặc trạng thái dù case revision chưa đổi cũng làm token cũ mất hiệu lực.

Các fact cùng authority, evidence payload, audit của human request và giới hạn nhìn thấy nguồn vẫn giữ nguyên. Summary không cấp quyền hoàn tất assessment. API context đầy đủ và Completion Gate không bị thay đổi.

### Rule lớn được đọc qua chỉ mục và các đoạn chính xác

Rule nhỏ vẫn có phản hồi đầy đủ như trước. Rule lớn trả chỉ mục và token; `get_assessment_rule_detail` cho phép đọc từng node bằng JSON Pointer, từng nhóm phần tử hoặc từng đoạn Unicode.

Giới hạn 4.096 byte áp dụng cho **toàn bộ phản hồi JSON**, kể cả envelope, pointer, hash và metadata. Các đoạn nối lại đúng nguyên văn; khóa quá dài vẫn đọc được qua JSON fragment của node cha. Token khác phiên bản/case/pins bị từ chối. Chỉ mục hoặc đoạn chưa đủ không được dùng làm kết luận pháp lý.

Một lỗi chuyển cách hiểu offset khi số chữ số tăng đã được phát hiện và sửa trước pilot. Kiểm thử công khai tái hiện đúng ranh giới 4.096/4.097 byte và kiểm tra phục hồi trọn vẹn nội dung.

### Mô tả ngắn, giữ nguyên công cụ và kiểm soát

Giữ toàn bộ 33 công cụ của Root. Middleware chỉ sao chép và thay mô tả của 10 công cụ native/learning đã rà soát; tên, thứ tự, schema, callable, validator, metadata và tool được đăng ký để thực thi giữ nguyên.

Prompt lập kế hoạch dùng tùy chọn công khai của native `TodoListMiddleware`. Native planning, checkpoint, giới hạn researcher, filesystem permissions, admission, usage và Completion Gate vẫn chạy qua luồng cũ. Các yêu cầu pháp lý, nguồn, sự bất định và HITL không được cắt bỏ để giảm kích thước.

### Trần catalog bổ sung sau pilot

Toàn bộ phản hồi catalog hiện bị giới hạn 4.096 byte. Yêu cầu 50 vẫn hợp lệ nhưng có thể nhận ít hơn; người gọi phải theo `nextOffset` thực tế.

Nếu một summary riêng đã quá lớn, dòng trả về nêu rõ chỉ có identity và cần gọi `get_assessment_rule` để đọc đầy đủ. Identity không thể vừa giới hạn sẽ tạo lỗi có kiểm soát; không bỏ qua rule hay tạo dấu hiệu hoàn tất giả.

## Kết quả pilot live

| Thuộc tính | Giá trị |
|---|---|
| Assessment | `6c85bdc9-68ce-456b-8179-9b6cc4e9c695` |
| Execution | `b9cafaab-260d-4f14-86d9-8841af77e83a` |
| Thread | `3955bd4a-92b0-4aab-b149-9f8b35a082b0` |
| Checkpoint cuối | `1f1d985b-65e1-6948-8049-8a3ba541b388` |
| Route / model | `fallback-01` / `gemini-3.5-flash-lite` |
| Thời gian thực thi | 08:58:07–08:59:34 ngày 06/11/2026, UTC+7 |
| Tổng thời gian, gồm chuẩn bị nguồn | 86,28 giây |
| Execution / case lifecycle | `FAILED` / `ACTIVE` |
| Lease sau khi kết thúc | Không còn token; expiry NULL |
| Lý do dừng đã ghi | `INPUT_BOUND_UNVERIFIED` |
| Lượt đã gửi / lượt bị chặn | 3 / 1 |
| Unresolved attempt trong lượt mới | 0 |

### Chuỗi công cụ thực sự được model gọi

| Thứ tự | Công cụ | Kích thước kết quả |
|---|---|---:|
| 1 | `get_assessment_context({})` | 3.125 byte |
| 2 | `get_pinned_rule_set({"limit":50,"offset":0})` | 16.092 byte |
| 3 | `write_todos`, ba mục | 361 byte |

Có bảy message delta: một HumanMessage khởi đầu, ba phản hồi model và ba kết quả công cụ. Chưa có lời gọi đọc chi tiết rule, nguồn luật, mã nguồn hoặc human request.

Checkpoint lưu 75 checkpoints, 8 blobs và 83 writes; step cuối là 73. Ba todo gồm một mục đang làm và hai mục chờ. Trạng thái runtime turn `COMPLETED` chỉ thể hiện việc xử lý lượt vận chuyển đã kết thúc; execution nghiệp vụ vẫn `FAILED`.

### Usage đối chiếu

| Lượt | Đơn vị input bảo thủ được admission đo | Input provider, gồm cache | Input không cache | Input cache | Output |
|---|---:|---:|---:|---:|---:|
| 1 | 65.725 | 11.899 | 11.899 | 0 | 12 |
| 2 | 70.338 | 13.290 | 3.187 | 10.103 | 23 |
| 3 | 88.770 | 18.720 | 6.555 | 12.165 | 91 |
| Tổng usage provider | Không cộng cột đo byte thành token provider | 43.909 | 21.641 | 22.268 | 126 |

Tổng token provider là 44.035. SQLite ledger, evidence usage, callback đã giao và API khớp nhau. Sáu callback STARTED/COMPLETED đều được giao; không có pending/poison callback hoặc unknown attempt mới. API `inputTokens` là 21.641 **không cache**; cộng 22.268 cached input mới ra 43.909.

Lượt bị từ chối không được ghi số đo admission đầy đủ, nên báo cáo không gán một con số đoán cho nó. Diagnostic bytes không được coi là số đo admission hoặc token tính phí.

Charge thực tế vẫn NULL. Không suy ra hóa đơn hoặc trần tiền từ các số token này.

## Chứng minh ngoại tuyến trên mã sau sửa cuối

Trên chính baseline 243 rule / 633 legal requirements:

| Trường hợp | Kết quả |
|---|---|
| Tái tạo catalog của mã đã chạy, limit 50 | 16.092 byte; hash khớp đúng ToolMessage live |
| Cùng yêu cầu limit 50 trên mã hiện tại | 13 summary đầy đủ, 4.081 byte, `nextOffset: 13` |
| Đi hết catalog với limit 50 | 23 trang, đủ 243 rule, lớn nhất 4.085 byte |
| Đi hết catalog với limit 10 | 25 trang, đủ 243 rule, lớn nhất 3.945 byte |
| Mất/trùng/bỏ qua summary trong baseline | 0 |
| Phục hồi đầy đủ payload rule qua detail tools | 243/243 khớp nguyên dữ liệu; 10.787 lời gọi công cụ ngoại tuyến; phản hồi lớn nhất 4.096 byte |

Đo counterfactual bằng native graph hiện tại, giữ lịch sử context → catalog yêu cầu 50 → ba todo:

`66.028 → 70.218 → 75.447 → 76.963` đơn vị bảo thủ.

Kịch bản thử thêm 2.048 byte metadata ở mỗi phản hồi model kết thúc ở 83.170, dưới 90.000. Đây là fixture ngoại tuyến với nội dung planning và metadata tổng hợp, **không phải** số đo của yêu cầu live bị chặn hoặc bảo đảm cho mọi chuỗi tương lai.

Trước pilot, 259 kiểm thử đạt. Sau sửa catalog, 273 kiểm thử đạt trong 9,40 giây. Bộ mới bao phủ đầy đủ phân trang, token stale/foreign, Unicode, JSON Pointer, ranh giới offset, authority của fact/HITL, native tool binding, trường hợp limit 50 và phản hồi danh mục quá lớn. Các kiểm thử provider dùng transport giả; không tạo thêm lượt model thật.

## Giới hạn còn lại

Các giới hạn giữ nguyên:

| Giới hạn | Giá trị |
|---|---:|
| Số lượt model tối đa | 8 |
| Tổng input | 120.000 |
| Tổng output | 16.384 |
| Input giữ trước cho mỗi lượt | 90.000 |
| Output tối đa mỗi lượt | 4.096 |
| Thời hạn làm việc model | 180 giây |
| Thời hạn chuẩn bị nguồn | 600 giây |
| Read timeout provider | 45 giây |

Ledger hiện có 43.909 input đã quyết toán. Theo cơ chế reservation hiện tại:

**43.909 + 90.000 = 133.909 > 120.000.**

Vì vậy, ngay cả khi thu gọn yêu cầu kế tiếp, execution này vẫn không thể nhận một lượt mới trong budget cũ. Trần tám lượt là tối đa, không phải cam kết luôn chạy được tám lượt.

Mốc tiếp theo là kiểm chứng bản catalog có trần byte trên một lượt mới có budget được chốt phù hợp cho chuỗi đọc nguồn, đọc rule và dừng tại câu hỏi HITL thật. Runtime và digest mới phải được chuẩn bị; ledger đã dừng không được reset hoặc dùng lại để lách giới hạn. Chưa có phê duyệt ngữ nghĩa cho 243 rule.

## Phạm vi nguồn và dữ liệu được giữ

Nguồn được ghim:

- Repository: `tkhudson/AI-Powered-Customer-Support-Chatbot`.
- Commit: `65e8ffcfefb3b097dbe876ecbcfa9b8af4e8e94b`.
- Prefix: `tkh/upworkProjects/AI-Powered-Customer-Support-Chatbot`.
- Baseline: `97004ff3-9240-4e37-8a94-9ade8832c00a`.

29 bảng baseline được sao chép đúng digest kế thừa; không kích hoạt candidate trong công việc này. Case lịch sử không bị dùng lại.

Audit container xác nhận 16.715 file nguồn giữ lại đều trong scope, không có file ngoài scope hoặc symlink giữ lại. Có chín entry trong scope bị loại bởi quy tắc an toàn; metadata tiếp tục công bố `coverageLimited: true`. Hash mẫu `app.py` và `README.md` khớp pilot trước. Audit không chạy mã của repository khách hàng.

Marker, budget, ledger và result của hai lượt Inception/Google trước vẫn khớp hash cũ. Exposure chưa xác định của lượt Inception cũ **90.000 input / 4.096 output** vẫn giữ riêng; số unresolved bằng 0 trong báo cáo này chỉ áp dụng cho lượt Google mới.

## File thay đổi trong lượt này

So sánh hash trước/sau xác nhận tám file triển khai hoặc kiểm thử thay đổi, không phải toàn bộ 113 mục đã dirty từ trước:

| Nhóm | File trong repository | Mục đích |
|---|---|---|
| Runtime | `deepagents/assessment_root/tools.py` | Context/coverage, rule detail, mô tả governed và trần catalog |
| Runtime | `deepagents/assessment_root/agent.py` | Mô tả native và hướng dẫn native planning ngắn |
| Hướng dẫn | `deepagents/assessment_root/instructions.md` | Cách đọc trang, token, đoạn và rule chưa đủ nội dung |
| Pilot | `deepagents/scripts/run_t31_scoped_pilot.py` | Ghim instructions.md vào runtime digest |
| Test hiện có | `deepagents/tests/test_assessment_root_agent.py` | Kiểm tra delegate đăng ký thật, đồng thời kiểm tra mô tả model |
| Test hiện có | `deepagents/tests/test_t31_scoped_pilot.py` | Từ chối prompt drift/mất file trước dispatch |
| Test mới | `deepagents/tests/test_assessment_context_paging.py` | Coverage, mô tả native, catalog có trần byte |
| Test mới | `deepagents/tests/test_assessment_rule_details.py` | Phục hồi nguyên dữ liệu và các trường hợp ranh giới |

Có thêm hai báo cáo của lần làm việc này. Không commit, push hoặc xóa file. Route mặc định của dự án và bootstrap không đổi.

## Dọn tài nguyên và bàn giao

Container của lượt mới đã dừng và được giữ lại. API port 59297 và PostgreSQL port 64303 đều đóng. PostgreSQL shutdown sạch lúc 09:06:06 UTC+7; process sessions đã được thu hồi. Không dừng Docker engine hoặc dịch vụ không thuộc lượt chạy.

Thư mục bằng chứng của pilot:

`/Users/nguyenanh/Documents/Capstone/LCSP/.cache/t31/scoped-pilot-mw4b302g_c27257febe44`

Chứng cứ tổng hợp đầy đủ được lưu tại:

`/Users/nguyenanh/Documents/Capstone/LCSP/docs/implementation-artifacts/lcsp-t31-compact-context-20261106.json`

SHA-256: `1446fc67eea1b746e6aec8691ff66ed58138e8056d8fc2b657aea7549a12e36c`.

JSON tổng hợp chứa pins, manifest hash trước/sau, hai phiên bản runtime, các kiểm thử, hash phục hồi 243 payload rule, audit DB/checkpoint/usage, chứng minh catalog sau sửa và kết quả cleanup. Không chứa key thực hoặc nội dung private runtime.
