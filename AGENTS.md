<!-- Source: AGENTS.md -->

@RTK.md

## Tailwind CSS v4.3 utility policy

- Before adding or editing a Tailwind class, prefer the canonical Tailwind v4.3 utility over an arbitrary value whenever both produce the same CSS.
- Do not write `min-h-[100dvh]`, `min-h-[18rem]`, `rounded-[2px]`, or equivalent arbitrary forms when `min-h-dvh`, `min-h-72`, and `rounded-sm` exist.
- Use an arbitrary value only when there is no semantically equivalent built-in utility (for example, `clamp()`, `min()`, a `ch` measure, or an approved design token not represented in Tailwind's scale).
- During frontend review, search changed TSX/JSX for `-[` utilities and replace every built-in-equivalent occurrence before declaring the task complete.

## Frontend Atomic Design boundaries

- Keep shadcn primitives in `apps/web/src/components/ui`. Keep reusable Atomic Design components in `apps/web/src/components/{atoms,molecules,organisms}`; they must remain domain-neutral and reusable across features.
- Keep feature-specific composition in `apps/web/src/features/<feature>/components/{molecules,organisms}`. Do not place feature components directly under `features/<feature>/molecules` or `features/<feature>/organisms`.
- Split reusable UI behavior into the smallest existing Atomic Design primitive that owns it; do not place an entire interaction surface, visual fixture, or multi-step workflow in one large page/component when existing atoms, molecules, or organisms can compose it.
- Put schemas, types, and static configuration in sibling `schemas/`, `types/`, and `config/` directories, never inline in a component.
- All customer-facing copy, including labels, helper text, validation messages, alerts, metadata, and accessible labels, must be represented by keys and resolved from `@lcsp/i18n`; never hardcode display strings in `apps/web`.
- Do not add HTML `title` attributes for hover hints or truncated text. Use the existing shadcn `Tooltip`, `TooltipTrigger`, and `TooltipContent` primitives while preserving semantic labels with visible text or `aria-label`.

## Brand invariant

- The approved product brand source is the Figma DS Brand system: DS Brand `1104:31791`, Logo Mark `1105:31795`, Logo Lockup `1106:31809`, and usage notes `1107:31803`.
- Whenever an approved screen contains product branding, reuse the shared production `LCSPLogo` component backed by the exact Figma asset.
- Use the Logo Lockup for navigation, auth, admin, and footer surfaces where space permits.
- Use the Logo Mark only for constrained icon contexts such as favicon and app icon.
- Never recreate, approximate, replace with Lucide, or render plain `LCSP` text when the approved lockup is required.

## Frontend form architecture

- In `apps/web`, non-trivial forms must use `react-hook-form` for form state and `zod` for validation. Do not build new forms around ad hoc `useState` field state plus manual error maps when the UI is a real form.
- Form schemas must live in feature-local sibling `schemas/` files; do not inline `z.object(...)` definitions inside page or component files.
- Reusable field molecules and organisms should bind through `react-hook-form` context (`FormProvider`, `useFormContext`, `Controller`) instead of receiving parallel `value`/`error`/`setError` plumbing from every parent.
- Keep draft-saving, submit orchestration, and step navigation in the form container, but keep field rendering and field-level wiring in atomic components.

<!-- Source: .ruler/AGENTS.md -->

# AGENTS.md

Centralised AI agent instructions. Add coding guidelines, style guides, and project context here.

Ruler concatenates all .md files in this directory (and subdirectories), starting with AGENTS.md (if present), then remaining files in sorted order.

## Contract value-set typing

- Do not define TypeScript enums for app/domain value sets. Use `as const` objects and derive types from them.
- Do not define direct string literal unions such as `type Status = "A" | "B"`. Define a constant source first, then derive the type:

  ```ts
  export const EVIDENCE_SEVERITIES = {
    low: "LOW",
    medium: "MEDIUM",
    high: "HIGH",
  } as const;

  export type EvidenceSeverity =
    (typeof EVIDENCE_SEVERITIES)[keyof typeof EVIDENCE_SEVERITIES];
  ```

- Apply the same rule to discriminators such as `kind`, `type`, `status`, `reason`, `requiredAction`, and UI state strings. Local UI-only states may keep local constants, but domain/API values must live in `packages/contracts`.
- Canonical domain/API values must use one format: `SCREAMING_SNAKE_CASE`. Do not introduce mixed styles such as `pending`, `pending_approval`, `FinalReport`, or `accessRevoked` for contract values.
- Hardcoded error codes, status values, workflow values, PBAC actions, scan statuses, evidence severities, document types, lifecycle statuses, audit/resource/reason/aggregate values, and wizard/assessment statuses must be imported from `packages/contracts`; do not repeat raw strings in `apps/web` or `apps/api`.
- `apps/api` may translate between Prisma enums and contract constants only at explicit persistence boundaries. Do not leak Prisma enum values into controllers, BFF responses, or shared contracts.
- For bounded database value sets in `apps/api/prisma/schema.prisma`, use Prisma enums instead of plain `String` fields when the set is closed. The enum members themselves must also be `SCREAMING_SNAKE_CASE`; do not rely on lower/mixed-case Prisma members plus `@map(...)` to simulate the canonical value set.
- Tests must assert the value set of the layer they exercise: contract/API tests use shared contract constants, and Prisma persistence tests use Prisma enums or shared mapper helpers for that boundary.
- Before finishing a TS change, search changed code for direct literal unions and enums:
  `rg 'type [A-Za-z0-9_]+\\s*=\\s*"[^"]+"\\s*\\||^\\s*\\|\\s*"[^"]+"|\\benum\\b'`.

## API result contract

- Backend JSON controllers must return one envelope contract for success and failure:
  - success: `{ ok: true, data }`
  - failure: `{ ok: false, problem: { type, status, code, titleKey, detailKey, requiredAction, correlationId, meta } }`
- The HTTP status code must match `problem.status` in the failure body. If status metadata is emitted elsewhere, it must match the same value. Add or update tests when touching problem factories, filters, or interceptors.
- Use the backend problem factory/global exception filter for failures instead of ad hoc response shapes. Do not introduce legacy shapes such as `{ error_code }`, `{ code }`, or custom per-controller error bodies.
- Success responses for JSON controllers must also use the shared envelope directly from backend helpers/interceptors; do not return bare DTOs from some controllers and wrapped DTOs from others.
- Do not apply a global success wrapper to stream/download endpoints unless the endpoint is explicitly JSON-only.

## Web BFF and API client layer

- Keep Next route handlers as BFF/proxy code. They should use shared server helpers for upstream calls, bearer/session handling, query param normalization, result JSON, and payload validation. Do not repeat `fetch(apiBaseUrl...)`, `response.json()`, credential/session cookie guards, or pagination parsing in every route.
- When a web business rule depends on server-side routing behavior such as auth gates, tenant/workspace entry, redirects before render, locale routing, or route-level access control, prefer a Next server-side route proxy (`apps/web/src/proxy.ts` with `export function proxy`) over client-side redirects or component-level guards. Do not add the deprecated `middleware.ts` convention for Next 16+; use Proxy naming, matcher coverage, and focused tests for the protected route set. Proxy is an early routing guard only; backend API/PBAC enforcement remains the source of truth.
- `LCSP_API_BASE_URL` must be read in one shared upstream helper, not repeatedly inside `apps/web/src/app/api` or client modules.
- Shared upstream server logic belongs under `apps/web/src/lib/server` such as `upstream-request.ts`; do not keep Next BFF proxy code in `apps/web/src/lib/api`.
- Shared session/cookie guards, repeated query param normalization, and repeated success/problem forwarding must be centralized in helpers instead of copied across route handlers.
- Client-side API calls must go through the shared `apiRequest` helper so envelope parsing and credential behavior are centralized.
- TanStack Query belongs in `*-queries.ts` hooks. Query hooks orchestrate caching/retries only; envelope parsing stays in `apiRequest`, and domain mapping from `problem.code` to page outcomes stays in domain client modules, using shared outcome constants instead of raw `kind` strings.
- Avoid keeping old `*-client.ts` modules as thin wrappers with duplicated fetch logic. If a domain module remains, it should exist for domain outcome mapping, not to re-implement request plumbing already handled by shared helpers.
- Keep server-only proxy helpers under `apps/web/src/lib/server`, not under `apps/web/src/lib/api`.

## Mock data placement

- All mock payload data must live under `apps/web/src/public/assets/mocks`.
- Type definitions, fixture readers, cookie constants, and mock-mode helpers may live under server/helper folders, but they must not embed mock payload objects that should be JSON assets.
- Do not add mock JSON, fixture payloads, or seed-like web data outside `apps/web/src/public/assets/mocks`.

## Debugging and bug-fixing protocol

When debugging, fixing a bug, or tracing an error, the response **must** include two clearly labelled sections before or alongside any code change:

1. **Root cause** – Explain _why_ the bug occurred: the exact code path, incorrect assumption, race condition, stale closure, wrong contract shape, etc. Be specific enough that a reader who was not involved can understand the failure without running the code.
2. **Fix** – Explain _how_ the fix works: what changed, why it resolves the root cause, and any trade-offs or follow-up risks.

Do not skip either section even for seemingly trivial fixes. If both sections can be stated in one sentence each, that is acceptable, but they must appear.
