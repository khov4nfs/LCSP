# Prompt 8 — Giá tham khảo G-01 và phép đo G-04 (2026-11-28)

Tài liệu này là biên lai thu thập và bản nháp để Product/Finance xem xét. Không publish `CustomerModelTariffSnapshot`, không đổi `MODEL_USAGE_DEBIT=OFF`, và không coi giá niêm yết của provider là biểu giá khách hàng đã được phê duyệt.

## G-01: Giá công khai của model đang cấu hình

`deepagents/config/model_routes.yaml` hiện khai báo một route `anthropic-primary`, model `claude-sonnet-4-6`, cho các role Assessment và Rule Set Preparation. Có thể thay route bằng cấu hình deployment; vì vậy phạm vi bên dưới chỉ đúng với cấu hình được kiểm tra trong repo. `packages/contracts/src/billing/official-reference-pricing.ts` đã có bản chụp giá ngày 2026-10-22; bảng sau được đối chiếu lại với [trang giá Claude Sonnet 4.6](https://platform.claude.com/docs/en/models/sonnet-4-6/overview) và [bảng giá Anthropic](https://platform.claude.com/docs/en/about-claude/pricing) ngày 2026-11-28.

| Bucket | Giá công khai USD / 1 triệu token | Chi phí tham khảo VND / 1 triệu token ở 26.500 VND/USD | Giá credit **nháp** / 1 triệu token |
| --- | ---: | ---: | ---: |
| Input thông thường | 3.00 | 79.500 | 104.940 credits |
| Cache read | 0.30 | 7.950 | 10.494 credits |
| Cache write 5 phút | 3.75 | 99.375 | 131.175 credits |
| Cache write 1 giờ | 6.00 | 159.000 | 209.880 credits |
| Output, gồm reasoning nếu provider gộp vào output | 15.00 | 397.500 | 524.700 credits |

Giá credit **nháp** áp dụng quyết định mới của Product: `giá USD công khai × 26.500 × 1,10 (hạ tầng 10%) × 1,2`. Đây là đầu vào soạn bảng giá, không phải công thức chạy khi settle. Tương ứng, giá input nháp là `104940000000` microcredits trên một triệu token, cache read `10494000000`, cache write 5 phút `131175000000`, cache write 1 giờ `209880000000`, output `524700000000`. Con số phải được xem xét cùng phí thanh toán, thuế, điều kiện hợp đồng và margin trước khi Finance phê duyệt. Không có giá reasoning riêng trong nguồn Anthropic này; khi làm tariff phải đối chiếu chính sách bucket của route và tránh tính reasoning hai lần.

Giá trên là **giá Claude API niêm yết**, chưa chứng minh đó là giá thực trả nếu deployment dùng proxy, đối tác, data residency hoặc chương trình giảm giá. Anthropic nêu phụ phí 1,1 lần cho US-only inference trên một số nền tảng; cần kiểm tra cấu hình thực tế. Thiếu hóa đơn/bảng giá hợp đồng thì chưa dùng số này làm bằng chứng cost/margin chính thức. Không tự điền giá cho model ngoài runtime allowlist; khi deployment đổi route, phải kiểm tra nguồn chính thức tương ứng và tạo phiên bản giá mới.

## G-04: Dữ liệu telemetry đã thu thập

Đã kết nối `127.0.0.1:5432/lcsp_local` bằng `DATABASE_URL` từ `.env` ngày 2026-11-28. URL được kiểm tra đúng host, port và database trước khi truy vấn. Phiên PostgreSQL đặt `default_transaction_read_only=on`; chỉ chạy `SELECT count(*)`, không đọc wallet/assessment ID, prompt hoặc payload và không chạy migration.

| Chỉ số | Kết quả hiện có |
| --- | ---: |
| Tổng `BillingWallet` | 0 |
| Tổng `BillableInvocationAdmission` | 0 |
| Tổng `ModelUsageReceipt` | 0 |
| Admission tạo trong 30 ngày | 0 |
| Receipt tạo trong 30 ngày | 0 |
| Bảng `BillingReconciliationCase` | Chưa có trong `lcsp_local` |

Vì mẫu bằng 0, **không có tỷ lệ từ chối slot, phân vị exposure, tỷ lệ settlement vượt exposure hay tỷ lệ unknown usage có thể tính một cách trung thực**. Không lấy số liệu từ test DB làm số liệu khách hàng thật. `apps/api/src/platform/logging/http-logger.middleware.ts` ghi HTTP status và `problem.code` khi lỗi, nhưng chưa có tập access log vận hành được cung cấp cho cửa sổ đo. DB admission chỉ chứa lượt được chấp nhận; dùng nó làm mẫu số tỷ lệ từ chối sẽ sai.

Khi có pilot, đo trên **cùng cửa sổ thời gian và cùng nguồn access log/metrics**:

1. Tỷ lệ từ chối slot = số response `POST /internal/billing/admission/request` có HTTP 409 và `BILLING_WALLET_CONCURRENCY_LIMIT_EXCEEDED` / tổng request vào route đó. Không tính 409 khác loại.
2. Đếm admission theo `fundingPrincipal`, `resolvedProvider`, `resolvedModel`, `state`; đo phân vị của `initialExposureMicrocredits` trên các admission có giá trị, riêng cho `CUSTOMER_WALLET` và `PLATFORM_SPONSORED`.
3. Đối chiếu từng receipt có usage xác thực với `initialExposureMicrocredits`, đếm case vượt bound và case chuyển `BILLING_INTEGRITY_REVIEW`/`OUTCOME_UNKNOWN`; không nhầm `calculatedMicrocredits` với tiền đã debit.
4. Ghi rõ thời gian đo, phiên bản route và tariff, số mẫu, nguồn log và các bucket không có dữ liệu. Chỉ trình Product/Finance/Security chọn ngưỡng exposure và concurrency sau khi có phân bố thực nghiệm.

Hiện G-01 và G-04 **chưa GREEN**. Kỹ thuật có thể tiếp tục test và thu thập trên pilot nhưng không tự suy diễn phê duyệt giá, ngưỡng rủi ro hoặc bật debit.
