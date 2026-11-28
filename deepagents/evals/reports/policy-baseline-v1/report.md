# Pilot đối chứng policy CRA

Chạy từ `deepagents/` với một thư mục đầu ra mới.

```bash
uv run python -m evals.cli policy-baseline --output-dir /tmp/lcsp-cra-policy-pilot
```

`policy-report.json` lưu verdict, applicability, JSON Pointer của evidence và evidence còn thiếu cho từng rule. `cases.json` là đầu vào P14 có thể tái sử dụng. `root-scripted/` chứa manifest, trial, trace và báo cáo P14. Hai nhánh đọc cùng bốn snapshot tổng hợp. Runner đối chiếu SHA-256 của cây fixture với manifest P14 trước và sau khi chạy.

## Phạm vi

Ba policy giới hạn ở tên nhà sản xuất, đầu mối báo lỗ hổng và tháng/năm kết thúc hỗ trợ tại thời điểm mua. Fixture xác nhận phạm vi áp dụng theo giả định của từng ca. Một trường vắng mặt hoặc có giá trị ngoài định dạng hỗ trợ cho kết quả `UNKNOWN`. `FAIL` chỉ xuất hiện khi tài liệu nêu rõ trường chưa được cung cấp hoặc chỉ công bố năm kết thúc hỗ trợ. Các kết quả này áp dụng cho từng tiêu chí tài liệu. Điều kiện, locator và giới hạn nằm trong [policy fixtures](../../fixtures/policy-baseline/policies.json). [CRA, OJ L 2024/2847](https://eur-lex.europa.eu/eli/reg/2024/2847/oj)

Runner dùng Python và học theo cách RuleScan khai báo điều kiện áp dụng và đánh giá evidence theo từng rule. Runner đọc JSON trong fixture, dùng nguồn OJ đã xác định phiên bản và pin các đoạn trích dùng trong ca kiểm thử. [Nghiên cứu RuleScan](https://www.mdpi.com/2076-3417/16/21/10931) · [Artifact RuleScan](https://github.com/AntoineSacre/RuleScan/tree/bbb1f7c82f40763eff2b41580edd7c7170aff4cf)

## Đối chứng theo rule

Mỗi ô ghi **baseline / P14 Root SCRIPTED**. Nhãn tham chiếu `SEEDED_UNREVIEWED` khớp baseline ở 12 ca. Đây là toàn bộ tập DEV gồm bốn snapshot tổng hợp, với một lượt Root cho mỗi ca.

| Loại rule | Locator | Alpha | Beta | Gamma | Delta |
|---|---|---|---|---|---|
| Thông tin người dùng | Annex II(1) | PASS / PASS | FAIL / PASS | UNKNOWN / PASS | NOT_APPLICABLE / PASS |
| Báo cáo lỗ hổng | Annex II(2) | FAIL / PASS | UNKNOWN / PASS | PASS / PASS | NOT_APPLICABLE / PASS |
| Thông tin hỗ trợ | Article 13(19) | UNKNOWN / PASS | PASS / PASS | FAIL / PASS | NOT_APPLICABLE / PASS |

Ba ca lệch vì có bằng chứng mâu thuẫn trực tiếp với tiêu chí. Ba ca lệch vì trường cần kiểm tra vắng mặt. Ba ca còn lại lệch vì phạm vi giả định được xác nhận là FOSS phi thương mại. Trong cả chín ca, model dạng kịch bản của P14 đi vào nhánh mặc định và gửi `COMPLIANT` sau khi dẫn nguồn tệp. Trace xác nhận luồng Root đã chạy qua các công cụ trong harness. Kết quả đo hành vi của kịch bản fixture; chất lượng suy luận model vẫn cần gold label đã review và một lượt đánh giá được cấp quyền.

Hai mục được đánh dấu `EXCLUDED`, ngoài mẫu số precision/recall.

- Annex I Part II(5) — tệp tài liệu chưa chứng minh việc thực thi quy trình công bố lỗ hổng có phối hợp.
- Annex I Part I(2)(b) — snapshot tài liệu chưa xác nhận cấu hình mặc định thực tế hay điều khoản dành cho sản phẩm đặt riêng.

## Số liệu lần chạy

Precision và recall tính theo từng lớp one-vs-rest trên 12 nhãn DEV. `UNKNOWN` và `NOT_APPLICABLE` được giữ nguyên. Thời gian là tổng đo trong một lần chạy cục bộ. Baseline đo bước kiểm tra policy trên dữ liệu đã đọc. Root đo cả lượt chạy đồ thị và công cụ trong harness.

| Số liệu | Baseline | Root SCRIPTED |
|---|---:|---:|
| Nhãn trùng với kỳ vọng | 12/12 | 3/12 |
| Ca có PASS hoặc FAIL | 6/12 | 12/12 |
| PASS precision / recall | 100% / 100% | 25% / 100% |
| FAIL precision / recall | 100% / 100% | Không xác định / 0% |
| Lỗi thực thi | 0 | 0 |
| Thời gian | 0,059 ms | 2.270,599 ms |
| Lượt gọi nhà cung cấp / chi phí | 0 / 0 | 0 / 0 |

Root thực hiện 84 lượt gọi model dạng kịch bản trong tiến trình. Hai lần chạy cho cùng 12 bộ verdict, phạm vi, evidence và evidence còn thiếu của baseline. Latency được đo riêng.

- `develop` đối chiếu với `origin/develop` tại `026476e580f6e9619ee57e861d06165fedf97c14`. P14 có mặt qua #622 và P05 qua #627.
- Manifest P14 `75f974d460d047d25fc26b68487b1970f4e5b43cab0b236953eca29485689de1` ghi model route `benchmark-scripted-root` và các fingerprint của prompt, instruction bundle, skill và tool.
- Policy fixture SHA-256 `6e6bdbf9f59102f80ac84efdfc504df83600a282bdee3b90a0b04593cc02783a`.
- Nhãn fixture SHA-256 `f381d604f172db098beddf91325e97d2c7cad4b5dbb660cda148f293fb97dbe9`. Trạng thái review `SEEDED_UNREVIEWED`.
