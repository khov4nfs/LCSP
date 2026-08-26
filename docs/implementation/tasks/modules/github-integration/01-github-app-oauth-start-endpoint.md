---
task_id: MW-gh-001
module: github-integration
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 3.1
depends_on:
  - auth-workspace/08-oauth-oidc-start-endpoint.md
  - platform/rbac/03-nestjs-guard.md
  - platform/audit-writer/02-audit-writer-service.md
---

# GitHub App OAuth Start Endpoint

## Outcome

Initiate GitHub App installation/authorization flow for repository access. Strictly separate from OAuth/OIDC login — this endpoint grants read-only repository permissions only. Never creates LCSP session. Generates secure `state` for GitHub's installation callback. The same endpoint also starts a managed installation update when LCSP passes an existing `installation_id`.

## Module Files

| File                                                                                                        | Action | Notes                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `apps/api/src/modules/github-integration/presentation/http/github-integration.controller.ts`                | Create | `GET /github/app/start`                                                               |
| `apps/api/src/modules/github-integration/application/commands/github-app-start/github-app-start.command.ts` | Create | Command shape                                                                         |
| `apps/api/src/modules/github-integration/application/commands/github-app-start/github-app-start.handler.ts` | Create | State generation + redirect URL build                                                 |
| `apps/api/src/modules/github-integration/infrastructure/github/github-app.client.ts`                        | Create | GitHub App API wrapper                                                                |
| `apps/api/src/modules/github-integration/github-integration.module.ts`                                      | Create | NestJS module wiring                                                                  |
| `apps/api/src/platform/security/decorators/re-auth-for-sensitive-route.decorator.ts`                        | Create | Route-owner decorator for sensitive route enforcement and preflight registration      |
| `apps/api/src/platform/security/sensitive-route-policy.ts`                                                  | Create | Registered route templates + recent re-auth TTL for sensitive routes                  |
| `apps/api/prisma/schema.prisma`                                                                             | Modify | Add `GitHubAppInstallState` model and session sensitive-action verification timestamp |

## Prisma Model

```prisma
model GitHubAppInstallState {
  id             String   @id @default(uuid())
  state          String   @unique
  assessmentId   String?
  organizationId String
  userId         String
  redirectUri    String
  expiresAt      DateTime
  createdAt      DateTime @default(now())
}
```

## API Contract

**Endpoint:** `GET /github/app/start`
**Auth required:** Yes — `@RequireAction('github:connect')` (authenticated owning Manager)

**Query parameters:**

| Param             | Type   | Required | Notes                                                                                       |
| ----------------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| `assessment_id`   | string | No       | Scope connection to specific assessment                                                     |
| `redirect_uri`    | string | Yes      | Must match server-side allowlist                                                            |
| `installation_id` | string | No       | Existing installation to manage; must already belong to the authenticated actor's workspace |

`GET /github/app/start` is a sensitive route. The backend must require recent session re-authentication before generating a GitHub install state. Sensitive-route membership is declared at the route owner with `@ReAuthForSensitiveRoute(...)`, not hardcoded per button in the frontend. The decorator enables guard enforcement and registers route IDs/path templates for `POST /auth/sensitive-route/check`. The frontend may call that check endpoint with `{ method, path }` before navigation to decide whether to show the re-auth modal, but this is UX only; `/github/app/start` remains the source-of-truth enforcement point.

**Success response (200):**

| Field              | Type   | Notes                                          |
| ------------------ | ------ | ---------------------------------------------- |
| `installation_url` | string | GitHub App installation URL with `state` param |
| `correlationId`    | string |                                                |

**Error responses:**

| HTTP | `error_code`           | Meaning                                                               |
| ---- | ---------------------- | --------------------------------------------------------------------- |
| 403  | `RBAC_DENIED`          | Actor lacks `github:connect`                                          |
| 403  | `REAUTH_REQUIRED`      | Current session has not confirmed access recently                     |
| 400  | `INVALID_REDIRECT_URI` | Not in server allowlist                                               |
| 400  | `ASSESSMENT_NOT_FOUND` | `assessment_id` not owned by org                                      |
| 400  | `CONNECTION_NOT_FOUND` | `installation_id` is not an active connection for the actor workspace |

## Business Rules

1. RBAC guard: `action = github:connect`.
2. Validate `redirect_uri` against server-side allowlist.
3. Require recent session sensitive-action verification (`sensitiveActionVerifiedAt`) within the server TTL before generating state.
4. Generate `state = crypto.randomBytes(32).toString('hex')`. Store in `GitHubAppInstallState` with 10-min expiry.
5. Build GitHub App installation URL: `https://github.com/apps/<APP_SLUG>/installations/new?state=<state>&redirect_uri=<redirect_uri>`.
6. This endpoint must NOT create any LCSP identity session or `AuthOAuthIdentity`.
7. This endpoint must NOT create `RepositoryConnection` — only starts authorization flow.
8. `state` not in response body — only in GitHub's installation URL (embedded as param).
9. Audit event `GITHUB_APP_INSTALL_STARTED` — no state value in payload; deny attempts include `REAUTH_REQUIRED`.
10. If `installation_id` is present, verify an active `RepositoryConnection` exists for `{ userId, organizationId, installationId }` before creating state. This is the supported UX for GitHub installation repository updates; do not rely on untrusted GitHub update redirects without LCSP state.

## Commands / Events

| Name                         | Type             | Safe payload                                                                                         |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `GitHubAppStartCommand`      | App command      | `{ userId, organizationId, sessionId, assessmentId?, redirectUri, installationId?, correlationId? }` |
| `GITHUB_APP_INSTALL_STARTED` | `AuthAuditEvent` | `{ userId, organizationId, assessmentId?, installationId?, correlationId }`                          |

## Test Cases

| ID  | Scenario                                              | Expected                                |
| --- | ----------------------------------------------------- | --------------------------------------- |
| T01 | Valid actor + allowlisted redirect_uri                | 200 with `installation_url`             |
| T02 | Actor lacks `github:connect`                          | 403 `RBAC_DENIED`                       |
| T03 | Redirect URI not in allowlist                         | 400 `INVALID_REDIRECT_URI`              |
| T04 | `assessment_id` not in org                            | 400 `ASSESSMENT_NOT_FOUND`              |
| T05 | `GitHubAppInstallState` created with 10-min expiry    | DB row verified                         |
| T06 | State not in response body                            | Response has no `state` field           |
| T07 | No LCSP session created                               | No `AuthSession` side effect            |
| T08 | Audit event has no state value                        | Clean payload                           |
| T09 | Existing active `installation_id` for actor workspace | 200 with managed installation URL       |
| T10 | Unknown or out-of-scope `installation_id`             | 400 `CONNECTION_NOT_FOUND`              |
| T11 | Direct start without recent re-auth                   | 403 `REAUTH_REQUIRED`; no install state |

## Definition of Done

- `installation_url` returned with embedded `state`.
- GitHub App flow strictly separate from OAuth/OIDC login.
- No LCSP session or `AuthOAuthIdentity` created.
- `GitHubAppInstallState` expires in 10 minutes.
