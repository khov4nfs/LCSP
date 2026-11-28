# Báo cáo tiếp tục Assessment module hardening — 28/11/2026

## Phạm vi và trạng thái

Đợt này tiếp tục Prompt 8 (ví chung, admission, settlement, đối soát) và chạy QA độc lập cho Assessment. Đây là **nghiệm thu kỹ thuật cục bộ**, không phải phê duyệt bật tính năng trừ tiền. `MODEL_USAGE_DEBIT=OFF`, `PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF`; không cutover ví thật, không commit/push/PR. Working tree vốn có nhiều thay đổi và được giữ nguyên.

## Các lỗi đã tái hiện và sửa

| Vấn đề | Root cause | Fix và bằng chứng |
| --- | --- | --- |
| Admission tính thiếu exposure khi caller sửa token bound | Worker tin input hint có thể nhỏ hơn context ceiling, còn request model settings có thể nâng output cap provider cao hơn cap dùng để xin admission. | Lấy input ceiling từ route; kẹp output provider vào cap đã admission, vẫn cho mức nhỏ hơn. RED→GREEN cho cả hai đường; 45/45 test admission + recovery đạt. |
| Hai provider dùng chung tên model chọn sai input ceiling | Fallback tìm route theo model name rồi chọn bản ghi đầu tiên, bỏ qua provider/protocol. | Chỉ dùng fallback khi `(provider, protocol, model)` khớp đúng một route; RED 1.000.000 thay vì 2.000.000 token → GREEN. |
| Assessment Root thiếu lease để xin admission | State được copy sau server claim chỉ gắn execution ID; lease token không được mang theo. | Gắn lease từ chính server claim vào state của Root. E2E RED `MISSING_EXECUTION_CONTEXT` → GREEN 1/1 qua HTTP NestJS và PostgreSQL test; kiểm chứng request → consume → model. |
| Admin không thể quyết định case platform và sweeper lưu sai correlation ID | Handler đòi BillingWallet cho mọi case; sweeper dùng invocation ID thay cho provider correlation ID. | Dùng platform funding lock cho platform case; lấy correlation ID từ admission đã khóa. Reconciliation E2E 22/22 đạt. |
| Platform usage có bucket chưa được định giá trả HTTP 500 | Settlement ném lỗi calculator khi cache/reasoning được policy đánh dấu unsupported. | Chuyển `OUTCOME_UNKNOWN` + `INTEGRITY_REVIEW`, giữ exposure/slot, không tạo receipt/debit. RED 500 → GREEN 200; Phase D E2E 25/25 đạt. |
| Ví còn microcredits dương nhưng public credits làm tròn về 0 bị chặn | Admission và Continue cùng đọc `availableCredits`, không xét đơn vị kế toán của ví. | Theo version: ví v2 kiểm tra signed `balanceMicrocredits`, ví v1 kiểm tra legacy `availableCredits`, version lạ fail closed. Test Continue 4/4, admission PostgreSQL 2/2 và runtime 74/74 đạt. |
| 402 hết tiền làm Root FAILED thay vì chờ khách nạp | Contract/runtime không có reason `PAYMENT_REQUIRED`; worker coi billing 402 là lỗi chung. | Thêm reason riêng, chỉ map billing 402 đúng code sang PAUSED khi có native checkpoint; Continue chỉ queue sau khi kiểm tra lại ví đúng owner. Contract, Python và Nest test RED→GREEN. |
| Model call cuối làm cạn ví vẫn có thể tiếp tục | Settlement trước đây không trả tín hiệu số dư sau ON debit; nếu không có admission tiếp theo, Root không biết cần checkpoint. Một bản vá thử ném lỗi ngay trong model middleware đã bị test bắt được vì Continue gọi lại model call đã trả tiền. | Server ghim `paymentRequired` vào response/receipt sau debit; worker xóa dấu do provider giả mạo rồi ghi dấu boolean đã xác nhận vào model response được checkpoint; `after_model` tạo interrupt riêng. Test RED→GREEN chứng minh Continue không gọi lại model cũ; D1b/D3/SHADOW E2E 3/3, Python Root+recovery 29/29. Review bổ sung tái hiện lỗi dọn SQLite sau settlement làm mất pause; đã ghi dấu trước khi dọn, worker recovery 28/28 đạt. Vẫn cần diễn tập crash/recovery vận hành trước khi đóng gate. |
| RBAC test còn đòi worker-key rotation đã bị rút | Test ASM-WORKER-01 cũ kỳ vọng previous key hợp lệ, trái thiết kế một `WORKER_API_KEY`. | Sửa riêng expectation test sang key hiện hành được nhận, key cũ bị từ chối; RBAC 49/49 đạt, không đổi production guard. |

