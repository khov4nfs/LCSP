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

### [2026-11-23] [PYTHON/TRACEABILITY] Correlation Identity Belongs to the Root Execution, Not an HTTP Attempt
- **Context / Symptom**: One Assessment Root execution emitted a different `x-correlation-id` for context, rule-set, evidence, heartbeat, and every read retry, breaking the trace across NestJS and the Python worker.
- **Root Cause**: `AssessmentRuntimeClient._headers()` generated a UUID for every request while `AssessmentRootBoundary.handle()` ignored the canonical correlation ID already propagated by the outbox and RabbitMQ invocation layer.
- **Resolution & Invariant**: Bind the inbound correlation ID once when constructing the execution-scoped runtime client and reuse that immutable value for every request and retry. Direct callers may generate one UUID at client construction, but correlation state must never be global, reset at claim time, or regenerated per attempt. Problem metadata must filter active worker/lease credentials before reaching model-facing errors.

### [2026-11-23] [BACKEND/IDEMPOTENCY] Unique-Race Replay Must Match the Exact Prisma Constraint
- **Context / Symptom**: Concurrent Assessment rule-audit exports with the same request and idempotency key produced one committed row, while the losing request exposed Prisma `P2002` instead of replaying the winner.
- **Root Cause**: The create path performed find-then-create inside one transaction without post-rollback convergence, and Prisma 7 with `@prisma/adapter-pg` reports the production unique fields under `meta.driverAdapterError.cause.constraint.fields` rather than only legacy `meta.target`.
- **Resolution & Invariant**: Replay a uniqueness loser only when `P2002` metadata exactly identifies the intended composite constraint, supporting the installed adapter's source-derived quoted-field shape and deliberately retained compatibility shapes. Keep a faithful quoted-field regression fixture, then reload owner-scoped allowlisted winner metadata once through the root Prisma client after the losing transaction rejects. Wrong/malformed constraints and a missing winner rethrow the original error; never retry the whole transaction or return loser-generated metadata. A database-backed concurrency test remains the strongest optional evidence when a disposable PostgreSQL harness is available.

### [2026-11-24] [BACKEND/SEARCH] Canonicalize Before Deduplication and Bounding
- **Context / Symptom**: Case and Unicode compatibility variants of one legal-search term consumed separate `MAX_TERMS` slots and produced redundant case-insensitive SQL `AND` predicates.
- **Root Cause**: The application deduplicated raw tokens before establishing a canonical comparison representation, so database-equivalent inputs remained distinct in memory.
- **Resolution & Invariant**: At one application boundary, apply Unicode NFKC and locale-independent `toLowerCase()` before length filtering, stable first-occurrence deduplication and result bounding. Apply limits to canonical unique terms, while leaving pinned corpus identity and retrieval semantics unchanged.

### [2026-11-27] [BILLING/SETTLEMENT] Authoritative Tariff Authority, Bounded Exposure, and Sub-Microcredit Fractional Rounding in Usage Settlement
- **Context / Symptom**:
  1. `SettleBillableInvocationUsageHandler` previously allowed admissions to settle to `SETTLED` with 0 microcredits and release concurrency slots when pinned tariff snapshots or platform sponsorship policies were missing or unresolvable.
  2. Usage reported by workers exceeding the admitted `maximumExposureMicrocredits` ceiling previously settled to `SETTLED`, violating the wallet financial exposure boundary.
  3. Rounding acceptance tests used integer-divisible rates (3 and 15 microcredits/token), yielding identical outcomes under both per-bucket integer division and single integer division, allowing rounding regressions to pass silently.
- **Root Cause**:
  1. Null checks on snapshot queries fell back to a default `0n` charge rather than failing closed, releasing concurrency slots without financial authority.
  2. Handler omitted invariant validation against `maximumExposureMicrocredits` (mandated by ADR-028 Line 138).
  3. Test fixtures lacked fractional microcredit buckets whose individual truncations expose per-bucket rounding errors.
- **Resolution & Invariant**:
  1. Unresolvable or missing tariff/sponsorship snapshots must fail closed: never settle, retain exposure, transition admission to `OUTCOME_UNKNOWN`, route to `BillingReconciliationCase` under `INTEGRITY_REVIEW`, and keep the concurrency slot blocked.
  2. Provider usage exceeding `maximumExposureMicrocredits` must never settle, release slots, or expand wallet exposure; it must enter `INTEGRITY_REVIEW` with usage evidence preserved while maintaining the admitted exposure ceiling.
  3. Acceptance tests verifying token arithmetic must configure fractional rates (e.g. 0.6 microcredits/token across multiple buckets) where separate integer division produces 0 but single integer division produces 1 microcredit, permanently locking against rounding regressions.

