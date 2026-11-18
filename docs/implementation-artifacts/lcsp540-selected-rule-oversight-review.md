# LCSP-999 — Selected-rule Preparation: giám sát rủi ro trung bình (review-only)

> **PENDING INDEPENDENT LEGAL REVIEW — NOT LEGAL GOLD.** Đây là ca tái hiện lỗi và điều kiện nghiệm thu, không phải kết luận pháp lý đã duyệt, không có live-model measurement và không cấp phép production.

## Đầu vào cần pin khi chạy lại

- Nguồn: Luật Trí tuệ nhân tạo số 134/2025/QH15, Điều 10 khoản 5 điểm b, trong quan hệ với câu dẫn khoản 5 và khoản 6.
- Nguồn chính thức để người review đối chiếu: https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/12/134-luat-qh.pdf
- Source binding xuất hiện trong output người dùng: `["luat-tri-tue-nhan-tao","art-10::cl-5::pt-b","sha256:07a7962156e6a3a7bdd3eab0605d1281f24c8168ce9936e1460ddf1f5ca14d40"]`. **Chưa có xác minh độc lập** rằng hash này đại diện đúng nội dung nguyên văn và version của nguồn luật trong runtime; phải kiểm tra với database snapshot.
- Văn bản nguồn: hệ thống AI rủi ro trung bình được giám sát thông qua báo cáo, kiểm tra chọn mẫu hoặc đánh giá tổ chức độc lập.

## Lỗi tái hiện (theo người dùng)

- Tự gán actor “tổ chức triển khai/vận hành” và modality DUTY mà không chứng minh chính điều khoản đã pin giao nghĩa vụ lập hồ sơ cho actor đó.
- Chuyển ba phương thức giám sát thành yêu cầu trong `requiredEvidence`: ít nhất một báo cáo/hồ sơ kiểm tra/đánh giá.
- Sinh investigation goals về tìm tài liệu, liên kết “metadata rủi ro trung bình”, theo dõi hoạt động giám sát liên tục trong repo; mô tả cùng mệnh đề bị lặp lại nhiều lần.
- Chưa tách legal applicability, development scope và khả năng chứng minh bằng repository.

## Điều kiện nghiệm thu định tính (chưa có gold approval)

| Ca | Kỳ vọng review | Không được suy ra |
| --- | --- | --- |
| A. Chỉ Điều 10(5)(b) và câu dẫn | Nhận diện cơ chế giám sát; không gán duty technical Developer, không sinh investigation checklist chứng từ | Developer phải tạo/lưu ba loại hồ sơ, báo cáo định kỳ, dashboard hay dịch vụ giám sát |
| B. Có nghĩa vụ external được chứng minh rõ từ điều khoản đã pin khác | Giữ nguyên LegalRequirement đúng actor, `nonRepositoryDuty=true`, `coverage=NON_ASSESSABLE`; không tạo AssessmentRule repository | Việc không tìm thấy file chứng minh NON_COMPLIANT hoặc NOT_APPLICABLE |
| C. Nghĩa vụ design/build riêng của developer/provider có căn cứ | Giữ AssessmentRule kỹ thuật thực sự được luật đặt ra và phù hợp scope | Loại toàn bộ chỉ vì cùng Điều có nhắc production hoặc báo cáo |
| D. Khoản mixed: development + operation | Tách đúng actor/action, giữ phần development; source ledger bảo toàn nhánh ngoài scope | Nhập nghĩa vụ operator vào một criterion developer |

## Cách xác minh

1. Truy xuất chính xác `PreparationRuleInput` đã lưu, nguồn pháp lý, câu dẫn/các cross-reference thực sự được cung cấp; không tự bổ sung source ngoài input để tạo giả kết quả model.
2. Chạy lại đúng selected-rule API/worker và kiểm tra `instructionReceipt.content` đã có **Mandatory legal-to-AssessmentRule gate**, hash khớp inventory.
3. So sánh cấu trúc output trước/sau, đặc biệt actor, modality, legalRequirements, coverage, assessmentRules, criteria, investigationGoals, requiredEvidence, nonRepositoryDuty; không được lặp tiêu chí tài liệu.
4. Reviewer pháp lý độc lập xác nhận expected result, bổ sung positive và mixed controls, sau đó chạy model thật cùng cấu hình và ghi usage journal/billing, false positives, false negatives, HITL.
5. Không coi provider-free static prompt tests hoặc CI xanh là chứng minh model đã hiểu đúng. Chưa có independently approved VI→EN runtime equivalence thì trạng thái release vẫn BLOCKED.

