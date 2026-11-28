# Assessment Antigravity Work-Package Prompts

> Mục đích: cung cấp các prompt độc lập để điều phối Antigravity xử lý những finding trong `assessment-module-audit-red-test-handoff.md` theo SDLC và TDD.
>
> Cách dùng: paste **Prompt 0** trước để thiết lập team. Sau đó paste lần lượt từng work package vào **cùng một conversation Antigravity**. Chỉ chuyển sang prompt tiếp theo sau khi package hiện tại đã hoàn tất và có execution receipt.
>
> Điểm dừng: Antigravity chỉ sửa và kiểm chứng local; không commit, push hoặc tạo PR. Sau Prompt 10, chuyển kết quả cho Codex review độc lập.

## Theo dõi tiến độ

- [ ] Prompt 0 — Khởi tạo team và quy trình
- [ ] Prompt 1 — Ownership và rename concurrency
- [ ] Prompt 2 — ADMIN metadata-only boundary
- [ ] Prompt 3 — Final-report lifecycle và error classification
- [ ] Prompt 4 — RBAC audit resilience và canonical AuditEvent
- [ ] Prompt 5 — Correlation ID xuyên suốt execution
- [ ] Prompt 6 — Export idempotency concurrency
- [ ] Prompt 7 — Legal-search normalization
- [ ] Prompt 8 — Shared-wallet actual usage, telemetry calibration và admin runtime override
- [ ] Prompt 9 — Refactor report-only sau behavioral fixes
- [ ] Prompt 10 — Integration QA và gói bàn giao review

## Prompt 0 — Khởi tạo team và quy trình

```text
/teamwork

Bạn là Coordinator cho đợt sửa Assessment module của LCSP.

Trước khi làm việc:
1. Đọc toàn bộ AGENTS.md ở root và AGENTS.md của apps/api, deepagents, packages/contracts nếu đụng tới.
2. Đọc .agents/memory/lessons-learned.md.
3. Đọc docs/architecture/assessment-module-audit-red-test-handoff.md.
4. Dùng Graphify query/path/explain trước khi tự quét source.
5. Kiểm tra git status và bảo toàn mọi thay đổi đang có của user.

Tạo team với các role:
- Requirement/Architect: dùng bmad-agent-architect, bmad-spec hoặc bmad-architecture.
- Implementation: dùng bmad-agent-dev, lcsp-module-refactor-cleaner và clean-architecture skill phù hợp.
- Security Reviewer: dùng lcsp-security-production-grade.
- Independent Reviewers: dùng bmad-code-review, bmad-review-edge-case-hunter và bmad-review-adversarial-general.
- QA/Test Architect: dùng bmad-tea và bmad-testarch-atdd/automate khi phù hợp.

Quy trình bắt buộc cho mỗi work package:
Requirement → Acceptance criteria → RED test → xác nhận RED → Implementation tối thiểu → Review độc lập → QA GREEN → lặp lại nếu còn finding.

Quy tắc:
- Không sửa production trước khi có test tái hiện và đã quan sát RED.
- Mỗi bug phải báo rõ hai mục “Root cause” và “Fix”.
- Business function bị sửa phải có documentation năm phần và explanatory comments theo AGENTS.md.
- Không đổi/xóa expectation hợp lệ để làm test xanh.
- Chỉ dùng RBAC; không thêm PBAC hoặc organization.
- Không triển khai worker-key rotation. Hệ thống giữ một WORKER_API_KEY.
- Không thay đổi các accepted design ASM-03, ASM-07, ASM-14, ASM-18.
- Không tự commit, push hoặc tạo PR.
- Không cập nhật audit report thành GREEN; chỉ trả execution receipt trong câu trả lời để Codex review độc lập sau.
- Nếu requirement thực sự mơ hồ và có thể làm thay đổi nghiệp vụ, dừng và báo blocker; không tự quyết định.

Chưa sửa code. Chỉ trả lại:
- Danh sách team/role.
- Thứ tự work package.
- Các file dirty cần bảo toàn.
- Xác nhận đã hiểu các finding bị rút, superseded và withdrawn.
```

## Prompt 1 — Ownership và rename concurrency