### [2026-11-27] [BILLING/DEBIT-PHASE-D] Atomic 5-Record Settlement, Signed Balance Projection, Lost-Response Idempotency & Sweeper Exposure Invariant
- **Context / Symptom**: In WP8 Phase D production debit, live charging requires atomic state transitions across multiple persistence boundaries while preserving financial safety. Missing transactions, double deductions on network replay, or unhandled lease expirations could lead to ledger discrepancies or exposure leakage.
- **Root Cause**:
  1. Multi-record operations (receipt, ledger entry, wallet projection, audit event, outbox message) without a single enclosing database transaction can leave partial state if mid-transaction failure occurs.
  2. Concurrent retries or replayed requests with identical fingerprints could double-debit wallets if the idempotency replay check fails to short-circuit before balance deduction.
  3. Sweeping expired `IN_FLIGHT` leases without retaining `maximumExposureMicrocredits` would release concurrency slots before provider usage can be accounted for.
- **Resolution & Invariant**:
  1. Live settlement (`debitMode: ON`) must atomically commit exactly 5 records within a single database transaction: `ModelUsageReceipt`, `CreditLedgerEntry` (with negative delta), `BillingWallet` update (supporting signed negative balance `balanceMicrocredits < 0n` without rollback), `AuditEvent`, and `OutboxMessage` (`aggregateType: BILLING_WALLET`).
  2. Idempotent replays for already-settled admissions must immediately return the existing receipt charge without creating a duplicate ledger entry or mutating wallet balance.
  3. Recovery sweeper (`POST /internal/billing/reconciliation/sweep-expired-leases`) transitions expired `IN_FLIGHT` leases to `DISPATCH_UNKNOWN` and opens a `BillingReconciliationCase` in `OPEN` state, while strictly retaining `maximumExposureMicrocredits` so that concurrency slots remain blocked until audited provider usage or verified no-usage evidence is recorded.

### [2026-11-27] [BILLING/PHASE-D-FINANCIAL-SAFETY] Clock Separation, Lock Ordering, Accounting Version & Missing Wallet Fail-Closed
- **Context / Symptom**: Review of Phase D production debit identified 4 financial discrepancies: using pre-consume TTL for in-flight sweeps, reversed row lock ordering between admission and wallet, outdated accountingUnitVersion/platform sponsorship billing charges, and settling when customer wallet is absent.
- **Root Cause**:
  1. Using admission TTL `expiresAt` (5 min) to sweep `IN_FLIGHT` invocations falsely swept legitimate long-running model inferences.
  2. Locking `BillableInvocationAdmission` before `BillingWallet` violated ADR-028 Section 5 hierarchical lock ordering (wallet -> admission -> case -> outbox) and risked deadlocks with concurrent transactions; wallet version was not incremented upon debit.
  3. Ledger entries wrote `accountingUnitVersion: 1` instead of cutover version 2; `PLATFORM_SPONSORED` invocations were assigned non-zero `chargedMicrocredits` mirroring provider cost rather than remaining strictly 0 for customer charges.
  4. Missing customer wallet row during settlement proceeded to settle instead of failing closed.
- **Resolution & Invariant**:
  1. Dedicated `inFlightLeaseExpiresAt` timestamp on `BillableInvocationAdmission` populated on CAS to `IN_FLIGHT` (default 15 min); sweeper evaluates `inFlightLeaseExpiresAt <= now`. Automated background `BillingReconciliationSweeperService` dispatches sweep commands periodically.
  2. Enforce strict lock ordering: row-lock `BillingWallet` `FOR UPDATE` (or advisory lock on platform sponsorship key) FIRST, then row-lock `BillableInvocationAdmission` SECOND. Increment `BillingWallet.version` on every balance mutation.
  3. Set `CreditLedgerEntry.accountingUnitVersion = wallet.accountingUnitVersion ?? 2`. Enforce `debitedMicrocredits = 0n` and `chargedMicrocredits = 0n` on all `PLATFORM_SPONSORED` settlements (`calculatedMicrocredits` retains provider cost).
  4. Missing customer wallet must fail closed: commit admission transition to `BILLING_INTEGRITY_REVIEW` and `BillingReconciliationCase` in `INTEGRITY_REVIEW` before returning HTTP 422 problem exception (never throw inside the database transaction, which causes PostgreSQL rollback of the review state).

