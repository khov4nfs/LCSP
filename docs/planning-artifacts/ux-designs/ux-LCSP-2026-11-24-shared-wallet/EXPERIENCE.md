---
name: LCSP Prompt 8 Shared Wallet
status: final
sources:
  - docs/product/prd.md
  - docs/product/addendum.md
  - docs/architecture/adr/adr-028-shared-wallet-model-usage-settlement.md
  - docs/planning-artifacts/sprint-change-proposal-2026-11-24.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md
updated: 2026-11-24
---

# LCSP Prompt 8 Experience Spine

## Foundation

Responsive web, desktop-primary, extending the canonical LCSP assessment workbench. `DESIGN.md` in this workspace owns the visual delta; this file owns financial information architecture, behavior, states, interactions, accessibility, and journeys. Existing shadcn/Base UI primitives, Tailwind CSS v4.3, Atomic Design boundaries, shared `LCSPLogo`, React Hook Form, Zod, and `@lcsp/i18n` remain mandatory.

The customer mental model is deliberately small: one shared prepaid wallet funds model usage across all assessments, and actual usage is charged after each physical provider invocation. Assessments do not receive separate balances, allocations, or reservations.

Financial permission and runtime safety are independent. A positive wallet answers whether a new paid invocation may be funded; it does not answer whether the run/lease, model policy or retry allowance permit work to continue. No-progress is diagnostic telemetry, not an assessment blocker or Admin unlock condition. A runtime override cannot create credit.

Authorization is RBAC-only and owner/resource-scoped. Customer wallet and charge reads bind to `wallet.userId`; assessment actions bind to `assessment.ownerId`; pricing, reconciliation, integrity review, and compensation require explicit Admin action permission. Organization membership and PBAC are not UX or authorization boundaries.

## Information Architecture

### Customer surfaces

| Surface | Reached from | Purpose | Lands in flow |
|---|---|---|---|
| Wallet summary | Primary navigation / assessment blocker | Show spendable credit, outstanding credit, last confirmed payment, and actions without an ambiguous signed balance | Flows 1, 2 |
| Top-up checkout | Wallet summary / `PAYMENT_REQUIRED` | Show service value, tax, payment total, credited amount, and payment action | Flow 1 |
| Payment status | Checkout return / wallet history | Distinguish pending, failed, confirmed-and-credited, and duplicate-safe replay | Flow 1 |
| Assessment payment gate | Assessment overview when paid work is needed | Explain what stopped, what remains preserved, and how to top up; never imply the whole assessment was deleted or failed | Flows 1, 5 |
| Continue review | Payment status / assessment payment gate | Re-check the selected assessment and make manual Continue explicit after wallet recovery | Flows 1, 5 |
| Charge history | Wallet summary | Group customer charges by logical operation and expose status, total, assessment reference, and date | Flow 2 |
| Charge detail | Expanded history group / deep link | Show each separately billable physical retry/fallback and safe pricing/usage provenance | Flow 2 |

### Admin surfaces

| Surface | Reached from | Purpose | Lands in flow |
|---|---|---|---|
| Pricing coverage | Admin navigation | Show exact-model, provider-default, and approved global-default assignments, gaps, conflicts, and effective intervals | Flow 3 |
| Pricing draft | Coverage create/edit action | Capture cost evidence and versioned assumptions; calculate suggested tariff and projected margin without publishing | Flow 3 |
| Publish review | Pricing draft | Validate normalized scope, allowlisted model, bucket completeness, interval, stale version, and overlaps before immutable publication | Flow 3 |
| Pricing history | Coverage / published assignment | Inspect immutable snapshots, assignments, approvals, evidence refs, supersession, and effective state | Flow 3 |
| Shadow billing comparison | Admin rollout/operations navigation | Compare non-authoritative shadow pricing/settlement variance by rollout mode/version without exposing a Customer debit or money-changing action | Flow 6 |
| Reconciliation queue | Admin navigation | Prioritize `DISPATCH_UNKNOWN`, `OUTCOME_UNKNOWN`, late evidence, and breached review deadlines | Flow 4 |
| Reconciliation case | Queue row | Compare immutable admission, safe provider evidence, pricing authority, prior decisions, and permitted resolutions | Flow 4 |
| Billing integrity review | Queue / alert | Fail closed on contradictory usage, exposure, pricing, or projection evidence; never offer an ordinary settlement shortcut | Flow 4 |
| Compensation review | Eligible settled debit / reconciliation case | Create a bounded immutable compensation linked to the original debit | Flow 4 |

