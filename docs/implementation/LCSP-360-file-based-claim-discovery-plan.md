## Superseded by simplification

The owner replaced this design: one native claim-author task reads one whole Điều and writes its existing claim JSON format. `commit_claims` performs deterministic checks and one API COMPLETE batch. There is no independent auditor, receipt or attestation, no separate checking tool, no assignment knobs and no legacy lease discovery mode. Finalization fails closed on coverage, references and structural integrity. The historical plan below is retained for context and is no longer implementation guidance.

---
task_id: LCSP-360-FBD
module: compliance-rule-set / deepagents rule_set_preparation
status: PLANNED
owner: khovan123
created: 2026-10-24
---

# LCSP-360 — File-based Claim Discovery (production plan)

## 1. Vì sao

Run thật `98228c59` (DB `lcsp_dev`, 2026-10-23):

| Chỉ số | Giá trị |
|---|---|
| Tiến độ | 46 / 3.231 unit trong 119 phút |
| Model call | 817 (Producer mercury-2.5: 646, auditor: 171) |
| Token | ≈ 18M (4,8M input + 13,1M cached + 0,63M output) |
| Mỗi unit | ~18 call · ~390k token · ~2,6 phút; chữ luật mỗi unit chỉ 140–230 ký tự |
| Tool bị từ chối | 241 / 646 (37%): `CLAIM_SCHEMA_INVALID` 96, `SEMANTIC_AUDIT_REQUIRED` 74, `SOURCE_SUPPORT_INVALID` 45 |
| Ngoại suy toàn corpus | ~57k call · ~1,2 tỷ token · ~140 giờ |

Nguyên nhân gốc: Deep Agent đang bị bọc trong một lớp điều phối custom. Lớp này gồm frontier lease theo từng khoản/điểm, tool ghi từng claim một, audit ngay sau mỗi lần complete, filesystem cấm ghi, và middleware cắt context tự viết. Lớp đó buộc agent phải tốn khoảng 18 vòng tool cho mỗi đoạn chữ dài khoảng 60 token.

**Hướng xử lý:** để Deep Agent dùng đúng các khả năng gốc của nó (filesystem, `write_todos`, subagent `task`, summarization). Corpus là thư mục chỉ đọc. Agent ghi claim ra file trong `/work`. Runtime kiểm tra **theo lô** trong vài tool governed. Không có cắt context custom.

## 2. Quyết định phạm vi (đã chốt 2026-10-24)

| Văn bản | Quyết định |
|---|---|
| Luật 116, 134, 71, 91; NĐ 142, 356; TT 05 | Đưa vào Rule Set, review đầy đủ |
| **QĐ 33/2026** (danh mục hệ thống AI rủi ro) | **Giữ, review đầy đủ như các văn bản khác.** Văn bản này xác định phạm vi và điều kiện cho nghĩa vụ AI rủi ro cao của Luật 134; có 2 tham chiếu sang NĐ 142 |
| **QĐ 1671** (chiến lược quốc gia) | **Xóa khỏi corpus.** Không văn bản nào tham chiếu tới nó (đã kiểm tra `LegalDocumentReference`) |

Corpus sau khi xóa QĐ 1671: 8 văn bản, khoảng 374 Điều, khoảng 3.028 unit, khoảng 570k ký tự.

## 3. Kiến trúc đích

```
/legal-source/                       (read-only, sinh từ AST đã pin)
  INDEX.md                           danh sách văn bản → chương
  <doc>/INDEX.md                     mục lục chương/mục/điều
  <doc>/<chuong>/dieu-<N>.md         toàn văn 1 Điều; mỗi khoản/điểm có dòng locator
                                     `art-5::cl-1::pt-c` và các referenceId nằm inline
/work/                               (read-write, chỉ agent ghi)
  claims/<doc>/dieu-<N>.json         claim do agent viết cho 1 Điều
```

