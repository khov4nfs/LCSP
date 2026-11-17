# ADR: LCSP-476 GitHub App Repository Onboarding — Minimum Permissions, Token Lifecycle, Migration, and Failure Modes

**Status:** PROPOSED (Requires product & security owner approval; legacy `GITHUB_APP` mode remains fail-closed until gate approval)  
**Date:** 2026-11-14  
**Author:** @NTA1210  
**Parent Issue:** khov4nfs/LCSP#467 ([Audit] Finding Register hợp nhất)  
**Implementation Issue:** khov4nfs/LCSP#476 ([Audit W2-04C] GitHub App repository onboarding)  
**Milestone:** #15 — LCSP-467 Assessment SaaS Refactor — 15/11/2026  

---

## 1. Context and Problem Statement

The LCSP assessment runtime requires read-only access to customer code repositories to pin commit snapshots, build tarball archives, index repository structure, and perform compliance scans.

### Current Baseline
Under baseline B1 (PR #456 / #480), repository onboarding relies exclusively on CLI provider credentials:
- `GITHUB_CLI_CREDENTIAL`
- `GITLAB_CLI_CREDENTIAL`
- `BITBUCKET_CLI_CREDENTIAL`
- `AZURE_DEVOPS_CLI_CREDENTIAL`

Legacy `GITHUB_APP` mode was retired and intentionally configured to fail closed (`REPOSITORY_AUTHENTICATION_MODE_UNSUPPORTED`, HTTP 409) in both `pin-snapshot.handler.ts` and `stream-snapshot-archive.handler.ts` because it lacked:
1. Strict server-side RSA private key rotation and JWT token minting controls.
2. Least-privilege permission boundaries preventing broad account-level or write access.
3. Explicit organization approval lifecycle and webhook reconciliation state machines.
4. An audited migration strategy for active customer repository connections.

While CLI credentials and Personal Access Tokens (PATs) provide functional isolation, they impose severe onboarding friction: customers must navigate GitHub Developer Settings, configure token scopes manually, and copy tokens into the UI. Customers frequently over-provision tokens with broad `repo` read/write or organization-wide privileges, creating security and compliance risks.

This Architecture Decision Record (ADR) establishes the formal specifications for re-architecting GitHub App onboarding under verifiable least-privilege, server-side token governance, safe credential migration, and robust failure recovery.

---

## 2. Core Architectural Invariants

### 2.1. Strict Separation of Concerns: Code Access vs. User Identity
- **Single Purpose:** The GitHub App exists exclusively as an authorization vehicle to obtain short-lived repository archive tokens for pinned assessment execution.
- **No OAuth Identity / SSO Coupling:** The GitHub App MUST NOT be used for user authentication, SSO, or user identity resolution. User sessions are governed independently by LCSP session cookies and existing PBAC auth gates. OAuth user login remains retired per issue #431.
- **Zero Token Leakage:** GitHub installation access tokens (IATs) are minted and consumed strictly server-side within the `github-integration` API module. No GitHub token or App private key is ever sent to the browser, stored in browser cookies/`localStorage`, or logged in execution traces.

### 2.2. Least Privilege and Minimum Scopes
The GitHub App registration must request only the absolute minimal scopes required to inspect code and pin snapshots:

| Permission Category | Scope | Justification |
| :--- | :--- | :--- |
| **Repository Contents** | `Read` | Required to fetch commit tree, read files, and download snapshot tarball archives. |
| **Repository Metadata** | `Read` | Mandatory default for GitHub Apps; required to resolve default branches and repository IDs. |

**Strictly Forbidden Scopes:**
- `Contents: Write`: Assessment runtime is purely analytical and never commits or alters customer code.
- `Issues / Pull Requests`: Write or Read access is prohibited.
- `Administration / Security Events`: Prohibited.
- `Members / Organization Administration`: Prohibited.
- `Workflows`: Prohibited.

Any request from an installation presenting scopes exceeding `Contents: Read` and `Metadata: Read` must be audited and rejected by the API.

### 2.3. Installation Target Guidance: Selected Repositories Default
- **Default Recommendation:** In both the LCSP onboarding UI and GitHub installation flow, `Selected repositories` is the default and strongly recommended choice.
- **UI Transparency:** The onboarding UI must explicitly inform the user why access is required, recommend choosing only the specific project repository, and explain how to add or remove repositories later in GitHub Settings.
- **All Repositories Handling:** If an organization administrator explicitly elects `All repositories`, the application accepts the grant but records `targetSelection: "ALL"` in the connection audit log without assuming persistent universal access.

---

## 3. Server-Side Token Lifecycle and Security

```
+---------------+        1. Signed JWT (RS256)        +------------------+
|   LCSP API    | ----------------------------------> |  GitHub REST API |
| (App PrivKey) | <---------------------------------- | (Token Endpoint) |
+---------------+     2. Installation Token (60m)     +------------------+
        |
        | 3. Cache in Memory (Max 50m with jitter)
        v
+---------------+        4. Authenticated Request     +------------------+
| Stream Archive| ----------------------------------> | GitHub Tarball   |
|  Pin Snapshot |                                     |    Endpoint      |
+---------------+                                     +------------------+
```

1. **Private Key Protection:** The GitHub App Private Key (RSA PEM, minimum 2048-bit) is stored in the secure secret manager or encrypted environment variable `LCSP_GITHUB_APP_PRIVATE_KEY`. It is never written to disk or exposed outside the API process boundary.
2. **App JWT Generation:**
   - Format: JSON Web Token signed with `RS256` using the App Private Key.
   - Claims: `iss` = App ID, `iat` = now - 60s (clock drift buffer), `exp` = now + 10m (maximum allowed by GitHub).
3. **Installation Access Token (IAT) Exchange:**
   - The API issues a POST request to `https://api.github.com/app/installations/{installation_id}/access_tokens`.
   - The token request optionally passes `repositories: [repo_name]` to narrow the token scope exclusively to the targeted repository.
4. **Token Caching & Jitter:**
   - GitHub IATs expire after 60 minutes.
   - The API maintains an in-memory token cache keyed by `installationId:repositoryId`.
   - Cached tokens expire after `min(token_ttl, 50 minutes)` with pseudo-random negative jitter (0–60 seconds) to guarantee tokens never expire in-flight during large archive downloads.
5. **Rate-Limit Guarding:**
   - The API inspects GitHub rate-limit response headers (`x-ratelimit-remaining`, `x-ratelimit-reset`).
   - If `x-ratelimit-remaining < 100`, requests are throttled using exponential backoff with jitter.
   - Hard rate-limit exhaustion (HTTP 403/429) fails closed with `PROVIDER_RATE_LIMITED`, logging the reset timestamp without infinite retry loops.

---

## 4. Connection Entity and Data Model

The `RepositoryConnection` persistence entity tracks the GitHub App installation bindings:

```prisma
// Extension to RepositoryConnection in prisma/schema.prisma
model RepositoryConnection {
  // Existing fields
  id                      String   @id @default(uuid())
  organizationId          String
  repositoryUrl           String
  repositoryFullName      String
  repositoryId            BigInt?
  defaultBranch           String
  status                  RepositoryConnectionStatus @default(ACTIVE)
  authenticationMode      RepositoryAuthenticationMode
  providerCredentialId    String?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt

  // GitHub App specific bindings (Audited)
  githubInstallationId    BigInt?
  githubAccountLogin      String?
  githubAccountType       String?  // "USER" | "ORGANIZATION"
  targetSelection         String?  // "SELECTED" | "ALL"
  migrationStatus         String   @default("NOT_MIGRATED") // "NOT_MIGRATED" | "ELIGIBLE" | "MIGRATED"
  suspendedAt             DateTime?
}
```

### Invariant:
A `RepositoryConnection` with `authenticationMode = GITHUB_APP` must have non-null `githubInstallationId`, non-null `repositoryId`, and null `providerCredentialId`.

---

## 5. Credential Migration Strategy

Existing active repositories onboarded via PAT/CLI credentials must remain completely functional:

1. **Non-Disruptive Coexistence:**
   - Existing connections retain `authenticationMode = GITHUB_CLI_CREDENTIAL` (or corresponding provider).
   - Live assessments, scheduled audits, and active workflows continue using their provisioned credential without interruption.
2. **Immutability of Historical Snapshots:**
   - Pinned commit snapshots (`RepositorySnapshot`) record exact commit SHAs, canonical tarball archive hashes (`canonicalArchiveSha256`), and source scope prefixes.
   - Pinned snapshot archives stored in S3 or local disk cache remain permanent and immutable.
   - Migrating a connection from PAT to GitHub App updates only *future* snapshot pins; it NEVER invalidates, re-downloads, or re-computes historical assessment snapshots.
3. **Opt-In Migration Workflow:**
   - In the Repository Settings UI, connections operating under `GITHUB_CLI_CREDENTIAL` display a badge: "Eligible for GitHub App connection".
   - The user initiates migration by authenticating the GitHub App installation.
   - The backend validates that the newly authorized GitHub App installation grants read access to the exact same repository (`githubRepositoryId` and `repositoryFullName`).
   - Upon successful verification, the backend atomically transitions `authenticationMode` to `GITHUB_APP`, records `migrationStatus = MIGRATED`, and retains the original connection ID.

---

## 6. Failure Modes, Webhooks, and Error Recovery

| Failure Scenario | Detection Mechanism | System Action & Outcome |
| :--- | :--- | :--- |
| **App Uninstalled by User** | Webhook: `installation.deleted` | Set connection status to `REVOKED`. Future scan jobs fail with `CONNECTION_NOT_FOUND`. Historical assessments and reports remain fully valid. |
| **Repository Access Revoked** | Webhook: `installation_repositories.removed` or HTTP 404 on IAT exchange | Transition connection status to `REVOKED`. In-flight jobs fail with `REPOSITORY_ACCESS_DENIED`. |
| **App Suspended by Org** | Webhook: `installation.suspend` or HTTP 403 on token exchange | Set connection status to `SUSPENDED`. Active jobs pause or fail closed with actionable error: "GitHub App installation suspended by organization admin". |
| **Org Approval Pending** | Callback query params or API response `AWAITING_ORG_APPROVAL` | Mark connection as `AWAITING_ORG_APPROVAL`. Display actionable message: "Request sent to organization admin for approval". Do not mark credential as broken. |
| **Webhook Replay / Spoofing** | HMAC-SHA256 signature verification (`X-Hub-Signature-256`) | Compute HMAC against configured `LCSP_GITHUB_WEBHOOK_SECRET`. Reject any unverified or timestamp-drifted payload with HTTP 401; log security audit event. |
| **Tarball Redirect Tampering** | URL parser & hostname verification | Archive download strictly checks redirects against approved GitHub domains (`codeload.github.com`, `api.github.com`). Fails closed on untrusted redirect origins (`ARCHIVE_REDIRECT_VALIDATION_FAILED`). |

---

## 7. Rollout Plan and Governance Gates

1. **Phase 1: ADR & Contract Baseline (This Checkpoint)**
   - Commit and ratify ADR `LCSP-476`.
   - Define canonical contract constants and schemas in `packages/contracts/src/github-integration/`.
   - Keep legacy `GITHUB_APP` mode strictly fail-closed in API handlers until Phase 2 gates are unlocked.
2. **Phase 2: Backend Implementation & Webhook Handling**
   - Implement `GitHubAppInstallationService` (RSA JWT signing, IAT caching, rate-limit backoff).
   - Implement signed webhook receiver for installation lifecycle events.
   - Implement unit and integration test fixtures using mock GitHub App endpoints.
3. **Phase 3: Web Onboarding & Migration UI**
   - Implement repository picker component supporting both GitHub App and CLI fallback.
   - Implement connection migration action in Repository Settings.
   - Verification across personal and organization account topologies.
4. **Phase 4: Production Authorization & Gate Acceptance**
   - Security owner review and formal sign-off.
   - Production GitHub App credential configuration.
   - Switch production gate to enable `GITHUB_APP` mode.
