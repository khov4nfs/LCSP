---
name: LCSP Prompt 8 Shared Wallet
description: Financial UX overlay for shared-wallet model usage, governed pricing, and billing recovery in LCSP.
status: final
sources:
  - docs/product/prd.md
  - docs/product/addendum.md
  - docs/architecture/adr/adr-028-shared-wallet-model-usage-settlement.md
  - docs/planning-artifacts/sprint-change-proposal-2026-11-24.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md
updated: 2026-11-24
colors:
  background: '#F7F8FA'
  surface: '#FFFFFF'
  surface-muted: '#EEF1F4'
  surface-warning: '#FFF6E6'
  surface-success: '#EAF7EF'
  surface-danger: '#FDECEC'
  ink: '#18202A'
  ink-muted: '#5B6673'
  border: '#D7DDE4'
  primary: '#155E75'
  primary-foreground: '#FFFFFF'
  success: '#1F7A4D'
  warning: '#A15C00'
  danger: '#B42318'
  info: '#2563A6'
typography:
  display:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: 32px
    fontWeight: '650'
    lineHeight: '1.2'
  title:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: 18px
    fontWeight: '620'
    lineHeight: '1.35'
  body:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.55'
  label:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: 13px
    fontWeight: '560'
    lineHeight: '1.35'
  caption:
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '6': 24px
  '8': 32px
  page-gutter: 24px
  page-gutter-mobile: 16px
components:
  wallet-summary:
    background: '{colors.surface}'
    border: '{colors.border}'
    radius: '{rounded.lg}'
  payment-blocker:
    background: '{colors.surface-warning}'
    foreground: '{colors.warning}'
    radius: '{rounded.md}'
  runtime-blocker:
    background: '{colors.surface-danger}'
    foreground: '{colors.danger}'
    radius: '{rounded.md}'
  reconciliation-notice:
    background: '{colors.surface-muted}'
    foreground: '{colors.info}'
    radius: '{rounded.md}'
  immutable-record:
    background: '{colors.surface}'
    border: '{colors.border}'
    radius: '{rounded.sm}'
---

# LCSP Prompt 8 Design Spine

## Brand & Style

This file is a visual delta over the canonical LCSP design spine. It introduces no new brand, palette, type family, radius language, or decorative motif. Prompt 8 remains a quiet compliance workbench: exact amounts, source evidence, immutable history, current state, and the next permitted action must be easier to see than financial jargon.

All surfaces inherit the approved Figma DS Brand system (`1104:31791`) and use the shared production `LCSPLogo`: Logo Lockup (`1106:31809`) for customer billing and Admin navigation, Logo Mark (`1105:31795`) only where space is constrained, following usage notes (`1107:31803`). Never reconstruct the brand with text or a generic icon.

The implementation system remains shadcn/ui on Base UI primitives, Tailwind CSS v4.3, and the existing Atomic Design boundaries. The token values above repeat only the canonical LCSP tokens consumed by this overlay; they are not a second theme. If the canonical spine changes, this overlay must be rebased rather than allowed to drift.

## Colors

- `{colors.primary}` identifies the one primary action on a surface: `Nạp credit`, `Tiếp tục`, `Xuất bản bảng giá`, or the selected reconciliation decision.
- `{colors.warning}` with `{colors.surface-warning}` identifies a recoverable financial gate such as `PAYMENT_REQUIRED`. It never implies runtime safety permission.
- `{colors.danger}` with `{colors.surface-danger}` identifies applicable runtime failures, integrity contradictions, destructive consequences, or denied authority. It is not used merely because a balance is low.
- `{colors.info}` on a neutral surface identifies pending evidence such as `OUTCOME_UNKNOWN`; it must not imply that a charge is final, free, or refundable.
- `{colors.success}` confirms a completed financial fact such as credited payment or published tariff. It never indicates that an assessment resumed unless the resume command itself succeeded.

Every state combines color with a text label, icon, and explicit next action. Customer screens never expose projected margin, markup, provider cost assumptions, internal risk buffer, or operational gate evidence.

## Typography

Financial hierarchy uses the canonical Inter/system stack. Spendable credit is the primary amount in `{typography.display}` only on the wallet summary. Outstanding credit is equally explicit but not visually conflated with spendable value. Checkout totals, credited amount, token buckets, tariff version, and invocation identifiers use stable tabular numerals where the existing font supports them.

Use `{typography.caption}` for safe provenance such as pricing version, resolution reason, correlation reference, evidence timestamp, and immutable record ID. Captions remain readable and copyable; critical financial meaning is never hidden in a tooltip or reduced to low-contrast metadata.

## Layout & Spacing

Customer wallet and recovery surfaces use a constrained single-column reading order: balance state, explanation, action, then history. Desktop charge history may use an expandable table, but the logical operation remains the parent row and physical retries/fallbacks remain child rows.