Luồng làm việc:
1. Agent cha dùng `write_todos` với mỗi văn bản (hoặc chương, nếu văn bản lớn như NĐ 142) là một mục. Agent cha giao từng mục cho subagent `claim-author` qua `task`, nhiều subagent song song trong cùng một lượt.
2. Subagent `claim-author` đọc file Điều (`read_file` gốc, có phân trang sẵn), ghi `dieu-N.json`, rồi gọi `check_claims` và `commit_claims`. Khi xong, nó trả về một dòng tóm tắt.
3. Agent cha xử lý tham chiếu chéo văn bản còn treo, gọi `discovery_status`, sau đó `finalize_semantic_claim_inventory`.
4. **Rule Authoring, validate và submit giữ nguyên như hiện tại.**

### 3.1 Định dạng file claim (contract)

Định nghĩa trong `packages/contracts/src/compliance-rule-set/claim-file.ts` (zod). Phía Python dùng JSON Schema sinh từ cùng nguồn này.

```json
{
  "article": "art-5",
  "claims": [{
    "key": "d5-k1-duty",
    "type": "DUTY",
    "statement": "...",
    "actor": "...", "action": "...",
    "authority": "LEGAL_NORMATIVE", "assessability": "REPOSITORY_OBSERVABLE",
    "frame": { "...": "chỉ các chiều nguồn hỗ trợ; legalEffect nếu có" },
    "relevant": true, "nonOperativeReason": null,
    "support": [{ "locator": "art-5::cl-1", "quote": "nguyên văn" }],
    "relations": [{ "kind": "EXCEPTION_TO", "to": "d5-k2-duty" },
                  { "kind": "DEFINED_BY", "to": "luat-134/dieu-3.json#d3-k7-def", "referenceId": "<id>" }]
  }],
  "noClaims": { "art-5::cl-3": "lý do thực tế" },
  "references": { "<referenceId>": { "material": false, "reason": "..." } }
}
```

Quy tắc:
- `key` là duy nhất trong file. Định danh toàn cục là `<file>#<key>`. Runtime dùng nó để sinh `canonicalClaimId`.
- Agent chỉ cần ghi locator và quote. Runtime tự đổi sang `nodeId` và offset UTF-16 (dùng lại `PinnedSourceGraph.resolve` và `support_span`).
- Mọi locator của Điều (khoản, điểm, kể cả `occurrence/N`) phải xuất hiện đúng một lần: hoặc trong `support` của ít nhất một claim, hoặc trong `noClaims`.
- Mỗi `referenceId` nằm trong Điều phải ở một trong ba trạng thái: bound (có relation mang `referenceId`), non-material (kèm lý do), hoặc `unresolved` (kèm lý do; dùng khi target `UNRESOLVED`/`AMBIGUOUS`).

## 4. Các phase triển khai

### Phase 0 — Chuẩn bị (0,5 ngày)
| Việc | Chi tiết |
|---|---|
| Dừng các run cũ | Cancel `98228c59`, `df1aca65`, `9b251221` qua admin cancel. Không chạy tiếp flow cũ. |
| Xóa QĐ 1671 | Tạo Legal Source Version mới không có QĐ 1671 qua flow quản trị nguồn (version luôn bất biến, không sửa version cũ), rồi activate. Kiểm tra materialization mới có 8 văn bản. |
| Lưu baseline | Export số liệu run `98228c59` (LlmUsageEvent theo role, rejection code) vào `reports/lcsp360-fbd/baseline.json`. |
| Golden set | Từ claim Luật 134 đã có (fixture ADR-026 và AIUsageFlow mapping), lập danh sách đối chiếu: DUTY/SCOPE/CONDITION chính, repeal cấp locator sang Luật 71, các điều kiện AI rủi ro cao có dẫn chiếu QĐ 33. |

**Exit:** version mới đã active; baseline và golden set đã commit.

