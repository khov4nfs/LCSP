# Persistent Lessons Learned & Pitfalls Ledger

## Format for New Entries
```markdown
### [YYYY-MM-DD] [STACK: apps/api | apps/web | deepagents | contracts | devops] Short Summary
- **Context / Symptom**: What failed or what behavior was requested.
- **Root Cause**: Why the issue occurred.
- **Resolution & Invariant**: The correct pattern to follow in all future tasks.
```

---

## Historical Incidents & Architectural Lessons

### [2026-11-19] [DEVOPS] pnpm Lifecycle Scripts (`pre*` / `post*`)
- **Context / Symptom**: `pretest:admin:e2e` and `pretest:billing:e2e` scripts in `package.json` were redundant.
- **Root Cause**: Unlike npm, `pnpm` does not automatically execute lifecycle `pre*` and `post*` scripts unless explicitly configured. CI was already invoking `build:runtime-packages` explicitly.
- **Resolution & Invariant**: Do not create duplicate `pre*` scripts for tasks that are explicitly orchestrated in CI or npm script chains.

### [2026-11-19] [DEVOPS] Test Script Globbing vs Hardcoded File Lists
- **Context / Symptom**: `test:dev-scripts` contained a 500-character line enumerating 14 individual test files.
- **Root Cause**: Manual addition of test files over time created a bloated, high-maintenance script where new tests were easily forgotten.
- **Resolution & Invariant**: ALWAYS use Node test runner glob patterns: `node --test 'scripts/*.test.mjs' ...` so new unit tests in the directory are discovered automatically.

### [2026-11-19] [PYTHON] Bandit AST Security Scanner Virtual Environment Traversal
- **Context / Symptom**: Running `bandit -r .` in `deepagents` hangs or runs extremely slowly.
- **Root Cause**: By default, Bandit recurses into `.venv` and tests, analyzing hundreds of third-party site-packages instead of first-party code.
- **Resolution & Invariant**: Always execute Bandit with explicit exclusion flags: `uv run bandit -r . -x ./.venv,./tests,./evals -ll`.

### [2026-11-19] [FRONTEND] Server-Only Isolation in Next.js BFF
- **Context / Symptom**: Risk of leaking API secrets and database URLs to the browser bundle in Next.js App Router.
- **Root Cause**: Code in `apps/web/src/lib/server` can accidentally be imported into a Client Component (`'use client'`).
- **Resolution & Invariant**: Always add `import 'server-only'` at the top of every backend helper under `lib/server/`. Compile-time failures prevent accidental bundling.

### [2026-11-19] [BACKEND] BOLA Prevention at Persistence Boundary
- **Context / Symptom**: Looking up resources with `prisma.model.findUnique({ where: { id } })` exposes IDOR vulnerabilities.
- **Root Cause**: A valid UUID from one tenant can be passed by an actor in another tenant.
- **Resolution & Invariant**: Always use `prisma.model.findFirst({ where: { id, workspaceId: user.workspaceId } })` to enforce tenant ownership at the query level.

### [2026-11-19] [PROCESS] Explicit User Authorization Required for Git Commit, Push, and PR Creation
- **Context / Symptom**: User explicitly directed: "sau này chỉ khi tôi bảo commit và push mới được tự tạo pr" (In the future, only create a commit, push, or open a PR when the user explicitly requests it).
- **Root Cause**: Proactive automatic committing, pushing, and PR opening can bypass the developer's local inspection and manual testing steps before changes are published to the remote repository.
- **Resolution & Invariant**: After performing code changes, refactoring, or bugfixes, the agent MUST stop at the local workspace stage and present verification evidence. The agent is STRICTLY FORBIDDEN from running `git commit`, `git push`, or `gh pr create` without explicit confirmation/instruction from the user (e.g. "hãy commit", "push lên", "tạo PR").

