---
task_id: MW-auth-009
module: auth-workspace
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 1.3
depends_on:
  - auth-workspace/08-oauth-oidc-start-endpoint.md
---

# OAuth/OIDC Callback Endpoint

## Outcome

Validate the provider callback (state, nonce, issuer, audience, expiry), link the provider identity to an existing verified LCSP user, create an LCSP session, and reject invalid callbacks with safe audit. Must not create repository authorization.

## Module Files

| File                                                                                                   | Action | Notes                                               |
| ------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                   | Modify | Add `GET /auth/oauth/callback` handler              |
| `apps/api/src/modules/auth-workspace/application/commands/oauth-callback/oauth-callback.command.ts`    | Create | `{ provider, code, state, correlationId? }`         |
| `apps/api/src/modules/auth-workspace/application/commands/oauth-callback/oauth-callback.handler.ts`    | Create | All validation + linking logic                      |
| `apps/api/src/modules/auth-workspace/infrastructure/oauth/oauth-provider.interface.ts`                 | Verify | `handleCallback(code, state, nonce): OAuthIdentity` |
| `apps/api/src/modules/auth-workspace/infrastructure/oauth/github-oauth.provider.ts`                    | Modify | Implement callback + token exchange                 |
| `apps/api/src/modules/auth-workspace/domain/entities/oauth-identity.entity.ts`                         | Create | `OAuthIdentity` domain entity                       |
| `apps/api/src/modules/auth-workspace/application/ports/persistence/oauth-identity.repository.ts`       | Create | Port interface                                      |
| `apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.ts` | Modify | Add `PrismaOAuthIdentityRepository`                 |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts`                                         | Modify | Register new handler + repository                   |

**New Prisma table to add to `schema.prisma`:**

```
model AuthOAuthIdentity {
  id                String   @id
  userId            String
  provider          String
  providerAccountId String
  createdAt         DateTime @default(now())
  user              AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}