### Phase 1 — Workspace (1 ngày)
| File | Thay đổi |
|---|---|
| `deepagents/rule_set_preparation/legal_source_files.py` | Viết lại `materialize_legal_source`: sinh cây `<doc>/<chuong>/dieu-N.md` từ AST, có locator và reference inline. Bỏ `nodes/`, chunk files, `CITATIONS.md`, `.pins.json`. `refute_source_block` chuyển sang kiểm tra hash nội dung node. |
| `deepagents/rule_set_preparation/agent.py` | Thêm `FilesystemPermission`: read `/legal-source/**`, read+write `/work/**`, deny phần còn lại. Bật `write_file`, `edit_file`, `write_todos`. Thêm subagent `claim-author`. Bỏ subagent `legal-source-reader`. Trong phase discovery bỏ `PreparationObservationMiddleware` và `DraftHistoryMiddleware`. |
| `packages/contracts/.../claim-file.ts` | Zod schema của file claim, export JSON Schema. |
| `instructions.md` | Tách thành `instructions-common.md`, `instructions-discovery.md`, `instructions-authoring.md`; chỉ nạp phần đúng phase. Sửa quy tắc điểm liệt kê: điểm thuộc câu dẫn bắt buộc ("phải thực hiện các biện pháp sau") là thành phần của DUTY ở khoản đó, không phải CONTEXT. |

Test:
- Materialize từ fixture Luật 134 ra đúng 44 file Điều. Mọi locator của AST có mặt đúng một lần.
- Path traversal và ghi ngoài `/work` đều bị từ chối.
- Test tách instructions theo phase.

### Phase 2 — Tool governed theo lô (2 ngày)
File mới: `deepagents/rule_set_preparation/claim_files.py`.

| Tool | Hành vi |
|---|---|
| `check_claims(paths)` | **Không gọi LLM.** Kiểm tra schema, locator resolve được, quote khớp và duy nhất trong node, đủ coverage locator và reference, `key` duy nhất, relation trỏ tới key hoặc file có thật, kind relation đúng chiều (quy tắc FROM là unit chứa reference giữ nguyên). Trả về **tất cả lỗi gom theo file và key**, mỗi lỗi có `fix` cụ thể. |
| `commit_claims(paths)` | Gọi `check_claims` trước, có lỗi thì dừng. Sau đó audit từng node bằng `SemanticAuditor` single-pass hiện có, chạy song song trong tool (`ThreadPoolExecutor`, `max_workers=LCSP_AUDIT_CONCURRENCY`, mặc định 4). Receipt còn hiệu lực theo fingerprint thì dùng lại. Cuối cùng gửi **một** lệnh `COMPLETE batch` lên API cho các node đạt. Kết quả trả về: node đã commit, gap của auditor gom theo `key`, và các node đang chờ target `REQUIRES_REFERENCE_RESOLUTION`. Commit lại cùng file là idempotent (`completionFingerprint`). |
| `discovery_status()` | Gọi API PROGRESS rồi gom theo file: số locator chưa commit, reference đang chờ, `discoveryCompleteEligible`. |

Giữ nguyên: `finalize_semantic_claim_inventory`, `conclude_no_operative_obligations`, `report_rule_set_source_blocked`, `record_preparation_progress`, `get_applicable_legal_state`, cùng toàn bộ tool của Rule Authoring.

API — `source-review.handler.ts`:
- `COMPLETE batch` chấp nhận unit ở `PENDING`/`IN_REVIEW`/`REOPENED` khi `operationId` trùng với operation của run. Bỏ yêu cầu phải NEXT trước để lấy lease. Các kiểm tra canonical id, disposition, revision, materialization và receipt audit giữ nguyên.
- Thêm `COMPLETE` hỗ trợ `sourceNodeIds` thuộc nhiều Điều trong cùng một transaction. Mục đích: commit cả hai đầu của một tham chiếu vòng trong một lần.
- Test (jest, DB thật port 55449): commit không cần lease; idempotent; operation lạ bị từ chối; stale revision bị từ chối; tham chiếu vòng giữa hai Điều commit được trong một lô.