```text
/teamwork

Thực hiện Work Package 1 theo protocol đã thiết lập:

Phạm vi:
- ASM-05 / ASM-OWNER-01: ownership race trong delete row lock.
- ASM-06 / ASM-OWNER-02: customer detail query phải owner-scope ngay tại persistence boundary.
- ASM-11/12/13 / ASM-RENAME-01/02/03: lost update, resurrection do upsert và updatedAt không được persist.

Yêu cầu:
1. Requirement agent xác nhận acceptance criteria và các transaction/security invariant.
2. QA chạy riêng các RED tests hiện có và ghi lại failure:
   - delete-assessment.handler.spec.ts
   - assessment-detail.loader.spec.ts
   - prisma-assessment.repository.red.spec.ts
3. Implementation:
   - Delete lock phải scope theo assessment ID và actor owner; ownership race phải dừng trước mọi side effect và trả masked 404.
   - Customer detail initial query phải có ID + owner ID.
   - Tách create path và update-only path; rename tuyệt đối không dùng upsert.
   - Rename phải có owner-scoped CAS/revision boundary để stale writer bị từ chối.
   - Persist updatedAt/revision mới.
   - Rename và canonical audit phải giữ tính atomic trong cùng transaction.
4. Security reviewer kiểm tra BOLA, row-lock DoS, stale authorization và concurrent delete/rename.
5. Edge-case reviewer kiểm tra create mới, deleted row, same-timestamp concurrency, audit rollback và retry.
6. QA chạy lại targeted tests, adjacent create/rename/delete tests, typecheck và các check bắt buộc của AGENTS.
7. Chạy graphify update . sau khi source ổn định.

Không đụng ADMIN metadata behavior trong package này ngoài việc tránh làm hỏng package kế tiếp.

Kết thúc bằng:
- Root cause/Fix cho từng ASM.
- File đã đổi.
- Bằng chứng RED và GREEN kèm command/exit code.
- Review findings đã xử lý và rủi ro còn lại.
- Không commit/push/PR.
```

## Prompt 2 — ADMIN metadata-only boundary

```text
/teamwork

Thực hiện Work Package 2 cho ASM-23 và ASM-ADMIN-01..04.

Acceptance contract:
- CUSTOMER chỉ đọc assessment của chính mình và được dùng customer content projection.
- ADMIN chỉ đọc metadata vận hành: assessment_id, owner_id, name, lifecycle/execution state và timestamps.
- ADMIN không được hydrate hoặc nhận case, evidence, final report, provenance hay runtime event payload.
- Provenance và customer content-rich SSE phải loại ADMIN.
- Quyền metadata không tự động cấp quyền mutation.

Quy trình:
1. Requirement/Architect mô tả rõ hai read model và endpoint/role matrix.
2. Chạy bốn RED tests hiện có trước khi sửa:
   - ASM-ADMIN-01/02 trong assessment-detail.loader.spec.ts.
   - ASM-ADMIN-03/04 trong assessment-admin-rbac.red.spec.ts.
3. Implement projection/query riêng cho admin metadata; không giả mạo admin thành owner.
4. Giữ customer query owner-scoped tại database boundary.
5. Loại ADMIN khỏi provenance và content-rich stream role decorators.
6. Security review kiểm tra data minimization, BOLA và accidental nested include.
7. Adversarial/edge review kiểm tra pagination, missing row, foreign owner, mixed roles và serialization leak.
8. QA chạy targeted và adjacent controller/loader tests đến GREEN, rồi typecheck/checks bắt buộc.
9. Chạy graphify update ..

Không thêm PBAC hoặc organization.

Trả execution receipt đầy đủ, không sửa audit report, không commit/push/PR.
```

## Prompt 3 — Final-report lifecycle và error classification

