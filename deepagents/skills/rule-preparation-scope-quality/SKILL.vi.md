---
name: rule-preparation-scope-quality
description: Kiểm tra scope selection development-only, không tạo shadow law và không lạm dụng NO_REQUIREMENT.
---
# Quality Gate cho DEVELOPMENT_ONLY

## Tiền điều kiện
Server sở hữu target scope, pinned legal source/claims có trace và draft/candidate được chuẩn bị đúng validation contract. Không dùng giao diện mock như production evidence.

## Gates
1. Tất cả source units được accounted theo contract; không biến out-of-target DUTY thành NO_REQUIREMENT.
2. Mọi AR dev có operative source và precise actor, activity, applicability condition, qualifier, exception, dates.
3. Không thêm AR từ operation/deployment/user/state authority/production-only; không xóa nhầm developer branch của mixed clause.
4. Không biến PERMISSION, khuyến khích hoặc định nghĩa thành mandatory DUTY.
5. Material context closure đầy đủ; ancestor/child không double count.
6. Chỉ phần repository-verifiable của MIXED được đưa thành technical criterion; external vẫn là duty trong legal ledger.
7. Không tạo API, framework, sản phẩm hay hồ sơ kỹ thuật bắt buộc nếu luật không có predicate đó.
8. Tài liệu scope review phải có source hash, version, reviewer; gate API chưa hỗ trợ DEVELOPMENT_ONLY thì không được activate scoped Rule Set.

## Negative controls
Kiểm tra tổng quát, không gắn cứng số luật: câu dẫn có phạm vi chung khác nghĩa vụ độc lập; khoản hỗn hợp developer/operator; PERMISSION khác DUTY; thẩm quyền Nhà nước khác nghĩa vụ của chủ thể phát triển; chữ điểm đ Unicode; heading chảy vào khoản trước; cross-reference chưa pin và bãi bỏ một phần. Ví dụ theo từng đạo luật phải nằm trong eval fixture đã pin.

## Đầu ra
{sourceCoverage, retainedDevelopmentRules, splitMixed, excludedStage, preservedContext, unresolved, errors, gateOutcome} — bản kiểm định scoped, không kết luận toàn bộ luật.

## Ví dụ chấp nhận và phản chứng theo nguồn luật

Một rule không đạt chất lượng chỉ vì chủ đề có vẻ thuộc bảo mật hoặc chất lượng dữ liệu. Mỗi criterion development cần truy ngược được: phiên bản nguồn luật đã pin, Điều/Khoản/Điểm chính xác, câu trích nguồn, chủ thể, hành vi, dạng quy phạm, ngưỡng/điều kiện, ngữ cảnh cha và giới hạn nghĩa vụ ngoài mã nguồn. Nếu criterion phát sinh từ framework thay vì từ luật thì **FAIL về ngữ nghĩa**, dù JSON hợp lệ.

**Phải giữ:** nghĩa vụ thiết kế biện pháp an toàn của nhà cung cấp dù phải hoàn thành trước khi đưa sản phẩm vào sử dụng; nghĩa vụ của người phát triển trong khoản có nhiều chủ thể; phạm vi/rủi ro cao được xác định tại câu dẫn.

**Loại khỏi catalog development:** nghĩa vụ chỉ dành cho người thực hiện vận hành, thẩm quyền quản lý của Nhà nước, quyền thử nghiệm tùy chọn hoặc chính sách khuyến khích. Loại khỏi catalog không có nghĩa nghĩa vụ bị bãi bỏ.

**Phải tách:** một khoản có trách nhiệm kỹ thuật khi phát triển và trách nhiệm thương mại/vận hành riêng. Mọi claim có thật vẫn được ghi nhận trong full-source ledger; chỉ phần development được phép xuất hiện ở projection đã qua validator và human review.

**Negative controls:** Hình ảnh camera có bounding box không mặc định là nội dung hình ảnh/video tổng hợp do AI tạo ra; phải xác định đối tượng đầu ra và thực tế pipeline theo điều kiện luật. Không thấy tài liệu trong repository không chứng minh cơ quan, tổ chức đã không thực hiện phê duyệt/báo cáo/thông báo ở bên ngoài. Chủ thể/điều kiện chưa có căn cứ phải điều tra hoặc HITL, không tự gán APPLICABLE/NOT_APPLICABLE.

Nếu chưa có scope ledger, validator và approval phía server, kết quả phải ghi **REVIEW_REQUIRED**, không tuyên bố đã kích hoạt catalog development-only. Đây là nhãn review, không phải enum API.

## Quality Gate chống rò rỉ điều khoản/context chỉ dành cho deploy

DEVELOPMENT_ONLY view không được chứa bất kỳ Điều/Khoản/Điểm, criterion, nhiệm vụ audit hoặc đoạn diễn giải nào chỉ thuộc deploy, vận hành production, sử dụng hay công tác quản lý nhà nước. Chỉ được giữ một predicate pháp lý tối thiểu khi có directed edge đã xác minh tới một development claim, đủ nguồn/locator và điều kiện/ngoại lệ.

Context edge đang chờ hoặc không chứng minh được không được tự giữ. Khoản mixed chưa tách mệnh đề thì đánh dấu REVIEW_REQUIRED, không đưa nguyên văn hỗn hợp vào development review. Test phải xác nhận sourceText bị loại không rò rỉ, chứ không chỉ kiểm số lượng AssessmentRule.