```

## API Contract

**Endpoint:** `GET /auth/oauth/callback`
**Auth required:** No (provider redirects here)

**Query parameters:**

| Param      | Type   | Required | Notes                            |
| ---------- | ------ | -------- | -------------------------------- |
| `code`     | string | Yes      | Authorization code from provider |
| `state`    | string | Yes      | Must match server-stored state   |
| `provider` | string | Yes      | Same as start request            |

**Success response (200):**

| Field             | Type    | Notes                                |
| ----------------- | ------- | ------------------------------------ |
| `session_token`   | string  | LCSP session (same shape as sign-in) |
| `expires_at`      | string  |                                      |
| `mfa_required`    | boolean |                                      |
| `organization_id` | string  |                                      |
| `correlationId`   | string  |                                      |

**Error responses:**

| HTTP | `error_code`             | Meaning                                                                |
| ---- | ------------------------ | ---------------------------------------------------------------------- |
| 400  | `OAUTH_STATE_INVALID`    | State not found or expired                                             |
| 400  | `OAUTH_CALLBACK_INVALID` | Token exchange failed, issuer/audience/expiry mismatch, nonce mismatch |
| 404  | `ACCOUNT_NOT_FOUND`      | No LCSP user linked to provider identity                               |
| 403  | `MEMBERSHIP_MISSING`     | Provider identity linked but no active membership                      |

## Prisma Models Used

| Model               | Action        | Key fields                                                                          |
| ------------------- | ------------- | ----------------------------------------------------------------------------------- |
| `AuthOAuthState`    | Read + Delete | Lookup by `state`, validate `expiresAt`, extract `nonce`, `provider`, `redirectUri` |
| `AuthOAuthIdentity` | Read          | `(provider, providerAccountId)` → `userId`                                          |
| `AuthUser`          | Read          | `id`, `emailVerified`                                                               |
| `AuthMembership`    | Read          | Active membership for org scope                                                     |
| `AuthSession`       | Create        | Same as sign-in                                                                     |
| `AuthAuditEvent`    | Create        | `AUTH_OAUTH_LOGIN_SUCCESS` or `AUTH_OAUTH_LOGIN_FAILED`                             |

## Business Rules

1. Load `AuthOAuthState` by `state` query param. If not found or `expiresAt < now()` → `OAUTH_STATE_INVALID`.
2. Delete `AuthOAuthState` row (one-time use). If already deleted → `OAUTH_STATE_INVALID`.
3. Exchange `code` for provider tokens. Validate:
   - `redirect_uri` matches stored `AuthOAuthState.redirectUri`.
   - `nonce` in ID token matches stored `nonce`.
   - `issuer` matches expected provider issuer.
   - `audience` contains LCSP client ID.
   - `exp` (expiry) is in the future.
4. If any validation fails → `OAUTH_CALLBACK_INVALID`. Log safe reason code only.
5. Extract provider `accountId` from ID token claims.
6. Look up `AuthOAuthIdentity` by `(provider, providerAccountId)`. If not found → `ACCOUNT_NOT_FOUND`. (No auto-create; user must register first and link OAuth separately.)
7. Load `AuthUser` and check `emailVerified`. If not verified → treat as `ACCOUNT_NOT_FOUND` (same code).
8. Load active membership. If none → `MEMBERSHIP_MISSING`.
9. Issue LCSP session (same as sign-in).
10. **Must not** create `RepositoryConnection`, GitHub App token, or scan permission.
11. Audit: `AUTH_OAUTH_LOGIN_SUCCESS` or `AUTH_OAUTH_LOGIN_FAILED`. No provider access token in audit payload.

## Commands / Events

| Name                               | Type             | Safe payload                                                              |
| ---------------------------------- | ---------------- | ------------------------------------------------------------------------- |
| `OAuthCallbackCommand`             | App command      | `{ provider, code, state, correlationId? }`                               |
| `event.auth.oauth-login-succeeded` | `AuthAuditEvent` | `{ actorId, provider, organizationId, correlationId, decision: allow }`   |
| `event.auth.oauth-login-failed`    | `AuthAuditEvent` | `{ provider, reasonCode, correlationId, decision: deny }` — no code/token |

## PBAC

Public endpoint (provider redirect). Post-login PBAC applies to workspace routes.

## Test Cases

| ID  | Scenario                                          | Expected                       |
| --- | ------------------------------------------------- | ------------------------------ |
| T01 | Valid callback, linked account, active membership | 200, LCSP session token        |
| T02 | Invalid `state` (not found)                       | 400 `OAUTH_STATE_INVALID`      |
| T03 | Expired `state`                                   | 400 `OAUTH_STATE_INVALID`      |
| T04 | `nonce` mismatch                                  | 400 `OAUTH_CALLBACK_INVALID`   |
| T05 | Issuer mismatch                                   | 400 `OAUTH_CALLBACK_INVALID`   |
| T06 | Audience mismatch                                 | 400 `OAUTH_CALLBACK_INVALID`   |
| T07 | Expired ID token                                  | 400 `OAUTH_CALLBACK_INVALID`   |
| T08 | Provider account not linked                       | 404 `ACCOUNT_NOT_FOUND`        |
| T09 | Account linked but no membership                  | 403 `MEMBERSHIP_MISSING`       |
| T10 | Provider access token not in audit payload        | `AuthAuditEvent.payload` clean |
| T11 | No `RepositoryConnection` created                 | No repo side effects           |
| T12 | `AuthOAuthState` row deleted after use            | Cannot reuse same state        |

## Definition of Done

- Callback validates state, nonce, issuer, audience, expiry before accepting.
- `AuthOAuthState` is deleted (one-time use).
- No provider access tokens in audit payloads or logs.
- No `RepositoryConnection` or scan permission created.
- `ACCOUNT_NOT_FOUND` returned for unknown provider identities (no auto-create).