```text
/teamwork

Thực hiện Work Package 3 cho ASM-16, ASM-17 và các test ASM-REPORT-01A/B/C/D, ASM-REPORT-02.

Quan trọng:
- Test ASM-REPORT-01 cũ yêu cầu compensating erase đã superseded.
- Trước production change, rewrite test cũ thành contract A/B/C/D và xác nhận các test mới RED.
- Không triển khai xóa bù shared content-addressed chunks.

Thiết kế bắt buộc:
1. Transaction 1 tạo authoritative artifact ở BUILDING.
2. Ghi và verify object storage đồng bộ trong chính request của user.
3. Transaction 2 lock/revalidate BUILDING rồi chuyển artifact ACTIVE và assessment COMPLETE atomically.
4. Retry cùng requestDigest phải resume cùng artifact ID, không tạo artifact thứ hai.
5. Digest khác khi có BUILDING tương ứng phải trả safe 409.
6. Activation failure phải để lại BUILDING row có hash/manifest để retry.
7. Loader chỉ phục vụ ACTIVE; BUILDING/INVALID không trả content.
8. Integrity/schema/hash mismatch trả 409.
9. Storage/DB dependency unavailable hoặc timeout trả safe 503.
10. Unexpected internal failure trả masked 500; không leak path, hostname hoặc raw exception.

Team workflow:
- Architect lập state-transition table và failure matrix trước.
- QA viết/rewrite tests, chạy và xác nhận RED.
- Dev triển khai tối thiểu theo synchronous two-phase.
- Security reviewer kiểm tra integrity, idempotency, data retention và error masking.
- Edge reviewer kiểm tra crash ở từng phase, concurrent same/different digest, retry và shared chunks.
- QA chạy targeted submit/loader specs và adjacent report tests đến GREEN.
- Chạy typecheck, business-doc, architecture/import checks và graphify update ..

Không chuyển happy path thành background generation.

Trả Root cause/Fix, state transitions, RED/GREEN receipts, file list và remaining risks. Không sửa report, commit, push hoặc PR.
```

## Prompt 4 — RBAC audit resilience và canonical AuditEvent

```text
/teamwork

Thực hiện Work Package 4 cho ASM-04, ASM-08, ASM-RBAC-01/02 và ASM-AUDIT-01.

Test normalization:
- ASM-RBAC-01/02 hiện tại đã superseded.
- Rewrite trước production change:
  - ALLOW cho read thông thường vẫn tiếp tục khi primary audit lỗi, nhưng phải có durable fallback + metric + alert/degraded signal.
  - DENY vẫn phải bị từ chối; audit failure không bao giờ biến DENY thành ALLOW.
- Chạy tests mới và xác nhận RED.
- ASM-AUDIT-01 hiện có phải giữ nguyên contract hợp lệ.

Implementation contract:
- Không fail-closed đồng loạt mọi GET.
- Authorization audit failure không được chỉ log rồi nuốt.
- Durable fallback phải có khả năng retry/recovery; không dùng in-memory-only fallback.
- Sensitive download/export không được trả bytes nếu business audit thất bại.
- Mutation, canonical AuditEvent và outbox phải atomic khi cùng một business transaction.
- AssessmentEvent, AuditEvent và outbox là ba trách nhiệm khác nhau.
- Audit payload phải sanitized và giữ correlation ID.
- Không thêm PBAC.

Review:
- Security reviewer kiểm tra audit bypass, audit DoS, fail-open/fail-closed boundary và secret/PII leakage.
- Adversarial reviewer mô phỏng primary audit down, fallback down, duplicate retry, DENY và transaction rollback.
- QA chạy RBAC guard/preflight, event appender và adjacent audit tests đến GREEN.
- Chạy required checks và graphify update ..

Trả rõ architecture của fallback, metric/alert signal, RED/GREEN evidence và review findings. Không sửa report, commit, push hoặc PR.
```

## Prompt 5 — Correlation ID xuyên suốt execution

```text
/teamwork

Thực hiện Work Package 5 cho ASM-09 / ASM-TRACE-01 trong deepagents.

Contract:
- Một Root execution phải reuse cùng x-correlation-id cho context, rule-set, evidence, retry và các HTTP call liên quan.
- HTTP retry trong cùng execution không được sinh correlation ID mới.
- Execution boundary mới phải có correlation ID mới.
- Worker API key và lease token không được log hoặc đưa vào error.
- NestJS nhận đúng header hiện có; không phát minh header contract mới.

Quy trình:
1. Đọc deepagents/AGENTS.md và dùng lcsp-python-clean-architecture.
2. Chạy test ASM-TRACE-01 và xác nhận RED.
3. Requirement agent xác định chính xác lifecycle của AssessmentRuntimeClient và execution boundary.
4. Implement thay đổi nhỏ nhất để correlation ID sống đúng phạm vi.
5. Review thread safety, client reuse, retry và accidental cross-execution reuse.
6. Chạy targeted pytest đến GREEN và các adjacent runtime-client tests.
7. Chạy Python lint/type checks áp dụng cho file thay đổi và graphify update ..

Trả Root cause/Fix, RED/GREEN receipt và file list. Không commit/push/PR.
```

