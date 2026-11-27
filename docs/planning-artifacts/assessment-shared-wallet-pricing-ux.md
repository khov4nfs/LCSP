---
title: LCSP Assessment Shared-Wallet and Model-Pricing UX
status: canonical_prompt8_ux_final
updated: 2026-11-24
authority:
  - docs/product/prd.md
  - docs/product/addendum.md
  - docs/architecture/adr/adr-028-shared-wallet-model-usage-settlement.md
  - docs/planning-artifacts/sprint-change-proposal-2026-11-24.md
design_spines:
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-11-24-shared-wallet/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-11-24-shared-wallet/EXPERIENCE.md
---

# Assessment shared-wallet and model-pricing UX

## 1. Purpose and authority

This document is the Prompt 8 UX authority for customer wallet recovery, per-invocation charge explanation, governed model pricing, unknown-usage reconciliation, billing-integrity review and immutable compensation. It adds financial surfaces to the existing assessment experience without turning an assessment into a separate wallet.

The active authorization model is RBAC with owner/resource scope. Customer data is scoped through `assessment.ownerId` and `wallet.userId`; Billing and Pricing Admin actions require explicit resource/action permission. Organization membership and PBAC are not active authority boundaries.

Production model-usage debit remains disabled until the approved enablement gates `G-01..G-07` are GREEN. This UX specification authorizes design and acceptance-test work; it does not by itself authorize debit enablement or approve tariff values.

When the Prompt 8 artifacts differ, the paired `DESIGN.md` controls visual presentation, `EXPERIENCE.md` controls behavior and state transitions, and this document controls Prompt 8 scope, requirement traceability and release gates. Product requirements and ADR-028 remain authoritative for business and architecture decisions.

## 2. Experience invariants

1. One customer has one shared prepaid wallet across all owned assessments. No screen presents per-assessment credit allocation, reservation or a separate assessment balance.
2. Wallet summary exposes two non-ambiguous values: spendable credits and outstanding usage. A signed internal projection is never shown as one unexplained negative number.
3. `PAYMENT_REQUIRED` blocks only new paid model invocations. It preserves completed artifacts and does not imply that the assessment failed.
4. Successful top-up never resumes work automatically. Customer must select **Continue**, and the server must re-evaluate wallet, pricing, assessment run/lease and runtime safety.
5. Payment recovery and runtime recovery are independent. Paying cannot clear an applicable runtime safety failure or invalid run/lease. No-progress does not block the assessment or require Admin unlock.
6. A logical operation may contain multiple separately billable physical invocations caused by retry or fallback. The UI groups them without hiding each charge.
7. Canonical domain/API state `OUTCOME_UNKNOWN` is neither a zero charge nor a completed charge. It remains visibly pending reconciliation and cannot be described as free, settled or refunded.
8. Customer surfaces never expose raw prompts, raw outputs, secrets, provider credentials, internal cost assumptions, markup or projected margin.
9. Financial history is append-only in the experience: debit and compensation remain separately visible. Admin cannot edit or delete a historical ledger entry.
10. Status, amounts and next actions are conveyed by text and programmatic semantics, never color alone.
11. Before `DEBIT_ENABLED`, shadow pricing/settlement is Admin-only non-authoritative comparison data. It cannot alter Customer balance, charge history, `PAYMENT_REQUIRED` or Continue behavior.
12. Customer totals include only `CUSTOMER_WALLET` effects. `PLATFORM_SPONSORED` work creates no Customer debit/outstanding/payment gate and is either Admin/audit-only or labeled platform-funded without exposing sponsorship-policy internals.

## 3. Actors and navigation

| Actor | Entry | Surfaces | Authority boundary |
|---|---|---|---|
| Customer (who may also be the Manager) | Assessment overview, account menu | Wallet summary, top-up, payment status, payment-required recovery, Continue, charge history | Own wallet and owned assessments only |
| Billing and Pricing Admin | Admin navigation | Pricing coverage, pricing draft, publish confirmation/history, reconciliation queue, integrity review, compensation | Explicit RBAC permission per action/resource |
| Support/read-only operator | Admin link from incident/audit reference | Redacted reconciliation or integrity detail | Read-only permission; no publish, resolve or compensate action |

Customer wallet and charge history live in account-level billing navigation because the wallet is shared. Assessment overview may show a compact financial blocker and deep-link to the shared-wallet recovery surface, but it must not render an assessment-specific balance.

## 4. Customer surfaces

### 4.1 Wallet summary