## Trạng thái

- Prompt/skills source change: **đã đưa lên PR #540** (commit `0df8c64f77249cbeb1965e7040366f261dcc400c`).
- Legal gold approval: **PENDING**.
- Live-model semantic rerun: **NOT_RUN**.
- Production verified: **NOT_RUN**.

## Điều kiện bổ sung — INPUT, OUTPUT, QUY TRÌNH

**Mục tiêu:** Tách chọn nguồn để Preparation khỏi phân tích nghĩa vụ. Việc selection theo ID/filter/catalog revision chỉ xác nhận *đầu vào hợp lệ*, không xác nhận một nghĩa vụ đã áp dụng cho hệ thống cụ thể hoặc sẽ luôn sinh AssessmentRule.

| Trục | Câu hỏi cần trả lời từ nguồn luật đã pin | Kết quả khi thiếu hoặc chỉ thuộc external |
| --- | --- | --- |
| INPUT | Nguồn điều chỉnh loại dữ liệu, yêu cầu, hệ thống, đối tượng và ngưỡng/điều kiện kích hoạt nào? Có câu dẫn cha, ngoại lệ, thời gian và AND/OR không? | Giữ điều kiện chưa biết để Assessment kiểm tra; không mặc định đúng hoặc áp rộng |
| OUTPUT | Luật bắt buộc/cấm phần mềm trả về, hiển thị, tạo, ngăn hoặc xử lý output nào, nếu có? | Không mặc nhiên biến báo cáo, tài liệu kiểm tra hay đánh giá độc lập thành output kỹ thuật |
| QUY TRÌNH | Ai thực hiện bước nào, ở giai đoạn nào, bằng chứng nằm trong repo hay ở tổ chức/cơ quan ngoài repo? | Giữ external duty có căn cứ theo NON_ASSESSABLE; không tạo repo rule cho thẩm quyền quản lý của Nhà nước |

### Kiểm thử hành vi

- **Điều 10(5)(b)**: Nếu chỉ có phương thức giám sát hệ thống rủi ro trung bình, không tự tạo output báo cáo và không sinh quy trình developer giám sát liên tục. Điều kiện rủi ro trung bình là trigger/source context, không phải trạng thái khách hàng đã được chứng minh.
- **Positive control — design duty riêng:** nếu nguồn đã pin buộc Developer hoặc Provider thiết kế, kiểm thử hay chặn một đầu ra cụ thể dưới điều kiện đã định, giữ nghĩa vụ và sinh một AssessmentRule gọn để kiểm tra phần có thể chứng minh bằng repo; không loại chỉ vì điều khoản liên quan giai đoạn sử dụng.
- **Mixed control:** điều khoản có cả bước design của Developer và kiểm tra ngoài repo của Deployer hoặc cơ quan; phân tách theo actor/process, không gộp ba bước thành một rule hoặc bỏ sót developer branch.
- **Unknown input:** không có dữ kiện hệ thống khách hàng nào được đưa vào Preparation; gắn điều kiện chưa rõ, không xuất APPLICABLE/COMPLIANT/NOT_APPLICABLE.
- **Evidence != duty:** file vắng mặt không tự chứng minh vi phạm nghĩa vụ external; file hiện diện không chứng minh hoàn tất thủ tục ngoài repo.

### Ranh giới triển khai

Giữ nguyên bulk/explicit selection authorization, idempotency, catalog version lock, exact legal source citations và API request contract. Thay đổi hướng dẫn và schema description chỉ ảnh hưởng cách model tạo *candidate result*; không sửa luật nguồn, không ép sửa enum, không bỏ nguồn legal/provenance. Instruction được nạp theo path/UTF-8 trực tiếp; không có manual instruction approval hay checksum gate. Các yêu cầu chứng minh legal accuracy bằng model thật vẫn tách biệt với việc chỉnh instruction.

**Trạng thái xác minh:** source-level/static checks có thể phát hiện thiếu wiring; chưa chứng minh chất lượng model qua controlled negative/positive/mixed run và các expected outcomes trên phải được đối chiếu nguồn luật thực tế, không coi chính bảng này là independently reviewed legal gold.