## Prompt 6 — Export idempotency concurrency

```text
/teamwork

Thực hiện Work Package 6 cho ASM-15 / ASM-EXPORT-01.

Contract:
- Concurrent requests có cùng (requestId, idempotencyKey) phải trả/replay cùng committed export metadata.
- Chỉ Prisma P2002 của đúng composite unique này mới được xem là idempotent loser.
- P2002 từ constraint khác phải được throw bình thường.
- Sau conflict phải reload winner; nếu winner không tồn tại thì rethrow lỗi gốc.
- Không tạo duplicate export hoặc duplicate side effect.
- Audit/correlation metadata phải giữ nguyên invariant.

Quy trình:
1. Chạy ASM-EXPORT-01 và xác nhận RED.
2. Architect xác nhận exact Prisma error shape/constraint target đang dùng.
3. Dev triển khai exact-conflict classifier và winner reload.
4. Edge reviewer kiểm tra concurrent create, missing winner, wrong constraint, retry và transaction visibility.
5. Security reviewer kiểm tra không che giấu lỗi integrity khác dưới dạng replay.
6. QA chạy targeted service spec và adjacent export tests đến GREEN.
7. Chạy required checks và graphify update ..

Trả Root cause/Fix và execution receipt. Không sửa report, commit, push hoặc PR.
```

## Prompt 7 — Legal-search normalization

```text
/teamwork

Thực hiện Work Package 7 cho ASM-19 / ASM-LEGAL-01.

Contract:
- Unicode normalize NFKC, trim và case-normalize trước dedupe.
- Loại bỏ term rỗng sau normalize.
- Áp dụng MAX_TERMS sau dedupe, không phải trước.
- Register/register/REGISTER chỉ chiếm một term.
- Kết quả normalization phải deterministic, không phụ thuộc locale máy chạy.
- Không thay đổi rule-set pinning hoặc biến search thành semantic/vector search trong package này.

Quy trình:
1. Chạy ASM-LEGAL-01 và xác nhận RED.
2. Bổ sung boundary tests cho whitespace, Unicode compatibility forms, empty terms, duplicate variants và MAX_TERMS.
3. Implement normalization tại một boundary duy nhất.
4. Review query semantics, AND-clause construction và performance.
5. QA chạy targeted + adjacent search tests đến GREEN.
6. Chạy checks bắt buộc và graphify update ..

Trả Root cause/Fix và RED/GREEN evidence. Không commit/push/PR.
```

## Prompt 8 — Direct-credit shared-wallet settlement, pricing management, telemetry và admin override

> Quyết định cập nhật: no-progress là telemetry chẩn đoán, không là blocker/điều kiện Admin mở khóa. Admin điều tra lỗi assessment qua audit và telemetry đã redacted; timeline theo assessment/run/correlation là follow-up riêng, không giả định endpoint hiện có đã hỗ trợ đầy đủ.