| Element | Required behavior |
|---|---|
| Spendable credits | Amount currently available for new paid model calls. Display the canonical public-credit unit and last-updated time. |
| Outstanding usage | Confirmed charge not yet covered by credit. Show `0` explicitly when none exists; explain that the next top-up clears this first. |
| Top up | Primary action. Opens checkout amount selection and breakdown. |
| Recent activity | Latest confirmed credits, debits and compensations. Unknown usage appears as a non-monetary pending state until resolved. |
| Assessment links | A charge can link to the owning assessment/run when the customer still has access. It never changes wallet scope. |

Loading uses amount-shaped skeletons and does not temporarily display zero. A load failure keeps the last-known value labeled stale when available; otherwise it hides monetary actions that require authoritative balance and offers retry with a correlation reference.

### 4.2 Top-up checkout and payment status

The checkout summary must separate:

| Line | Meaning |
|---|---|
| Service value | Pre-tax value purchased from LCSP. |
| Tax | Customer transaction tax; never credited to wallet. |
| Payment total | Amount sent to the payment provider. |
| Credited amount | Pre-tax service value converted to wallet credits after confirmed payment. The wallet applies those credits to outstanding usage first; only the remainder becomes spendable. |

Before confirmation, the customer can review and change the selected amount. A non-trivial top-up form uses React Hook Form and a feature-local Zod schema. Duplicate browser submission or payment callback must resolve to the same payment record; the UI must not claim credit until confirmation is authoritative.

Payment status has explicit states: `AWAITING_PAYMENT`, `PROCESSING`, `CONFIRMED`, `FAILED`, `EXPIRED` and `CANCELLED`. `PROCESSING` explains that closing the page does not create another payment and provides a safe refresh/status action. `CONFIRMED` shows credited amount, amount applied to outstanding usage, resulting spendable credits and a **Return to assessment** action when a recovery context exists.

### 4.3 Payment-required recovery

The assessment blocker contains:

- heading and body derived from stable shared i18n keys;
- current spendable and outstanding credits;
- the fact that completed work has been preserved;
- primary **Top up credits** action;
- secondary **View charge history** action;
- safe assessment/run and correlation references.

Candidate Vietnamese copy:

> **Cần nạp thêm credit để tiếp tục**  
> Hệ thống đã tạm dừng các lượt gọi mô hình có tính phí mới. Kết quả đã hoàn thành vẫn được giữ nguyên. Sau khi thanh toán, bạn cần quay lại và chọn **Tiếp tục**.

The UI must not say that payment failed the assessment, that the assessment will resume automatically, or that top-up clears an applicable runtime safety failure.

### 4.4 Manual Continue

After payment is confirmed, the assessment overview shows **Continue** only when the authenticated customer still owns the assessment and there is a resumable checkpoint. Activating it sends no client-selected wallet, tariff, model, admission or charge authority.

The action has these outcomes:

| Outcome | Treatment |
|---|---|
| Accepted | Announce that the assessment is continuing and move to the current runtime-status surface. |
| Balance still insufficient | Remain in `PAYMENT_REQUIRED`; refresh authoritative amounts and explain why no work started. |
| Runtime safety failure | Show the independent failure and its own next action; do not return to checkout as the primary recovery. |
| Run/lease no longer resumable | Explain that the prior run cannot continue and offer the server-authorized restart/review action, if any. |
| Pricing unavailable/integrity failure | Fail closed with a safe support/correlation reference; do not dispatch provider work. |

Continue is never optimistic. Disable repeated activation while the server decision is pending, but preserve keyboard focus and announce the result.

Every Continue response includes the latest wallet and assessment version. A stale tab, cross-tab duplicate or intervening debit/top-up never client-merges with the old view: refresh authoritative state, retain the selected assessment context, announce the changed blocker/action and dispatch no work unless the fresh decision accepts it. A wallet change from one assessment never resumes or checkpoints another assessment automatically.

### 4.5 Runtime and financial blocker separation

| State | What stopped | Primary action | Payment effect |
|---|---|---|---|
| `PAYMENT_REQUIRED` | New paid model invocation | Top up, then manual Continue | Can resolve the financial precondition |
| `SAFETY_LIMIT_REACHED` | Approved runtime safety boundary | Review or approved override/restart path | No effect |
| `DISPATCH_UNKNOWN` | Whether the admitted invocation reached the provider is unresolved | Wait for bounded reconciliation; never retry or re-dispatch the same physical invocation | Top-up does not resolve the case |
| `OUTCOME_UNKNOWN` | Financial outcome of an already dispatched invocation is incomplete | Wait for reconciliation; inspect safe details | Top-up does not resolve the case |
| `BILLING_INTEGRITY_REVIEW` | Contradictory pricing, usage, exposure or projection evidence | Contact support / operator review | No effect; payment cannot clear the review, and financial automation remains failed closed |