### [2026-11-19] [PROCESS] Mandatory Explanatory Comments on ALL Code & Configuration Changes (Core-First Invariant)
- **Context / Symptom**: User emphasized that explanatory comments must NOT be restricted to CI workflows alone, but MUST be present on ALL modifications throughout the repository, with the highest priority and strictness on changes affecting the project's core (architecture, domain logic, contracts, security gates, transactions, PBAC, data models).
- **Root Cause**: Code modifications, especially in core layers, often carry hidden assumptions, complex invariants, or non-obvious trade-offs. Future maintainers and reviewers cannot easily deduce the technical "Why" behind the change from the diff alone without clear inline context.
- **Resolution & Invariant**: Whenever making ANY change across the codebase—particularly in core business logic, API envelopes, contracts, DB persistence, or CI/infra—the agent MUST write clear, easy-to-understand comments directly in the code/config explaining:
  1. The business or architectural reason for the change ("Why").
  2. How the new/modified logic operates and prevents regressions.
  3. Any side-effects, boundaries, or constraints being enforced.

### [2026-11-19] [DEAD-CODE] Pruning Verified Unused Files Discovered by Knip
- **Context / Symptom**: 10 orphan files (8 in `apps/web` and 2 in `apps/api`) were detected by `knip` dead code audit.
- **Root Cause**: During earlier refactorings, components (like `form-card`, `assessments-directory`), old DTOs, and utility helpers (`query-params.ts`) were replaced by centralized contracts, `upstream-request.ts`, or updated UI layouts, but the legacy files were left unreferenced in the repository.
- **Resolution & Invariant**: Whenever deleting dead code reported by Knip, always verify:
  1. `git grep` yields zero incoming imports or consumer references.
  2. Workspace `pnpm run typecheck` (`tsc -b`) compiles with exit code 0.
  3. `pnpm run check:business-logic-docs` passes without baseline violation.

### [2026-11-19] [CI/CD] Scoped Paths Filtering Markdown Exclusion & Workflow Triggers
- **Context / Symptom**: CI triggered Python worker tests, Docker e2e, Windows VMs, and API e2e even though only markdown instructions and CI workflow files were modified.
- **Root Cause**: Two issues combined:
  1. `dorny/paths-filter` was matching `apps/api/**`, `apps/web/**`, and `deepagents/**` without negative patterns for `.md` files (`!**/*.md`), treating documentation edits as production source changes.
  2. The workflow file itself (`.github/workflows/test.yml`) was listed under every target filter (`docker:`, `windows:`, `python:`), forcing all heavy jobs to run whenever CI comments or cache configurations were touched.
- **Resolution & Invariant**: Always append negative exclusion patterns (`!apps/api/**/*.md`, `!apps/web/**/*.md`, `!deepagents/**/*.md`) to scoped filters. Never list the workflow file itself under heavy execution jobs (`docker:`, `windows:`) unless those specific runners are the target of the test.

### [2026-11-19] [PROCESS] Strict Preservation of Architectural Invariants in AGENTS.md
- **Context / Symptom**: User emphasized that whenever updating `AGENTS.md` or scoped agent rule files, the core structure, established conventions, and existing baseline principles must NEVER be broken, altered, or diluted.
- **Root Cause**: Overwriting or casually paraphrasing rule files can accidentally omit critical established constraints (such as Atomic Design boundaries, 5-section business logic JSDoc, Result Envelope format, or SCREAMING_SNAKE_CASE enums).
- **Resolution & Invariant**: All modifications to `AGENTS.md` and scoped agent instructions must be strictly **additive and non-destructive**. Existing principles, section structures, and baseline rules are permanent contracts. New policies must coexist with and strengthen the original guidelines without changing or deleting existing requirements.

### [2026-11-19] [CI/CD] GitHub Actions Release Gate Skipping Pitfall
- **Context / Symptom**: CI took 15-20 minutes on every commit because all 12 heavy jobs (Windows VM, Docker build, Python, Playwright) ran even for minor CSS/frontend edits.
- **Root Cause**: The aggregator gatekeeper job (`v2-release-gate`) evaluated `job["result"] != "success"`. Because skipped jobs have status `"skipped"`, path-filtered jobs caused false positive gate failures, forcing all jobs to run unconditionally.
- **Resolution & Invariant**: In any aggregator/release-gate job asserting downstream results, ALWAYS allow both `"success"` and `"skipped"`: `job["result"] not in ("success", "skipped")`. Only fail on `"failure"` or `"cancelled"`.