```text
/teamwork

Thực hiện Work Package 8 cho ASM-24; viết mới ASM-PRICING-01..04, ASM-BUDGET-01..05 và ASM-USAGE-01..04 theo TDD.

Trước khi code:
- Architect map payment confirmation, shared wallet, usage receipt, pricing snapshot, ledger, runtime model allowlist, model-call boundary, runtime checkpoint và admin override hiện có.
- Không xây payment-to-runtime-allocation flow. Confirmed payment chỉ credit ví prepaid chung; mọi assessment của customer dùng chung wallet.
- Giữ quy đổi top-up hiện tại `1 VND = 1 public credit`. Runtime tuyệt đối không dùng USD/VND, FX hoặc multiplier `1.8` để settlement.
- Không tự phát minh số tariff ban đầu. Có thể viết contract RED tests, nhưng chưa triển khai/bật MODEL_USAGE_DEBIT production cho tới khi mọi enablement gate cuối prompt được đóng.
- Paid-tool billing nằm ngoài WP8; chỉ triển khai MODEL_USAGE_DEBIT.

Pricing contract:
1. Internal accounting dùng integer microcredits: `1 public credit = 1_000_000 microcredits`; wire format customer là decimal string canonical với đúng tối đa 6 chữ số thập phân, không exponent/JS number, và `parse(format(microcredits))` phải giữ nguyên giá trị.
2. Immutable pricing snapshot định giá trực tiếp từng token bucket bằng microcredits/token. Snapshot không chứa runtime FX conversion hoặc runtime markup.
3. Pricing scope gồm EXACT_MODEL, PROVIDER_DEFAULT và GLOBAL_DEFAULT. Resolution order cố định: exact model → provider default → global default → reject trước provider call.
4. Fallback chỉ áp dụng cho resolved model có trong runtime model allowlist. Model lạ hoặc lỗi chính tả không được hợp thức hóa bằng global default.
5. Admission lưu requestedModel, resolvedModel, pricingSnapshotId và pricingResolution. Snapshot được pin theo từng physical invocation và không đổi nếu Admin publish giá mới trong lúc call đang chạy.
6. Assessment có thể đổi model/provider/pricing version giữa các call. Mỗi physical provider call có invocationId và settlement độc lập; assessment total chỉ là aggregate read model.
7. Admin Model Pricing dùng RBAC ADMIN-only, không PBAC/organization; có list/detail/create/update draft, publish, preview và supersede. `ModelPricingDraft` được sửa nhưng không billable; publish copy sang immutable `ModelPricingSnapshot` append-only.
8. Scheduling/activation là versioned assignment/interval riêng tham chiếu snapshot immutable. SCHEDULED/ACTIVE/SUPERSEDED là derived read status, không update snapshot. Dùng database UTC clock, half-open interval `[effectiveFrom,effectiveTo)`, serialized publish transaction và database constraint để không overlap trong cùng normalized scope key.
9. Admin preview phải gọi cùng canonical pricing calculator với settlement. Publish có idempotencyKey/requestFingerprint; snapshot assignment và canonical AuditEvent commit atomically. Fallback usage được ghi pricingResolution và tổng hợp thành PRICING_FALLBACK_USED.
10. Token bucket policy khai báo tường minh: SEPARATE_RATE, USE_OUTPUT_RATE, INCLUDED_IN_OUTPUT hoặc UNSUPPORTED. Không tự coi missing rate là zero.

Wallet và settlement contract:
11. Customer không được gửi raw model-call/token allowance và không gọi admin override route.
12. Confirmed payment credit shared wallet đúng một lần; retry cùng payment/ledger ID không double-credit và không tạo runtime extension.
13. Không tạo per-assessment allocation, reservation/hold hoặc refund-unused-reservation. Billing debit actual usage sau từng physical model call, không chờ assessment hoàn thành.
14. Trước paid call, server-issued admission atomically kiểm tra spendable credits > 0, runtime state, active execution lease, runtime allowlist, pricing resolution và wallet in-flight slot; admission persist maximumExposureMicrocredits được canonical calculator suy ra từ pinned tariff cùng input/context/output hard bounds.
15. Pilot dùng `maxInFlightBillableInvocationsPerWallet = 1`; đây là concurrency guard, không giới hạn số assessment, không reserve/trừ credits và không được mô tả là tự nó giới hạn monetary exposure. Provider usage vượt admitted maximum exposure chuyển billing-integrity review, không âm thầm mở rộng debt.
16. Settlement atomic ghi immutable usage receipt + MODEL_USAGE_DEBIT ledger entry + signed wallet projection + billing outbox event + terminal wallet-slot transition dưới cùng wallet lock/version. Idempotency key/fingerprint dựa trên physical invocationId; replay khác payload trả conflict.
17. Settlement authority bắt buộc load immutable server admission bằng invocationId và derive userId, walletId, assessment/run/lease, provider, resolved model, pricing snapshot/resolution và policy version; callback không được override các field này hoặc charge amount. Missing/foreign/expired/mismatched admission fail closed không ghi financial state; unbound callback tối đa chỉ được quarantine làm non-billable telemetry.
18. Invocation in-flight vẫn settle dù làm ledgerBalance âm trong admitted maximum exposure. Customer projection: spendableCredits=max(balance,0), outstandingCredits=max(-balance,0). Top-up bù âm trước, không lãi/phạt và không tự resume.
19. Wallet <= 0 chặn paid call mới; read/download/report cũ vẫn hoạt động. Assessment của call gây depletion checkpoint PAYMENT_REQUIRED; assessment khác tự checkpoint khi paid admission kế tiếp bị từ chối.
20. Customer chủ động Continue sau top-up; Continue kiểm tra lại wallet và các runtime safety gates còn hiệu lực. Không triển khai NO_PROGRESS_LIMIT_EXCEEDED như assessment blocker hoặc Admin unlock.
21. Mỗi physical retry/fallback có invocationId riêng và cùng logicalOperationId. Usage provider đã xác nhận vẫn bị charge dù TRUNCATED, SCHEMA_INVALID hoặc DOMAIN_REJECTED; chỉ durable provider evidence xác nhận no-usage mới không charge, missing metadata là unknown.
22. Timeout chưa biết usage chuyển OUTCOME_UNKNOWN, giữ in-flight slot và không tự replay. Late receipt settle đúng invocation. Operator command có idempotencyKey, expectedVersion, evidence reference, structured reason và audit rationale; actor/time server-derived.
23. Reconciliation terminal precedence phải chống race late receipt. CONFIRMED_NO_USAGE đóng slot không debit; SETTLED_WITH_USAGE dùng evidence bound admission; compensation chỉ tham chiếu debit có thật. Refund/waiver ghi immutable COMPENSATION, amount server-computed không vượt uncompensated debit và commit atomic với projection/audit/outbox.

Telemetry và runtime contract:
24. Giữ `65536` là provider/global maximum được phép, không phải silent default/business cap. Bỏ fallback `4096`; mỗi production route khai báo `max_output_tokens > 0` phù hợp operation.
25. Chưa đặt operation-specific business cap hoặc statistical warning threshold. High usage hợp lệ tiếp tục; MAX_TOKENS/TRUNCATED không được coi là domain success.
26. ModelUsageReceipt lưu operationType, route/protocol/policyVersion, appliedMaxOutputTokens, finishReason, responseStatus, token buckets, duration/modelStep/attempt lineage; không lưu raw prompt/response/source.
27. ModelOutputEvaluation là record riêng theo invocationId, do downstream evaluator ghi ACCEPTED, SCHEMA_INVALID, DOMAIN_REJECTED hoặc NOT_EVALUATED; provider finish reason sở hữu TRUNCATED.
28. Analytics đủ dữ liệu tính P50/P90/P95/P99, cap-hit/truncate/accepted-output rate theo operation+provider+model+policy version trước khi đề xuất cap.

Admin override contract:
29. Admin runtime override độc lập wallet/payment; request có idempotencyKey, expectedVersion, targetRunId, auditReason và overrideNoProgress. Server derive authorizedBy/authorizedAt từ authenticated ADMIN.
30. overrideNoProgress=true chính là explicit operational review trong request được audit; không phát minh review subsystem riêng nếu codebase chưa có authority.
31. Canonical route là POST /admin/assessments/:assessmentId/budget-extension. Legacy route deprecated và forward cùng command/service trong compatibility window.
32. Canonical AuditEvent atomic với extension/resume request. Runtime extension source chỉ ADMIN_OVERRIDE hoặc SYSTEM_COMPENSATION; PAYMENT chỉ là billing-ledger source.

Thứ tự SDLC bắt buộc:
- Phase A: shadow microcredit columns + accounting unit version; fence/drain old writers, idempotent backfill, dual-write from immutable payment input, shadow-read reconciliation, rollback criteria và atomic cutover; không reinterpret/rescale legacy columns in place.
- Phase A2: pricing draft/snapshot/assignment contracts + calculator + Admin API/UI + browser verification; classify legacy FX/markup snapshots REFERENCE_ONLY; debit feature flag vẫn OFF.
- Phase B: server-issued admission + per-wallet slot + worker/deepagents integration. Enumerate mọi sync/async/retry/fallback/preparation provider-call boundary; shadow admission → mandatory admission with debit OFF → settlement shadow reconciliation → debit enablement. Không có local/unrestricted fallback thay wallet admission.
- Phase C: actual-usage settlement, signed debt projection, PAYMENT_REQUIRED outbox/checkpoint và manual Continue.
- Phase D: OUTCOME_UNKNOWN reconciliation, compensation và admin override consolidation.
- Requirement/QA viết acceptance matrix và tất cả RED tests trước production changes của từng phase.
- Security review mass assignment, arbitrary-model fallback, pricing mutation, replay/double debit, wallet ownership và negative-balance bypass.
- Adversarial review multi-model assessment, price change mid-run, concurrent assessments, timeout/late usage, retry/fallback, missing bucket, fallback pricing, top-up while negative, stale version, outbox/DLQ và audit failure.
- QA targeted GREEN, adjacent billing/usage/runtime/deepagents/web regressions, browser verification cho Admin UI, typecheck và project checks; sau code chạy graphify update ..

Enablement gates còn mở: (1) owner phê duyệt initial rates; global default optional nếu exact/provider coverage đã bao phủ toàn bộ allowlisted models, (2) admission-to-settlement binding, (3) mixed-version microcredit cutover, (4) admitted maximum monetary exposure, (5) immutable pricing assignment/interval constraints, (6) mọi provider-call path đã mandatory wallet admission, và (7) versioned/idempotent reconciliation-compensation. Chỉ bật debit khi mọi allowlisted production route/model resolve deterministic tới ACTIVE exact/provider snapshot hoặc optional global snapshot và toàn bộ gate có RED/GREEN + operational rollback evidence. Không sửa audit report thành GREEN, không commit/push/PR.
```

