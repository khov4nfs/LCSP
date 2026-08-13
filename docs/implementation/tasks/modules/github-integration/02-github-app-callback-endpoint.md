---
task_id: MW-gh-002
module: github-integration
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 3.1
depends_on:
  - github-integration/01-github-app-oauth-start-endpoint.md
  - platform/audit-writer/02-audit-writer-service.md
---

# GitHub App Callback Endpoint

## Outcome

Handle the GitHub App installation callback. Validate `state`, exchange installation code for GitHub App access token, store `RepositoryConnection` metadata (never raw tokens in API responses or logs), and create or refresh the selected installation record scoped to org and assessment.

## Module Files

| File                                                                                                              | Action | Notes                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `apps/api/src/modules/github-integration/presentation/http/github-integration.controller.ts`                      | Modify | Add `GET /github/app/callback`                          |
| `apps/api/src/modules/github-integration/application/commands/github-app-callback/github-app-callback.command.ts` | Create | Command shape                                           |
| `apps/api/src/modules/github-integration/application/commands/github-app-callback/github-app-callback.handler.ts` | Create | State validation + token exchange + connection creation |
| `apps/api/src/modules/github-integration/domain/entities/repository-connection.entity.ts`                         | Create | `RepositoryConnection` domain entity                    |
| `apps/api/src/modules/github-integration/application/ports/persistence/repository-connection.repository.ts`       | Create | Port interface                                          |
| `apps/api/src/modules/github-integration/infrastructure/persistence/prisma-github-integration.repository.ts`      | Create | Prisma implementation                                   |
| `apps/api/prisma/schema.prisma`                                                                                   | Modify | Add `RepositoryConnection` model                        |

## Prisma Models

```prisma
model RepositoryConnection {
  id                String   @id @default(uuid())
  assessmentId      String?
  organizationId    String
  userId            String
  installationId    String
  repositoryId      String
  repositoryName    String
  repositoryFullName String
  defaultBranch     String
    permissions       Json                             // contents read-only; metadata read is allowed as GitHub implicit access
  status            String   @default("active")     // 'active' | 'revoked'
  connectedAt       DateTime @default(now())
  revokedAt         DateTime?

  @@index([organizationId])
  @@index([assessmentId])
  @@unique([installationId, repositoryId])
}
```

## API Contract

**Endpoint:** `GET /github/app/callback`
**Auth required:** No (GitHub redirects here with `installation_id`, `code`, `state`)

**Query parameters:**

| Param             | Type   | Required | Notes                                                                                                    |
| ----------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `installation_id` | string | Yes      | GitHub App installation ID                                                                               |
| `code`            | string | Yes      | Authorization code                                                                                       |
| `state`           | string | Yes      | Must match server-stored state                                                                           |
| `repository_id`   | string | No       | Required when GitHub returns multiple authorized repositories and LCSP must choose one deterministically |

**Success response (200):**

| Field                  | Type   | Notes                     |
| ---------------------- | ------ | ------------------------- |
| `connection_id`        | string | `RepositoryConnection.id` |
| `repository_name`      | string |                           |
| `repository_full_name` | string |                           |
| `default_branch`       | string |                           |
| `status`               | string | `active`                  |
| `correlationId`        | string |                           |

**Error responses:**

| HTTP | `error_code`               | Meaning                                                |
| ---- | -------------------------- | ------------------------------------------------------ |
| 400  | `GITHUB_STATE_INVALID`     | State not found or expired                             |
| 400  | `GITHUB_CALLBACK_INVALID`  | Token exchange failed or invalid installation          |
| 400  | `PERMISSIONS_INSUFFICIENT` | GitHub App does not have read-only contents permission |

## Business Rules

1. Load `GitHubAppInstallState` by `state`. If not found or expired → `GITHUB_STATE_INVALID`.
2. Delete `GitHubAppInstallState` (one-time use).
3. Exchange `code` for installation access token via GitHub API.
4. Fetch installation and repository metadata via GitHub API.
5. Validate `permissions.contents = 'read'` and allow GitHub implicit `metadata = 'read'`. Any write/admin or non-implicit extra permission → `PERMISSIONS_INSUFFICIENT`.
6. Create or refresh `RepositoryConnection` metadata for the selected repository. Raw installation token must NOT be stored in `RepositoryConnection` table or returned in API response.
7. Raw GitHub access token is used only for this request's metadata fetch, then discarded.
8. This endpoint must NOT create any LCSP identity session or `AuthOAuthIdentity`.
9. Audit event `GITHUB_APP_CONNECTED` — no token in payload.

## Commands / Events

| Name                       | Type             | Safe payload                                                                  |
| -------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `GitHubAppCallbackCommand` | App command      | `{ installationId, code, state, correlationId? }`                             |
| `GITHUB_APP_CONNECTED`     | `AuthAuditEvent` | `{ connectionId, repositoryFullName, organizationId, userId, correlationId }` |

## Test Cases

| ID  | Scenario                                            | Expected                                                 |
| --- | --------------------------------------------------- | -------------------------------------------------------- |
| T01 | Valid state + valid installation                    | 200 connection created                                   |
| T02 | State not found                                     | 400 `GITHUB_STATE_INVALID`                               |
| T03 | Expired state                                       | 400 `GITHUB_STATE_INVALID`                               |
| T04 | Token exchange fails                                | 400 `GITHUB_CALLBACK_INVALID`                            |
| T05 | Installation has write permissions                  | 400 `PERMISSIONS_INSUFFICIENT`                           |
| T06 | Raw token not in DB or response                     | DB inspection + response inspection                      |
| T07 | No LCSP session created                             | No `AuthSession` side effect                             |
| T08 | `GitHubAppInstallState` deleted after use           | DB verified                                              |
| T09 | Audit event has no token                            | Clean payload                                            |
| T10 | Multiple repositories and no `repository_id`        | 400 `GITHUB_CALLBACK_INVALID`                            |
| T11 | Multiple repositories with selected `repository_id` | 200 connection created/refreshed for selected repository |

## Definition of Done

- `RepositoryConnection` created with metadata only (no raw tokens stored or returned).
- GitHub App flow strictly separate from OAuth/OIDC login.
- Only `contents: read` plus GitHub implicit `metadata: read` permission accepted.
- `GitHubAppInstallState` one-time use (deleted after callback).
- No LCSP session created as side effect.