### [2026-11-19] [SECURITY/PYTHON] XXE and Entity Expansion Prevention with defusedxml (Bandit B314)
- **Context / Symptom**: Bandit AST security scan flagged `B314:blacklist` on `xml.etree.ElementTree.fromstring` in DOCX parsing files (`tools/legal/managed_documents/extract.py`, `official_text_extraction.py`, and `crawl_congbao_docx.py`).
- **Root Cause**: Python's standard library `xml.etree.ElementTree` is vulnerable to quadratic XML entity expansion attacks (Billion Laughs / DoS) and XML External Entity (XXE / CWE-20) injections when parsing untrusted Office Open XML (`word/document.xml`).
- **Resolution & Invariant**: Always parse XML from user-uploaded or external documents with `defusedxml.ElementTree.fromstring` (from the `defusedxml` package). Catch `DefusedXmlException` alongside `ParseError` and assert entity rejection with a dedicated security regression test.

### [2026-11-19] [BACKEND/NESTJS] Clean HTTP Pipeline Structure & Prohibition of Re-export Facades
- **Context / Symptom**: User corrected two architectural violations during backend optimization: (1) Leaking middleware and pipes into root `src/` or `common/` instead of unifying under `platform/http/`, and (2) Relying on temporary re-export facades to mask moved files.
- **Root Cause**: Treating `common/` as a catch-all folder causes fragmentation where some HTTP mechanisms (filters, interceptors) live in `platform/http/` while others (pipes, guards) scatter elsewhere. Using re-export facades leaves dead/lazy redirection files that violate Clean Architecture purity.
- **Resolution & Invariant**:
  1. **Unified HTTP Boundary**: All HTTP lifecycle components in NestJS must strictly live under `apps/api/src/platform/http/` in dedicated subdirectories: `filters/`, `interceptors/`, `pipes/`, and `middlewares/`.
  2. **Zero Re-Export Facades**: Never leave backward-compatibility re-export files (`export * from ...`) when relocating files. Update all consumer import paths directly at the call sites across the entire repository.
  3. **Preserve User Scope & Directives**: Never jump ahead to audit or refactor other modules without explicit instruction from the user.

### [2026-11-20] [BACKEND/NESTJS] Centralized Config vs Ad-Hoc `process.env` Reads & Defensive Parsing Pitfalls
- **Context / Symptom**: Multiple platform and infrastructure services were reading raw `process.env` directly (e.g. `MFA_SECRET_ENCRYPTION_KEY`, `LCSP_AGENT_SERVER_URL`, `PORT`, `storage` paths). Concurrently, `Number("")` in config parsers coerced empty string env vars to `0` instead of falling back to default timeouts, and boolean string `"1"` was parsed to `false` in `config()` despite passing Joi boolean validation.
- **Root Cause**: `AppConfig` lacked domain-typed fields for security and platform credentials, forcing services to bypass `ConfigService`. In JavaScript, `Number("") === 0` is a classic coercion hazard, and string equality `env === "true"` does not cover common truthy variants allowed by schema validators (`"1"`, `"yes"`).
- **Resolution & Invariant**: All environment variables validated in Joi MUST be exposed in `AppConfig` and mapped in `config()`. Always use defensive parsing helpers (`parsePositiveInteger`, `parseBoolean`) that guard against empty strings and align with Joi coercions. Services must inject `ConfigService<AppConfig>` instead of reading raw `process.env` directly.

### [2026-11-20] [BACKEND/NESTJS] Persistence Enum Mappers & Silent Fallback Elimination
- **Context / Symptom**: Credential provider enum mappers (`toPrismaCredentialProvider` / `fromPrismaCredentialProvider`) used a `switch-case` with a silent `default: return GITHUB` fallback. Furthermore, `PrismaService` bypassed `ConfigService` and failed silently on empty database URLs instead of throwing an explicit configuration error.
- **Root Cause**: Developers often write fallback defaults in switch statements as a quick convenience. In credential and security contexts, silently defaulting unmapped providers to GitHub risks credential confusion or persistent misrouting. In `PrismaService`, failing to validate database URL protocol and emptiness passed invalid strings into the database adapter.
- **Resolution & Invariant**: Never use silent fallback defaults in persistence enum mappers. Always use bidirectional static dictionary lookups (`as const satisfies Record<A, B>`) and throw an explicit, descriptive Error when an unmapped value is received. `PrismaService` must validate protocol and non-emptiness before initializing adapter pools.