No customer surface exposes raw prompt/output, secrets, provider credentials, internal markup, projected margin, risk buffer, provider cost assumptions, or operational enablement evidence. Admin evidence is also redacted to the minimum needed for the authorized decision.

## Voice and Tone

All examples below are copy intent. Production components resolve approved Vietnamese/English keys from `@lcsp/i18n`; they do not hardcode these strings or trust backend prose as final display copy.

| Do — Vietnamese | Don't |
|---|---|
| `Credit khả dụng của bạn hiện không đủ để bắt đầu lượt gọi model tiếp theo.` | `Assessment đã hết tiền.` |
| `Các kết quả đã hoàn thành vẫn được giữ nguyên.` | `Quá trình đã thất bại.` when only new paid work is blocked |
| `Thanh toán đã được ghi nhận. Chọn Tiếp tục khi bạn muốn hệ thống kiểm tra lại điều kiện chạy.` | `Đã nạp tiền. Assessment đang tự động chạy lại.` |
| `Assessment chưa thể tiếp tục vì chưa có tiến triển sau nhiều bước. Việc nạp credit không gỡ giới hạn này.` | `Số dư vẫn có nhưng hệ thống bị lỗi.` |
| `Chi phí của lượt gọi này đang được đối soát; số credit cuối cùng chưa được xác nhận.` | `Lượt gọi này miễn phí.` or a guessed amount |
| `Khoản điều chỉnh này tạo một bản ghi mới và không thay đổi giao dịch gốc.` | `Sửa số tiền đã trừ.` |
| `Bảng giá sau khi xuất bản không thể chỉnh sửa; thay đổi tiếp theo sẽ tạo phiên bản mới.` | `Lưu bảng giá.` for an immutable publish action |

Customer copy uses plain financial language first, then the stable state code only where it helps support (`PAYMENT_REQUIRED`, `OUTCOME_UNKNOWN`). Admin copy may use domain terms but must pair them with decision consequences and evidence status.

## Component Patterns

| Component | Use | Behavioral rules |
|---|---|---|
| Wallet summary | Customer wallet | Reads server-formatted exact values. Spendable and outstanding are separate labels; no client-side subtraction or FX conversion. |
| Payment blocker | Assessment overview | Uses `{components.payment-blocker}`. Shows preserved work, affected next paid step, balance state, top-up action, and support reference. It never disables read-only assessment access or artifact download. |
| Runtime blocker | Assessment overview / Continue result | Uses `{components.runtime-blocker}`. Names an applicable safety failure and recovery path. It is not cleared merely because payment succeeded; no-progress telemetry does not produce this blocker. |
| Continue panel | Payment return / overview | Shows restored wallet state and selected assessment. Continue is an explicit button; successful payment alone never triggers it. |
| Checkout breakdown | Top-up | Fixed rows: service value, tax, payment total, credited amount. Pending submit is idempotent; repeated return or refresh does not promise duplicate credit. |
| Charge group | Charge history | Parent is a logical operation; expansion reveals physical invocations. Parent total is the sum of finalized child financial effects and visibly excludes pending unknown usage. |
| Physical invocation row | Charge detail | Shows provider/model, non-overlapping token buckets, tariff version/resolution, credits, outcome, timestamp, and safe correlation reference. Never shows prompt/output. |
| Reconciliation notice | Customer charge detail | Uses `{components.reconciliation-notice}`. Announces pending review without showing a final amount or promising a deadline not backed by policy. |
| Pricing coverage table | Admin pricing | Filters by provider/model/scope/effective time. Missing coverage, overlap conflict, superseded, scheduled, and active are text states, not empty-cell conventions. |
| Pricing draft editor | Admin pricing | React Hook Form + Zod. Cost evidence, assumptions, tariff buckets, scope, and interval are separate sections. Suggested tariff never becomes approved solely by calculation. |
| Immutable publish confirmation | Admin pricing | Requires explicit confirmation after server validation. A stale draft, unknown/non-allowlisted model, missing rate, or overlapping interval blocks publish and preserves edits. |
| Reconciliation evidence timeline | Admin case | Orders admission, dispatch acknowledgement, receipt/evidence, decisions, and late events by server time while keeping immutable source identity. |
| Immutable record | Customer history / Admin history | Keeps the original debit, published pricing, reconciliation decision or compensation visible as its own append-only record and links later superseding/offsetting records without replacing history. |
| Compensation review | Admin debit/case | Server supplies original and remaining eligible amount. Admin chooses an allowed reason and amount; UI cannot override wallet, owner, debit identity, or maximum. |

