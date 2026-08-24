---
task_id: MW-scan-py-001
module: python-workers/scanner
runtime: nestjs-api + python-workers
priority: P0
status: READY_FOR_DEV
epic_story: 3.4
depends_on:
  - python-workers/platform/01-worker-platform-bootstrap.md
  - github-integration/03-pin-commit-snapshot-endpoint.md
---

# Scanner Workspace Setup and Materialization

## Outcome

Materialize a pinned `RepositorySnapshot` into a restricted temporary workspace directory for static analysis. The scanner obtains the archive only through the GitHub Integration-owned internal snapshot service; it never calls GitHub or handles GitHub credentials directly. Workspace is isolated, size-bounded, and cleaned up after scan regardless of success or failure. No raw source or repository archive is persisted long-term.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/__init__.py` | Create | Package init |
| `deepagents/tools/graph/scanner/workspace.py` | Create | Workspace lifecycle: create, materialize, cleanup |
| `deepagents/tools/graph/scanner/snapshot_service_client.py` | Create | Authenticated client for the internal snapshot archive endpoint; no GitHub dependency |
| `deepagents/tools/graph/scanner/scan_consumer.py` | Create | `ConsumerBase` subclass for `scan.triggered` events |
| `apps/api/src/modules/github-integration/presentation/http/internal-snapshot.controller.ts` | Create | Worker-only archive streaming endpoint |
| `apps/api/src/modules/github-integration/application/queries/stream-snapshot-archive/stream-snapshot-archive.handler.ts` | Create | Validate job/snapshot scope and stream the pinned archive |

## Workspace Constraints

| Constraint | Value | Notes |
|---|---|---|
| Max total workspace size | 500 MB | Abort if exceeded |
| Max single file size | 10 MB | Skip file, log as coverage-limited |
| Workspace path | `/tmp/lcsp-scanner/<job_id>/` | Isolated per job |
| Cleanup policy | Always — on success, failure, or timeout | Verified after scan |

## Materialization Method

- Scanner calls `GET /internal/repository-snapshots/:snapshotId/archive` using the worker service credential and propagates the scan correlation ID.
- The internal endpoint verifies that the authenticated worker, `scanJobId`, organization, snapshot, repository connection, and pinned commit SHA belong to the same active scan context.
- GitHub Integration obtains an installation access token per request, downloads the `.tar.gz` for the pinned commit, and streams it to the worker. The token never crosses the internal API boundary and is discarded after the upstream request.
- Neither the API nor the worker stores the archive in object storage, a database, a queue, logs, or audit payloads. Any bounded temporary buffering must be deleted before the request/job is finalized.
- Scanner validates content type and byte limits while streaming, rejects redirects to unapproved hosts, verifies the returned snapshot/commit metadata, and extracts with path-traversal, symlink, hardlink, device-file, depth, file-count, and decompression-bomb protections.
- Raw source is available only inside the restricted worker workspace for the duration of the scan.

The scanner package must not import a GitHub SDK/client, GitHub OAuth/App credential provider, or accept an installation token in configuration, queue payloads, or method arguments.

## Internal Snapshot Service Contract

**Endpoint:** `GET /internal/repository-snapshots/:snapshotId/archive?scanJobId=:scanJobId`

**Auth:** worker service authentication (`X-Worker-Api-Key` under the current MVP internal-auth contract). User sessions and caller-supplied GitHub tokens are not accepted.

**Success:** streamed `application/gzip` response with safe metadata headers for snapshot ID and commit SHA. The response body is never logged or cached.

**Failure:** return a safe, machine-readable error without repository credentials or upstream response bodies:

| HTTP | Error code | Meaning |
|---|---|---|
| 401/403 | `INTERNAL_WORKER_UNAUTHORIZED` | Missing/invalid worker identity or scan scope |
| 404 | `SNAPSHOT_NOT_FOUND` | Snapshot or active connection is unavailable |
| 409 | `SNAPSHOT_SCAN_MISMATCH` | Scan job does not reference the requested snapshot |
| 422 | `SNAPSHOT_COMMIT_MISMATCH` | Upstream archive does not match the pinned commit |
| 502/504 | `SNAPSHOT_RETRIEVAL_FAILED` | Bounded upstream GitHub retrieval failure |

## Business Rules

1. Listen on RabbitMQ queue `scan.triggered`.
2. Fetch scan job details from NestJS API via GET `/internal/scan-jobs/:id`.
3. Materialize through `SnapshotServiceClient`; never call GitHub from the scanner worker. Log only workspace ID, snapshot ID, pinned commit SHA, bounded size, and correlation ID.
4. If total size > 500 MB: abort scan, report `status = partial`, mark coverage-limited.
5. Skip files > 10 MB individually — log as coverage-limited, continue.
6. Do NOT execute any code, install dependencies, run builds, docker commands, or probe endpoints.
7. After scan complete: verify cleanup of `/tmp/lcsp-scanner/<job_id>/`.
8. Log cleanup status (success or residual).
9. Raw source code must NOT be sent to NestJS API in scan callback — only metadata and findings.
10. GitHub installation tokens, GitHub App private keys, and GitHub clients must remain inside the API-owned GitHub Integration boundary.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Normal-sized repo | Workspace created, files extracted |
| T02 | File > 10 MB | File skipped, logged as coverage-limited |
| T03 | Total size > 500 MB | Scan aborted, `status = partial` |
| T04 | Cleanup after success | `/tmp/lcsp-scanner/<job_id>/` removed |
| T05 | Cleanup after failure | Directory still removed |
| T06 | Raw source not in callback payload | Callback inspection |
| T07 | Scanner dependency boundary | No GitHub SDK/client, OAuth client, installation token config, or direct GitHub HTTP call in scanner package |
| T08 | Internal service authorization | Missing/invalid worker credential or mismatched scan job is denied |
| T09 | Pinned commit integrity | Snapshot/commit metadata mismatch aborts materialization |
| T10 | Malicious archive entry | Traversal, links, device files, or decompression bomb are rejected and workspace is cleaned |
| T11 | Credential containment | Installation token remains API-side and is absent from response, logs, audit, queue, and worker memory |

## Definition of Done

- Workspace size-bounded (500 MB total, 10 MB per file).
- Cleanup verified after every scan outcome.
- Raw source never sent to API or logged.
- Scanner obtains source only through `SnapshotServiceClient` and has no direct GitHub dependency or credential.
- Internal endpoint enforces worker authentication, scan/snapshot scope, pinned commit integrity, bounded streaming, and no-store behavior.
- Installation token remains inside GitHub Integration and is discarded immediately after upstream retrieval.