## Prompt 9 — Refactor report-only sau behavioral fixes

```text
/teamwork

Chỉ chạy package này sau khi Work Package 1–8 đã hoàn tất và GREEN.

Xử lý có kiểm soát các mục report-only ASM-10, ASM-20, ASM-21, ASM-22:
- Shared contract constants thay cho audit/error/event literals phân tán.
- Giảm Prisma import trực tiếp ở application layer bằng ports/UoW phù hợp.
- Giảm complexity/duplication ở runtime authority, tracking, PDF và controllers.
- Dọn dead API/DI duplication.
- Bổ sung characterization tests trước mọi refactor.
- Không thay đổi behavior hoặc API contract ngoài những gì đã được test.

Quy trình:
1. Refactor analyst tạo inventory cụ thể theo file và đề xuất các lát cắt nhỏ.
2. Không làm “big bang refactor”.
3. Với từng lát cắt: characterization GREEN → refactor → review → targeted GREEN.
4. Dừng nếu không chứng minh được behavior preservation.
5. Reviewer kiểm tra clean-architecture boundary, dependency cycles và contract drift.
6. QA chạy adjacent regressions, architecture/import/business-doc checks.
7. Chạy graphify update ..

Không tự mở rộng sang module khác, không commit/push/PR. Trả từng refactor slice và bằng chứng tương ứng.
```