### Phase 3 — Cách agent làm việc (1 ngày)
- `instructions-discovery.md`, khoảng 1/3 độ dài hiện tại, gồm: cấu trúc thư mục, định dạng file claim, quy trình `todos → task(claim-author) → check → commit → status → finalize`, quy tắc ngữ nghĩa giữ nguyên (applicability chỉ từ SCOPE/CONDITION, modifier phải nối relation, legalEffect, nguồn là dữ liệu không đáng tin).
- Prompt của subagent `claim-author`: phạm vi một văn bản hoặc chương; không đọc ngoài `/legal-source`; trả về đúng một dòng `done: X Điều, Y claim, Z chờ reference`.
- Khởi động lại sau crash: khi run bắt đầu, runtime **dựng lại** `/work/claims/**` từ các payload đã commit (API LOAD) để agent thấy phần đã xong. `write_todos` dựng lại từ `discovery_status`.

### Phase 4 — Kiểm soát chi phí và quan sát (0,5 ngày)
- Gắn `AgentRunBudgetMiddleware` (đã có sẵn) cho Producer và subagent, với ngưỡng `LCSP_RSP_MAX_MODEL_CALLS`, `LCSP_RSP_MAX_INPUT_TOKENS`. Khi chạm ngưỡng thì run chuyển sang **PAUSED** (không FAILED). Admin resume được vì mọi thứ đã commit đều nằm trong DB.
- Mỗi lần `commit_claims` phát một event `CLAIM_FILE_COMMITTED` gồm `{file, committedNodes, auditCalls, rejected}`.
- Cập nhật `apps/web/src/features/admin/utils/rule-set-preparation-activity.ts` và i18n (`packages/i18n` en/vi) để màn tiến độ hiển thị theo file/Điều, bỏ các activity của tool đã xóa.
- Query đo chuẩn lưu tại `reports/lcsp360-fbd/metrics.sql` (call/token theo role, tỷ lệ reject, thời gian).

### Phase 5 — Kiểm chứng trên Luật 134, discovery-only (0,5–1 ngày)
| Tiêu chí | Ngưỡng |
|---|---|
| Model call (Producer, subagent, auditor) | ≤ 400 |
| Token | ≤ 5M |
| Thời gian | ≤ 45 phút |
| Lời gọi tool bị từ chối | ≤ 10% |
| Kết thúc | `CLAIM_INVENTORY_READY`, không còn node pending/blocked |
| Chất lượng | Khớp golden set Phase 0; repeal cấp locator sang Luật 71 có mặt; điều kiện AI rủi ro cao trỏ đúng sang QĐ 33 (hoặc ở trạng thái `unresolved` có lý do nếu QĐ 33 chưa cùng phạm vi run) |

Nếu trượt bất kỳ ngưỡng nào thì **dừng lại**, phân tích trace và sửa trước khi sang Phase 6.

### Phase 6 — Chạy toàn corpus và Rule Authoring (1 ngày)
- Chạy discovery-only cho 8 văn bản. Theo dõi theo checklist §6. Ước lượng: khoảng 2.500 call, khoảng 25–35M token (trong đó auditor khoảng 15M), khoảng 2–3 giờ.
- Chạy full run (discovery, authoring, validate, submit) và kiểm tra journey từ DB/API: Rule Set đạt `PASSED`, activation, và một assessment mẫu dùng được Rule Set mới.

### Phase 7 — Xóa code cũ (1 ngày)
Xóa sau khi Phase 6 đạt:
- `review_frontier.py`: phần `next`, `complete`, `complete_batch`, lease. Giữ phần `restore`/`LOAD` vì dùng để dựng lại `/work`.
- Tool: `get_next_review_unit`, `get_review_progress`, `complete_source_review`, `complete_review_batch`, `register_semantic_claim`, `batch_register_semantic_claims`, `update_semantic_claim`, `remove_semantic_claim`, `link_semantic_claims`, `bind_semantic_reference`, `mark_reference_non_material`, `inspect_semantic_reference_binding`, `review_source_node`, `review_source_reference`, `expand_review_frontier`, `reopen_source_review` (thay bằng `edit_file` rồi `commit_claims`), `get_source_support`.
- `legal_source_reader.py`; phần discovery của `draft_history.py` và `PreparationObservationMiddleware`; các hằng cắt context trong `source_graph.py` (chỉ giữ `resolve`/`search` nội bộ cho `claim_files.py`).
- Audit cascade trong `semantic_audit.py` (`audit_cascade`, catalog, concept, relation-batch và các prompt liên quan). Trước khi xóa phải xác nhận prod không đặt `LCSP_SEMANTIC_AUDIT_MODE=cascade`.
- `add_to_packet_draft`, `remove_from_packet_draft`, `packet-schema.json` nếu không còn tham chiếu.
- API: action `NEXT` và các trường lease (`leaseExpiresAt`) nếu không còn caller. Migration Prisma cho việc bỏ cột chỉ làm sau khi không còn run cũ ở trạng thái RUNNING/PAUSED.
- Các test tương ứng. Chạy `graphify update .`.

