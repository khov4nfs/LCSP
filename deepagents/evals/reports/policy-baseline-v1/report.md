# LCSP-412 · Policy baseline cho Development Activity Scope

Benchmark áp dụng phạm vi phát triển của LCSP-424 theo chủ thể, nghĩa vụ và đầu ra kỹ thuật. Kết quả chỉ phản ánh tiêu chí được liệt kê trong từng policy. [LCSP-424](https://minhpnq1807.atlassian.net/browse/LCSP-424) · [Định nghĩa policy](../../fixtures/policy-baseline/policies.json)

| Kiểm tra được chấm | Căn cứ và đầu ra |
|---|---|
| `RISK-VERSION` | Điều 10 Luật 134 và Điều 12 Nghị định 142, trường phiên bản trong hồ sơ phân loại kỹ thuật của nhà cung cấp |
| `INTERACTION-DISCLOSURE` | Điều 11 khoản 1 Luật 134, khả năng người dùng nhận biết AI tại điểm tương tác trực tiếp |
| `MEDIA-MARK` | Điều 11 khoản 2 Luật 134 và Điều 17 Nghị định 142, dấu máy đọc nhận diện nguồn gốc AI trên đầu ra nghe nhìn |
| `OPEN-MARK-ENABLEMENT` | Điều 17 khoản 5 Nghị định 142, cơ chế tích hợp hoặc phương tiện công khai để bật và vận hành chức năng đánh dấu |

`RISK-NOTICE`, `PUBLIC-NOTICE-TIMING` và `VISIBLE-MEDIA-LABEL` nằm ngoài mẫu số development. Policy đầu kiểm tra thủ tục nộp thông báo hành chính của nhà cung cấp. Hai policy còn lại kiểm tra hành vi của bên triển khai khi đưa nội dung ra công cộng. Khả năng kỹ thuật đánh dấu tiếp tục được đánh giá dưới căn cứ riêng tại Điều 17. Phân loại rủi ro và chất lượng minh bạch vẫn nằm trong danh mục `excluded`. [Luật 134/2025/QH15](https://congbao.chinhphu.vn/van-ban/luat-so-134-2025-qh15-468694.htm) · [Nghị định 142/2026/NĐ-CP](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-142-2026-nd-cp-469480.htm)

Runner xác minh hash của PDF, tái tạo bản trích xuất bằng pipeline managed-document ingestion và đối chiếu hash của toàn bộ artifact với receipt LCSP-402. Fixture pin định danh điều và dải trang PDF. Runner kiểm tra hierarchy, dải trang và thứ tự của từng chunk. Phần nối `::part-N` phải khớp locator gốc và đi theo thứ tự. Nếu gặp `::dup-N` thuộc điều đã chọn, runner dừng để điều khoản được kiểm tra lại. Cả 11 điều hiện dùng đã được đối chiếu với PDF gốc và đều qua guard. [Manifest Công báo](../../corpora/lcsp-402-vn-cong-bao-v1/manifest.json) · [Receipt P05](../../corpora/lcsp-402-vn-cong-bao-v1/ingestion-receipt.json)

Mỗi tiêu chí yêu cầu evidence đúng kiểu. Chuỗi placeholder gắn nhãn `VERIFIED_PRESENT` trả `UNKNOWN`. Một kết quả thử nghiệm đã xác minh có thể xác nhận hoặc bác bỏ tiêu chí. Runner dùng ngày đánh giá, ngày bắt đầu vận hành và lĩnh vực của hệ thống có trước Luật để kiểm tra mốc chuyển tiếp 12 hoặc 18 tháng theo Điều 35. Khi còn trong thời hạn chuyển tiếp, kết quả chỉ có ý nghĩa tại ngày đánh giá. Ngày sai hoặc thiếu dữ kiện trọng yếu trả `UNKNOWN`.

## Kiểm tra local

| Nhãn fixture | DEV | HOLDOUT |
|---|---:|---:|
| PASS | 4 | 2 |
| FAIL | 3 | 1 |
| UNKNOWN | 2 | 1 |
| NOT_APPLICABLE | 7 | 12 |

Hai nhóm gồm bốn snapshot riêng mỗi nhóm và có tổng 19 negative controls. Nhãn tham chiếu ở trạng thái `SEEDED_UNREVIEWED`. HOLDOUT là phân vùng fixture local, với 12/16 ca `NOT_APPLICABLE`. Chưa xác lập việc cách ly dữ liệu trước khi thiết kế policy. Các ngày đánh giá năm 2027 là dữ liệu giả định áp dụng văn bản đã pin.

Baseline khớp 32/32 nhãn fixture. Manifest P14 của lượt xác minh locator có SHA-256 `4ed6efdb485bcd0cef0fee7f9dd93d4558c0a5c818a88f6dd3a9e891da6c37cb`. So sánh `legal_provisions` trước và sau khi thêm guard cho thấy cả 32 ca dùng cùng văn bản điều luật.

Root `SCRIPTED` chạy đủ 32 ca để kiểm tra tích hợp P14, ghi nhận 0 lỗi thực thi và 0 lượt gọi provider. Verdict khớp 6/32, citation anchors khớp 32/32, HITL khớp 31/32 và workflow khớp 29/32. Điểm suy luận vẫn ở trạng thái `NOT_SCORED`. Đối chứng LIVE cần nhãn tham chiếu được review độc lập và quyền chạy theo LCSP-407.

## Tái lập

Chạy từ `deepagents/` với thư mục đầu ra mới.

```bash
uv run python -m evals.cli policy-baseline --output-dir /tmp/lcsp-development-policy-pilot
```

`policy-report.json` lưu verdict, applicability và các đường dẫn evidence. `cases.json` lưu dữ liệu đầu vào của P14. `root-scripted/` chứa manifest, trial inventory, kết quả và traces. Workflow Tests lưu các tệp này trong artifact gắn với revision CI trong 30 ngày.
