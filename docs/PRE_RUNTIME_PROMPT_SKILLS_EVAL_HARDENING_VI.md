# LCSP — Pre-runtime hardening: Preparation, Assessment, Skills và Semantic Eval

**Trạng thái:** Implementation + provider-free evaluation; **chưa phải semantic acceptance, chưa merge/deploy**. PR chính: [#456](https://github.com/khov4nfs/LCSP/pull/456).

## 1. Quy tắc quyết định: runtime contract là authority, không phải prompt

- Server hiện phát `targetActivityScope=FULL_SOURCE`. Worker từ chối `DEVELOPMENT_ONLY` trước bước tạo model thông qua `enforce_runtime_scope`; prompt hay skill không thể bật một scoped run.
- Source/corpus đã pin vẫn được kiểm kê đầy đủ theo Claim Inventory; `NO_REQUIREMENT` không dùng để giấu duty nằm ngoài development.
- Development view chỉ là projection để review. Điều/Khoản/Điểm chỉ điều chỉnh deploy/operation không đi vào catalog phát triển; modifier thực sự ảnh hưởng nghĩa vụ development phải giữ theo **directed material dependency**.
- `scope_review.py` chỉ chấm quyết định stage **theo từng normative claim**, không thay thế claim extraction, LegalSourceVersion pin, chữ ký reviewer, persisted scope ledger, server-side projection validator hay Completion Gate.
- Không có lệnh thay đổi Rule Set ACTIVE trong đợt này.

## 2. Runtime ownership và locale

| Tầng | Đã áp dụng | Giới hạn còn lại |
| --- | --- | --- |
| API claim handler | Worker bundle có `targetActivityScope=FULL_SOURCE`, `responseLanguage=vi` do server cấp. | Chưa persist/choose locale theo owner/run; không chấp nhận self-selected scope. |
| Preparation runner | Truyền scope/locale từ trusted bundle vào context. | Chưa có server-approved DEVELOPMENT_ONLY run. |
| Preparation phases | Common/Discovery/Authoring/Direct giữ đầy đủ nguồn khi FULL_SOURCE; chặn hiểu nhầm deployment-view suppression. | Đợt này chưa chuyển 100% phase prompts sang VI độc lập; dùng VI overlay trong VI run. |
| Claim Author child | Được nạp 2 tool read-only `list_preparation_skills`, `load_preparation_skill`, bên cạnh `commit_claims`; có prompt assignment EN/VI. | Quyền ghi per-Article vẫn cần guard cấp filesystem; prompt chỉ hướng dẫn. |
| Skills | 4 Preparation skills EN/VI; ngôn ngữ bắt buộc theo run; không lấy kỹ năng làm luật. | Chưa có A/B live eval về hiệu quả skill selection. |
| Compaction | Parent/child compaction nhận prompt phase và locale hiện hành. | Cần live replay kiểm tra retention qua nhiều lần nén. |
| Assessment Root | Existing EN/VI Root + Researcher có selected-scope và evidence provenance. | Semantic parity trên nhiều repository chưa được chứng minh. |

## 3. Decomposition và material closure

Bộ `review_claim_level_development_scope` yêu cầu mỗi normative claim có tuple **actor × modality × action** cùng `sourceNodeIds` thuộc đúng `legalSourceVersionId`. Quyết định stage (DEVELOPMENT / NON_DEVELOPMENT / LEGAL_REVIEW_REQUIRED) phải được gán cho **từng claim**, không phải chỉ nhãn trên cả Article. Claim thiếu, trùng proposition hoặc quyết định đổi chủ thể/source đều bị từ chối.

Material closure chỉ đi qua các **quan hệ có hướng đã tồn tại trong semantic graph**: CONDITION_OF, QUALIFIES, EXCEPTION_TO, TEMPORALLY_APPLIES_TO, CONTEXT_FOR và các relation được cho phép. Duty của operator/deployer là normative claim độc lập, không biến thành modifier của development. Unlinked context không được xuất trong preview. Preview không chứa raw source quote và có `activationEligible=false`.

**Giới hạn:** Đây là preflight của graph/decision đã có; nó không tự hiểu đúng câu luật hoặc phát hiện một nghĩa vụ mà LLM bỏ sót khỏi graph. Việc đó cần gold claim inventory và review pháp lý độc lập trước runtime.

## 4. Semantic eval offline — có oracle, không nhầm model quality với CI

- `eval_semantics.py` so frozen output với gold: claim omission/invention, actor/action/modality/source identity, dev duty omission, deploy duty leak, missing/unrelated material context, directed relation mismatch.
- `eval_cli.py` nhận `--gold <FILE> --candidate <FILE>` và xuất JSON report với SHA-256 cả hai input. Candidate có `semanticGraph` và `scopeDecisions`. Không gọi LLM/API.
- `compare_preparation_locale_parity` so cùng source pin trên các claim tuples + stage và typed material edges; **parity không chứng minh legal truth**.
- Regression tests mới có negative controls biến đổi actor, stage, omitted claim, invented claim, missing condition, reversed/wrong relation và source mismatch.
- Gold hiện mới là **synthetic/test-authored**. Không được dùng `fixtureMatched=true` để xác nhận semantic acceptance.
- `tests/assessment-root-live-eval.mjs` và `deepagents/tests/vertical/live_preparation.py` tồn tại làm harness cho vòng runtime **sau này**; chưa chạy trong đợt này.

Lệnh kiểm tra provider-free trên workspace có dependencies:

```bash
deepagents/.venv/bin/pytest -q deepagents/tests/test_preparation_scope_review.py deepagents/tests/test_preparation_semantic_eval_oracle.py
```

Khi đã có model output và bộ gold đã được human review:

```bash
cd deepagents
python -m rule_set_preparation.eval_cli --gold /path/to/approved-gold.json --candidate /path/to/frozen-candidate.json
```

## 5. Chưa đạt: chặn release trước runtime test

1. **P0 scope governance:** persisted per-claim decision ledger, actor/stage review, signed/revisioned human approvals, material-dependency validation, server-issued DEVELOPMENT_ONLY and server-side scoped projection validator. Không dùng view script hiện tại để thay API validation.
2. **P0 semantic gold:** độc lập xác nhận law text, từng proposition, Điều/Khoản/Điểm, ngoại lệ và legal effect; sửa source integrity/locator trước gắn nhãn PASS. Bộ review 171 đơn vị hiện chưa có approval.
3. **P0 live model eval:** chạy trên nhiều corpus/repo có positive + negative controls và so kết quả thật, không chỉ chạy scripted model/fixture contract.
4. **P1 multi-locale production:** persist responseLanguage theo run thay vì cố định VI trong handler; kiểm chứng full phase prompt EN/VI và tool descriptions.
5. **P1 subagent write isolation:** khóa per-Article claim file writes tại filesystem/tool boundary, không chỉ từ system prompt.
6. **P1 cross-version eval fingerprint:** pin model id, prompt file hashes, skill hashes, corpus IDs, selected rules, gold reviewer revision, model costs và successful/failed attempts cho mỗi eval run.
7. **P1 full provenance/effect controls:** gold không được chỉ kiểm source unit classification; cần kiểm legal effect / exemptions / temporal variants và mixed external-fulfillment.

**Acceptance trước khi merge:** CI và dependency/security gates PASS trên HEAD; review semantics có human-approved gold, zero critical false positives/omissions/contradictions; release/gov approval riêng. Green CI của Python/TypeScript không có nghĩa đã đạt acceptance pháp lý.

## 6. Negative controls đưa vào gold corpus sau legal review

Các ví dụ gắn số luật trước đây trong generic skills đã được bỏ để tránh source-specific priming. Có thể chuyển chúng thành case có source pin riêng và human oracle: khoản đồng thời cho phép và bắt buộc; cùng khoản có actor developer và operator; câu dẫn chung với các điểm con; quyền quản lý nhà nước; điểm đ Unicode; partial repeal; nghĩa vụ external không thấy từ code; yêu cầu thiết kế hoàn thành trước khi sử dụng. **Không xác nhận đúng Điều/Khoản hoặc kết luận luật khi gold chưa duyệt.**


> **Cập nhật 04/11/2026:** Tài liệu này mô tả baseline tiền triển khai. Đọc thêm [Prompt & Scope Governance Delivery](PROMPT_AND_SCOPE_GOVERNANCE_DELIVERY_20261104.md) để xem scope approval/validator, fingerprint receipt và các giới hạn kiểm chứng mới trong PR #456. Không thay thế điều kiện review pháp lý và live acceptance.
