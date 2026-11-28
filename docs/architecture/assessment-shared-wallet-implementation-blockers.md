# Assessment Direct-Credit Shared-Wallet Readiness

> Ngày cập nhật: 2026-11-24  
> Phạm vi: Prompt 8 — direct-credit pricing, per-invocation settlement, shared wallet, telemetry và admin runtime override  
> Trạng thái: **READY_FOR_CONTRACT RED TESTS — NOT READY FOR PRODUCTION IMPLEMENTATION OR DEBIT ENABLEMENT**  
> Mục đích: phân biệt quyết định kiến trúc đã chốt, implementation prerequisites và blocker thật sự còn mở.

## 1. Kết luận

Thiết kế nghiệp vụ đã đủ rõ để bắt đầu viết contract RED tests. Chưa được triển khai production debit cho tới khi toàn bộ enablement gates tại mục 5 được đóng bằng RED/GREEN evidence và operational rollback receipts. Model usage được settlement sau từng physical provider invocation, không chờ assessment hoàn thành. Một assessment có thể đổi model, provider hoặc pricing version giữa các call; mỗi call pin và dùng pricing snapshot riêng.

Không còn blocker nghiệp vụ về FX, markup runtime, reservation, allocation theo assessment hoặc multi-model assessment. Tuy nhiên, tariff approval không phải gate duy nhất: authority binding, unit cutover, maximum monetary exposure, immutable interval assignment, provider-call cutover và financial reconciliation constraints vẫn phải được thiết kế/test đầy đủ trước implementation production.

## 2. Source reality đã xác minh

- Top-up hiện dùng `1 VND = 1 credit` tại `packages/contracts/src/billing/prepaid.ts`.
- Payment confirmation đã credit shared wallet idempotently qua billing ledger.
- `BillingUsageKernel` hiện chỉ ghi telemetry và reference-cost estimate; không reserve/debit wallet.
- Quote `1.8` hiện chỉ là informational USD quote, không phải conversion rate và không phải wallet authority.
- Accounting kernel hiện từ chối debit làm balance âm; wallet contract chỉ biểu diễn số không âm.
- Prisma đã có `ModelPricingSnapshot` và các field settlement trên `LlmUsageEvent`, nhưng production usage path chưa pin pricing hoặc ghi `chargedCredits`.
- Legacy reservation schema còn tồn tại, nhưng production flow mới không tạo reservation; chỉ giữ compatibility/release cho dữ liệu cũ.

Graphify chỉ được dùng làm navigation index. Các kết luận trên đã được xác nhận lại trong source; không dựa vào graph edge để chứng minh runtime behavior.

## 3. Quyết định kiến trúc đã chốt

### AD-01 — Shared prepaid wallet

- Một user/customer account có một shared wallet.
- Top-up giữ quy đổi hiện tại `1 VND = 1 public credit`.
- Payment chỉ ghi `BILLING_ORDER_CREDIT`; không tạo runtime allowance, không tự resume assessment.
- Chỉ RBAC, không PBAC hoặc organization dimension.

### AD-02 — Direct-credit runtime pricing

- Runtime settlement chỉ dùng rate bằng microcredits/token.
- Không dùng USD/VND, FX snapshot hoặc multiplier `1.8` trong phép tính từng call.
- FX/provider cost/biên lợi nhuận chỉ là input vận hành khi Admin xây bảng giá mới, không phải dữ liệu settlement runtime.

### AD-03 — Integer microcredit accounting

```text
1 public credit = 1_000_000 microcredits
```

- Calculator và ledger authority dùng integer/BigInt, không floating point.
- Không đặt minimum charge.
- Wire format customer là canonical base-10 decimal string với tối đa 6 chữ số thập phân, không exponent và không JS number; `parse(format(microcredits))` phải giữ nguyên giá trị.
- Internal persistence dùng microcredits. Không reinterpret/rescale các legacy `*Credits` columns tại chỗ; thêm shadow columns có tên đơn vị rõ ràng và accounting schema version.
- Compatibility writer tính public credits và microcredits từ cùng immutable payment input rồi dual-write atomically. Backfill idempotent, old writers bị fence/drain trước cutover và shadow-read phải reconciliation per wallet trước khi microcredit trở thành sole authority.
- `BillingOrder.creditUnits` tiếp tục là public credits; khi payment settle, ledger credit bằng `creditUnits × 1_000_000` microcredits.