Admin pricing and reconciliation surfaces may use the existing wide operational layout. Pricing coverage and reconciliation queues are tables; draft editing, publish review, case evidence, and compensation are focused panels or dialogs. Use `{spacing.4}` inside grouped financial objects, `{spacing.6}` between decision sections, and `{spacing.8}` between separate authorities such as pricing evidence and publish confirmation.

Checkout preserves a fixed semantic order on every viewport:

1. service value;
2. customer transaction tax;
3. payment total;
4. credit that will be added.

Do not place tax next to credited value in a way that suggests tax becomes spendable credit.

## Elevation & Depth

Use borders and tonal layers before shadows. Wallet summaries, charge groups, pricing assignments, reconciliation evidence, and compensation records are durable work objects, not promotional cards. Dialog elevation is reserved for explicit confirmation of irreversible publication or a compensation decision.

Nested financial hierarchy is expressed with indentation, row grouping, separators, and labels—not card-inside-card depth. Immutable history remains flat and inspectable.

## Shapes

Use `{rounded.lg}` for wallet and focused decision panels, `{rounded.md}` for banners, buttons, inputs, and dialogs, and `{rounded.sm}` for status badges and immutable metadata rows. Pills are limited to short state labels. Amounts and actions are never enclosed in decorative capsules.

## Components

- **Wallet summary** — `{components.wallet-summary}`. Shows `Credit khả dụng` and `Credit còn phải thanh toán` as two named values. Never shows an ambiguous signed balance or per-assessment allocation.
- **Payment blocker** — `{components.payment-blocker}`. Contains the affected paid step, preserved-work statement, spendable/outstanding values, `Nạp credit`, and the fact that payment will not resume work automatically.
- **Runtime blocker** — `{components.runtime-blocker}`. Names an applicable runtime failure and its recovery action. It remains distinct from the payment blocker; no-progress telemetry is not rendered as a blocker.
- **Continue panel** — Inherited shadcn panel composition. Shows the selected assessment, authoritative wallet timestamp/version, current runtime gate and one explicit `Tiếp tục` action; it never presents payment success as resume success.
- **Reconciliation notice** — `{components.reconciliation-notice}`. Marks usage whose final charge is not yet known. It shows a safe reference and review state without guessing zero or final cost.
- **Charge group** — shadcn table/accordion composition. Parent row is the logical operation; expanded child rows are physical invocations with provider/model, token buckets, tariff version/resolution, credits, outcome, and correlation reference.
- **Physical invocation row** — Inherited semantic table row/detail composition. Visually preserves the parent logical-operation relationship and distinguishes finalized, sponsored, dispatch-unknown, usage-unknown, and compensated outcomes with text plus icon.
- **Checkout breakdown** — shadcn form/card composition with the four fixed amount rows. The submit button repeats the payment total; the confirmation repeats credited value separately.
- **Pricing coverage table** — Admin table grouped by exact model, provider default, and optional approved global default. Missing/overlapping coverage is an explicit blocking state, never an empty cell interpreted as zero.
- **Pricing draft editor** — React Hook Form plus Zod composition. Separates cost-source evidence, editable assumptions, suggested tariff, projected margin, bucket rates, effective interval, and scope. Suggested values remain distinguishable from Admin-approved inputs.
- **Immutable publish confirmation** — shadcn Dialog. Summarizes scope, normalized model/provider identity, rates, interval, evidence, approval context, and the fact that publication creates a new immutable version.
- **Immutable record** — `{components.immutable-record}`. Used by publish history, ledger charge, reconciliation decision, and compensation. Original records remain visible when a later record supersedes or offsets them.
- **Reconciliation evidence timeline** — Inherited list/timeline composition. Leads with contradiction, affected scope and permitted decision, then progressively discloses immutable admission, dispatch and receipt evidence without hiding mandatory warnings.
- **Compensation review** — Shows original debit, already compensated amount, remaining eligible amount, requested reason, resulting projection, and immutable linkage before submission.

`Wallet summary`, `Payment blocker`, `Runtime blocker`, `Reconciliation notice`, and `Immutable record` have Prompt 8 token deltas in frontmatter. The remaining components are named compositions of inherited shadcn and canonical LCSP tokens; their explicit names align one-to-one with `EXPERIENCE.md` and do not introduce a second token family.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Name spendable and outstanding credits separately | Present one signed balance and expect the customer to infer its meaning |
| Show logical operation first and physical retries/fallbacks on expansion | Collapse all retries into one unexplained charge |
| Keep payment and runtime blockers as separate components | Reuse one generic `Blocked` banner for every cause |
| State that payment succeeded and a manual Continue is still required | Use a success screen that implies automatic resume |
| Keep original debit and immutable compensation visible together | Edit, delete, or visually replace the original charge |
| Label pending usage as under review | Treat missing usage as zero or a final charge |
| Show Admin evidence, assumptions, projected margin, and version | Expose internal margin assumptions on customer surfaces |
| Reuse canonical tokens, shadcn primitives, and `LCSPLogo` | Add a finance-specific theme, invented logo, gradient, or decorative chart |