## State Patterns

### Customer financial and runtime states

| State | Treatment | Primary action | Announcement intent |
|---|---|---|---|
| Spendable credit positive | Normal wallet summary; no success celebration | `Nạp thêm credit` optional | Announce values only on explicit refresh/change |
| Outstanding credit positive | Show outstanding separately and explain next top-up clears it first | `Nạp credit` | `Bạn còn {amount} credit cần thanh toán.` |
| `PAYMENT_REQUIRED` | Warning financial gate; preserve all completed artifacts and read access | `Nạp credit` | `Đã tạm dừng lượt gọi model mới vì credit khả dụng không đủ.` |
| Payment pending | Payment status owns focus; assessment remains waiting | `Kiểm tra trạng thái` | `Thanh toán đang được xác nhận.` |
| Payment failed/cancelled | Keep checkout context; no wallet success state | `Thử lại` / return | `Thanh toán chưa hoàn tất. Chưa có credit mới được cộng.` |
| Payment confirmed and credited | Success state says payment is complete but work is still waiting | `Tiếp tục` when an assessment-recovery context exists; otherwise return to Wallet summary | `Đã cộng {amount} credit. Assessment chưa tự động tiếp tục.` |
| `WAITING_FOR_CUSTOMER_CONTINUE` | Assessment overview shows restored wallet plus manual gate | `Tiếp tục` | `Assessment đang chờ bạn chọn Tiếp tục.` |
| Continue accepted | Show newly evaluated runtime state; do not promise provider success | View progress | `Yêu cầu tiếp tục đã được chấp nhận.` |
| Runtime/safety blocked | Danger/blocked state separate from payment | State-specific safe action | `Assessment chưa thể tiếp tục do giới hạn chạy độc lập với số dư.` |
| `DISPATCH_UNKNOWN` | Pending reconciliation: provider dispatch itself is unresolved; never offer retry/re-dispatch of the same physical invocation | View safe details / contact support | `Trạng thái gửi yêu cầu tới nhà cung cấp đang được đối soát.` |
| `OUTCOME_UNKNOWN` | Pending reconciliation notice; no guessed/final amount | View safe details / contact support | `Chi phí cuối cùng của một lượt gọi đang được đối soát.` |
| Settled charge | Final child row and operation total update atomically | View details | Announce changed total without moving focus |
| Platform-sponsored invocation | No Customer financial effect; omit from financial history or label `Nền tảng chi trả / không trừ ví` for operation provenance | View safe operation details | No wallet-change announcement |
| Compensated charge | Original debit remains; linked compensation appears as a separate positive record | View linked records | `Đã ghi nhận khoản điều chỉnh {amount}; giao dịch gốc được giữ nguyên.` |

If payment and runtime blockers coexist, order them by the next permitted action. Show wallet recovery first only when funding is the immediate prerequisite; otherwise show the runtime blocker first. Clearing one banner must not clear or visually downgrade the other.

### Admin pricing and operations states

