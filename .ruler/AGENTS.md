# AGENTS.md

Centralised AI agent instructions. Add coding guidelines, style guides, and project context here.

Ruler concatenates all .md files in this directory (and subdirectories), starting with AGENTS.md (if present), then remaining files in sorted order.

You are working inside an isolated Agent Orchestrator worker.

Rules:

- Work only on the task assigned to this worker.
- Do not modify unrelated modules.
- Do not switch to branches belonging to other workers.
- Do not merge another worker's branch.
- Keep the change focused and minimal.
- Follow the existing architecture and coding conventions.
- Run relevant tests before finishing.
- Check git diff before finishing.
- Do not include unrelated files in the commit.
- If the task requires changes owned by another worker, report the dependency instead of implementing that worker's scope.

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

## Frontend form architecture

- In `apps/web`, non-trivial forms must use `react-hook-form` for form state and `zod` for validation. Do not introduce new manual form state stacks built from scattered `useState`, bespoke field error maps, and per-field submit plumbing when a form abstraction is appropriate.
- Feature form schemas must live in sibling `schemas/` files, with exported inferred types reused by containers and field components. Do not inline large `zod` schemas inside page or organism components.
- Prefer `FormProvider`, `useFormContext`, and `Controller` in reusable field molecules/organisms so parent containers do not have to thread `value`, `error`, and mutation callbacks through every field.
- Keep orchestration concerns such as autosave, step transitions, submit side effects, and API outcomes in the feature form container; keep field rendering and field binding in atomic components.

## Debugging and bug-fixing protocol

When debugging, fixing a bug, or tracing an error, the response **must** include two clearly labelled sections before or alongside any code change:

1. **Root cause** – Explain _why_ the bug occurred: the exact code path, incorrect assumption, race condition, stale closure, wrong contract shape, etc. Be specific enough that a reader who was not involved can understand the failure without running the code.
2. **Fix** – Explain _how_ the fix works: what changed, why it resolves the root cause, and any trade-offs or follow-up risks.

Do not skip either section even for seemingly trivial fixes. If both sections can be stated in one sentence each, that is acceptable, but they must appear.