### [2026-11-20] [BACKEND/NESTJS] Platform Layer Hardening: DI Config Injection, Safe Chaining & Synchronous I/O Caching
- **Context / Symptom**: `RabbitMqClient` read `process.env.RABBITMQ_EXCHANGE` directly inside `resolveExchangeName()`; `MailService.readConfig()` crashed with unhandled `TypeError: Cannot read properties of undefined (reading 'trim')` when email configuration was empty (`{}`) or when credentials were omitted; `FilePartitionedLogger` called `fs.mkdirSync` synchronously on every single log write; and relative imports within `src/platform/` used redundant traversals (`../../platform/...`).
- **Root Cause**: Clients initialized in module providers often only passed partial settings to the constructor (e.g. `url` without `exchangeName`), causing the instance to fall back to `process.env`. Optional chaining on parent objects (`emailConfig?.smtpHost.trim()`) was applied without chaining on the property itself (`?.trim()`). In file logging, directory existence was verified via synchronous filesystem syscalls on every message instead of caching known directories in-memory.
- **Resolution & Invariant**:
  1. **DI Config Completeness**: Client providers must accept all required parameters in their constructor and inject them from `ConfigService<AppConfig>` via `useFactory`.
  2. **Safe Chaining on Config Properties**: Always apply `?.trim()` when accessing string properties from configuration objects that may be undefined.
  3. **In-Memory Directory Caching**: Cache created directory paths in a static `Set<string>` to avoid repetitive synchronous `fs.mkdirSync` syscalls.
  4. **Clean Sibling Imports**: Subdirectories within `src/platform/` must use direct relative paths (`./interfaces/` or `../rbac/`), never `../../platform/...`.

### [2026-11-20] [BACKEND/NESTJS] API Entrypoint Bootstrap Hardening & NodeNext ESM Export Specifiers
- **Context / Symptom**: `main.ts` executed an unexported `void bootstrap();` without error handling, missing `app.enableShutdownHooks()`; root export files (`index.ts` and `security.ts`) exported relative specifiers ending in `.ts` instead of `.js`.
- **Root Cause**: Scaffolding default `main.ts` often executes unexported functions that spontaneously bind ports when imported into test harnesses, while lacking OS signal hooks (`SIGTERM`/`SIGINT`) for graceful teardown in containerized deployments. In TypeScript with `moduleResolution: NodeNext`, exporting raw `.ts` extensions leaks `.ts` specifiers into emitted `.d.ts` declaration maps, causing consumer resolution failures in strict ESM packages.
- **Resolution & Invariant**:
  1. **Exported, Testable Bootstrap**: Always export `bootstrap()` and guard spontaneous invocation with `if (process.env.NODE_ENV !== "test")`.
  2. **Graceful Shutdown**: Call `app.enableShutdownHooks()` so Nest triggers `onModuleDestroy()` across all providers (RabbitMQ channel/connection cleanup, Prisma connection pool disconnection).
  3. **NodeNext ESM Consistency**: All export and import specifiers in TypeScript source files MUST use the standard `.js` extension, never raw `.ts`.

### [2026-11-22] [BACKEND/CONCURRENCY] Assessment Module Hardening: Row-Lock DoS, Zombie Run Prevention & FK Restrict
- **Context / Symptom**: In `assessment` module:
  1. Raw SQL row locks `SELECT 1 FROM "Assessment" WHERE "id" = ... FOR UPDATE` locked rows before tenant ownership was checked, enabling cross-tenant Row-Lock DoS (BOLA).
  2. Expired worker leases rejected `finishExecution` calls with HTTP 403 `EXECUTION_LEASE_INVALID`, stranding runs in `RUNNING` state indefinitely ("Zombie Run").
  3. Deleting an assessment crashed with Prisma P2003/P2014 due to `onDelete: Restrict` on `AssessmentExecutionIsolation`.
  4. Raw database errors (e.g. CTE query timeouts) leaked in `ServiceUnavailableException` messages (CWE-209).
  5. `open-human-request.handler.ts` duplicated ~450 lines of complex validation and event logic already present in `open-human-requests-batch.handler.ts`.