| State | Treatment | Permitted action |
|---|---|---|
| Pricing draft | Editable, versioned, clearly not active | Save draft, preview, request publish validation |
| Coverage gap | Blocking row with affected allowlisted model/bucket | Create assignment; production debit remains unavailable for that scope |
| Scope/interval conflict | Explain normalized key and conflicting immutable assignment | Change draft scope/interval; never overwrite active history |
| Ready to publish | Read-only confirmation of exact values/evidence | Publish immutable version |
| Published active/scheduled/superseded | Immutable history with effective interval and approver | Inspect; create new draft for change |
| `DISPATCH_UNKNOWN` / `OUTCOME_UNKNOWN` | Reconciliation queue with bounded exposure and evidence age | Accept admission-bound terminal evidence, accept durable admission-bound no-usage proof, or escalate; never retry/re-dispatch the original invocation |
| Late receipt after reviewed no-usage | Append-only conflict; no automatic debit | Open audited integrity review |
| `BILLING_INTEGRITY_REVIEW` | Fail-closed case displays server-declared affected scope and allowed safe reads; normal settle/compensate shortcuts unavailable and top-up is never recovery | Authorized decision or audited reopen only |
| Compensation eligible | Show original, prior compensation, remaining bound | Create immutable compensation |
| Compensation exhausted/conflict | Disable submit with exact reason; preserve form evidence | Return to case / refresh version |

### Operational surface-state matrix

| Surface group | Loading / empty | Network, offline or stale | Permission / version conflict | Safe recovery |
|---|---|---|---|---|
| Wallet summary | Amount-shaped skeletons; never render temporary zero. Empty activity means no financial records, not no wallet. | Last authoritative values may remain visible only with stale timestamp/read-only label; top-up/Continue stay unavailable when authority cannot be confirmed. | Wrong owner returns a safe denial without wallet existence detail. A newer wallet version replaces, never client-merges with, the stale view. | Labeled retry preserves no secret data and announces only a changed semantic state. |
| Checkout / Payment status | Restore server-owned payment by stable return context; never create a second payment on load. | Retain non-sensitive entered amount; disable submit if authoritative quote/payment state is unavailable. | Expired LCSP session re-authenticates without resubmitting payment, restores Payment status/assessment return context when still authorized, then focuses and announces the status once. | Refresh existing payment idempotently; never infer success from provider query parameters. |
| Assessment payment gate / Continue | Show current server decision, not optimistic resume. Missing recovery context returns to Wallet summary. | Disable Continue while wallet/run/pricing/runtime authority cannot be refreshed. | Stale or duplicate cross-tab Continue refreshes latest wallet and assessment version, retains selected assessment context and shows the new blocker/action. | One assessment's wallet event never resumes/checkpoints another; each changes only on its own next admission evaluation. |
| Charge history / detail | Skeleton rows; empty history and filter-empty are distinct. | Stale history is read-only and labeled with last update; pending unknown outcomes remain non-final. | Removed ownership hides protected detail and returns a safe denial. | Retry fetch only; never retry provider work. |
| Pricing coverage / history | Skeleton table; distinguish no assignments, coverage gap and filter-empty. | Cached data is read-only; publish is unavailable offline. | Recheck Admin authority at submit. Stale draft/version or overlap preserves allowed draft fields and routes to conflict detail. Revocation clears protected evidence and returns focus to a safe surface. | Refresh server version and re-review immutable diff before publish. |
| Shadow billing comparison | Loading identifies rollout mode/version; empty variance means no comparable sample, not zero cost. | Stale rollout/pricing/receipt versions make the comparison read-only and explicitly non-current; it never updates Customer state. | Permission denial/revocation clears protected comparison evidence and provides no financial mutation. | Refresh authoritative shadow evidence; no settle, compensate, wallet or `PAYMENT_REQUIRED` action exists on this surface. |
| Reconciliation queue / case | Empty queue means no authorized open cases; filter-empty retains filter reset. | Cached evidence is read-only; no terminal decision is available offline. | Recheck authority and expected version at submit. On revocation clear protected case evidence; keep only policy-approved local draft rationale, never success state. | Reload immutable timeline. Unknown dispatch/outcome never permits original invocation retry. |
| Billing integrity / compensation | Missing eligible debit or exhausted bound is a terminal explanatory state, not an empty form. | Evidence/projection unavailable means no mutation. | Server declares affected freeze scope; stale compensation version refreshes original/prior/remaining values. Revoked authority clears protected evidence. | Return to safe history/case with correlation reference; never route to top-up for integrity recovery. |

