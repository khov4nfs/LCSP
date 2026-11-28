# LCSP-412 · Policy baseline pháp luật Việt Nam

Bộ benchmark dùng hai PDF trong corpus P05. Mỗi lần chạy kiểm tra SHA-256 của PDF gốc theo manifest, pin các điều khoản trích xuất và đối chiếu hash của snapshot với manifest P14. Các điều khoản cung cấp cho Root bao gồm định nghĩa chủ thể, phạm vi, hiệu lực, chuyển tiếp và ngoại lệ có liên quan. [Manifest P05](../../corpora/lcsp-402-vn-cong-bao-v1/manifest.json) · [Điều khoản và trang PDF](../../fixtures/policy-baseline/legal-context.json)

| Kiểm tra evidence | Căn cứ |
|---|---|
| Phiên bản hệ thống trong hồ sơ phân loại rủi ro | Điều 10 Luật 134/2025/QH15, Điều 12 Nghị định 142/2026/NĐ-CP |
| Thời điểm thông báo kết quả phân loại | Điều 10 Luật 134, Điều 14 và Điều 46 Nghị định 142 |
| Nhận biết khi tương tác trực tiếp với hệ thống AI | Điều 11 khoản 1 Luật 134, Điều 16 Nghị định 142 |
| Dấu máy đọc trên đầu ra nghe nhìn | Điều 11 khoản 2 Luật 134, Điều 17 Nghị định 142 |
| Cơ chế đánh dấu cho hệ thống nguồn mở hoặc miễn phí | Điều 17 khoản 5 Nghị định 142 |
| Thời điểm thông báo nội dung AI ra công cộng | Điều 11 khoản 3 Luật 134, Điều 18 khoản 1 và khoản 3 Nghị định 142 |
| Nhãn hiển thị trên nội dung nghe nhìn thuộc diện gắn nhãn | Điều 11 khoản 4 Luật 134, Điều 18 Nghị định 142 |

Các fixture mô phỏng việc quan sát hồ sơ, giao diện và đầu ra đã phát hành. Giá trị đã kiểm tra phải có trạng thái `VERIFIED_PRESENT` và đúng kiểu dữ liệu. Evidence thiếu, chưa xác minh hoặc sai cấu trúc trả về `UNKNOWN`. Khi áp dụng, `FAIL` yêu cầu evidence ghi nhận thiếu sót rõ ràng hoặc có giá trị mâu thuẫn với tiêu chí đã định. Hai nhóm cần suy luận về phân loại rủi ro hoặc chất lượng minh bạch được đánh dấu `EXCLUDED`. [Định nghĩa policy](../../fixtures/policy-baseline/policies.json)

## Kết quả local

Bốn snapshot DEV và bốn snapshot HOLDOUT khác nhau tạo thành 56 ca, có 25 negative controls về phạm vi, chủ thể và ngoại lệ. HOLDOUT là nhóm fixture riêng trong cùng repo. Các nhãn tham chiếu đều ở trạng thái `SEEDED_UNREVIEWED`.

| Baseline | DEV | HOLDOUT |
|---|---:|---:|
| Khớp nhãn fixture | 28/28 | 28/28 |
| PASS / FAIL / UNKNOWN / NOT_APPLICABLE | 7 / 6 / 5 / 10 | 8 / 2 / 3 / 15 |
| Precision và recall theo lớp PASS và FAIL | 100% | 100% |
| Negative controls | 10 | 15 |

Hai lượt chạy trả về cùng manifest, input pins, verdict, applicability và đường dẫn evidence. Smoke test P14 chạy đủ 56 ca, không ghi lỗi thực thi và có 0 lượt gọi provider. P14 ghi riêng verdict khớp (15/56), nguồn dẫn phủ đúng đoạn (56/56), cả verdict và nguồn dẫn cùng khớp (15/56), HITL khớp (55/56) và workflow khớp (48/56). Lượt smoke dùng Root `SCRIPTED`, vốn có thể trả `COMPLIANT` theo nhánh mặc định. Trường hợp `workbench` kỳ vọng Root mở HITL khi dấu máy đọc còn thiếu bằng chứng xác minh. Smoke test ghi nhận kịch bản không mở HITL trong ca này.

Đánh giá suy luận theo rubric LCSP-400 đang ở trạng thái `NOT_SCORED`. Phép đối chứng với Root LIVE còn cần review độc lập cho gold labels và quyền thực thi theo LCSP-407.

## Tái lập và kiểm tra artifacts

Chạy từ `deepagents/` với một thư mục đầu ra mới.

```bash
uv run python -m evals.cli policy-baseline --output-dir /tmp/lcsp-vn-policy-pilot
```

`policy-report.json` lưu verdict, applicability và JSON Pointer cho từng ca. `cases.json` chứa đầu vào P14 và tiêu chí evidence, HITL, lifecycle. `root-scripted/` chứa manifest, trial inventory, kết quả và traces. Manifest P14 của lượt local có SHA-256 `bd4950f898274f9c16fc45330e5f43f7a82a07b48deb2945b45a8dacb0a9a7d1`.

Workflow Tests tạo artifact `lcsp-policy-baseline-<SHA>` theo từng revision CI và giữ 30 ngày. Artifact gồm cả các tệp dùng để kiểm tra lại kết quả và traces.
