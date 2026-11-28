# Shared Contracts Agent Instructions (`packages/contracts`)

## 1. Role & Scope
`packages/contracts` is the Single Source of Truth (SSOT) for all domain and API value sets, DTO envelopes, statuses, error codes, and permissions shared across `apps/web` and `apps/api`.

---

## 2. Coding Patterns & Contrastive Examples

### Pattern 1: Value-Set Typing
- **Rule**: NEVER define TypeScript `enum` or raw string literal unions (`type Status = "A" | "B"`). ALWAYS define an `as const` object and derive the union type. Canonical values MUST use `SCREAMING_SNAKE_CASE`.

```typescript
// ❌ BAD: TypeScript enum or arbitrary casing
export enum AssessmentStatus {
  Pending = "pending",
  Completed = "completed",
}

// ❌ BAD: Direct string literal union
export type Severity = "low" | "medium" | "high";

// ✅ GOOD: as const object with derived type and SCREAMING_SNAKE_CASE
export const ASSESSMENT_STATUSES = {
  pending: "PENDING",
  inProgress: "IN_PROGRESS",
  completed: "COMPLETED",
  rejected: "REJECTED",
} as const;

export type AssessmentStatus =
  (typeof ASSESSMENT_STATUSES)[keyof typeof ASSESSMENT_STATUSES];
```

### Pattern 2: Result Envelope Standard
- **Rule**: All API responses must follow the unified Result Envelope contract.

```typescript
// ❌ BAD: Ad hoc error or bare entity response
{ "code": 400, "error": "Invalid input" }
{ "id": "123", "name": "Item" }

// ✅ GOOD: Standard envelope
export type ResultEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; problem: ProblemDetails };
```

---

## 3. Boundary Invariants
- **Zero Duplication**: Never re-declare contract types, enums, or constants locally inside `apps/api` or `apps/web`.
- **Zero Framework Coupling**: Contracts must be pure TypeScript. Never import NestJS, Next.js, React, or Prisma dependencies into `packages/contracts`.
- **Mandatory Explanatory Comments**: Because `packages/contracts` is the core foundation of the entire system, any addition, deprecation, or alteration to contracts MUST include clear inline comments explaining the business domain rationale, consumers impacted, and backward-compatibility guarantees.

---

## 4. Verification Checklist (Before declaring complete)
- [ ] Run contract literal check: `pnpm run check:contracts`
- [ ] Run TypeScript typecheck: `pnpm --filter @lcsp/contracts build`
- [ ] Verify all values use `SCREAMING_SNAKE_CASE` (no camelCase, kebab-case, or PascalCase).
- [ ] Verify clear explanatory comments exist on all added/modified contract definitions.
- [ ] When Product changes a planning markup, version and test the informational usage quote across contracts/API/Web fixtures; confirm that admission and settlement still use only published microcredit tariff snapshots.
