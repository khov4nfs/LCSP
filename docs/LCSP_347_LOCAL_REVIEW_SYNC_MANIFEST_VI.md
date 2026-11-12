# LCSP-347 — Đồng bộ tư liệu review local (11/11/2026)

> **REVIEW ONLY — NOT LEGAL GOLD — NOT ACTIVATION-ELIGIBLE.** Không sử dụng các tệp trong thư mục này làm đầu vào đã phê duyệt của Preparation, runtime instruction manifest, hoặc quyết định compliance.

## Đối chiếu nguồn

Tư liệu được chuyển từ local workspace đang ở commit `711ad063878c034db57662feb53852a69bddb14d`, với 11 file tracked sửa và các file untracked. Remote `feat/LCSP-347-development-preparation-scope` (commit `b9ecc2f5f617194f6baf3fe1d7f97eca966616e1`) đã nhận nhiều thay đổi đó nhưng PR #457 đóng, chưa merge. Remote PR #456 ở `3507652e50e1e73b856231060668f95a51463bd5` có runtime instruction controls, localization và semantic eval mới hơn. Do đó **không chép đè các prompt, evaluation CLI hay production code cũ**.

## Tệp được bổ sung

- `COMPLIANCE_RULE_SETS_REVIEW.md`: bản tổng hợp lịch sử, gồm dữ liệu mock và 14 đánh giá chưa được chấp thuận; có cảnh báo không phải production evidence.
- `COMPLIANCE_RULESET_1TO1_LEGAL_REVIEW_VI.md`: phân tích 171 bản ghi và bất đồng về locator / legal source, chưa chứng minh đầy đủ văn bản gốc.
- `COMPLIANCE_RULESET_1TO1_MAPPING_DRAFT_VI.json`: draft review 1:1, chỉ có mục đích tra cứu và phát hiện discrepancy.
- `preparation-development-skills/*/SKILL.md`: bốn checklist tiếng Việt cho review actor/stage, material legal context, mixed propositions và quality. Đây là **tài liệu**, không phải skills được đăng ký runtime hoặc được duyệt EN equivalent.

## Chính sách kiểm tra

`scripts/check-canonical-terminology.mjs` chỉ miễn trừ thuật ngữ lịch sử cho **ba tệp chính xác**, với marker chứng minh review-only; không mở rộng miễn trừ tới code, prompt, output thực thi hoặc tài liệu khác. Canonical terminology gate phải tiếp tục fail với tên cũ ở nơi khác.

## Điều kiện còn thiếu

1. Pin đúng legal source version/hash và đối chiếu điều khoản gốc trước khi lập legal gold.
2. Reviewer pháp lý độc lập phê duyệt từng case, positive và mixed/HITL controls; kết quả snapshot không phải nhãn đúng mặc định.
3. Reviewer instruction độc lập phê duyệt VI→EN bundle; không dùng các checklist này để thay manifest runtime.
4. Live-model A/B, provider costs và production-like authenticated Assessment cần evidence riêng; không được đánh dấu PASS từ tài liệu này.
