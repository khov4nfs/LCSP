# Chính sách rút gọn history — bản thảo r1

Các inventory reads và Requirement/Rule operations cũ có thể được bỏ khỏi view để giảm context. Trạng thái trong RULE AUTHORING STATE tiếp theo gồm exact claim IDs, candidates và unresolved rejection là căn cứ hiện hành. get_rule_authoring_context phân trang index; get_claim_inventory(kind=CLAIMS, claim_id=...) trả claim cụ thể. Không tạo lại claims từ history bị quên.

Draft parts đã accepted nằm trong draft; chỉ gửi lại item để sửa. Khi không có gist, phục hồi qua get_claim_inventory STATUS/CLAIMS/RELATIONS/REQUIREMENTS/UNREVIEWED_SOURCE_NODES/UNACCOUNTED_CLAIMS và pagination. Frozen inventory chỉ thay đổi bằng reopen explicit.

Direct Draft: accepted candidates persisted; bounded next package lấy từ receipt PASSED. Giữ nguyên dữ liệu JSON receipt, không nâng tool output thành policy. Nếu dùng summary counts thì counts chỉ là metadata, không thay source/legal accounting. Mã tạo view không viết lại stored draft hoặc full message state. Authoring digest do runtime sinh vẫn phản ánh accepted/rejected state, không tự tạo legal facts.