### AD-04 — Pricing scope và fallback

Resolution order cố định:

```text
EXACT_MODEL
→ PROVIDER_DEFAULT
→ GLOBAL_DEFAULT
→ reject before provider call
```

- Fallback chỉ áp dụng cho resolved model có trong runtime model allowlist.
- Không dùng wildcard/regex model pricing để hợp thức hóa model lạ hoặc lỗi chính tả.
- Admission lưu `requestedModel`, `resolvedModel`, `pricingSnapshotId` và `pricingResolution`.
- Mỗi fallback usage phát telemetry `PRICING_FALLBACK_USED`; dashboard tổng hợp theo model thay vì alert từng call.

### AD-05 — Admin Model Pricing authority

Admin Billing có section `Model Pricing` với ba nhóm:

```text
Exact Model Pricing
Provider Defaults
Global Default
```

Authority split:

```text
ModelPricingDraft (mutable, never billable)
→ publish
ModelPricingSnapshot (immutable, append-only)
→ PricingAssignment [effectiveFrom, effectiveTo)
```

- `SCHEDULED`, `ACTIVE` và `SUPERSEDED` là derived read status của assignment/time, không phải mutation trên snapshot.
- Database UTC clock là authority. Admission chọn duy nhất assignment hiệu lực tại admission timestamp và pin immutable snapshot ID.
- Publish dùng idempotency key/request fingerprint và serialized transaction; assignment, snapshot publication và AuditEvent commit atomically.
- Database constraint ngăn half-open intervals `[effectiveFrom,effectiveTo)` overlap trong cùng normalized scope key.
- Preview gọi cùng canonical calculator với settlement.
- Customer/worker không được gửi rate hoặc quyết định snapshot.
- Publish/supersede được audit; actor/role derive từ authenticated ADMIN.

### AD-06 — Per-physical-invocation settlement

- Một physical provider call có một immutable `invocationId`.
- Retry/fallback tạo invocation mới nhưng dùng cùng `logicalOperationId`.
- Assessment có thể đổi model/provider/pricing version giữa các call.
- Mỗi invocation pin snapshot tại admission; price change giữa call không hồi tố.
- Assessment total chỉ là aggregate read model, không phải settlement unit.

### AD-07 — Server-issued admission, không reservation

Trước paid provider call, API atomically xác minh:

```text
wallet spendableCredits > 0
runtime state cho phép
active execution lease khớp
resolved model nằm trong allowlist
pricing resolution thành công
wallet còn in-flight slot
canonical maximum exposure tính được từ tariff + applied hard bounds
```

- Không giữ hoặc trừ credits trước call.
- Pilot dùng `maxInFlightBillableInvocationsPerWallet = 1`.
- Đây chỉ là concurrency guard, không tự nó giới hạn monetary exposure và không giới hạn số assessment đang hoạt động.
- Admission persist `maximumExposureMicrocredits` từ pinned tariff, input/context bound, output cap và bucket policy. Provider usage vượt bound chuyển billing-integrity review, không âm thầm mở rộng debt.
- Worker consume admission bằng compare-and-swap trước dispatch. Claim expired không được chuyển `IN_FLIGHT`; `IN_FLIGHT`/`OUTCOME_UNKNOWN` không tự giải phóng chỉ do TTL.

### AD-08 — Atomic settlement và signed wallet projection

Một billing transaction atomic ghi:

```text
ModelUsageReceipt
MODEL_USAGE_DEBIT ledger entry
signed wallet projection
BillingOutboxEvent
terminal wallet-slot transition
```

Customer projection:

```text
ledgerBalance       = signed ledger total
spendableCredits    = max(ledgerBalance, 0)
outstandingCredits  = max(-ledgerBalance, 0)
```

