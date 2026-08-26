---
task_id: MW-auth-008
module: auth-workspace
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 1.3
depends_on:
  - auth-workspace/01-sign-in-endpoint.md
  - platform/audit-writer/02-audit-writer-service.md
---

# OAuth/OIDC Start Endpoint

## Outcome

Initiate OAuth/OIDC provider login: generate a secure `state` and `nonce`, persist them server-side, and return the provider authorization URL. Never create repository authorization as a side effect.

## Module Files

| File                                                                                          | Action | Notes                                                 |
| --------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`          | Modify | Add `GET /auth/oauth/start` handler                   |
| `apps/api/src/modules/auth-workspace/application/commands/oauth-start/oauth-start.command.ts` | Create | `{ provider, redirectUri, correlationId? }`           |
| `apps/api/src/modules/auth-workspace/application/commands/oauth-start/oauth-start.handler.ts` | Create | State/nonce generation, URL build                     |
| `apps/api/src/modules/auth-workspace/infrastructure/oauth/oauth-state.store.ts`               | Create | Server-side state/nonce storage (DB or signed cookie) |
| `apps/api/src/modules/auth-workspace/infrastructure/oauth/oauth-provider.interface.ts`        | Create | `OAuthProvider` interface                             |
| `apps/api/src/modules/auth-workspace/infrastructure/oauth/google-oauth.provider.ts`           | Modify | Google OIDC implementation                            |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts`                                | Modify | Register new command handler and provider             |

## API Contract

**Endpoint:** `GET /auth/oauth/start`
**Auth required:** No (public — user not yet signed in)

**Query parameters:**

| Param          | Type   | Required | Notes                                                          |
| -------------- | ------ | -------- | -------------------------------------------------------------- |
| `provider`     | string | Yes      | `google` for auth login; `github` is intentionally unsupported |
| `redirect_uri` | string | Yes      | Must match allowlisted redirect URIs                           |

**Success response (200):**

| Field               | Type   | Notes                           |
| ------------------- | ------ | ------------------------------- |
| `authorization_url` | string | Full provider authorization URL |
| `correlationId`     | string |                                 |

**Error responses:**

| HTTP | `error_code`           | Meaning                                     |
| ---- | ---------------------- | ------------------------------------------- |
| 400  | `UNSUPPORTED_PROVIDER` | Provider not in allowlist                   |
| 400  | `INVALID_REDIRECT_URI` | `redirect_uri` not in server-side allowlist |
| 400  | `INVALID_REQUEST`      | Missing fields                              |

## Prisma Models (or Session Store)

| Store                        | Action | Key fields                                                                                                               |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `AuthOAuthState` (new table) | Create | `id`, `state` (random 32-byte hex), `nonce` (random 32-byte hex), `provider`, `redirectUri`, `expiresAt = now() + 10min` |
| `AuthAuditEvent`             | Create | `eventType: AUTH_OAUTH_START`, no state/nonce in payload                                                                 |

**New Prisma table to add to `schema.prisma`:**

```
model AuthOAuthState {
  id          String   @id
  state       String   @unique
  nonce       String
  provider    String
  redirectUri String
  expiresAt   DateTime
  createdAt   DateTime @default(now())
}
```

## Business Rules

1. Validate `provider` is in the allowlist (`['google']`). GitHub OAuth login is intentionally unsupported; GitHub App repository authorization belongs to the separate `github-integration` module.
2. Validate `redirect_uri` exactly matches one of the server-configured allowlisted URIs. Never trust client-provided URI.
3. Generate `state = crypto.randomBytes(32).toString('hex')` and `nonce = crypto.randomBytes(32).toString('hex')`.
4. Persist `AuthOAuthState` row with 10-minute expiry.
5. Build `authorization_url` from provider config: `clientId`, `scope`, `redirectUri`, `state`, `nonce`.
6. Return `authorization_url`. State and nonce must not appear in the response or logs — they are server-side only.
7. This endpoint must NOT create any `RepositoryConnection`, GitHub App token, or scan permission.

## Commands / Events

| Name                     | Type             | Safe payload                                   |
| ------------------------ | ---------------- | ---------------------------------------------- |
| `OAuthStartCommand`      | App command      | `{ provider, redirectUri, correlationId? }`    |
| `event.auth.oauth-start` | `AuthAuditEvent` | `{ provider, correlationId }` — no state/nonce |

## RBAC

Public endpoint. No authorization check.

## Test Cases

| ID  | Scenario                                        | Expected                                        |
| --- | ----------------------------------------------- | ----------------------------------------------- |
| T01 | Valid provider + allowlisted redirect_uri       | 200, `authorization_url` contains `state` param |
| T02 | Unsupported provider                            | 400 `UNSUPPORTED_PROVIDER`                      |
| T03 | Redirect URI not in allowlist                   | 400 `INVALID_REDIRECT_URI`                      |
| T04 | `AuthOAuthState` row created with 10-min expiry | DB row exists after call                        |
| T05 | State and nonce not in response body            | Response body only has `authorization_url`      |
| T06 | No `RepositoryConnection` created               | No repo side effects                            |
| T07 | Audit event has no state/nonce                  | Clean payload                                   |
| T08 | `provider=github`                               | 400 `UNSUPPORTED_PROVIDER`; no GitHub login URL |

## Definition of Done

- `authorization_url` returned for valid provider + redirect_uri.
- `state` and `nonce` stored server-side only; not returned in response.
- Redirect URI validated server-side against allowlist (not client-controlled).
- No repository authorization side effects.
- `AuthOAuthState` expires in 10 minutes.