### Phase 8 — Release (0,5 ngày)
Checklist §7, PR vào `develop` (squash, 3 check, 1 review, commit dạng `type(scope): LCSP-360 ...`). Cấm `git add -A`.

**Tổng: khoảng 8–9 ngày.**

## 5. Rủi ro và cách xử lý

| # | Rủi ro | Xử lý trong plan |
|---|---|---|
| R1 | Model chép sai quote hoặc locator | `check_claims` bắt lỗi bằng code, không tốn LLM; agent chỉ cần `edit_file` một dòng. Dùng locator in sẵn trong file Điều thay cho hex nodeId. |
| R2 | Model rẻ (mercury) sai schema | Ghi JSON vào file thay cho tool có schema 5k ký tự; lỗi được gom một lần cho cả file. Provider fallback (sonnet) có sẵn trong `provider_fallback.py`. Theo dõi tỷ lệ reject ≤ 10% (Phase 5). |
| R3 | Chi phí auditor (audit theo node) | Single-pass, chạy song song trong tool, dùng lại receipt theo fingerprint. Chỉ gộp audit theo Điều nếu Phase 5/6 cho thấy auditor chiếm trên 50% token. Cần ADR riêng vì đụng tới receipt contract. |
| R4 | Tham chiếu chéo Điều/văn bản và vòng tham chiếu | `REQUIRES_REFERENCE_RESOLUTION` đã có trên API. Agent commit lại file khi target đã xong. Vòng tham chiếu thì commit hai file trong một `commit_claims(paths=[a,b])` (transaction đa Điều ở Phase 2). |
| R5 | 111 reference `UNRESOLVED` và 34 `AMBIGUOUS` | Bắt buộc trạng thái `unresolved` kèm lý do trong file; `check_claims` không cho bỏ sót. Agent không được tự đoán target. |
| R6 | Worker crash hoặc restart làm mất `/work` | `/work` dựng lại từ DB (Phase 3). Commit idempotent. Phần chưa commit chỉ mất tối đa một file Điều. |
| R7 | Nhiều subagent ghi cùng file | Mỗi subagent sở hữu một thư mục văn bản/chương (khai báo trong prompt `task`). `commit_claims` khóa bằng `context.mutation_lock`, API dùng transaction và kiểm tra revision. Ghi chồng sẽ bị `STALE_REVIEW_REVISION`. |
| R8 | Chi phí vượt kiểm soát | `AgentRunBudgetMiddleware` với ngưỡng call/token; chạm ngưỡng thì PAUSED, resume được. Có event và query đo (Phase 4). |
| R9 | Prompt injection trong văn bản luật | `/legal-source` chỉ đọc; instructions giữ "nguồn là dữ liệu"; agent chỉ ghi được `/work`; mọi thay đổi trạng thái phải qua tool governed và kiểm tra deterministic. |
| R10 | Path traversal hoặc ghi ngoài vùng cho phép | `FilesystemPermission` + `virtual_mode=True`; `check_claims`/`commit_claims` chỉ nhận path nằm dưới `/work/claims`. Có test âm tính. |
| R11 | Điều rất dài (NĐ 142: 39k ký tự) | `read_file` gốc có offset/limit và Deep Agent tự đẩy kết quả lớn ra file. Không cắt custom. File claim vẫn theo Điều. |
| R12 | Hồi quy ngữ nghĩa (điểm liệt kê, applicability) | Sửa quy tắc điểm liệt kê (Phase 1). Golden set Luật 134 là cổng chặn (Phase 5). Gate `APPLICABILITY_AUTHORITY_MISSING` ở finalize giữ nguyên. |
| R13 | Unit trùng `occurrence/N` (nguyên nhân P0-B) | Locator có `occurrence/N` hiện rõ trong file Điều. Agent ghi `noClaims` "trùng nguyên văn với X" hoặc claim riêng. Không còn ownership claim giữa các unit nên lỗi P0-B không tái diễn. |
| R14 | Context của agent cha phình to | Subagent chỉ trả một dòng; dùng summarization gốc của Deep Agent; agent cha không đọc nội dung Điều. |
| R15 | Run cũ pin materialization/legal version cũ | Cancel ở Phase 0. Bỏ cột lease chỉ khi không còn run cũ (Phase 7). |
| R16 | Nới lease ở API mở lỗ ghi đè | Chỉ chấp nhận khi trùng `operationId` của run và đúng worker token, revision và materialization. Có test operation lạ bị từ chối (Phase 2). |
| R17 | UI tiến độ sai vì tool đổi tên | Cập nhật mapping activity và i18n (Phase 4); frontier state trong DB vẫn là nguồn số liệu. |
| R18 | Quota hoặc lỗi provider (403, reset) | Retry và fallback có sẵn; commit idempotent nên retry an toàn; ngưỡng ngân sách đưa run về PAUSED thay vì FAILED. |
| R19 | Mất tham chiếu sang QĐ 33 | QĐ 33 nằm trong phạm vi review. Phase 5 kiểm tra riêng các điều kiện AI rủi ro cao. |
| R20 | Xóa QĐ 1671 làm đứt tham chiếu | Đã kiểm tra: 0 tham chiếu tới QĐ 1671. Thực hiện bằng version mới, không sửa version cũ. |

