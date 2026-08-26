---
task_id: MW-gh-003
module: github-integration
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 3.2
depends_on:
  - github-integration/02-github-app-callback-endpoint.md
  - platform/rbac/03-nestjs-guard.md
  - platform/outbox/02-outbox-publisher.md
---

# Pin Commit Snapshot Endpoint

## Outcome

Allow the owning Manager to pin a branch/ref/commit SHA to create an immutable `RepositorySnapshot`. Downstream scan jobs reference the snapshot — not the mutable branch. Raw source is not persisted. Failure is audited and safe.

## Module Files

| File                                                                                                | Action | Notes                                           |
| --------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| `apps/api/src/modules/github-integration/presentation/http/github-integration.controller.ts`        | Modify | Add `POST /assessments/:assessmentId/snapshots` |
| `apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.command.ts` | Create | Command shape                                   |
| `apps/api/src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.handler.ts` | Create | Ref resolution + snapshot creation              |
| `apps/api/src/modules/github-integration/domain/entities/repository-snapshot.entity.ts`             | Create | `RepositorySnapshot` domain entity              |
| `apps/api/prisma/schema.prisma`                                                                     | Modify | Add `RepositorySnapshot` model                  |

## Prisma Model

```prisma
model RepositorySnapshot {
  id                String   @id @default(uuid())
  assessmentId      String
  organizationId    String
  connectionId      String
  repositoryId      String
  repositoryFullName String
  branch            String?
  ref               String?
  commitSha         String                         // Resolved, immutable
  providerMetadata  Json                           // GitHub commit metadata (no source)
  actorId           String
  status            String   @default("ready")    // 'ready' | 'failed'
  createdAt         DateTime @default(now())

  @@index([assessmentId])
}
```

## API Contract

**Endpoint:** `POST /assessments/:assessmentId/snapshots`
**Auth required:** Yes — `@RequireAction('snapshot:create')`

**Request body:**

| Field           | Type   | Required | Notes                                  |
| --------------- | ------ | -------- | -------------------------------------- |
| `connection_id` | string | Yes      | `RepositoryConnection.id`              |
| `branch`        | string | No       | Branch name                            |
| `ref`           | string | No       | Git ref                                |
| `commit_sha`    | string | No       | Specific commit SHA (overrides branch) |

**Success response (201):**

| Field                  | Type           | Notes                  |
| ---------------------- | -------------- | ---------------------- |
| `snapshot_id`          | string         |                        |
| `repository_full_name` | string         |                        |
| `commit_sha`           | string         | Resolved immutable SHA |
| `branch`               | string \| null |                        |
| `status`               | string         | `ready`                |
| `created_at`           | string         | ISO 8601               |
| `correlationId`        | string         |                        |

**Error responses:**

| HTTP | `error_code`           | Meaning                                             |
| ---- | ---------------------- | --------------------------------------------------- |
| 403  | `RBAC_DENIED`          | Actor lacks `snapshot:create`                       |
| 404  | `CONNECTION_NOT_FOUND` | Connection not found or not in org                  |
| 400  | `REF_NOT_RESOLVABLE`   | Branch/ref/commit cannot be resolved via GitHub API |
| 400  | `REF_OUT_OF_SCOPE`     | Ref outside connection's repository scope           |

## Business Rules

1. RBAC guard: `action = snapshot:create`.
2. Load `RepositoryConnection` by `connection_id`. Verify `organizationId = session.organizationId` and `status = active`.
3. Resolve commit SHA via GitHub API using installation access token (fetched per-request, not stored).
4. If resolution fails → `REF_NOT_RESOLVABLE`. Audit failure.
5. If resolved ref is outside connection scope → `REF_OUT_OF_SCOPE`.
6. Create `RepositorySnapshot` with resolved `commitSha` and provider metadata. No raw source stored.
7. Emit outbox message `snapshot.created` for scan trigger.
8. Raw source is NOT materialized at this step — only commit metadata stored.
9. Audit event `SNAPSHOT_CREATED` with snapshot ID, commit SHA, assessment ID.

## Commands / Events

| Name                 | Type             | Safe payload                                                                |
| -------------------- | ---------------- | --------------------------------------------------------------------------- |
| `PinSnapshotCommand` | App command      | `{ assessmentId, connectionId, branch?, ref?, commitSha?, correlationId? }` |
| `snapshot.created`   | Outbox           | `{ snapshotId, assessmentId, commitSha, connectionId, correlationId }`      |
| `SNAPSHOT_CREATED`   | `AuthAuditEvent` | `{ snapshotId, assessmentId, commitSha, correlationId }`                    |

## Test Cases

| ID  | Scenario                                  | Expected                                       |
| --- | ----------------------------------------- | ---------------------------------------------- |
| T01 | Valid connection + branch resolves to SHA | 201 snapshot created with `commitSha`          |
| T02 | Specific `commit_sha` provided            | 201 snapshot with that SHA                     |
| T03 | Branch not resolvable                     | 400 `REF_NOT_RESOLVABLE`, failure audited      |
| T04 | Connection not in session org             | 404 `CONNECTION_NOT_FOUND`                     |
| T05 | Actor lacks `snapshot:create`             | 403 `RBAC_DENIED`                              |
| T06 | No raw source in DB                       | `RepositorySnapshot` has no source code fields |
| T07 | Outbox message created                    | `event.snapshot.created` in `OutboxMessage`    |
| T08 | Manager can snapshot without collaborator | Manager flow independent                       |

## Definition of Done

- `RepositorySnapshot` created with immutable `commitSha`.
- No raw source persisted — metadata only.
- Outbox message `snapshot.created` created for scan trigger.
- Failure audited with safe reason code.

## Implementation Evidence

- API build, TypeScript, ESLint, import policy, and contract-literal policy pass.
- Unit coverage verifies ref precedence, repository scope, metadata-only persistence, ephemeral installation token use, RBAC decorator metadata, and atomic snapshot/outbox persistence.
- E2E coverage verifies success, explicit SHA, resolution failure, organization isolation, RBAC denial, audit events, and absence of raw source persistence.