Continue has explicit rejected outcomes: insufficient refreshed balance returns `PAYMENT_REQUIRED`; a non-resumable run/lease offers only a server-authorized recovery path; pricing unavailable or integrity failure dispatches no provider work and shows a safe correlation reference; applicable runtime safety failure retains its independent state. No-progress telemetry cannot reject Continue.

## Financial Disclosure and Integrity Rules

- The customer sees public credits derived from authoritative server values. The browser never recalculates token charges, FX, markup, tax, outstanding value, or compensation bounds.
- Before rollout mode `DEBIT_ENABLED`, telemetry, shadow prices and shadow settlements are non-authoritative simulations: they never appear as Customer debits/outstanding, never reduce Customer spendable credit, never emit `PAYMENT_REQUIRED`, and never change Continue behavior. Authorized Admins may inspect a separately labeled shadow comparison with rollout mode/version and no money-changing action.
- Checkout keeps `serviceValue`, `taxAmount`, `paymentTotal`, and `creditedMicrocredits` semantically distinct. Tax never appears as spendable credit.
- Customer history distinguishes finalized charges, pending unknown usage, and linked compensation. A pending invocation is not included in a displayed finalized total unless that total is explicitly labeled provisional.
- Customer totals include only `CUSTOMER_WALLET` financial effects. A `PLATFORM_SPONSORED` invocation is either Admin/audit-only or, when needed for Customer operation provenance, labeled `Nền tảng chi trả / không trừ ví` and excluded from Customer totals, outstanding credit and payment recovery without exposing sponsorship-policy internals.
- Provider-confirmed usage may remain billable when output is truncated, schema-invalid, or rejected downstream. Charge detail explains provider usage and output outcome as separate facts.
- Exact/provider/global pricing resolution is visible to authorized Admins and safe customer charge detail through version/reason, but internal costing and margin remain Admin-only.
- Original ledger history is never edited or deleted in UX. Corrections are new linked immutable records.
- `BILLING_INTEGRITY_REVIEW` responses declare an authoritative affected scope (invocation, case, wallet, or broader financial freeze) and allowed actions. UX keeps safe reads/downloads/history available, never presents top-up as the recovery, and disables only mutations blocked by that declared scope.
- Paid-tool billing is outside this experience; no tool-call price, allowance, or refund control is shown.

## Interaction Primitives

- Primary navigation remains the canonical desktop sidebar and smaller-screen sheet.
- All money-changing or authority-changing actions use explicit submit: top-up, Continue, publish, reconciliation decision, compensation. No hover, autosave, page load, payment callback, or toast triggers them.
- `Enter` may submit only when focus is inside the validated form and the primary action is unambiguous. Publish and compensation still require a review/confirmation step.
- `Escape` closes a dialog without discarding a saved draft or executing an action. Focus returns to the invoking control.
- Tables support keyboard row expansion, sorting, filtering, copy-safe references, and wrapped identifiers. Expand/collapse state is programmatically exposed.
- A payment provider return restores server state by idempotent lookup. Browser query parameters never establish that payment was credited.
- Continue targets one selected owner-scoped assessment. It re-fetches wallet, run/lease, pricing, and runtime state before presenting the result.
- Shared-wallet events update wallet values atomically with the new server version. Announce once only when the change alters the current surface's next permitted action; otherwise update the timestamp/activity passively. Never navigate, resume or checkpoint another assessment because a background assessment changed the wallet.
- Banned: automatic resume after payment, client-computed charge, inline editing of published tariffs or ledger rows, optimistic success for publish/compensation, generic `Blocked` without authority/recovery, and color-only state.

## Accessibility Floor