- **Root Cause**:
  1. Row locking in PostgreSQL acquires exclusive locks immediately upon row match. Scoping the query only by `id` allowed an attacker to hold exclusive locks on any victim's record.
  2. Lease validation enforced expiration checks uniformly across both intermediate operations (heartbeats/evidence writes) and terminal settlement (`finishExecution`).
  3. Cascading delete relied on Prisma default cascades without explicitly cleaning up restrictive foreign-key relations.
  4. Exception handling passed `err.message` directly into user-facing HTTP exception messages.
  5. Historical single vs batch handlers evolved independently without a unified delegation pattern.
- **Resolution & Invariant**:
  1. **Tenant-Scoped Row Locking**: Always scope `FOR UPDATE` queries with `AND "ownerId" = ${actorId}` to prevent cross-tenant row locking.
  2. **Terminal Settlement on Expired Leases**: Permit terminal state transitions (SUCCEEDED, FAILED, PAUSED, CANCELLED) even after lease expiration as long as the worker's `leaseToken` matches and `executionState` is `RUNNING`, eliminating Zombie Runs.
  3. **Explicit Restrict FK Cleanup**: Pre-delete records with `onDelete: Restrict` (e.g. `assessmentExecutionIsolation.deleteMany({ where: { assessmentId } })`) inside the deletion transaction before deleting the root entity.
  4. **Error Masking (CWE-209)**: Log internal driver/query details via `Logger.error()` but return generic safe messages (`"Service is temporarily unavailable."`) to clients.
  5. **Batch Delegation Pattern**: Single item handlers must delegate to their corresponding batch handler wrapped in a 1-item batch, eliminating duplicate logic while preserving contract and DI compatibility.

### [2026-11-22] [PROCESS] Mandatory PR Metadata (Assignee & Labels) on PR Creation
- **Context / Symptom**: User requested: "gắn kèm cáci metadata như asign và lables chứ. lần sau tôi nói là tự nhớ đấy". PR was created without assignee and labels.
- **Root Cause**: The agent executed `gh pr create` specifying only `--title` and `--body`, omitting assignee and labels.
- **Resolution & Invariant**: Whenever creating a Pull Request via `gh pr create`, the agent MUST ALWAYS include:
  1. Assignee: `--assignee "@me"` (or current actor login).
  2. Labels: `--label "<module>,refactor,priority:P2"` (matching the module being refactored, e.g. `assessment`, `auth-workspace`, etc.).

### [2026-11-23] [BACKEND/CONCURRENCY] CAS Revisions and Durable Authorization Across External Cleanup
- **Context / Symptom**: Assessment renames could produce the same `updatedAt` revision within one clock millisecond, transaction-scoped saves marked aggregates committed before audit completion, and deletion released its owner lock before destructive runtime/storage/billing cleanup finished.
- **Root Cause**: Timestamp equality made compare-and-set revisions reusable; a repository participating in an outer transaction cannot know whether that transaction will commit; and a PostgreSQL row lock cannot safely span slow external services without timeout/connection-pool risk.
- **Resolution & Invariant**: Every CAS mutation must create a strictly newer revision and be tested with a frozen clock plus stateful concurrent writers. `saveInTx` writes only; its application transaction owner calls `markPersisted()` only after the outer commit. Destructive external cleanup must run outside long database transactions under a durable owner-bound database fence with one renewable cleanup lease token; concurrent requests must never share the token. Every initial resource lookup and `FOR UPDATE` lock must include the authenticated owner scope.

### [2026-11-23] [SECURITY/STREAMING] Do Not Multiplex ADMIN Operations Telemetry onto Customer SSE
- **Context / Symptom**: Restricting the customer workspace runtime controller to CUSTOMER correctly protected assessment content, but the existing Admin Rule Set Preparation UI still subscribed to that controller and immediately regressed to HTTP 403.
- **Root Cause**: One SSE endpoint had accumulated two unrelated security scopes: owner-bound assessment snapshots and globally administered, sanitized Preparation telemetry. Tightening one role boundary silently disabled the other consumer, while dead ADMIN branches remained unreachable behind the class guard.
- **Resolution & Invariant**: Customer assessment SSE and ADMIN operations SSE must use separate RBAC-protected routes, schemas and client hooks. ADMIN Preparation streams bind one validated run ID, re-check the Preparation boundary after subscription, pass every event through the Preparation allowlist, and forward one `x-correlation-id` across the BFF; they never emit canonical assessments or customer runtime events. Protected route isolation must use a successfully verified canonical role and fail closed on profile errors or unknown roles. Browser verification must assert that the Admin page requests the dedicated ADMIN stream and never the customer workspace endpoint.

