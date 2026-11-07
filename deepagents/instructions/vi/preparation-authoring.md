# RULE_AUTHORING — nguồn bản thảo r1

Sau finalize, gọi start_rule_authoring (author_legal_requirement cũng có thể bắt đầu). Claims, types, source bindings, relevance và relations đã bất biến; không di chuyển accounting denominator. Chỉ reopen_semantic_claim_inventory khi discovery thực sự thiếu, kèm lý do rõ: nó tăng revision, vô hiệu toàn bộ downstream candidates và giữ revision cũ để audit. Sửa Requirement, AssessmentRule hoặc draft validation bằng author_*, remove_rule_candidate, get_rule_authoring_status; không reopen để tránh gap. Sau reopen phải xem ID remapping và author lại phần bị ảnh hưởng.

Phân trang operative anchors bằng get_rule_authoring_context, tối đa 40; một lượt assistant có thể batch tối đa 12 author_legal_requirement rồi tối đa 12 author_assessment_rule cho phần assessable. Requirement cần requirement_key, title, operative_claim_ids; external duty thêm non_repository_duty/non_assessable_reason. Runtime tự bind closure đã xác minh: applicability, qualifier, exception, context. Chỉ xem get_semantic_closure để sửa binding cụ thể, không đọc trước mỗi lần author. get_claim_inventory(kind=CLAIMS, claim_id=...) trả statement/actor/action/relation/provenance; page tối đa 20, theo appliedLimit/hasMore/nextOffset.

History có thể bị trim; dùng RULE AUTHORING STATE cuối request để đọc frozen revision, claim accounting, LegalRequirement IDs, NEEDS AssessmentRule, outstanding rejection và exact claim IDs. Rejection không sửa draft; đọc invalid fields, expected values, requiredAction, sửa đúng lỗi rồi gửi lại. Tool không tồn tại/JSON sai cũng là rejection. Không đoán tool name hoặc legalRequirementId.

Mặc định một operative claim cho một Requirement. Chỉ aggregate khi actor, modality, assessability và modifiers tương thích. Runtime giữ branch-local conditions và typed reachability; explicit bindings chỉ được thuộc verified closure. Guidance không làm operative anchor. Definitions/context không tạo placeholder Requirement; PRESERVES giữ context cho duty không bị thay. Applicability phải giữ đúng addressee và source conditions, any-of/all-of; chỉ SCOPE/CONDITION cấp authority này. NON_ASSESSABLE không miễn operative actor/modality/action hoặc claimBindings.

Khai non_repository_duty trung thực cho performance tổ chức/con người/vật lý/ngoài repo. Log/chính sách không chứng minh đã trả tiền hoặc giao nộp. Runtime dẫn xuất coverage; không tự tạo state. Sửa Requirement bằng cùng requirement_key và toàn bộ intended selection; xem REQUIREMENTS và UNACCOUNTED_CLAIMS khi cần.

author_assessment_rule chỉ nhận exact legal_requirement_ids hiện hữu có thể đánh giá. API dẫn xuất legalIntent, applicability guidance, criteria, evidence từ parent semantics; mọi parent phải được biểu diễn, mỗi criterion có evidenceBindings. investigation_focus chỉ thu hẹp tìm chứng cứ, không tạo capability bắt buộc hoặc thay predicate. Permission có điều kiện không tự yêu cầu cơ chế block/unblock. Sửa rule bằng assessment_rule_id hiện hữu; remove_rule_candidate kèm reason vô hiệu dependency downstream và không sửa claims.

## Validation và completion

validate_compliance_rule_set không nhận packet; kiểm candidates theo frozen revision. Sửa grouped actionable gaps; UNACCOUNTED_SEMANTIC_CLAIM yêu cầu xem claim/source rồi sửa role/dependency. Revision stale phải reload. Không finalize lại inventory để sửa Requirement bình thường. PASSED chuyển SUBMISSION_READY; gọi submit_compliance_rule_set không packet đúng một lần cho exact validated draft. Prose không phải submission; không gửi graph/packet thay thế khổng lồ.

NO_PROGRESS sau validation lặp cùng state/gap kết thúc run. Cosmetic bookkeeping/source reads không reset convergence. Sửa gap cụ thể, đổi chiến lược hoặc reopen có căn cứ. Quota pause giữ committed discovery. record_preparation_progress ghi facts nguồn và unresolved work, không reasoning riêng. Source blocked chỉ khi /legal-source không đọc được hoặc pins mâu thuẫn.

## Kiểm tra trước nộp

Không gộp actor/modality/condition/time/assessability khác nhau chỉ vì cùng locator. Giữ duty development thật và duty operation/external trong full-source accounting; actor vận hành không tự trở thành developer. MIXED phải giữ repositoryObservableAspect và externalFulfillmentAspect; code không chứng minh hành vi hành chính/vật lý. Giữ đúng predicate, risk class, actor, exception; không bắt API/library/UI/config/encryption/file mà luật không yêu cầu. Context ngoài scope chỉ được mang predicate tối thiểu có directed dependency đã xác minh.

FULL_SOURCE giữ packet toàn nguồn. DEVELOPMENT_ONLY đã được server phê duyệt dùng scoped validator: giữ requirement ngoài scope bằng NON_ASSESSABLE + OUT_OF_SCOPE_TARGET:, không tạo AssessmentRule cho nó. Chưa approved thì dừng, không giả NO_REQUIREMENT. Không tạo duty mới từ thiếu evidence. Giữ point đ, ancestor chain và source integrity; extraction hỏng phải báo lỗi cụ thể, không tự bịa locator hay luật đã sửa.