- Tất cả record trên commit dưới cùng wallet lock/version để slot không mở trước khi debit/projection nhìn thấy được.
- Invocation in-flight vẫn settle dù làm balance âm trong admitted maximum exposure.
- Top-up bù outstanding balance trước, không lãi/phạt.
- Replay cùng invocation/fingerprint trả kết quả cũ; payload khác trả conflict.
- `invocationId` bắt buộc resolve immutable server admission. Settlement derive user/wallet/assessment/run/lease/provider/resolved model/pricing/policy từ admission; callback không được override authority hoặc charge amount.
- Missing, foreign, expired hoặc identity-mismatched admission fail closed không ghi usage tài chính, ledger, projection, audit hoặc outbox. Callback không bound chỉ được quarantine làm non-billable telemetry.

### AD-09 — Wallet depletion và manual continuation

- Wallet `<= 0` chặn paid call mới nhưng không chặn login/read/download/report.
- Invocation làm cạn ví phát durable outbox event; assessment của invocation checkpoint `PAYMENT_REQUIRED`.
- Assessment khác tự checkpoint khi paid admission kế tiếp bị từ chối; không mass-update mọi assessment.
- Top-up không tự resume; Continue kiểm tra lại ví, pricing, run/lease và safety gates còn hiệu lực. `NO_PROGRESS_LIMIT_EXCEEDED` không còn là blocker cần Admin mở khóa.
- Customer bấm `Continue`; runtime đánh giá lại wallet và toàn bộ blocker.
- Outbox consumer phải idempotent, retry durable, có dead-letter/alert và audited operator replay.

### AD-10 — Attempt charge và compensation

| Kết quả physical attempt                                  | Settlement policy                                    |
| --------------------------------------------------------- | ---------------------------------------------------- |
| Provider xác nhận usage                                   | Charge actual usage                                  |
| `TRUNCATED`/schema invalid/domain rejected nhưng có usage | Charge actual usage                                  |
| Provider xác nhận không có usage                          | Không charge                                         |
| Timeout có confirmed usage                                | Charge actual usage                                  |
| Timeout chưa biết usage                                   | `OUTCOME_UNKNOWN`, chưa debit tới khi reconciliation |
| Waiver/refund do LCSP quyết định                          | Ghi immutable `COMPENSATION`, không sửa debit gốc    |

Compensation command lưu `idempotencyKey`, `expectedVersion`, `reasonCode`, `approvedBy`, `originalLedgerEntryId` và `correlationId`. Amount do server tính, không vượt uncompensated amount của debit gốc; goodwill credit là action khác.

### AD-11 — `OUTCOME_UNKNOWN` reconciliation

- Không replay cùng provider invocation.
- Late receipt settle đúng invocation cũ.
- Claim tiếp tục chiếm in-flight slot.
- Cảnh báo operator khi unresolved quá 15 phút; không tự coi usage bằng zero.
- Operator command bắt buộc idempotency key, expected version, durable evidence reference, structured reason và audit rationale; actor/time server-derived.
- `SETTLED_WITH_USAGE` chỉ dùng validated provider evidence bound admission; `CONFIRMED_NO_USAGE` cần durable evidence và đóng slot không debit.
- Terminal precedence phải định nghĩa race với late receipt: terminal no-usage không được âm thầm bị late callback đổi thành charge; muốn reopen phải qua audited compensating transition.
- `COMPENSATED` chỉ dùng khi debit gốc tồn tại. Unknown attempt chưa debit dùng zero-charge closure, không tạo compensation không có original ledger entry.

### AD-12 — Usage và output evaluation là hai evidence records

```text
ModelUsageReceipt
→ provider usage, applied cap, finish reason, duration

ModelOutputEvaluation
→ ACCEPTED | SCHEMA_INVALID | DOMAIN_REJECTED | NOT_EVALUATED
```

- Provider finish reason sở hữu `TRUNCATED`.
- Downstream evaluator ghi domain outcome idempotently theo `invocationId`.
- Operation chưa có evaluator dùng `NOT_EVALUATED`, không giả lập outcome.

### AD-13 — Paid tools deferred

WP8 chỉ triển khai `MODEL_USAGE_DEBIT`. Paid-tool billing là work package riêng sau khi có tariff, usage unit, receipt identity và refund semantics. Việc defer này không chặn model-usage debit.

### AD-14 — Admin runtime override độc lập billing