### [2026-11-27] [BILLING/LEASE-DEADLINE-AND-TRANSACTION-COMMITTED-REVIEWS] In-Flight Lease Deadline Inheriting, Heartbeat Renewal & Committed Review States
- **Context / Symptom**: Review identified two critical gaps: 1) Throwing exceptions inside transaction for missing wallet rolled back `BILLING_INTEGRITY_REVIEW` and reconciliation cases, leaving test D9 unable to prove state persistence; 2) Fixed 15-minute lease caused false sweeps for long-running inferences and lacked heartbeat renewal, while sweeper scheduling interval was missing from `config.ts`.
- **Root Cause**:
  1. Throwing an exception inside Prisma `$transaction` causes PostgreSQL transaction abort and rollback. Any state intended to persist permanently for audits or recovery is discarded.
  2. Fixed 15-minute lease ignored approved execution lease deadlines from `AssessmentRuntime.leaseExpiresAt`, falsely sweeping model calls running within an authorized longer window; workers had no authoritative heartbeat mechanism to extend leases.
  3. Sweeper service referenced configuration paths that were not validated or declared in NestJS `config.ts` or `config.types.ts`.
- **Resolution & Invariant**:
  1. Controlled two-step pattern: Inside the transaction, write and commit `state: BILLING_INTEGRITY_REVIEW` and `BillingReconciliationCase` in `INTEGRITY_REVIEW`, returning a sentinel failure flag. Outside the transaction after PostgreSQL commit, throw the HTTP 422 problem exception so the review records are permanently saved.
  2. In-flight lease deadline resolution: On CAS to `IN_FLIGHT`, inherit the approved execution deadline from `AssessmentRuntime.leaseExpiresAt` or `AssessmentDiscoveryRun.leaseExpiresAt` (floor of 15m), so inferences within authorized execution windows are protected. Provide an authoritative HMAC-verified heartbeat renewal endpoint (`POST /internal/billing/admission/heartbeat`) allowing workers to extend active in-flight leases.
  3. Sweeper configuration: Explicitly declare `BILLING_RECONCILIATION_SWEEPER_ENABLED` (boolean, default true) and `BILLING_RECONCILIATION_SWEEPER_INTERVAL_MS` (integer >= 1000, default 60000) with Joi schema validation in `config.ts` and export typed interface in `config.types.ts`.

### [2026-11-27] [BILLING/LEASE-BOUNDARIES-AND-HEARTBEAT-AUTHORITY] Runtime Authority Ceiling, Execution Lease Token Alignment & Transactional Row-Locking
- **Context / Symptom**: Review of heartbeat and consume handlers identified two authority boundary leaks: 1) Consume defaulted to `now + 15m` even when run had only 5m remaining, violating the "never exceed approved deadline" invariant; 2) Heartbeat only inspected `assessmentId` and `leaseExpiresAt`, allowing superseded runs to renew admissions under a new execution's lease without locking against concurrent run replacements.
- **Root Cause**:
  1. Ternary condition in consume selected `Math.max(approvedDeadline, now + 15m)` instead of clamping to the approved run deadline.
  2. Heartbeat did not verify that `admission.runId` and `admission.executionLeaseToken` matched the execution currently holding the runtime lease, and read `AssessmentRuntime` outside the lock boundary of `BillableInvocationAdmission`.
  3. Throwing exceptions inside Prisma `$transaction` caused rollback of `EXPIRED` status updates on TTL expiration during consume.
- **Resolution & Invariant**:
  1. Consume strictly bounds `inFlightLeaseExpiresAt` by `approvedDeadline` (e.g. 5 minutes if run only has 5 minutes remaining), never defaulting to 15m when the run authority is shorter.
  2. Heartbeat executes within a PostgreSQL transaction with row locks: locks `BillableInvocationAdmission` `FOR UPDATE` and `AssessmentRuntime` `FOR SHARE`. It verifies exact match on `runId`, `executionLeaseToken`, and unexpired `leaseExpiresAt`. Any superseded run or mismatched token fails closed with HTTP 403 Forbidden (`admissionContextMismatch`).
  3. Heartbeat deadline renewal enforces both monotonicity (cannot shorten existing deadline) and runtime ceiling clamping (`Math.min(calculatedDeadline, runtimeCeiling)`).
  4. Controlled commit pattern for consume: All admission validation, capability checks, `AssessmentRuntime` `FOR SHARE` row-locking, and state transitions execute within a single PostgreSQL transaction. When marking an unconsumed admission `EXPIRED` upon TTL expiry, update and commit `state: EXPIRED` to PostgreSQL via sentinel return (`{ kind: 'EXPIRED' }`), then raise HTTP 422 `admissionExpired` outside the transaction, guaranteeing both state persistence and atomic lease-verification isolation.