If more than one blocker exists, show them as separate ordered items. Financial recovery may be completed while the runtime blocker remains, and the assessment stays paused until all required gates pass.

### 4.6 Charge history

The default row represents a logical operation such as classification, evidence analysis or report generation. Expanding it reveals every physical invocation.

| Logical-operation row | Physical-invocation detail |
|---|---|
| Operation name and assessment | Provider and resolved model |
| Started/completed time | Requested model when different |
| Total finalized charge in credits | Input, cached-input, cache-write, visible-output and reasoning token buckets when supplied |
| Invocation count | Pricing snapshot version and resolution: exact/provider/global |
| Outcome summary | Debit, pending unknown outcome, non-billable resolution or compensation |
| Expand/collapse control | Correlation reference and safe timestamps |

Retry and fallback invocations are labeled as separate provider attempts, not duplicate charges. If a compensation exists, the original debit remains visible with a linked positive entry and remaining uncompensated amount.

Customer totals include only `CUSTOMER_WALLET` effects. A `PLATFORM_SPONSORED` invocation is either omitted from Customer financial history and retained in Admin/audit provenance, or—when operation comprehension requires it—shown as `Nền tảng chi trả / không trừ ví`, excluded from total/outstanding and stripped of sponsorship-policy internals.

## 5. Admin surfaces

### 5.1 Pricing coverage list

The list is ordered by resolution precedence and clearly labels:

1. exact resolved-model assignment;
2. provider default;
3. optional approved global default.

Rows show scope, provider/model identifier, effective interval, immutable snapshot version, coverage status, source-evidence freshness and future/superseded state. A default never makes an unknown or non-allowlisted model valid. Filters include provider, model, scope, active-at time and coverage gap.

Before `DEBIT_ENABLED`, an authorized operations view may show clearly labeled shadow pricing/settlement variance with rollout mode and policy version. Shadow values are comparison evidence only: they provide no publish/settle/compensate shortcut, never appear in Customer wallet/history and never trigger `PAYMENT_REQUIRED`.

### 5.2 Pricing draft and preview

The form separates evidence from editable assumptions:

- provider price source and version;
- provider billing currency and cost buckets;
- reference FX evidence used for planning, and realized provider-invoice or payment-settlement evidence used for profitability review;
- infrastructure-overhead assumption;
- markup multiplier;
- customer tariff rates in integer microcredits for every supported usage bucket;
- effective scope and interval.

Initial planning values (`26,500 VND/USD`, `10%` infrastructure overhead and multiplier `1.8`) are editable draft inputs, never hard-coded runtime values. Suggested tariff and projected margin are previews only. Runtime settlement later uses the immutable published customer tariff and does not fetch FX, add tax or recompute markup.

Preview must identify missing provider buckets, stale evidence, unsupported model aliases, overlap, and rounding effects. A missing required rate blocks publication rather than becoming zero.

### 5.3 Immutable publish confirmation and history

Publish requires a review step that shows the complete diff from the draft/base version, scope, effective interval, every rate, evidence references, assumptions and projected margin. The confirmation states that publication creates an immutable snapshot/assignment and future corrections require a new version.

Publication rejects stale draft version, overlapping effective interval, unknown/non-allowlisted resolved model, incomplete rate coverage and missing approval evidence. The history records actor, time, snapshot, assignment, reason and audit/correlation reference. No edit/delete action appears for published records.

### 5.4 Reconciliation queue

Queue rows show age, provider/model, assessment/run/invocation reference, admission state, receipt state, pinned pricing version and safe reason. Raw prompts/outputs and credentials are excluded. Filters include `DISPATCH_UNKNOWN`, `OUTCOME_UNKNOWN`, late receipt, unbound callback quarantine, non-billable resolution and SLA age. Both unknown states retain bounded exposure; neither permits retrying or re-dispatching the same physical invocation.

Supported decisions are permissioned and versioned:

