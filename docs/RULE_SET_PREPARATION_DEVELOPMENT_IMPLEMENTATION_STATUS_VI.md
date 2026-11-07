# LCSP — Triển khai Preparation Development-only (bản review kỹ thuật)

**Trạng thái:** feature branch / Draft PR, chưa merge, chưa deploy, chưa thay Rule Set ACTIVE.

## Hợp nhất PR và phạm vi review

- **PR chính:** [#456](https://github.com/khov4nfs/LCSP/pull/456) — bao gồm Assessment Root (prompts/skills EN–VI), sửa MFA, và toàn bộ phần Preparation Development-only.
- **PR nguồn:** [#457](https://github.com/khov4nfs/LCSP/pull/457) — đã đóng do thay đổi được gộp vào #456; không phải merge vào `develop`.
- **Commit hợp nhất:** `911abb9aa55fc8713e7f41c0ac6a364a26f54d7c`; giữ cả hai cha của #456 và #457, không force-push.
- **Điều kiện duyệt:** cần CI mới chạy trên head của #456 cùng semantic acceptance và phê duyệt người review. Chưa có quyền triển khai production hay kích hoạt Rule Set development-only.

## Những phần đã triển khai trong mã nguồn

- `instructions-common.md`, `instructions-discovery.md`, `instructions-authoring.md`, `instructions-direct.md`: thêm yêu cầu tách actor, modality, Điều/Khoản/Điểm, tránh nghĩa vụ trùng khoản/điểm, không biến quyền/khuyến khích thành nghĩa vụ và phân biệt development với deployment/operation/production.
- `instructions-development.md`: overlay chỉ dành cho một target scope **được server xác thực**, không phải quyền cho model bỏ nghĩa vụ pháp lý.
- `preparation_skills.py` và agent/tool allowlists: hai tool chỉ đọc `list_preparation_skills` và `load_preparation_skill`, nạp 4 skills EN/VI từ thư mục cố định, SHA-256 cho body.
- Contract API hỗ trợ trường `targetActivityScope` trên bundle với default `FULL_SOURCE`; claim handler hiện trả **cố định FULL_SOURCE**, không nhận đầu vào DEVELOPMENT_ONLY từ request Admin, để không thay đổi validator/activation hiện hành.
- Các kiểm thử Python và Jest chứng minh: full-source default, fail-closed khi scope lạ, tool allowlist, ngôn ngữ EN/VI, schema strict không cho client tự cấp scope.

## Các điểm **chưa triển khai / chưa đủ điều kiện bật**

1. **Server-authoritative targetActivityScope** trong DB, start/retry/idempotency và riêng từng Rule Set version. Hiện claim handler chưa bật development.
2. **Bảng quyết định phân loại theo operative claim/assessment rule** với source node pin, exact quote, actor/action/stage/reason, trạng thái reviewer, revision và checksum.
3. **Scoped validator và projection** để tạo catalog dev-only mà vẫn bảo toàn toàn bộ nguồn/claim/LegalRequirement trong full legal ledger, kể cả các nghĩa vụ operation-only.
4. **UI review và lựa chọn scope**, cơ chế approval/HITL, phân biệt `OUT_OF_SCOPE_TARGET` với `NO_REQUIREMENT` và `NOT_APPLICABLE`.
5. **Semantic live controls** trên corpus đã pin với kết quả thực của Preparation Agent (không dùng dữ liệu mock hoặc suy ra sản phẩm đã PASS từ 171 trích đoạn).

**Không được chỉ thay `NO_REQUIREMENT` cho điều khoản vận hành:** đó là nghĩa vụ có thật trong pháp luật nhưng ngoài mục tiêu phát hành catalog dev-only. Mọi khoản/điểm đều phải được accounted; context ảnh hưởng đến dev obligation vẫn phải giữ.

## Các tài liệu để review

- `docs/RULE_SET_PREPARATION_DEVELOPMENT_SCOPE_REVIEW_VI.md` — 171 đơn vị và tiêu chí keep/split/context/exclude/review.
- `docs/RULE_SET_PREPARATION_DEVELOPMENT_SCOPE_TRIAGE_VI.json` — dữ liệu triage sơ bộ, chưa phê duyệt.
- `docs/RULE_SET_PREPARATION_DEVELOPMENT_PROMPT_PROFILE_VI.md` — logic profile và negative controls.
- `deepagents/skills/rule-preparation-*/SKILL.vi.md` — bộ skills thực tế tương ứng.

## Kiểm thử tại workspace

- Python focused Preparation suites: 154 PASS, 0 FAIL.
- Python new scope tests: 10 PASS (đã tính trong 154 sau khi chạy chung).
- Jest contracts: 71 PASS, 0 FAIL.
- TypeScript monorepo typecheck: PASS.
- Business logic docstrings, import policy, contract literals, Prettier: PASS.

Không kích hoạt `DEVELOPMENT_ONLY` trên run thật cho tới khi có scoped validator/human review. Đây là một phần triển khai kỹ thuật an toàn và có thể review, chưa phải chức năng lọc production hoàn chỉnh.

## Bổ sung yêu cầu loại Điều/Khoản/Điểm/context chỉ dành cho deploy

- `instructions-common.md`, `instructions-development.md`, `instructions-discovery.md`, `instructions-authoring.md`, `instructions-direct.md` bổ sung hard suppression: phần deploy/production-only không được đưa vào development rule, điều tra kỹ thuật hoặc model-facing context.
- Context chỉ tồn tại trong Development-only review view khi có directed material dependency đã được xác minh từ nguồn pin. Không giữ nguyên khoản deploy hoặc toàn bộ lời dẫn chỉ vì cùng Điều; chỉ giữ predicate tối thiểu có liên quan trực tiếp.
- `scripts/preparation-development-review-view.mjs` tạo **review-only projection không kèm văn bản nguồn**, đọc từ triage 171 đơn vị, không phải runtime catalog hay legal validator. `scripts/preparation-development-review-view.test.mjs` có negative controls cho sourceText rò rỉ, context chưa duyệt và identity trùng.
- Dữ liệu mẫu tại `docs/RULE_SET_PREPARATION_DEVELOPMENT_REVIEW_VIEW_VI.json`: **5** dev candidates, **15** mixed cần tách, **99** non-development bị loại, **31** context chưa chứng minh bị loại, **21** chưa đủ căn cứ không đưa vào output. Tất cả số liệu chỉ là sơ bộ.
- Scope `DEVELOPMENT_ONLY` hiện chưa được API phát hành: server vẫn `FULL_SOURCE`; full-source ledger giữ 171/171 nguồn, và validation pháp lý không được bypass. Chưa thay đổi Rule Set ACTIVE, chưa deploy production.

Để tái tạo file review: `node scripts/preparation-development-review-view.mjs > docs/RULE_SET_PREPARATION_DEVELOPMENT_REVIEW_VIEW_VI.json`; để chạy test: `node --test scripts/preparation-development-review-view.test.mjs`.
