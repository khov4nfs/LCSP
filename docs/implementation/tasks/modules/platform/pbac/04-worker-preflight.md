---
task_id: MW-pbac-004
module: platform/pbac
runtime: nestjs-api + python-workers
priority: P1
status: READY_FOR_DEV
epic_story: 1.7
depends_on:
  - platform/pbac/02-evaluator-service.md
  - platform/outbox/02-outbox-publisher.md
---

# PBAC Worker Preflight — Python Worker Authorization Check

## Outcome

Before a Python worker processes any task-queue message that requires authorization context, it calls back to the NestJS API via a preflight endpoint to verify the authorization decision is still valid. This prevents stale-membership exploitation: a Developer whose membership was revoked after task dispatch must not have their task executed.

## Module Files

**NestJS API side:**

| File                                                      | Action | Notes                                |
| --------------------------------------------------------- | ------ | ------------------------------------ |
| `apps/api/src/platform/pbac/pbac-preflight.controller.ts` | Create | `POST /internal/pbac/preflight`      |
| `apps/api/src/platform/pbac/pbac-preflight.service.ts`    | Create | Re-evaluates PBAC for worker context |
| `apps/api/src/platform/pbac/pbac.module.ts`               | Modify | Register preflight controller        |

**Python Worker side (specification only — implemented in python-workers tasks):**

| Pattern                                                                          | Notes                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------- |
| Before processing: POST `/internal/pbac/preflight`                               | Pass `userId`, `orgId`, `action`, `correlationId` |
| If response `decision = deny` → discard message, emit `WORKER_TASK_DENIED` event | Do not process                                    |
| If response `decision = allow` → process task                                    | Continue                                          |

## API Contract

**Endpoint:** `POST /internal/pbac/preflight`
**Auth:** Internal worker API key (not session-based — workers are server-side)

**Request body:**

| Field             | Type   | Required | Notes                                       |
| ----------------- | ------ | -------- | ------------------------------------------- |
| `user_id`         | string | Yes      | The user on whose behalf the task runs      |
| `organization_id` | string | Yes      |                                             |
| `action`          | string | Yes      | The specific action the worker will perform |
| `correlationId`   | string | Yes      | Task correlation ID                         |

**Success response (200):**

| Field           | Type              | Notes        |
| --------------- | ----------------- | ------------ |
| `decision`      | `allow` \| `deny` |              |
| `reason_code`   | string \| null    | Only on deny |
| `correlationId` | string            |              |

## Business Rules

1. Endpoint is authenticated via `X-Worker-Api-Key` header (pre-shared secret from env var `WORKER_API_KEY`).
2. Evaluation is a full PBAC re-evaluation: load membership + policy + call evaluator. Same rules as NestJS guard.
3. `decision = deny` is returned for revoked membership, expired policy, or action not granted. Never 4xx for policy denial — always 200 with `decision = deny`.
4. Python worker must discard the task message if `decision = deny`. Task must not be retried — log `WORKER_TASK_DENIED` event.
5. If preflight endpoint is unreachable: worker fails the task (no silent allow). Retry after backoff.
6. `AuthDecisionLog` written for all preflight decisions (allow and deny).

## Prisma Models Used

| Model             | Action | Key fields                                                                         |
| ----------------- | ------ | ---------------------------------------------------------------------------------- |
| `AuthMembership`  | Read   | `(userId, orgId, status = active)`                                                 |
| `AuthPolicy`      | Read   | From membership                                                                    |
| `AuthDecisionLog` | Create | `decision`, `reasonCode`, `action`, `userId`, `orgId`, `policyId`, `policyVersion` |

## Test Cases

| ID  | Scenario                                | Expected                                           |
| --- | --------------------------------------- | -------------------------------------------------- |
| T01 | Valid membership + action granted       | 200 `decision: allow`                              |
| T02 | Membership revoked since task dispatch  | 200 `decision: deny`, `reason: STATE_GATE_FAILED`  |
| T03 | Action not in policy                    | 200 `decision: deny`, `reason: ACTION_NOT_GRANTED` |
| T04 | Missing/invalid `X-Worker-Api-Key`      | 401                                                |
| T05 | Worker discards task on deny            | No processing — logged as `WORKER_TASK_DENIED`     |
| T06 | Preflight unreachable — worker behavior | Worker fails task, does not process                |
| T07 | `AuthDecisionLog` written for allow     | DB row exists                                      |
| T08 | `AuthDecisionLog` written for deny      | DB row exists                                      |

## Definition of Done

- Preflight endpoint secured by `X-Worker-Api-Key`.
- Always returns 200 with `decision: allow | deny` (4xx only for auth failure or bad request).
- `AuthDecisionLog` written for all decisions.
- Python worker integration spec documented (implemented in python-workers tasks).
- Revoked-membership deny verified end-to-end in integration test.
