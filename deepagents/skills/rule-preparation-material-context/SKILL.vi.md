---
name: rule-preparation-material-context
description: Lọc ngữ cảnh theo quan hệ material đến nghĩa vụ development, bảo toàn legal source ledger.
---
# Context closure cho development

## Khi dùng
Sau khi có các development operative claims được review, trước khi lập Rule assessment hay rút gọn prompt context.

## Quy tắc
- Bắt buộc giữ ancestor lead-in xác định actor/nhóm rủi ro, điều kiện phát sinh, định nghĩa, qualifier, exception, thời điểm và dẫn chiếu ảnh hưởng đến claim dev.
- Đường liên kết material phải là quan hệ có căn cứ: CONDITION_OF, QUALIFIES, EXCEPTION_TO, TEMPORALLY_APPLIES_TO, DEFINED_BY, INCORPORATES, CONTEXT_FOR, CROSS_REFERENCE.
- Không sinh độc lập AssessmentRule từ heading, định nghĩa, khuyến khích, policy hoặc thẩm quyền Nhà nước.
- Chỉ ẩn khỏi context gửi model các đoạn không có đường dependency đến development claim; vẫn giữ nguyên trong corpus/accounting/trace.
- Không loại modifier chỉ vì nó nằm trong điều về vận hành. Phần exception có thể điều chỉnh chính duty dev.
- Locator điểm đ phải giữ Unicode chuẩn; ID pt- không có chữ là lỗi ingestion, không tự chữa bằng suy đoán.

## Đầu ra
retainedContextEdges [{claimId, contextNodeId, relationKind, quote, materialReason}], excludedFromModelView [{nodeId, reason}].

## Cấm
Không xóa khỏi legal corpus, không coi view suppression là source repeal, không giấu unresolved references hay cắt ngoại lệ.

## Loại triệt để context chỉ thuộc deploy khỏi phần đánh giá development

- Không đưa vào development view bất kỳ Điều/Khoản/Điểm và đoạn context nào chỉ về triển khai, vận hành production, sử dụng hệ thống hoặc công tác quản lý, nếu không có quan hệ phụ thuộc trực tiếp đã xác minh với nghĩa vụ development.
- Không giữ nguyên toàn bộ đoạn deploy chỉ vì một điểm chung Điều có nghĩa vụ của developer. Chỉ trích đúng điều kiện, phạm vi, định nghĩa, ngoại lệ hoặc hiệu lực trực tiếp sửa nghĩa vụ development.
- Tính material phải có nguồn pin + locator + directed relation. Nội dung ở gần nhau hay cùng từ khóa không đủ để giữ.
- Nếu chưa xác minh quan hệ material, đánh dấu cần review; tuyệt đối không tự gộp context deploy vào rule development.
- Full legal ledger vẫn giữ toàn bộ nghĩa vụ để bảo toàn coverage.