### [2026-11-23] [BACKEND/ARTIFACTS] Durable Two-Phase Publication for Content-Addressed Reports
- **Context / Symptom**: Final-report publication wrote immutable bytes before committing artifact authority, kept BUILDING and ACTIVE inside one database transaction, rejected same-digest retries, and classified storage/DB outages as artifact corruption. A failed commit could leave unreachable shared chunks, while a failed activation had no durable resume point.
- **Root Cause**: Database metadata and filesystem storage were treated as one atomic unit even though they cannot share a transaction. The BUILDING row did not contain the expected hash, size, and manifest, and activation revalidation checked only a subset of pinned metadata. A catch-all error boundary also collapsed integrity, dependency, and internal failures into one status.
- **Resolution & Invariant**: Publish immutable artifacts synchronously in three ordered phases: (1) commit a fully specified BUILDING authority row, (2) write and verify content-addressed storage outside database transactions under a bounded deadline, and (3) lock/revalidate every identity, pin, schema, digest, hash, size, and manifest field before atomically activating the artifact and completing the aggregate. Same-digest retries resume the same deterministic artifact; different digests conflict before storage. Never compensating-delete shared chunks. Preserve explicit error classes: integrity 409, allowlisted dependency outage/timeout 503, unexpected failure masked 500. Read paths must scope owner/aggregate identity in the database query and serve ACTIVE artifacts only.

### [2026-11-23] [BACKEND/ARTIFACTS] Normalize Semantic Pins and Rebind Foreign Provenance on Replay
- **Context / Symptom**: A final report could be accepted by the submission handler but rejected by the loader when the same Git SHA used different hexadecimal casing. ACTIVE replay also trusted the stored `repositoryScanJobId` without proving that the referenced job belonged to the report's Assessment and repository snapshot.
- **Root Cause**: Integrity checks were duplicated across write/replay/read boundaries with asymmetric comparison rules, and foreign provenance identifiers were compared as scalar values instead of being rebound to their authoritative aggregate relationships.
- **Resolution & Invariant**: Compare case-insensitive semantic identifiers such as Git hexadecimal object IDs through the same normalization rule at every boundary. On immutable artifact replay, resolve each foreign provenance pin and verify both ownership and parent identity (for scan jobs: `assessmentId` and `snapshotId`) before returning content. Treat Prisma `P2034` transaction conflicts as retryable dependency failures, and recognize P2002 string targets only when they match the exact intended unique constraint.

### [2026-11-23] [BACKEND/AUDIT] Durable RBAC Evidence Must Not Depend on Broker Availability
- **Context / Symptom**: Ordinary RBAC reads either failed whenever the primary AuditEvent store was unavailable or risked proceeding with only an in-memory failure signal. At the same time, sensitive export bytes and material assessment mutations required stronger audit guarantees than ordinary reads.
- **Root Cause**: Authorization evidence, domain history, broker delivery, and compliance audit were treated as one undifferentiated concern. A broker-first outbox poll also prevented local recovery while RabbitMQ was down, and unauditable ALLOW outcomes could escape the authorization boundary.
- **Resolution & Invariant**: Canonical AuditEvent remains primary. An ordinary-read ALLOW may continue only after a deterministic, idempotent authorization fallback is durably stored in the local outbox; failure of both stores rejects ALLOW, while DENY remains DENY. The outbox poller restores local audit fallbacks before connecting to RabbitMQ and retains failures through bounded retry/DLQ. Sensitive downloads release no bytes until business-audit persistence succeeds. Material AssessmentEvent, its canonical AuditEvent, and outbox intent must share one transaction while remaining separate records.

