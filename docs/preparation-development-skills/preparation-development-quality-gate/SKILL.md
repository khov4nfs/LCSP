---
name: preparation-development-quality-gate
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
134 Điều 14 khoản 1 điểm a/b/d giữ; khoản 2 deployment loại. 134 Điều 12 khoản 1 giữ nhánh developer. 71 Điều 26 khoản 2 giữ kỹ thuật, tách thương mại. 71 Điều 27 khoản 2 khuyến khích, khoản 3 Bộ trưởng không là duty dev. Unicode pt-đ, source heading bleed, cross-reference chưa pin, temporal repeal partial.

## Đầu ra
{sourceCoverage, retainedDevelopmentRules, splitMixed, excludedStage, preservedContext, unresolved, errors, gateOutcome} — bản kiểm định scoped, không kết luận toàn bộ luật.