- WCAG 2.2 AA is the minimum for customer and Admin financial surfaces.
- Wallet values use programmatic labels that include unit and meaning; screen readers must not hear an unlabeled pair of numbers.
- Payment, credit, Continue, reconciliation, publish, and compensation transitions use a polite `aria-live` region. Integrity failures and destructive validation use assertive announcement only when immediate attention is required.
- Status is always text plus icon and color. Icons are decorative when the adjacent text already names the state.
- Checkout summary, charge groups, pricing coverage, and reconciliation evidence preserve a logical reading order at 200% zoom and narrow widths.
- Expandable logical-operation rows expose `aria-expanded`, associate child invocation rows, and keep focus on the parent after collapse.
- Dialogs trap focus and return it on close. Error summaries link to invalid form controls. React Hook Form/Zod errors remain visible and programmatically associated.
- Exact identifiers and references are copyable through a labeled button; hover-only tooltips are never the sole disclosure mechanism.
- Reduce Motion removes progress and state-transition animation without suppressing state announcements.
- Vietnamese and English layouts allow text expansion; fixed-width controls may not truncate the action or state meaning.
- Visible focus is never obscured, preserves the shadcn focus ring, has at least a 2 CSS-pixel perimeter-equivalent and `3:1` contrast between focused and unfocused states. Pointer targets are at least `24×24` CSS pixels or satisfy WCAG 2.5.8 spacing/inline exceptions.
- At 400% browser zoom / 320 CSS-pixel reflow, content and actions remain available without page-level horizontal scrolling. A genuinely tabular dataset may use one labeled keyboard-focusable horizontal scroll region with row identity retained while scrolling.
- Background polling never moves focus or repeats unchanged announcements. Announce user-requested refreshes and semantic transitions once through one atomic polite status region per surface; reserve assertive alerts for actionable failures.
- Public-credit values never use exponent notation, preserve exact required precision, include a localized unit, and expose accessible labels distinguishing service value, tax, payment total, credited, outstanding and spendable amounts. Admin microcredits expose the full integer plus unit.
- Data tables have a programmatic caption/name, semantic row/column headers, `aria-sort` for sortable headers, keyboard-reachable filters with result feedback, and labeled scroll regions. Mobile card transformations preserve every field label and the logical-operation-to-physical-invocation relationship.

## Responsive & Platform

| Viewport | Behavior |
|---|---|
| Desktop (`lg+`) | Persistent sidebar. Wallet may pair summary with recent history. Admin coverage/reconciliation use full tables and a side detail panel. |
| Tablet (`md`) | Navigation collapses; wallet and checkout stack. Admin tables use column controls; case detail opens as a wide sheet. |
| Phone (`< md`) | One task per screen. Logical operations become expandable rows/cards; invocation fields stack. Admin publication and compensation remain possible but use a full-screen review step. |

No financial capability becomes desktop-only. Dense Admin evidence may be easier on desktop, but mobile must still expose the complete decision and confirmation rather than silently omitting fields.

## Key Flows

### Flow 1 / UJ-2 — Customer recovers from payment required: Lan resumes one assessment deliberately

1. Lan is reviewing an assessment when the next model call reaches `PAYMENT_REQUIRED`.
2. The assessment payment gate explains that completed findings are preserved, shows spendable/outstanding credit, and links to top-up.
3. Lan opens checkout and sees service value, tax, payment total, and the credited amount as distinct rows.
4. She pays and returns to Payment status. LCSP confirms the payment server-side and credits it exactly once.
5. The success surface says the assessment has **not** resumed and offers `Tiếp tục` for that assessment.
6. Lan selects Continue. LCSP re-checks wallet, pricing, run/lease, and runtime safety.
7. **Climax:** the assessment progress surface returns with a clear `Yêu cầu tiếp tục đã được chấp nhận` status; Lan knows she resumed one assessment intentionally, not every assessment sharing the wallet.

Failure: payment is confirmed but the run lease has expired. The wallet success remains visible, while a separate runtime state explains why this run cannot resume and provides the authorized recovery action.

### Flow 2 / SM-9 — Charge comprehension: Minh explains two physical invocation charges

1. Minh opens Wallet summary after noticing a balance change.
2. Charge history shows one logical operation for legal analysis with a finalized total and two physical invocations.
3. He expands the operation. The first invocation is a failed provider attempt with confirmed usage; the second is a fallback model invocation.
4. Each row shows safe provider/model, token buckets, tariff version/resolution, credits, outcome, and correlation reference—never the prompt or output.
5. **Climax:** Minh can explain the total as two billable provider invocations, not a duplicated ledger debit.

