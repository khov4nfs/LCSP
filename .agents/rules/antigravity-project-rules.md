---
trigger: always_on
---

## LCSP project rules

- Domain/API value sets must be defined from `as const` objects, not TypeScript enums or direct string-literal unions.
- Canonical contract values must use `SCREAMING_SNAKE_CASE`. Do not introduce mixed styles such as `pending`, `pending_approval`, `FinalReport`, or `accessRevoked`.
- Hardcoded status/code/type/action/reason/resource/aggregate values are not allowed in `apps/web` or `apps/api`; import them from `packages/contracts`.
- `apps/api` may translate between Prisma enums and contract constants only at explicit persistence boundaries.
- In `apps/api/prisma/schema.prisma`, bounded status/type/reason/resource sets must use Prisma enums when the set is closed. Prisma enum members must also be `SCREAMING_SNAKE_CASE`.
- Backend JSON controllers must return one envelope contract:
  - success: `{ ok: true, data }`
  - failure: `{ ok: false, problem: { type, status, code, titleKey, detailKey, requiredAction, correlationId, meta } }`
- The HTTP status code must match `problem.status` in the failure body. Do not introduce legacy error shapes such as `{ error_code }` or `{ code }`.
- Next route handlers in `apps/web/src/app/api` are BFF/proxy code and must use shared helpers for upstream requests, session guards, query normalization, and envelope forwarding.
- Read `LCSP_API_BASE_URL` in one shared upstream helper under `apps/web/src/lib/server`, not repeatedly across routes or client modules.
- Client-side requests must go through shared `apiRequest`; TanStack Query belongs in `*-queries.ts`; domain mapping from `problem.code` belongs in domain modules.
- Do not keep `*-client.ts` files as thin duplicated fetch wrappers once shared request helpers exist.
- All web mock payload JSON must live under `apps/web/src/public/assets/mocks`.
- In `apps/web`, non-trivial forms must use `react-hook-form` for form state and `zod` for validation.
- Feature form schemas must live in sibling `schemas/` files rather than inline in page or organism components.
- Reusable field molecules/organisms should bind through `FormProvider`/`useFormContext`/`Controller` instead of manual `value`/`error`/callback threading from every parent.
- Keep autosave, submit orchestration, and step navigation in the feature form container; keep field rendering and field-level binding in atomic components.

## Git Commit & PR Authorization Policy

- **Explicit Command Only**: NEVER execute `git commit`, `git push`, or `gh pr create` unless the user explicitly commands it in their prompt (e.g. "commit", "push", "tạo PR").
- **Local Stage First**: Always stop at modifying local files, verifying tests/lints, and presenting the findings/diffs for user review.

## Mandatory Explanatory Comments Policy (Core-First Invariant)

- **Universal Rule**: Every code change, refactoring, bugfix, or configuration adjustment across the repository MUST include clear, human-readable explanatory comments directly above or alongside the modified code.
- **Strict Core Priority**: Changes affecting **core architecture** (contracts, domain logic, authentication/PBAC, tenant isolation, DB transactions, security gates, and CI pipelines) MUST explicitly document:
  1. The architectural/business rationale (**Why** the change was made).
  2. The execution mechanism (**How** it works and prevents edge cases or regressions).
  3. Boundary invariants (**What** security or cross-layer contracts are maintained).
- Never submit or complete modifications to core systems without clear inline explanatory comments.

## Debugging and bug-fixing protocol

When debugging, fixing a bug, or tracing an error, the response **must** include two clearly labelled sections before or alongside any code change:

1. **Root cause** – Explain _why_ the bug occurred: the exact code path, incorrect assumption, race condition, stale closure, wrong contract shape, etc. Be specific enough that a reader who was not involved can understand the failure without running the code.
2. **Fix** – Explain _how_ the fix works: what changed, why it resolves the root cause, and any trade-offs or follow-up risks.

Do not skip either section even for seemingly trivial fixes. If both sections can be stated in one sentence each, that is acceptable, but they must appear.

### Mandatory Red-Test First Policy (TDD Reproducer)

- **Zero Blind Fixes**: Before touching or modifying any production code or business logic to fix a reported bug, the agent **MUST** first author or run a focused, minimal reproduction test that asserts the expected behavior and reproduces the bug.
- **Verify Failure (RED)**: Run the fast scoped test runner for the reproduction test and confirm that it fails (exit code non-zero). Never skip this step — if the reproducer does not fail before the fix, the test is invalid.
- **Apply Minimal Fix**: Implement the targeted fix to resolve the identified root cause.
- **Verify Success (GREEN)**: Re-run the reproduction test and confirm it now passes (exit code 0).
- **Permanent Regression Lock**: The reproduction test must be preserved in the test suite so the issue can never silently regress.