- bind a valid late receipt through the authoritative server path;
- accept `CONFIRMED_NO_USAGE` only when the server validates durable no-usage proof bound to the original admission; absence of a receipt, operator opinion or a reason alone is insufficient;
- apply a separate policy-authorized non-billable resolution only when product/architecture defines that authority and its evidence contract; it must never masquerade as provider no-usage proof;
- escalate to `BILLING_INTEGRITY_REVIEW`;
- leave pending when evidence is insufficient.

Operator action does not let the browser choose customer, wallet, tariff or amount. Those identities are derived and verified server-side.

Every Admin submit rechecks session and action/resource permission. Expired or revoked authority never executes a publish, reconciliation or compensation decision, never renders success, clears protected case evidence and returns focus to a safe surface with a correlation reference. A policy-approved local draft may retain only non-sensitive fields.

### 5.5 Billing-integrity review

The review surface compares immutable evidence without offering a generic “force settle” action. It identifies the contradiction among admission, maximum exposure, pricing authority, provider usage, ledger and wallet projection. The server declares the affected scope—invocation, case, wallet or broader financial freeze—and allowed actions. UX keeps safe reads/downloads/history available, never offers top-up as recovery, and disables only mutations blocked by that scope. Resolution choices are narrow, separately permissioned, reason-required and audit-linked. Customer-facing financial automation remains failed closed until the case reaches an authorized terminal decision.

### 5.6 Bounded compensation

Compensation starts from an eligible original debit. The surface shows original amount, prior compensation, maximum remaining eligible amount and reason category. The operator enters an amount not exceeding that bound and reviews the resulting append-only entry before confirmation.

Compensation never edits the debit, never changes provider usage evidence and never masquerades as goodwill credit. Duplicate submission resolves idempotently to the same compensation result.

## 6. Voice, i18n and accessibility

- Every customer-facing label, description, error, accessible name and status announcement is an `@lcsp/i18n` key with Vietnamese and English values. Backend prose is not final display copy.
- Amounts use locale-aware grouping while preserving exact public-credit value; identifiers and pricing versions remain copyable.
- `aria-live="polite"` announces normal payment, balance and Continue transitions. Failed financial actions use an assertive alert only when immediate attention is required.
- Polling and background refresh remain silent while semantic state is unchanged, never move focus and deduplicate repeated payloads; each surface uses one atomic polite status region.
- Focus moves to the state heading after route-level recovery changes and returns to the invoking control after dialogs/drawers close.
- Payment return after session expiry uses a stable non-secret return context, re-authenticates without resubmitting payment, restores the existing server-owned payment/assessment target when still authorized, focuses Payment status and announces the current state once.
- Dialogs trap focus; all tables, filters, expandable invocation rows and confirmation controls are keyboard operable.
- Visible focus is unobscured, keeps the shadcn focus ring, meets a 2 CSS-pixel perimeter-equivalent and `3:1` focused/unfocused contrast. Pointer targets meet WCAG 2.5.8 (`24×24` CSS pixels or its documented spacing/inline exceptions).
- Status badges always include visible text. Charts or color-coded margin previews require an equivalent textual/table value.
- No critical explanation is hover-only. Use shadcn Tooltip only for supplementary hints, with a semantic visible label or `aria-label`; never use HTML `title` attributes.
- Customer wording says “credit” and explains outstanding usage in plain language. Visible values never use exponent notation, preserve exact precision and include a localized unit plus an accessible label distinguishing service value, tax, total, credited, outstanding and spendable values. Internal microcredit arithmetic may appear only where exact audit/administrative detail is required and exposes the full integer plus unit.
- At 400% zoom / 320 CSS-pixel reflow, no content or action is lost and page-level horizontal scrolling is unnecessary. Genuinely tabular data may use one labeled keyboard-focusable horizontal scroll region. Tables retain a programmatic caption/name, semantic headers, `aria-sort`, filter-result feedback and equivalent labeled fields when transformed to mobile cards.

## 7. Responsive behavior and component ownership

Desktop is primary for Admin pricing/reconciliation and detailed charge inspection. Tablet stacks summary and action panels. Phone supports wallet summary, top-up, payment recovery, Continue and charge review; dense Admin tables may use column controls and detail sheets but must remain operable.

Use existing shadcn primitives from `apps/web/src/components/ui`. Domain-neutral amount/status/definition patterns belong in shared Atomic Design directories. Wallet, checkout, pricing, reconciliation and compensation compositions live under their feature-local `components/{molecules,organisms}` paths. Schemas, types and static configuration remain in sibling directories. Non-trivial forms use React Hook Form and feature-local Zod schemas.

