---
task_id: MW-auth-014
module: auth-workspace
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 1.8
depends_on:
  - platform/audit-writer/02-audit-writer-service.md
  - platform/outbox/02-outbox-publisher.md
---

# Audit Event Writer — Auth Workspace Integration

## Outcome

Provide a thin auth-workspace-scoped audit writer service that serializes `AuthAuditEvent` rows via the platform audit writer. Ensures no sensitive values (passwords, tokens, MFA secrets, provider credentials) ever appear in audit payloads. All auth module command handlers use this service instead of writing `AuthAuditEvent` directly.

## Module Files

| File | Action | Notes |
|---|---|---|
| `apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-audit.service.ts` | Create | Thin wrapper around platform `AuditWriterService` |
| `apps/api/src/modules/auth-workspace/application/services/auth-workspace/audit-event-types.ts` | Create | `AUTH_AUDIT_EVENT_TYPES` enum / const object |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts` | Modify | Register `AuthAuditService` |

## API Contract

No HTTP endpoint. Internal service called by command handlers.

**`AuthAuditService.write(event: AuthAuditEventInput): Promise<void>`**

| Field | Type | Required | Notes |
|---|---|---|---|
| `eventType` | `AuthAuditEventType` | Yes | From `AUTH_AUDIT_EVENT_TYPES` const |
| `actorId` | string \| null | Yes | User ID or `null` for unauthenticated events |
| `organizationId` | string \| null | Yes | |
| `correlationId` | string | Yes | |
| `decision` | `allow` \| `deny` | Yes | |
| `payload` | Record<string, unknown> | No | Caller-provided; must be pre-sanitized |

## Prisma Models Used

| Model | Action | Key fields |
|---|---|---|
| `AuthAuditEvent` | Create | `id`, `eventType`, `actorId`, `organizationId`, `correlationId`, `decision`, `payload`, `occurredAt` |

## Supported Event Types

```
AUTH_SIGN_IN_SUCCESS
AUTH_SIGN_IN_FAILED
AUTH_SESSION_REVOKED
AUTH_MFA_ENROLLED
AUTH_MFA_OTP_VERIFIED
AUTH_MFA_OTP_FAILED
AUTH_PROFILE_UPDATED
AUTH_OAUTH_START
AUTH_OAUTH_LOGIN_SUCCESS
AUTH_OAUTH_LOGIN_FAILED
```

Retired Developer invitation/revocation audit event names are not active runtime events. Historical audit records may still use legacy resource values.

## Business Rules

1. `AuthAuditService` must call a sanitize step before writing: strip any field matching `/password|token|secret|key|nonce|code/i` from `payload`.
2. If sanitization removes a field, log a warning internally (not to audit output) to flag miscalled handlers.
3. `occurredAt = new Date()` set by service — caller must not provide timestamp.
4. Write is non-throwing: if `AuthAuditEvent` insert fails, log the failure to application logger but do NOT bubble the exception to the command handler (audit failure must not rollback business transactions).
5. Write is synchronous to the same DB transaction when called inside a transaction context; otherwise writes directly.
6. All command handlers across the auth-workspace module call `AuthAuditService.write(...)` — not raw Prisma `AuthAuditEvent.create`.

## Commands / Events

This service IS the event sink. Not a command handler.

## RBAC

Not applicable. Called post-authorization only.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | `write()` with clean payload | `AuthAuditEvent` row created |
| T02 | `write()` with `payload.password` | Field stripped, row created, warning logged |
| T03 | `write()` with `payload.sessionToken` | Field stripped, row created |
| T04 | `write()` with `payload.mfaSecret` | Field stripped, row created |
| T05 | DB insert fails | No exception thrown; error logged internally |
| T06 | `occurredAt` set by service | Caller-provided timestamp ignored |
| T07 | All 13 event types accepted | No type error |
| T08 | `actorId = null` for unauthenticated events | Row created without actorId |

## Definition of Done

- All 13 auth event types defined and writable.
- Sanitizer strips any password/token/secret/key/nonce/code field from payload before write.
- Audit failures are non-throwing (log-only).
- All auth command handlers use `AuthAuditService.write()` — no direct `prisma.authAuditEvent.create()` in command handlers.
