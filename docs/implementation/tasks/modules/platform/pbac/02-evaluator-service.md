---
task_id: MW-rbac-002
module: platform/rbac
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.6
depends_on:
  - platform/rbac/01-policy-model.md
---

# RBAC Evaluator Service

## Outcome

Provide a stateless `RbacEvaluatorService` that evaluates a `RbacEvaluationContext` against a loaded `PolicyDocument` and returns a `RbacDecisionResult`. Default deny on any failure path. Stateless — all policy loading done by the caller (guard or handler) before invocation.

## Module Files

| File | Action | Notes |
|---|---|---|
| `apps/api/src/platform/rbac/rbac-evaluator.service.ts` | Create | Core evaluation logic |
| `apps/api/src/platform/rbac/rbac.module.ts` | Create | `@Global()` NestJS module — exports `RbacEvaluatorService` |
| `apps/api/src/app.module.ts` | Modify | Import `RbacModule` |

## API Contract

No HTTP endpoint. Internal service.

**`RbacEvaluatorService.evaluate(ctx: RbacEvaluationContext): RbacDecisionResult`**

Synchronous. Never throws — all exceptions caught internally and returned as `decision: deny`.

## Evaluation Algorithm

```
function evaluate(ctx):
  if ctx.policy is null → deny, reasonCode: POLICY_NOT_FOUND
  if ctx.policy.stateGate = 'membership_active' AND ctx.membershipStatus ≠ 'active'
    → deny, reasonCode: STATE_GATE_FAILED
  if ctx.subject.role ≠ ctx.policy.subjectRole
    → deny, reasonCode: SUBJECT_ROLE_MISMATCH
  if ctx.action NOT IN ctx.policy.actions
    → deny, reasonCode: ACTION_NOT_GRANTED
  → allow
```

**Reason codes:**

| Code | Meaning |
|---|---|
| `POLICY_NOT_FOUND` | Policy null or missing |
| `STATE_GATE_FAILED` | Membership not active |
| `SUBJECT_ROLE_MISMATCH` | Subject role ≠ policy subject role |
| `ACTION_NOT_GRANTED` | Action not in `policy.actions` |

## Business Rules

1. Evaluator is stateless — it does NOT load `AuthPolicy` from DB. The calling guard loads policy and passes it in `ctx`.
2. All exception paths return `decision: deny`. No exception propagates to caller.
3. `conditions` in `PolicyDocument` is ignored in Phase 1 (reserved for future attribute-based conditions).
4. Evaluation is O(1) + O(N) for actions array lookup — no complex graph traversal.
5. Result always includes `policyId` and `policyVersion` for `AuthDecisionLog` write.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | All checks pass | `decision: allow` |
| T02 | `ctx.policy = null` | `decision: deny`, `reasonCode: POLICY_NOT_FOUND` |
| T03 | `stateGate = membership_active`, membership not active | `decision: deny`, `reasonCode: STATE_GATE_FAILED` |
| T04 | Subject role mismatch | `decision: deny`, `reasonCode: SUBJECT_ROLE_MISMATCH` |
| T05 | Action not in `policy.actions` | `decision: deny`, `reasonCode: ACTION_NOT_GRANTED` |
| T06 | Evaluator throws internally | Caught; returns `decision: deny` |
| T07 | Multiple actions in policy — one matches | `decision: allow` |
| T08 | Empty `policy.actions` array | `decision: deny`, `ACTION_NOT_GRANTED` |

## Definition of Done

- `evaluate()` is synchronous and never throws.
- All four denial reason codes implemented.
- Default deny on any unexpected exception path.
- `RbacModule` exported globally.
- Zero DB calls inside evaluator (policy loaded by caller).