- Request gồm `idempotencyKey`, `expectedVersion`, `targetRunId`, `auditReason`, `overrideNoProgress`.
- `overrideNoProgress=true` là explicit operational review được audit; không tạo review subsystem mới khi chưa có authority.
- Server derive `authorizedBy`/`authorizedAt`; client không gửi role authority.
- Route canonical: `POST /admin/assessments/:assessmentId/budget-extension`.
- Legacy route forward cùng command trong compatibility window.
- Source runtime extension chỉ `ADMIN_OVERRIDE` hoặc `SYSTEM_COMPENSATION`; payment chỉ là billing-ledger source.

## 4. Readiness matrix sau khi chốt thiết kế

| Hạng mục                                   | Trạng thái             | Ghi chú                                                         |
| ------------------------------------------ | ---------------------- | --------------------------------------------------------------- |
| Payment credit shared wallet               | READY_FOR_CONTRACT_RED | Production chờ mixed-unit cutover gate.                         |
| Direct-credit pricing contracts/calculator | READY_FOR_CONTRACT_RED | Không còn FX/markup runtime.                                    |
| Admin Model Pricing API/UI                 | READY_FOR_CONTRACT_RED | Production chờ immutable assignment/interval gate.              |
| Exact/provider/global resolution           | READY_FOR_CONTRACT_RED | Global optional; mọi allowlisted model vẫn phải resolve.        |
| Per-invocation admission                   | READY_FOR_CONTRACT_RED | Production chờ authority binding, exposure và no-bypass gates.  |
| Actual model-usage settlement              | READY_FOR_CONTRACT_RED | Chưa sẵn sàng production implementation/debit enablement.       |
| Negative balance/top-up                    | READY_FOR_CONTRACT_RED | Signed microcredit projection đã chốt; cutover chưa chứng minh. |
| `OUTCOME_UNKNOWN`/compensation             | READY_FOR_CONTRACT_RED | Production chờ version/idempotency/terminal-precedence gate.    |
| Output evaluation telemetry                | READY_FOR_CONTRACT_RED | Cho phép `NOT_EVALUATED`.                                       |
| Admin runtime override                     | READY_FOR_CONTRACT_RED | Không cần review subsystem riêng.                               |
| Paid-tool billing                          | DEFERRED               | Không chặn WP8 model usage.                                     |

## 5. Production enablement gates còn mở

### GATE-01 — Chưa có initial ACTIVE tariff values

**Loại:** không chặn contract RED tests; chặn production implementation/debit enablement.

Admin/owner cần phê duyệt ít nhất:

- Exact/provider default rate đủ bao phủ mọi allowlisted production model.
- Một global default rate hoặc quyết định không dùng global default.
- Rate/treatment cho input, cached input, cache write, visible output và reasoning.
- `effectiveFrom` và audit reason của snapshot đầu tiên.

Không lấy multiplier `1.8` informational hiện tại làm tariff authority. Không tự suy ra các con số này từ provider reference cost trong runtime.

**Enablement condition:** mọi production route/model allowlist resolve deterministic tới ACTIVE exact/provider snapshot, hoặc optional global snapshot nếu owner chủ động publish global.

### GATE-02 — Admission-to-settlement authority binding

Settlement phải derive toàn bộ financial authority từ immutable server-issued admission. Shared worker key và caller-supplied assessment/model/token payload không đủ quyền tạo debit. Unbound/mismatched callback fail closed hoặc chỉ được quarantine làm non-billable telemetry.

### GATE-03 — Mixed-version microcredit migration

Phải có shadow columns + accounting unit version, writer fencing/drain, atomic dual-write từ immutable payment input, idempotent backfill, per-wallet reconciliation, mismatch alarm, rollback criteria và explicit cutover. Không rescale/reinterpret legacy columns tại chỗ.

### GATE-04 — Bounded maximum monetary exposure

One-slot pilot chỉ giới hạn concurrency. Admission phải persist canonical `maximumExposureMicrocredits` từ pinned tariff và applied hard bounds. Settlement vượt bound chuyển integrity review thay vì tự mở rộng debt.

### GATE-05 — Immutable pricing publication và interval authority