## QA và giao diện

- Đã đổi **giả định soạn giá** từ 1,8 sang 1,2 và version hóa informational quote `lcsp-usage-1.2-v1`; bảng giá nháp dùng FX 26.500 VND/USD và hạ tầng 10%. Những con số này không được settlement dùng trực tiếp. Chưa publish ACTIVE tariff hay tự phê duyệt giá; [biên lai nguồn giá và dữ liệu](./assessment-prompt8-g01-g04-evidence-2026-11-28.md) ghi rõ giới hạn.
- Assessment Jest: **782/782** test đạt; Python adjacent runtime/retry/root/admission: **51/51**; RBAC **49/49**; contracts sau thay đổi cuối **205/205**. `check:architecture` và `check:imports` exit 0 (architecture còn 3 cảnh báo cycle sẵn có trong compliance-rule-set).
- Sau bản vá dọn envelope, chạy lại admission + worker recovery + Root payment bằng Python: **49/49** đạt; `check:business-logic-docs` kiểm tra 3.905 hàm, **0** thiếu/sai; API typecheck, contract literal policy và `git diff --check` đều đạt. Scoped ESLint trên một số file billing lớn trong working tree vẫn báo nhiều lỗi định dạng và kiểu; chưa có baseline tách riêng để quy kết từng lỗi, nên không tự format toàn file và không ghi nhận gate lint này là sạch.
- Đã thêm BFF và trang Admin **chỉ đọc** cho queue/detail reconciliation. BFF **3/3**, Web typecheck, scoped ESLint, business docs và `git diff --check` đạt. Review độc lập không tìm thấy P0/P1/P2 trong BFF/RBAC. **Chưa xác minh bằng trình duyệt:** Chrome CUA lỗi `cgWindowNotFound`, in-app browser báo host unavailable. Chưa có form quyết định/bồi hoàn Admin.
- Test Phase C trước đó có kỳ vọng cũ đóng đinh exposure 1.800 microcredits; calculator mới tính cả bucket cache nên fixture có trần 3.300. Test hiện so sánh với exposure do server thực sự ghi, vẫn chứng minh usage 30.000 vượt trần; Phase C **12/12** đạt.

## Phần chưa thể đóng

1. **G-01..G-07 đều chưa GREEN.** [Bảng gate chi tiết](./assessment-prompt8-technical-gate-status.md) liệt kê bằng chứng vận hành và người phê duyệt cần có. `lcsp_local` hiện có 0 ví/admission/receipt, nên không thể rút số liệu soak G-04 từ dữ liệu thật.
2. **ModelOutputEvaluation:** schema/contract đã có nhưng evaluator ngoài usage middleware chưa sở hữu `invocationId` vật lý. Cần quyết định nơi ghi verdict và cách truyền ID qua retry/fallback trước khi triển khai để không gắn sai kết quả với model call.
3. **G-06/G-07 vận hành:** E2E Root mới còn thay thế claim/context và repository hydration bằng fixture; cần trace deployment thật. Khóa provider đối soát tin cậy còn ở memory và hàm tạo khóa test vẫn nằm trong runtime service; chưa thể bật tự giải phóng case. Cần diễn tập crash ở ranh giới settlement → model checkpoint để xác nhận không thể tự redispatch.
4. **Prompt 9:** tài liệu quy định chỉ refactor report-only sau WP1–8 GREEN. Đã kiểm kê trước các lát cắt: ASM-22 DI/service profile không có caller production được tìm thấy; ASM-10 literal audit/reason; ASM-20 Prisma types trong event appender application; ASM-21 helper render PDF V2/V3 trùng. Mỗi lát cắt cần characterization test trước khi đổi code. Chưa thực hiện refactor khi các gate còn mở.

## Nguyên tắc tiếp tục

Giữ debit và automated release OFF. Chỉ dùng database E2E riêng `127.0.0.1:55434/lcsp_api_e2e` cho test có ghi dữ liệu; `lcsp_local` chỉ được truy vấn đọc khi thu thập bằng chứng. Không tự nâng gate, publish tariff, cutover ví thật hay ghi nhận phê duyệt thay Product/Finance/Security/Release.
