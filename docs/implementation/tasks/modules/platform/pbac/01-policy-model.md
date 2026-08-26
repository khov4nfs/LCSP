---
task_id: MW-rbac-001
module: platform/rbac
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 1.6
depends_on:
  - platform/config/01-config-loader.md
---

# RBAC Policy Model — Prisma Schema + Types

## Outcome

Define the Prisma `AuthPolicy` and `AuthDecisionLog` models, plus the TypeScript types used by all RBAC evaluation logic. This task is schema + types only — no evaluation logic.

## Module Files

| File                                          | Action        | Notes                                                                    |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `apps/api/prisma/schema.prisma`               | Verify/Modify | Confirm `AuthPolicy`, `AuthDecisionLog` models exist with correct fields |
| `packages/contracts/src/rbac/policy.types.ts` | Create        | Shared `PolicyDocument`, `SubjectAttributes`, `RbacDecision` types       |
| `apps/api/src/platform/rbac/rbac.types.ts`    | Create        | Internal RBAC evaluation context types                                   |

## Prisma Models (verify or extend)

```prisma
model AuthPolicy {
  id             String   @id @default(uuid())
  organizationId String
  version        Int      @default(1)
  subjectRole    String                         // 'Manager' | 'SystemAdmin'
  stateGate      String?                        // 'membership_active' | null
  actions        String[]
  conditions     Json?                          // reserved for future attribute conditions
  createdAt      DateTime @default(now())

  organization   AuthOrganization @relation(...)
  memberships    AuthMembership[]

  @@unique([organizationId, subjectRole, version])
  @@index([organizationId])
}

model AuthDecisionLog {
  id             String   @id @default(uuid())
  decision       String                         // 'allow' | 'deny'
  reasonCode     String?
  action         String
  sessionId      String?
  userId         String?
  organizationId String?
  policyId       String?
  policyVersion  Int?
  occurredAt     DateTime @default(now())

  @@index([organizationId, occurredAt])
  @@index([userId, occurredAt])
}
```

## TypeScript Types

```typescript
// packages/contracts/src/rbac/policy.types.ts

export type SubjectRole = "Manager" | "SystemAdmin";
export type StateGate = "membership_active";
export type RbacDecision = "allow" | "deny";

export interface PolicyDocument {
  id: string;
  organizationId: string;
  version: number;
  subjectRole: SubjectRole;
  stateGate: StateGate | null;
  actions: string[];
  conditions?: Record<string, unknown>;
}

export interface SubjectAttributes {
  role: SubjectRole;
  scope?: string; // resource scope when a future explicit policy requires it
}

export interface RbacEvaluationContext {
  action: string;
  subject: SubjectAttributes;
  policy: PolicyDocument;
  membershipStatus: string;
}

export interface RbacDecisionResult {
  decision: RbacDecision;
  reasonCode?: string;
  policyId: string;
  policyVersion: number;
}
```

## Business Rules

1. `actions` is a `String[]` — plain string array for easy policy inspection.
2. `conditions` is `Json?` — reserved for attribute-based conditions (not evaluated in Phase 1).
3. `@@unique([organizationId, subjectRole, version])` — one policy version per role per org.
4. `AuthDecisionLog` stores the resolved `policyId` and `policyVersion` at decision time (not a FK — allows policy deletion without losing audit history).
5. `SubjectAttributes.scope` is reserved for explicit future scoped policies. Null for Manager in active MVP.

## Test Cases

| ID  | Scenario                              | Expected                                 |
| --- | ------------------------------------- | ---------------------------------------- |
| T01 | Create `AuthPolicy` with Manager role | Row created with `subjectRole = Manager` |
| T02 | `@@unique` constraint violated        | DB error on duplicate                    |
| T03 | `PolicyDocument` type accepted        | No TypeScript errors                     |
| T04 | `RbacDecision` union type             | Only `allow` or `deny` accepted          |
| T05 | `AuthDecisionLog` without policyId FK | Row created, no FK constraint            |

## Definition of Done

- `AuthPolicy` and `AuthDecisionLog` Prisma models migrated.
- `PolicyDocument`, `SubjectAttributes`, `RbacEvaluationContext`, `RbacDecisionResult` exported from `packages/contracts`.
- `@@unique([organizationId, subjectRole, version])` constraint in place.
- No FK from `AuthDecisionLog` to `AuthPolicy` (audit trail must survive policy deletion).