Failure: the fallback has no terminal receipt. Its row says `đang được đối soát`, is excluded from the finalized total, and does not guess zero or a future charge.

### Flow 3 / UJ-6 — Admin publishes governed model pricing: Hương publishes an immutable tariff

1. Hương, an authorized Billing and Pricing Admin, opens Pricing coverage and filters to an allowlisted provider/model with a coverage gap.
2. She creates a draft, attaches provider cost-source evidence, and reviews editable FX reference, fees, infrastructure estimate, risk buffer, and markup assumptions.
3. The preview separates suggested tariff and projected margin from her approved bucket rates.
4. She selects exact-model scope and a half-open effective interval, then requests validation.
5. Publish review shows normalized provider/model identity, every required bucket rate, source evidence, interval, pricing version, and the immutable-publication warning.
6. **Climax:** Hương confirms publication; Pricing history adds a new immutable snapshot/assignment and coverage moves to scheduled or active without changing prior history.

Failure: another Admin published an overlapping interval first. The stale publish is rejected, Hương's draft is preserved, and the conflict identifies the immutable assignment she must account for.

### Flow 4 / UJ-7 — Admin reconciles unknown usage and compensates safely: Quang preserves history

1. Quang, an authorized billing operator, opens the Reconciliation queue and selects an aged `OUTCOME_UNKNOWN` case.
2. The case timeline shows immutable admission, dispatch acknowledgement, safe provider field presence, pinned pricing authority, bounded exposure, and prior actions.
3. A late provider receipt is admission-bound and passes mapping/integrity validation, so Quang chooses the authorized settle path.
4. The resulting debit appears as a new immutable financial record; the customer charge detail moves from pending to settled.
5. Quang determines that an eligible portion should be waived and opens Compensation review from the debit.
6. The form shows original debit, prior compensation, remaining eligible bound, reason, and resulting wallet projection.
7. **Climax:** submission appends a bounded compensation linked to the original debit; both records remain visible and auditable.

Failure: late evidence contradicts a previously reviewed no-usage decision. LCSP routes the case to `BILLING_INTEGRITY_REVIEW`, disables ordinary settlement/compensation shortcuts, and requires an explicit audited reopen.

### Flow 5 — Mai sees payment and an expired run as different conditions

1. Mai opens an assessment stopped for insufficient credit; its prior run lease has since expired.
2. The overview shows the financial gate and current run state with separate explanations.
3. Mai tops up; the payment gate changes to `WAITING_FOR_CUSTOMER_CONTINUE`, while the expired run state remains unchanged.
4. She selects Continue. LCSP re-evaluates both authorities and rejects resuming the expired lease.
5. **Climax:** Mai sees available credit and the server-authorized action for starting a valid run; the rejected Continue creates no provider call or charge.

Failure recovery: Mai follows the authorized run recovery action. The system performs fresh checks rather than reusing the earlier payment result as permission.

### Flow 6 — Hương inspects shadow settlement without changing Customer money

1. Hương opens Shadow billing comparison during `SHADOW_SETTLEMENT` rollout.
2. The surface names the rollout mode/version and compares simulated tariff results with provider evidence and authoritative Customer ledger effects, which remain unchanged.
3. She filters by provider/model/policy version and opens a variance row; every shadow value is labeled non-authoritative and no settle, compensate or wallet action is available.
4. **Climax:** Hương records the variance evidence needed for the enablement review without creating a Customer debit, outstanding amount or `PAYMENT_REQUIRED` state.

Failure: the selected rollout/pricing version is stale or there is no comparable sample. The surface becomes read-only, labels the evidence stale or insufficient, and offers only an authoritative refresh; empty variance never renders as zero cost or gate approval.

## Handoff Boundary

- The validated spine tables and state/flow contracts are the visual handoff. LCSP brand, component library, responsive shell, and per-page task-table convention are already approved; Prompt 8 planning approval requires no new pixel mockup.
- Final production message keys, Vietnamese editorial review, provider-specific payment copy, and numeric formatting rules belong in implementation stories and i18n acceptance tests without changing the behavioral authority above.
- This UX contract does not enable production debit. `G-01..G-07`, rollout mode, migration, rollback, security, and operations evidence remain separate release gates.