### [2026-11-27] [BILLING/POST-LOCK-CLOCK-AND-FALLBACK-DRIFT] Multi-Lock Clock Drift, Final Lock TTL Re-Evaluation & Deterministic Lock Signals
- **Context / Symptom**: Review of clock drift during row-lock queueing identified two timing boundary leaks in consume and heartbeat: 1) In consume, unconsumed admission TTL (`expiresAt`) was checked only before waiting on the `AssessmentRuntime` row lock; if the transaction queued behind a lock holder past the TTL mark, it still transitioned to `IN_FLIGHT`; 2) In the fallback `AssessmentDiscoveryRun` branch, both consume and heartbeat reused timestamps sampled prior to waiting on the discovery run lock, allowing expired discovery leases to pass.
- **Root Cause**:
  1. In PostgreSQL, `NOW()` freezes at transaction start (`transaction_timestamp()`) and does not advance during queueing for row locks. Sampling `clock_timestamp()` only after the first lock (`AssessmentRuntime`) left any subsequent lock acquisitions (`AssessmentDiscoveryRun` or `RuleSetPreparationRun`) vulnerable to uncaptured elapsed time.
  2. Admission TTL was evaluated only once at the beginning of the transaction. Any queueing delay during runtime row-lock acquisition was not accounted for before CAS transition to `IN_FLIGHT`.
  3. Test synchronization using arbitrary sleep delays (`setTimeout(..., 20)`) introduced potential race conditions and test flakiness.
- **Resolution & Invariant**:
  1. Sample `clock_timestamp()` immediately after acquiring the lock on each chosen authority row (`AssessmentRuntime`, `AssessmentDiscoveryRun`, or `RuleSetPreparationRun`).
  2. In consume, re-evaluate unconsumed admission TTL (`admission.expiresAt <= finalUtcNow`) and approved run deadline (`approvedDeadline <= finalUtcNow`) after the final authority lock is held, immediately before the state transition. If TTL expired during the lock wait, commit `state: EXPIRED` within the transaction and return sentinel `{ kind: 'EXPIRED' }` to throw HTTP 422 `admissionExpired` outside.
  3. In heartbeat, re-evaluate `runtimeCeiling <= dbUtcNow` after acquiring the final authority lock immediately before extending the lease, failing closed with HTTP 403 Forbidden.
  4. Test synchronization: Use a Promise-based lock acquisition signal (resolved immediately after `SELECT ... FOR UPDATE` resolves in the background transaction) instead of arbitrary timeouts, ensuring zero-flake concurrency test execution.

### [2026-11-27] [BILLING/COMPENSATION-AUTHORITY-AND-BRANCH-ISOLATION] Financial Debit Authority, Distinct Action RBAC & Granular RED Verification
- **Context / Symptom**: Review of G-07 compensation specification and RED tests identified two financial authority contradictions and a test verification flaw: 1) Test fixtures seeded debits with `rolloutMode: "TELEMETRY_ONLY"` and `debitMode: "OFF"` while recording real ledger deductions; 2) Handler only checked role `ADMIN` without enforcing explicit `BILLING_ACTIONS.compensation`, conflating compensation with goodwill credit; 3) RED tests failed on an identical stub error (`concurrencyConflict`) rather than independently testing each domain branch.
- **Root Cause**:
  1. A legitimate debit can NEVER be produced under `debitMode: "OFF"`. Seeding an off-mode admission with a live debit created an illegal financial fixture that falsely taught the handler to compensate debits issued without financial authority.
  2. Defining `BILLING_ACTIONS.compensation` in contracts is insufficient without runtime enforcement: ADR-028 Line 173-174 mandates that role alone never grants financial authority, and compensation must remain distinct from goodwill credit.
  3. Throwing a single generic stub exception from the handler caused all tests to fail with that same error, verifying only that the stub threw, rather than independently testing each domain assertion.
- **Resolution & Invariant**:
  1. Financial debit authority: Eligible debit fixtures must be seeded with `rolloutMode: "DEBIT_ENABLED"`, `debitMode: "ON"`, `debitedMicrocredits` matching ledger `abs(deltaMicrocredits)`, and wallet balance reflecting the deduction. Debits linked to `OFF` admissions or mismatched receipts must be rejected with HTTP 422 `BILLING_DEBIT_NOT_ELIGIBLE`.
  2. Explicit action RBAC: Enforce `@RequireActions(BILLING_ACTIONS.compensation)` on controller and verify `rbacContext.permissions` in handler. Admin sessions lacking this explicit authority (e.g. granted only `BILLING_ACTIONS.goodwillCredit`) receive HTTP 403 Forbidden (`AUTH_ERROR_CODES.rbacDenied`).
  3. Granular RED verification: Structure RED tests and handlers so that each branch fails on its own distinct assertion (e.g. unpersisted ledger entry, missing wallet projection, ceiling calculation, duplicate entry detection, concurrency race, missing audit event), proving independent branch verification before full implementation.