## Prompt 10 — Integration QA và gói bàn giao review

```text
/teamwork

Thực hiện integration review cuối cho toàn bộ Assessment work packages. Không thêm feature mới.

Tạo các review lane độc lập:
- Security review: lcsp-security-production-grade.
- Code review: bmad-code-review.
- Edge cases: bmad-review-edge-case-hunter.
- Adversarial review: bmad-review-adversarial-general.
- QA gate: bmad-tea.

Kiểm tra:
1. Tất cả RED contracts hợp lệ đã GREEN.
2. Ba superseded contracts đã được rewrite đúng:
   ASM-RBAC-01, ASM-RBAC-02, ASM-REPORT-01A/B/C/D.
3. ASM-WORKER-01 đã withdrawn; không có worker rotation production code. Nếu test cũ còn tồn tại, thay nó bằng accepted single-key invariants hoặc loại bỏ riêng expectation không còn hợp lệ.
4. Không có PBAC hoặc organization mới.
5. Không có production behavior cho các finding đã rút/accepted.
6. Chạy targeted Assessment suite và adjacent RBAC/deepagents tests.
7. Chạy:
   - git diff --check
   - API/Python type/lint checks liên quan
   - check:business-logic-docs
   - test:business-logic-docs
   - check:architecture
   - check:imports
   - search enum/direct literal union theo AGENTS.md
8. Chạy graphify update ..
9. Kiểm tra git diff để bảo đảm không ghi đè thay đổi ngoài scope.

Nếu review tìm thấy lỗi:
- Chuyển lại đúng Dev owner.
- Viết RED reproducer nếu là bug mới.
- Fix tối thiểu.
- Review và QA lại cho tới khi không còn finding P0/P1 trong scope.

Kết quả cuối chỉ gồm:
- File thay đổi theo work package.
- Root cause/Fix.
- RED → GREEN command receipts và exit codes.
- Review findings đã đóng/còn mở.
- Rủi ro và migration/deployment notes.
- Git diff summary.

Không cập nhật audit report thành GREEN, không commit, push hoặc tạo PR. Dừng để user chuyển kết quả cho Codex review độc lập.
```
