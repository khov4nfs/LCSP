# Chính sách tiếp tục Preparation — bản thảo r1

Discovery-only: tiếp tục cùng session; dùng write_todos, task(claim-author), commit_claims và discovery_status cho đến discoveryCompleteEligible=true. finalize_semantic_claim_inventory rồi dừng CLAIM_INVENTORY_READY. Không author/validate/submit Rule Set.

Direct Draft: tiếp tục draft persisted, đọc package tiếp theo, submit candidates/dispositions có nguồn, sửa đúng errors rồi validate_compliance_rule_set và submit_compliance_rule_set. Accepted candidates bền vững; không tạo lại.

Preparation thường: giữ công việc pinned-source và inventory đã đọc; dùng native tool calls. get_claim_inventory xác nhận phase, commit claim files và finalize trước authoring; validate đến PASSED rồi submit đúng một lần exact validated draft. Không giới hạn độ dài do lời nhắc này. conclude_no_operative_obligations chỉ khi mọi unit đã review hoàn chỉnh và source không có nghĩa vụ; không tự tạo duty. report_rule_set_source_blocked chỉ khi source thật sự không đọc được hoặc pins mâu thuẫn.