## 8. Browser acceptance journeys

### Journey C1 — Customer restores funding and continues manually

1. Lan opens an assessment paused at `PAYMENT_REQUIRED`.
2. She sees preserved progress, spendable `0`, outstanding usage and the top-up action.
3. Checkout separates service value, tax, total and credited amount.
4. Payment reaches `CONFIRMED`; the page shows how much cleared outstanding usage and the resulting spendable credit.
5. She returns to the assessment. It is still paused.
6. **Climax:** Lan selects **Continue**, receives an accessible “continuing” announcement, and the assessment resumes only after server re-evaluation passes.

Failure variant: payment confirms but the run/lease is no longer resumable. Continue explains the current state and offers only the server-authorized recovery action; it does not create a new paid invocation.

### Journey C2 — Customer explains a retry charge

1. Minh opens account-level charge history.
2. He finds a classification operation with two physical invocations.
3. He expands the row and sees the first provider attempt timed out with unknown usage before later reconciliation, while the fallback completed.
4. **Climax:** Minh can distinguish the logical operation from each provider attempt, its pricing version, token buckets and final financial outcome without seeing raw prompts or internal margin.

### Journey A1 — Admin publishes a governed tariff

1. Hanh opens a pricing draft for an allowlisted resolved model.
2. She selects cost-source evidence, reviews editable assumptions and completes all supported token-bucket rates.
3. Preview shows suggested tariff, projected margin and exact/provider/global coverage effect.
4. She reviews the immutable diff and confirms publication.
5. **Climax:** Publish history shows the new immutable version and effective assignment; the prior version remains inspectable.

Failure variant: an overlapping interval or stale draft version blocks publish and keeps the draft available for correction.

### Journey A2 — Admin resolves unknown usage without rewriting history

1. Quang opens an aged `OUTCOME_UNKNOWN` case.
2. He reviews redacted admission, pinned pricing and provider-receipt evidence.
3. A valid late receipt arrives and is bound by the authoritative server workflow.
4. A separately authorized correction is required, so he starts compensation from the original debit.
5. **Climax:** the history displays the unchanged debit and bounded compensation as linked immutable entries with one audit trail.

## 9. Traceability and acceptance

| UX capability | Requirement / acceptance authority |
|---|---|
| Shared wallet summary | FR-083, AC-051 |
| Checkout and idempotent credit | FR-084, AC-052 |
| Admin pricing draft/publish/coverage | FR-085..FR-087, AC-053..AC-055 |
| Admission-backed Continue and no-dispatch failure | FR-088, AC-056 |
| Atomic settlement-backed charge history | FR-089, AC-057 |
| Payment-required and Continue | FR-090, AC-058, SM-8 |
| Charge grouping and provenance | FR-091, AC-059, SM-9 |
| Unknown usage and integrity review | FR-092, AC-060 |
| Immutable compensation | FR-093, AC-061 |
| Billing/runtime separation | FR-094, AC-063, NFR-033, NFR-042 |
| Production debit enablement gate | AC-062, G-01..G-07 |
| Accessible financial interactions | NFR-14 |
| Privacy-safe telemetry and display | NFR-041 |

Implementation stories must include focused component/domain tests and real-browser verification of C1, C2, A1 and A2. Financial state transitions require API/contract tests; browser tests prove presentation and interaction but do not replace server-side authorization, idempotency or atomicity evidence.

## 10. Deferred or gated items

### Assessment failure diagnostics

Admin may investigate assessment failures using redacted AuditEvent and runtime telemetry. The current Admin audit list filters event type, actor and time, but does not provide an assessment/run/correlation timeline; customer provenance remains Customer-only. A dedicated Admin diagnostic read model is therefore a follow-up requirement: scope by assessment ID, run ID and correlation ID; show safe event chronology, error class, retry, usage and checkpoint references; enforce explicit RBAC permission and redact customer case evidence, raw prompts, outputs and secrets. Investigation does not grant Admin access to full customer provenance or create a no-progress unlock workflow.

- Paid-tool billing is outside Prompt 8.
- No lower business output-token cap or runtime warning threshold is introduced before representative telemetry is available.
- Pricing assumptions remain drafts until Product/Finance approval; this UX does not approve tariff values.
- Production debit remains gated by `G-01..G-07`, migration reconciliation, rollback rehearsal and operational evidence.
- Pixel-level mockups are optional because the LCSP visual system and component library are already approved; the design/experience spines and per-story component/state tables remain the implementation contract.