Mutable draft, immutable snapshot và versioned assignment phải tách riêng. Database UTC clock, half-open interval `[effectiveFrom,effectiveTo)`, publish idempotency, atomic AuditEvent và database no-overlap constraint phải có RED/GREEN evidence. Legacy FX/markup snapshots là `REFERENCE_ONLY`, không được thỏa direct-credit resolution.

### GATE-06 — Complete provider-call admission cutover

Mọi sync/async/retry/fallback/preparation provider attempt phải có wallet admission trước dispatch khi operation bật debit. Rollout bắt buộc: shadow admission → mandatory admission/debit off → settlement shadow reconciliation → debit on. Local runtime/token admission không thay wallet admission và không có unrestricted legacy fallback.

### GATE-07 — Versioned reconciliation và compensation authority

Operator actions cần idempotency key, expected version, evidence/reference identity, structured reason và atomic ledger/projection/audit/outbox. Compensation không vượt uncompensated debit; late receipt race có terminal precedence rõ ràng.

## 6. Implementation work sau khi contract RED được duyệt

Các mục này phải được làm theo TDD nhưng không cần thêm product decision:

1. Thực hiện GATE-03 migration/cutover; không có hai accounting authorities sau cutover.
2. Shared-contract constants/schemas cho pricing scope, lifecycle, resolution, ledger source, pause reason và reconciliation result.
3. Canonical pricing calculator dùng chung cho preview và settlement.
4. Admin pricing draft/snapshot/assignment commands/queries, DB interval constraint, immutable publish boundary và atomic AuditEvent.
5. Worker/deepagents admission handshake và GATE-06 cutover cho mọi provider-call boundary.
6. Wallet-scoped in-flight counter/claim và orphan recovery.
7. Atomic usage receipt + ledger + projection + outbox settlement.
8. PAYMENT_REQUIRED consumer, DLQ/alert/operator replay và manual Continue.
9. ModelOutputEvaluation writers theo operation; fallback `NOT_EVALUATED` cho operation chưa có evaluator.
10. Customer/admin analytics cho charge, fallback resolution và unresolved usage mà không lưu raw content.

## 7. RED test inventory bắt buộc

- `ASM-PRICING-01`: ADMIN-only draft/publish/supersede; publish idempotent; snapshot immutable; DB-time half-open assignments không overlap.
- `ASM-PRICING-02`: exact → provider default → global default resolution; model ngoài allowlist bị reject.
- `ASM-PRICING-03`: integer microcredit calculation cho mọi token bucket; không runtime FX/`1.8`; missing bucket không thành zero.
- `ASM-PRICING-04`: assessment đổi model/provider/pricing version; từng physical invocation pin và settle độc lập.
- `ASM-BUDGET-01..05`: payment credit, shared wallet, admission, debit, signed debt, PAYMENT_REQUIRED và admin override.
- `ASM-USAGE-01..04`: applied cap, finish/outcome, lineage và calibration telemetry.
- Bổ sung migration/cutover, admission-binding, exposure-bound, provider-call bypass, concurrency/replay, late usage, compensation, outbox/DLQ và top-up khi âm.

## 8. Thứ tự triển khai

1. Phase A — contract RED tests cho GATE-01..07; chưa sửa production debit path.
2. Phase B — shadow microcredit migration/cutover tooling, calculator và pricing draft/snapshot/assignment persistence.
3. Phase B2 — Admin Model Pricing API/UI, audit và browser verification.
4. Phase C — shadow rồi mandatory admission handshake, authority binding, pricing resolution, exposure và in-flight slot trên mọi provider-call path.
5. Phase D — settlement shadow reconciliation, actual-usage settlement, signed projection và customer charge history.
6. Phase D2 — PAYMENT_REQUIRED outbox/checkpoint và manual Continue.
7. Phase E — OUTCOME_UNKNOWN reconciliation, compensation và admin override consolidation.
8. Phase F — đóng đủ GATE-01..07, seed ACTIVE assignments, enable debit feature flag và quan sát telemetry.

Không bật production debit trước Phase F. Không triển khai paid-tool billing trong WP8. Không commit, push hoặc tạo PR nếu chưa có lệnh riêng của user.