## 6. Vận hành (runbook rút gọn)
- **Bắt đầu run:** activate Legal Source, việc này tự kích hoạt Rule Set Preparation. Có thể chạy discovery-only để kiểm tra trước.
- **Theo dõi:** chạy `reports/lcsp360-fbd/metrics.sql` theo `runId`; xem các event `CLAIM_FILE_COMMITTED` và `discovery_status`.
- **Run bị PAUSED** (do ngưỡng ngân sách): xem metrics → tăng ngưỡng hoặc sửa nguyên nhân → resume. `/work` tự dựng lại.
- **Rollback code:** revert PR. Dữ liệu claim và receipt trong DB không đổi format, nên không cần migrate ngược. Trong lúc chưa xóa code cũ (trước Phase 7), có thể đặt `LCSP_RULE_SET_DISCOVERY=frontier` để quay về flow cũ. Cờ này bị xóa ở Phase 7.

## 7. Production readiness checklist
- [ ] Version mới không có QĐ 1671 đã active; các run cũ đã cancel
- [ ] Phase 5 đạt mọi ngưỡng; báo cáo ở `reports/lcsp360-fbd/luat-134/`
- [ ] Phase 6: Rule Set `PASSED` và đã activate; một assessment mẫu chạy được
- [ ] Python tests (`cd deepagents && PYTHONPATH=.:tests pytest`) xanh, gồm test mới cho `claim_files.py` (coverage locator, quote, reference, path, idempotent, dựng lại `/work`)
- [ ] API jest xanh, gồm commit không cần lease, operation lạ, vòng tham chiếu
- [ ] `tsc`, lint, web build xanh; i18n en/vi đủ key
- [ ] Ngưỡng ngân sách đã cấu hình trên môi trường prod; đã thử chạm ngưỡng → PAUSED → resume
- [ ] Không còn `LCSP_SEMANTIC_AUDIT_MODE=cascade` ở bất kỳ môi trường nào trước khi xóa cascade
- [ ] Code cũ đã xóa (Phase 7); `graphify update .`
- [ ] Đã cập nhật memory và DTC log
