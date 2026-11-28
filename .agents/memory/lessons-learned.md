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

### [2026-11-28] [WORKER/CAPABILITY-ENVELOPE-RECOVERY] Crash Between Envelope Write and Consume, and Priced Token Buckets Parity
- **Context / Symptom**:
  1. Worker crash recovery sweeper threw HTTP 422 `admissionInvalidState` on startup when sweeping admissions that crashed between durable envelope write and atomic CAS consume, creating an unrecoverable boot crash loop.
  2. Live settlement and crash recovery dropped priced token buckets (`cachedInputTokens`, `cacheWriteTokens`, `reasoningTokens`), settling only `inputTokens`, `outputTokens`, `totalTokens` and underbilling models with prompt caching and reasoning.
- **Root Cause**:
  1. `UsageMeteringMiddleware` durably encrypts and records the capability envelope in SQLite before calling `POST /internal/billing/admission/consume`. A worker crash in that window leaves the server-side admission state as `ADMITTED`. Recovery previously called `/internal/billing/usage/settle` with `OUTCOME_UNKNOWN`, but the settlement handler rejects `ADMITTED` with HTTP 422 `admissionInvalidState`. Because startup recovery fails closed, workers were stuck in a crash loop on every restart.
  2. `extract_verified_token_evidence` only extracted `inputTokens` and `outputTokens`, ignoring prompt caching details (`cache_read`, `cache_creation`) and reasoning tokens in `input_token_details` and `output_token_details`.
- **Resolution & Invariant**:
  1. In `recover_in_flight_capabilities`, when usage evidence is absent: first attempt pre-consume cancellation via `POST /internal/billing/admission/cancel`. If the admission is still `ADMITTED`, the server transitions it to `CONFIRMED_NO_USAGE`, releases the concurrency slot (`slotReleased: true`), and the worker deletes the envelope from SQLite. If cancellation returns HTTP 409 Conflict (`admissionAlreadyInFlight`), consume won the race on the server; the worker then falls back to `/internal/billing/usage/settle` with `OUTCOME_UNKNOWN` and retains the envelope in SQLite for administrative reconciliation.
  2. In `extract_verified_token_evidence`, flatten metadata and extract all priced token buckets: `cachedInputTokens`, `cacheWriteTokens`, and `reasoningTokens`. Store all 6 buckets in SQLite `invocation_usage_evidence`, and forward all of them in settlement requests across both normal live execution and crash recovery, guaranteeing 100% contract parity.

### [2026-11-28] [WORKER/BILLING-TARIFF-ACCOUNTING-AND-RECOVERY-FAIL-CLOSED] Non-Overlapping Input Tokens, Auxiliary Usage Unpacking & Cancellation Conflict Guard
- **Context / Symptom**:
  1. Billing tariff calculation double-charged for cached tokens when providers reported inclusive prompt tokens alongside cache breakdown buckets.
  2. Provider responses containing usage metadata only in `response_metadata["token_usage"]` (e.g. OpenAI format) dropped cache discount and extended reasoning buckets, charging standard rates.
  3. Sweeper caught all HTTP 409 errors during pre-consume cancellation, erroneously swallowing concurrency limit errors (`BILLING_CONCURRENCY_LIMIT_REACHED`) instead of failing closed.
- **Root Cause**:
  1. Server tariff calculation computes `totalNumerator = inputTokens * inputRate + cachedInputTokens * cachedRate + cacheWriteTokens * writeRate`. When providers report inclusive `input_tokens` (inclusive of cache reads and cache writes), sending raw `input_tokens` as `inputTokens` resulted in charging for cached tokens twice.
  2. `extract_provider_usage` and `extract_verified_token_evidence` only inspected top-level metadata and `input_token_details`/`output_token_details`, omitting `prompt_tokens_details`, `completion_tokens_details`, and `details`.
  3. Pre-consume cancellation catch block treated any exception with `status_code == 409` as an in-flight race, ignoring the specific `error_code`.
- **Resolution & Invariant**:
  1. **Strictly Non-Overlapping Accounting Buckets**: For inclusive providers (`OPENAI`, `GOOGLE_GENAI`, `INCEPTION`, normalized `ANTHROPIC`, or responses with `prompt_tokens_details`/`cached_tokens`), compute `inputTokens = input_tokens - cachedInputTokens - cacheWriteTokens` before dispatching settlement requests.
  2. **Comprehensive Container Flattening**: Both live extraction (`extract_provider_usage`) and recovery extraction (`extract_verified_token_evidence`) flatten `response_metadata`, `token_usage`, `details`, `prompt_tokens_details`, `completion_tokens_details`, and `cache_creation`, converting string integers to native ints.
  3. **Strict 409 Code Verification**: `recover_in_flight_capabilities` only treats HTTP 409 as a consume race if `error_code` matches `BILLING_ADMISSION_ALREADY_IN_FLIGHT` or `admissionAlreadyInFlight`. Any other 409 or non-409 error fails closed and re-raises immediately.
  4. **Zero Fallback on Contradictory Usage**: When normalization detects contradictory token buckets (e.g. `input_tokens < cachedInputTokens`, yielding negative derived uncached input), `extract_provider_usage` returns `None`. Settlement logic strictly forbids falling back to raw un-normalized metadata to construct `COMPLETED` requests. Instead, it must route to `OUTCOME_UNKNOWN` and retain both the capability envelope and the concurrency slot for audit and reconciliation.

### [2026-11-28] [BILLING/PRICING-TEST-UNIT-PARITY] Worker Mock Omitted Per-Million Tariff Conversion
- **Context / Symptom**: A worker recovery test claimed that a settlement response of 18,600 microcredits matched the canonical tariff calculator, but both its Python helper and mock API client multiplied token counts by rates without applying the contract's per-million-token divisor.
- **Root Cause**: The test asserted equality between two copies of the same incorrect Python calculation. The rate unit in `packages/contracts/src/billing/microcredit-pricing.ts` is microcredits per million tokens, and the authoritative calculator divides the total weighted numerator once by 1,000,000.
- **Resolution & Invariant**: Scale representative fixture rates consistently, divide once after summing buckets in the mock, and assert the same fixture with the real TypeScript contract calculator. Worker tests prove payload and recovery behavior; only the contract calculator or a NestJS settlement E2E can prove the authoritative monetary amount. A low-rate reproducer must catch any mock that skips the divisor.

### [2026-11-28] [BILLING/ADMISSION-EXPOSURE-BUCKETS] Ordinary-Rate Admission Underbounded Cache Writes
- **Context / Symptom**: G-04 review found a published tariff could charge 20,015 microcredits for an invocation within its token bounds while the customer admission stamped only 3,015 microcredits. The PostgreSQL E2E reproducer failed before the fix and passed after it.
- **Root Cause**: The admission handler called the settlement calculator only with ordinary `inputTokens` and `outputTokens`. The same pinned tariff may price disjoint cached-input, cache-write, and reasoning buckets at different rates during settlement.
- **Resolution & Invariant**: Before dispatch, price the full bounded input volume in every tariff-supported input bucket and include bounded separately priced reasoning; stamp the largest result as immutable `initialExposureMicrocredits`. Use the canonical integer calculator for each candidate. This is exposure reservation, not a customer charge or a new per-assessment spending cap. G-04 still requires provider-specific bound semantics, operational telemetry and owner approval before GREEN.

### [2026-11-28] [BILLING/PRICING-POLICY-VERSION] Draft Markup Changed from 1.8 to 1.2
- **Context / Symptom**: Product changed the planning markup to `1.2` after a draft price table had been prepared with `1.8`; the informational customer usage quote, mock responses and current planning docs still advertised the old value.
- **Root Cause**: A current planning assumption and a versioned informational quote were represented in separate files, so editing the draft table alone left customer-visible estimates inconsistent.
- **Resolution & Invariant**: Version the informational quote as `lcsp-usage-1.2-v1`, align current planning documents and mock fixtures, and preserve RED/GREEN tests for exact decimal quotes. The quote and FX/infra/markup draft remain non-authoritative; only a published microcredit tariff snapshot may price admission or settlement. Historic evidence mentioning `1.8` remains historical rather than being rewritten as if it never existed.

### [2026-11-28] [WORKER/ADMISSION-INPUT-BOUND-AUTHORITY] Request Hint Understated G-04 Exposure
- **Context / Symptom**: A request carrying `input_tokens_upper_bound = 1` sent that value to server admission despite the configured model route declaring a 1,000,000-token context ceiling; the focused worker test failed before the fix.
- **Root Cause**: `_execute_server_admission` preferred a mutable request attribute over the configured route's hard input ceiling. The request attribute was an unverified estimate and could underprice maximum exposure while provider dispatch remained capable of using the larger route limit.
- **Resolution & Invariant**: Resolve `inputTokensUpperBound` exclusively from `input_token_limit(model)` for admission. A request-local hint cannot reduce the bound used to price `maximumExposureMicrocredits`; retain a focused regression test. G-04 remains pending operational telemetry and approval.

### [2026-11-28] [WORKER/ADMISSION-OUTPUT-CAP-AUTHORITY] Request Settings Raised Provider Output Above Admitted Bound
- **Context / Symptom**: For the configured Anthropic route, the worker admitted a 4,096-token output bound but a request-local `model_settings.max_tokens = 131,072` reached the provider-facing handler. The focused test failed before the fix and passed afterward.
- **Root Cause**: `_prepare` merged route output settings before request model settings, so caller settings overwrote the native protocol cap after the bound had been priced for admission.
- **Resolution & Invariant**: Resolve the native provider cap through `output_cap_settings(model)` and clamp caller settings to that cap. A smaller valid request cap remains allowed; an invalid cap fails before dispatch. Check each configured provider's native output parameter before enabling that route. G-04 remains pending provider-bound inventory, operational telemetry and approval.

### [2026-11-28] [BILLING/RECONCILIATION-FUNDING-AND-CORRELATION] Platform Cases and Swept Provider Identity
- **Context / Symptom**: Admin decisions on platform-sponsored reconciliation cases returned 404 despite an existing case, and swept cases stored the invocation ID as provider correlation ID even when the dispatched correlation ID differed.
- **Root Cause**: The decision handler always attempted to lock a customer wallet, although platform-sponsored admissions intentionally have no wallet. The sweeper built provider correlation from `invocationId` instead of reading the admission's `correlationId` under lock.
- **Resolution & Invariant**: Lock the platform sponsorship aggregate before the admission for platform cases, and lock a real wallet only for customer cases. Persist the locked admission's correlation ID in the swept case. Reconciliation evidence must be checked against the same identity sent to the provider; no-usage decisions must never be authorized by searching an unrelated ID.

### [2026-11-28] [BILLING/PLATFORM-UNPRICED-USAGE] Platform Provider Buckets Without Pinned Rates
- **Context / Symptom**: A platform-sponsored invocation with valid provider cache usage caused settlement HTTP 500 because its pinned policy priced only ordinary input/output tokens. The transaction rolled back and left no reconciliation case.
- **Root Cause**: The handler passed cache/reasoning buckets to the canonical calculator even though platform policy deliberately marked those buckets unsupported; the resulting typed pricing error escaped the transaction before a durable unknown outcome was recorded.
- **Resolution & Invariant**: Before pricing, detect positive cache or reasoning buckets under platform sponsorship and atomically record OUTCOME_UNKNOWN plus an INTEGRITY_REVIEW case with the reported usage. Keep admission exposure and slot, and create no receipt or debit. Add dedicated published rates before these buckets may settle normally; never treat missing rates as zero.

### [2026-11-28] [ASSESSMENT-ROOT/CLAIM-LEASE-USAGE-BINDING] Root Model Calls Lost Billing Lease Authority
- **Context / Symptom**: A live NestJS/PostgreSQL G-06 integration test entered the Assessment Root graph but made zero provider calls; usage admission failed closed with `MISSING_EXECUTION_CONTEXT`, and Root paused before billing HTTP admission.
- **Root Cause**: The transport `AgentRunState` has no execution lease until the server claims the Root. `_root_telemetry` copied the state with `dataclasses.replace` to attach the claimed execution ID but did not attach `claim["leaseToken"]`. `UsageMeteringMiddleware._execute_server_admission` requires that lease for an Assessment request, so every physical Root model attempt was rejected before dispatch.
- **Resolution & Invariant**: After a successful API claim, bind both the claim's execution ID and lease token to the copied run-scoped usage state. The token must come from the server claim, never the broker payload or a fabricated fallback. Keep a Root boundary-to-billing HTTP/PostgreSQL regression test asserting request → consume → provider order and the persisted owner wallet/tariff/debit-OFF authority. This fixture substitutes Root control/hydration and does not itself close G-06.

### [2026-11-28] [WORKER/ADMISSION-ROUTE-IDENTITY] Shared Model Name Selected Wrong Input Ceiling
- **Context / Symptom**: A worker configured with two reachable routes using the same model name sent the first route's 1,000,000-token input ceiling for the second provider's 2,000,000-token route. The focused admission test reproduced the underbound before the fix.
- **Root Cause**: `input_token_limit` searched the route table by model name alone and accepted the first match when the model object lacked attached route metadata. Provider, protocol and route ambiguity were ignored.
- **Resolution & Invariant**: Resolve a fallback ceiling only when provider, protocol and model identify exactly one configured route; otherwise fail closed before admission and provider dispatch. A shared model name cannot establish monetary exposure authority, and route ordering must not change the admitted bound.

### [2026-11-28] [WORKER/POST-SETTLEMENT-PAYMENT-PAUSE] Cleanup Failure Hid Server Depletion Decision
- **Context / Symptom**: An ON settlement could finish with `paymentRequired=true`, but a worker-local SQLite deletion error prevented the Root from receiving the payment pause marker. The provider call and settlement had already completed.
- **Root Cause**: The worker deleted the recovery envelope before recording the server's terminal depletion decision; the broad settlement cleanup catch then logged the deletion error and returned the model response without a pause marker.
- **Resolution & Invariant**: After a terminal server acknowledgement, stamp the trusted run-state and checkpointable model-response marker before attempting local envelope cleanup. On cleanup failure, retain the envelope for idempotent recovery and still interrupt at the later `after_model` checkpoint. Never throw from inside the settled model node or redispatch that invocation on Continue.

### [2026-11-28] [ASSESSMENT/PAYMENT-REQUIRED-CHECKPOINT] Wallet Denial Was Reported as Root Failure
- **Context / Symptom**: A real Assessment Root graph receiving HTTP 402 `BILLING_PAYMENT_REQUIRED` before its model call made zero provider calls but settled the execution as `FAILED`. Customer Continue could also queue a paused turn while the shared wallet still had zero available credits.
- **Root Cause**: The billing worker exception reached the Root runner's generic exception branch, while the API pause allowlist recognized only runtime call/token budget reasons. The customer Continue path validated checkpoint and source pins but never re-read the owner-bound shared wallet.
- **Resolution & Invariant**: Match both HTTP 402 and the canonical billing problem code, capture a durable native checkpoint, and settle a distinct `PAYMENT_REQUIRED` pause. The API accepts that reason only under existing pause/checkpoint authority. Customer Continue reads the owner's wallet within its control transaction and refuses missing or nonpositive available credits before changing the turn or enqueueing work. Top-up alone never resumes; the next billable admission still row-locks and rechecks wallet solvency before provider dispatch. Unrelated callback failures remain failures.

### [2026-11-28] [ASSESSMENT/LAST-CALL-SETTLEMENT-CHECKPOINT] Post-Settlement Exception Replayed a Paid Model Step
- **Context / Symptom**: A terminal ON settlement could deplete the shared wallet on the final model call, leaving no subsequent admission to return HTTP 402. A proposed worker exception paused Root, but a real native checkpoint/Continue test showed the same paid model step ran again.
- **Root Cause**: Throwing from model middleware after the provider response was settled prevented LangGraph from committing that response into its model-node checkpoint. The pause pointed before the paid call. An in-memory flag alone also disappears on process restart between model and after-model nodes.
- **Resolution & Invariant**: Persist the server-owned `paymentRequired` decision in the immutable receipt and settlement response. After a terminal ON acknowledgement and envelope deletion, stamp an internal marker on the returned AIMessage while overwriting any provider-supplied marker; Root interrupts only in the separate `after_model` node. Customer Continue resumes the exact native interrupt, allowing the graph to advance past the already paid response. A real graph test must show one finalization and one report, with no replay of the first model step. The crash window before the server records the pause still requires operational recovery review; it does not make G-06/G-07 GREEN by itself.

### [2026-11-28] [BILLING/LEGACY-RECONCILIATION-ACTION] Older No-Usage Route Lacked Financial Action Guard
- **Context / Symptom**: A review of Admin reconciliation routes found the case-decision endpoint required `BILLING_RECONCILIATION_DECISION`, while the older `resolve-no-usage` endpoint could also release a wallet slot but required only the `ADMIN` role. A focused controller metadata test failed before the fix.
- **Root Cause**: The financial action decorator was applied to the newer route only. The older mutation stayed under class-level role protection, which did not enforce the same explicit permission boundary. Its handler also wrote the literal `admin` as `resolvedBy`, and the case-list error mapper replaced a supplied request correlation ID with a fixed fallback.
- **Resolution & Invariant**: Every route that closes an unresolved invocation or releases exposure must carry the reconciliation decision action guard and persist the authenticated Admin user ID as resolver. Preserve the supplied request correlation ID in case read failures and validate case identifiers at the transport boundary. Keep the automated provider release gate OFF until independent evidence authority is operationally accepted.

### [2026-11-28] [WORKER/LOCAL-CEILING-BEFORE-SERVER-CONSUME] Local Denial Stranded Server Slot
- **Context / Symptom**: Legacy paid-admission migration exposed a real sync/async ordering failure: a local `CALL_LIMIT` denied the model before dispatch, but the server admission had already reached `IN_FLIGHT`. A focused RED test recorded server `request → consume`, zero provider calls, and a held slot.
- **Root Cause**: `UsageMeteringMiddleware._execute_server_admission` durably stored and consumed the capability before the wrapper called local `_admit`; the latter could reject outside the provider error handler. A lost response after successful pre-consume cancellation also made a retry receive 422 instead of a terminal receipt.
- **Resolution & Invariant**: Order one predispatch operation as server request (`ADMITTED`) → encrypted envelope → local hard-ceiling admission → server consume → provider. On local denial or uncertain consume, attempt server cancellation but delete the envelope only after a terminal slot-release acknowledgement; any ambiguous `IN_FLIGHT` outcome retains evidence for recovery. Server cancellation replays an already `CONFIRMED_NO_USAGE` result idempotently for the same capability, while `IN_FLIGHT` still rejects cancellation. Local reservation cleanup after ambiguous server failure remains a liveness risk requiring separate evidence and design.

### [2026-11-28] [BILLING/CUSTOMER-UNPRICED-AND-SPLIT-USAGE] Settlement Lost Pricing Evidence
- **Context / Symptom**: A completed customer-funded call with an unsupported cache bucket returned HTTP 500 and left no durable integrity case. A split 5-minute/1-hour cache-write report was dropped by settlement Zod parsing, and explicit zero tokens persisted as null.
- **Root Cause**: The unsupported-bucket guard applied only to platform sponsorship; settlement request schema omitted split buckets; the receipt used truthiness for optional token counts. The replay fingerprint omitted the two split fields.
- **Resolution & Invariant**: Check every pinned tariff for unsupported nonzero buckets, convert typed incomplete-price failures into OUTCOME_UNKNOWN with an INTEGRITY_REVIEW case while retaining exposure and slot, carry split counts through schema/calculator/receipt/fingerprint, and use definedness so zero remains zero. Test the actual HTTP/PostgreSQL path with an unsupported customer tariff, distinct split rates, and explicit zeros before changing settlement production code.

### [2026-11-28] [BILLING/ADMISSION-MISSING-TARIFF-HTTP] Missing Price Surfaced as Internal Error
- **Context / Symptom**: Migrated worker tests modeled a missing active customer tariff as HTTP 422, but a focused live NestJS/PostgreSQL test received HTTP 500 for the same condition.
- **Root Cause**: `ModelPricingCalculatorService.resolveEffectiveTariff` raised a typed `ModelPricingNoCoverageError`; the admission command rethrew it unchanged, and the admission controller did not apply the billing HTTP error mapper.
- **Resolution & Invariant**: Map that typed denial to the canonical 422 `modelPricingNoCoverage` problem in the admission command's error boundary. Verify through real HTTP that no admission record or capability is issued. Worker mocks must be paired with an API integration test for financial denial parity.

### [2026-11-28] [WORKER/LEGACY-REHEARSAL-SERVER-CONTEXT] Offline Budget Test Bypassed Current Admission Contract
- **Context / Symptom**: Three token-budget analytics tests failed with `MISSING_EXECUTION_CONTEXT` after server-issued admission became mandatory; the standalone rehearsal constructed `LiveUsage` without an API authority or preparation run ID.
- **Root Cause**: The old offline fixture assumed local `RunAdmission` alone authorized physical model calls. Current middleware correctly requires server request/consume and a durable envelope before provider dispatch.
- **Resolution & Invariant**: Route physical-call test fixtures and the rehearsal through a test-only server-issued admission authority, supply configured route input bounds, and retain the production fail-closed guard. Verify both pytest and direct script execution; do not change production policy to satisfy legacy tests.

### [2026-11-28] [WORKER/LOCAL-JOURNAL-TERMINAL-PARITY] Server Freed Slot but Local Ceiling Stayed Reserved
- **Context / Symptom**: A server-confirmed pre-consume cancellation released the wallet slot, while the worker's SQLite `RunAdmission` still counted the same physical attempt against its local call and exposure ceiling.
- **Root Cause**: Local admission entered `ADMITTED`/`IN_FLIGHT` before server consume, but the cancellation path only removed the encrypted recovery envelope; it had no terminal local-journal transition.
- **Resolution & Invariant**: After a server response explicitly confirms `CONFIRMED_NO_USAGE` and `slotReleased=true`, close the matching local predispatch attempt and zero its reserved exposure before envelope deletion. An ambiguous consume/cancel or unknown/settled local row must retain its evidence and exposure. Verify the middleware trust boundary, not only a direct local method call.

### [2026-11-28] [WORKER/GRAPH-TASK-SETTLEMENT-REPLAY] Fresh Logical ID Bypassed Settled-Call Fence
- **Context / Symptom**: A real LangGraph checkpoint test crashed after a model response standing in for terminal settlement but before the model node committed. Resuming the same thread invoked the provider a second time.
- **Root Cause**: `AgentRoleMiddleware` called `activate_model_step()` without a stable ID, generating a new UUID on every node replay. The server's settled logical-operation fence could not recognize the replay as the same paid step. The worker also accepted a replayed `SETTLED` admission as if dispatchable.
- **Resolution & Invariant**: Bind the model-step ID to LangGraph's checkpoint-stable `execution_info.task_id` when present, while retaining fresh IDs for nongraph callers. Reject every server admission replay state except `ADMITTED` before local reservation, consume, or provider dispatch; `IN_FLIGHT` remains recovery-only. This prevents duplicate dispatch but does not reconstruct a response lost before checkpoint, so operational recovery remains a separate gate.

### [2026-11-28] [BILLING/OUTPUT-EVALUATION-AUTHORITY] Provider Usage Is Not Output Acceptance
- **Context / Symptom**: Settlement persisted a confirmed usage receipt but no `ModelOutputEvaluation` row; downstream schema/domain validation occurs later and can follow retry/fallback.
- **Root Cause**: The usage middleware settles inside the model call before outer evaluators run, while a model-step ID may represent several physical attempts. Provider completion alone cannot establish an `ACCEPTED` or `DOMAIN_REJECTED` verdict.
- **Resolution & Invariant**: Create a separate `NOT_EVALUATED` row bound to the exact admission and physical `invocationId` in the settlement transaction. The worker overwrites any provider-supplied physical invocation marker on the returned response with the ID issued by server admission; retry/fallback responses carry the winning physical ID. Only a later evaluator with this causation and business evidence may write `DOMAIN_REJECTED`; no billing mutation follows an evaluation verdict. The downstream writer and replay policy remain separate work.

### [2026-11-28] [WORKER/PAID-RESPONSE-CHECKPOINT-GAP] Terminal Receipt Outlived the Model Answer
- **Context / Symptom**: A real LangGraph model node could settle a paid call and then crash before checkpointing its response. Server replay blocked a second provider dispatch but could not reconstruct the original answer.
- **Root Cause**: The worker recovery journal stored capability and usage evidence, not the model response. LangGraph checkpoint writes occur after middleware returns; terminal settlement can precede that write.
- **Resolution & Invariant**: Commit an encrypted, graph-step-bound response before terminal settlement; on restart compare both local admission/invocation IDs with the server's `SETTLED` replay before restoring LangChain messages. Promote a pending response only after authoritative terminal acknowledgement, including startup sweeper recovery. A temporary response has a bounded TTL and startup purge; do not claim operational completion until checkpoint-ack deletion and worker restart evidence are verified. An output verdict still requires a separately authenticated evaluator event, never inference from provider completion.

### [2026-11-28] [WORKER/LANGGRAPH-PENDING-WRITES-DEQUE] Synthetic Checkpoint Writes Missed Cleanup
- **Context / Symptom**: A synthetic checkpoint test supplied a list of pending writes, while the real LangGraph graph supplied a `deque`; the paid response remained in local recovery after a successful graph write.
- **Root Cause**: The checkpoint acknowledgement hook accepted only list/tuple write containers and silently skipped the real sequence type.
- **Resolution & Invariant**: Accept the native `deque` shape and require exact execution ID, model task, physical invocation marker, and serialized message match before deleting encrypted response after successful `put_writes`. Keep wrong-channel, failed-write, and mismatched-identity tests; a real graph test must accompany mocked saver tests. Live Postgres acknowledgement and operational retention evidence remain separate gates.

### [2026-11-28] [ASSESSMENT/RULE-REJECTION-JOURNAL-AUTHORITY] Worker Event ID Was Neither Unique nor Immutable
- **Context / Symptom**: A narrow `DOMAIN_REJECTED` callback could read one rule-authoring rejection event by JSON event ID, while another event with the same worker-supplied ID could be inserted later or its payload changed.
- **Root Cause**: `AssessmentRuntimeEvent` only constrained `(runId, sequence)` and allowed UPDATE/DELETE of `outputSummaryJson`; the callback's read-time `take: 2` was not a durable uniqueness guarantee.
- **Resolution & Invariant**: For `RULE_SET_PREPARATION` journal rows with `RULE_AUTHORING_TOOL_REJECTED`, PostgreSQL now requires a nonempty event ID, enforces unique `(runId, eventId)` and rejects UPDATE/DELETE of the row. Direct DB tests must prove duplicate insert and tamper fail while unrelated stream event kinds remain unaffected. Worker event ID is server-persisted and uniquely constrained, not server-generated. A verdict still requires exact physical invocation causation and receipt membership.

### [2026-11-28] [BILLING/EXPIRED-REPLAY-CONSUME-RACE] Expiry Replay Could Overwrite a Live Invocation
- **Context / Symptom**: Replaying an expired `ADMITTED` admission used an unconditional update by ID. A concurrent consume could move the same record to `IN_FLIGHT` between the replay's read and write, after which replay would incorrectly persist `EXPIRED` and release its slot.
- **Root Cause**: The expiry transition did not compare expected state and version. Its first read was treated as current authority even after another transaction could commit a state change.
- **Resolution & Invariant**: Use conditional `updateMany` matching ID, `ADMITTED`, version and expiry; if it loses, reread and return the updated in-flight replay or a conflict. Never let an expiry replay overwrite `IN_FLIGHT`. Keep a focused race reproducer and test the conflict branch whenever a new admission state transition is added.

### [2026-11-28] [BILLING/RULE-PREPARATION-PHYSICAL-CAUSATION] Tool-call IDs Alone Cannot Authorize Domain Verdicts
- **Context / Symptom**: A rule-authoring rejection could name a tool-call ID also present in more than one legitimate settled physical receipt, so a callback based only on that ID could mark the wrong invocation `DOMAIN_REJECTED`.
- **Root Cause**: The worker event ID is scoped to a run, and provider tool-call IDs can be reused; neither is a globally unique physical invocation identity. A duplicate rejection journal insert also surfaced a raw Prisma uniqueness error as HTTP 500.
- **Resolution & Invariant**: Require the rejection journal's physical invocation ID to equal the settled admission and immutable receipt, use the server journal row ID as the global evaluator event identity, and map duplicate rejection-event publication to a canonical 409 problem. Missing or ambiguous physical identity leaves `NOT_EVALUATED`; callback replay must be idempotent and must not mutate wallet or ledger.

### [2026-11-28] [ASSESSMENT/JOURNAL-RETENTION-DELETE] Evidence DELETE Trigger Broke Owner Lifecycle
- **Context / Symptom**: Deleting an authorized Legal Source with a terminal Rule Set Preparation run failed because its rejection journal child could not be deleted.
- **Root Cause**: A blanket `BEFORE UPDATE OR DELETE` trigger protected rejection evidence without accounting for the existing Legal Source deletion transaction and preparation-run foreign-key cascade.
- **Resolution & Invariant**: Keep rejection evidence UPDATE-immutable and event IDs unique, but allow the established owner-lifecycle deletion path. Do not expose a verdict writer that depends on a deletable journal until the retention/erasure policy and durable post-deletion audit proof are specified and tested.
### [2026-11-27] [STACK: deepagents] Pre-audit questions describe intended AI feature behavior
- **Context / Symptom**: Every AI candidate produced the same production and operations questions, including test-only code.
- **Root Cause**: The discovery scanner used one fixed list for product context and unresolved runtime reachability.
- **Resolution & Invariant**: Ask about a product candidate's intended workflow and use of AI output. Preserve static reachability gaps for source investigation and keep test/example findings without interview prompts. The SDK/HTTP and test-only scanner regressions verify both paths.
- **After rule selection**: The registered Assessment Root startup and question guidance must reuse accepted Discovery answers, start from the relevant product workflow and pinned code, and defer external questions until a selected rule still depends on a missing fact. Verify the loaded runtime assets because reference prompt edits alone do not reach the agent.

### [2026-11-27] [STACK: apps/web] Nested Settings dialogs preserve scroll content and mounted focus targets
- **Context / Symptom**: At a 320px viewport with enlarged Vietnamese text, the Confirm Access heading consumed most of the dialog and identity/support cards shrank below their content. Dismissing step-up also left focus on an unmounted intermediate confirmation control.
- **Root Cause**: A constrained flex scroll body allowed child cards to shrink, and the nested dialog's default focus return target no longer existed after the parent action prompt unmounted.
- **Resolution & Invariant**: Keep content cards at intrinsic height and scroll the dialog body; wrap account identifiers instead of truncating them. Consumer-specific header sizing must remain opt-in. When a controlled nested dialog can outlive its trigger, provide a stable mounted focus target and verify Tab, Shift+Tab, Escape, reopen, and restoration without changing authorization or proof handling.

### [2026-11-28] [PYTHON/ARCHIVES] Rootless fixture members match verified root metadata
- **Context / Symptom**: Four Docker release integrations declared `VERIFIED_ROOTLESS` and expected `src/app.py`, but hydration reported the file missing; the shared TAR also allowed its nested `repo/.lcsp/repository.json` test payload through sanitization.
- **Root Cause**: The fixture encoded every member beneath `repo/` while both the fake snapshot client and HTTP fixtures declared that no provider wrapper existed. The sanitizer correctly preserved all paths when wrapper metadata was absent.
- **Resolution & Invariant**: Keep archive fixture member paths repository-relative whenever transport metadata says `VERIFIED_ROOTLESS`. Rootless semantics preserve legitimate top-level directories; only exact verified wrapper metadata may remove one. Assert the shared fixture's sanitized paths and reserved `.lcsp` omission, while retaining contradictory metadata and pinned-tree rejection coverage.

### [2026-11-28] [COMPLIANCE-RULE-SET/CANCELLATION-COMMIT-FENCE] Native Stop Cannot Roll Back With a Run Transaction
- **Context / Symptom**: Cancelling a running Rule Set Preparation could signal Agent Server before the database compare-and-set committed; a transaction conflict could leave the run marked RUNNING after its native work had already been stopped. A cooperative native cancel could also return HTTP 200 while the run remained active.
- **Root Cause**: The handler made a network call while holding the preparation row lock, then treated transport acknowledgement as terminal cancellation. Reactivation and availability used different unresolved-state sets.
- **Resolution & Invariant**: Commit a nonterminal `CANCEL_REQUESTED` fence with actor audit first. A bounded poller signals the native run outside the transaction and closes the row only after an explicit terminal status; unknown status, HTTP 404, timeout, or network failure keeps the request pending. Reactivation and availability share the same unresolved-state set. PostgreSQL integration must verify the cancel/submission race before operational closure.

### [2026-11-28] [COMPLIANCE-RULE-SET/SELECTED-RULE] Cancellation authority and pending state must cross every entry point
- **Context / Symptom**: The selected-rule cancel route attributed an Admin request to a fixed system actor. Its submit/import and catalog paths also treated `CANCEL_REQUESTED` as finished, while Admin activity UI closed its stream early.
- **Root Cause**: A shared cancellation command accepted an actor but the selected-rule wrapper supplied a constant; adjacent consumers each maintained their own incomplete QUEUED/RUNNING checks.
- **Resolution & Invariant**: Pass the authenticated Admin ID through the controller and service into the audited command. Reuse the canonical unresolved-state set for submission, import and catalog decisions, and keep SSE live until native cancellation reaches a terminal state. Regression tests must exercise the controller-to-command actor and pending-cancel behavior.

### [2026-11-28] [COMPLIANCE-RULE-SET/DIAGNOSTIC-DB] Guard the resolved adapter target
- **Context / Symptom**: A diagnostic command could pass its database allowlist using `process.env.DATABASE_URL` even when `PrismaService` connected through a different ConfigService URL.
- **Root Cause**: The guard checked an environment value instead of the adapter's effective datasource.
- **Resolution & Invariant**: Capture only the sanitized host and database name from Prisma's resolved connection configuration and check that identity before diagnostic writes. A permitted environment URL cannot authorize a client connected to another target; never expose the connection string or password.

### [2026-11-28] [CONTRACTS/NEXT-SOURCE-IMPORT] Browser bundling must resolve source imports
- **Context / Symptom**: The Admin Rule Set page failed to compile in Next although API unit tests passed, because a new contracts constant imported an internal `.js` path while the web package resolved contracts directly from TypeScript source.
- **Root Cause**: The internal import followed the server's emitted-JavaScript convention instead of the source-import convention already used by neighboring contract files.
- **Resolution & Invariant**: Use the package's source-resolvable `.ts` import for internal shared-contract references and verify the affected page in Chromium. Contract unit tests alone do not establish that Next can bundle a changed contract.

### [2026-11-28] [COMPLIANCE-RULE-SET/CATALOG-DELETE-LOCK] Deletion Must Serialize With Selected-Rule Submission
- **Context / Symptom**: Catalog deletion checked unresolved preparation results before deleting descendants, but a concurrent selected-rule submit could create a run after that check.
- **Root Cause**: Submit held the catalog row lock while deletion only read the catalog and its children without taking the same lock.
- **Resolution & Invariant**: Lock the catalog row with `FOR UPDATE` before checking unresolved results and deleting descendants in one transaction. PostgreSQL race coverage must hold the creator lock, confirm deletion waits, then commit a `CANCEL_REQUESTED` result and verify deletion rejects while both catalog and result survive.

### [2026-11-28] [LEGAL-SOURCE/DELETION-CANCEL-PENDING] Native Cancellation Remains Unresolved
- **Context / Symptom**: Legal Source deletion impact reported an eligible source while an owned Rule Set Preparation run had `CANCEL_REQUESTED`; deleting then could remove source data before native worker termination was confirmed.
- **Root Cause**: The deletion service maintained its own four-state nonterminal list and omitted `CANCEL_REQUESTED`, while other preparation guards used the canonical unresolved-state contract.
- **Resolution & Invariant**: Derive deletion impact and transaction-time delete blocking from `RULE_SET_PREPARATION_UNRESOLVED_STATES`. A cancellation request is not terminal; keep source-owned data until a confirmed terminal native outcome. Preserve a PostgreSQL integration reproducer for this state.

### [2026-11-28] [LEGAL-SOURCE/ACTIVATION-INGEST-STALE-READ] Version Locks Require a Post-Lock Authority Read
- **Context / Symptom**: A Legal Source draft could activate after its validated document disappeared, and an ingestion worker could claim an older attempt after a retry incremented the persisted attempt while it waited for a lock.
- **Root Cause**: Both decisions used document/index rows loaded before acquiring the version lock. The lifecycle CAS checked only the version status, not the current corpus or attempt.
- **Resolution & Invariant**: Reload corpus, retrieval index, and ingestion attempt after the version lock and before mutation. An activation transaction at `Serializable` can still read a stale snapshot because its advisory-lock query comes before the row lock; use `ReadCommitted` under the existing lifecycle advisory lock plus version row lock so the post-lock query sees a newly committed document change. Preserve the initial invalid-input API response separately from a stale locked-state conflict. PostgreSQL interleaving tests must assert both the 409 race path and normal activation success.

### [2026-11-28] [LEGAL-SOURCE/SNAPSHOT-AUDIT-UNIQUE-RACE] Snapshot Registration Shares Audit Commit and Exact Race Recovery
- **Context / Symptom**: A failed audit left an immutable official-source snapshot committed; simultaneous identical registrations could surface Prisma P2002 instead of returning the existing snapshot.
- **Root Cause**: Snapshot creation and audit used separate writes, and replay only checked before insertion. Prisma 7's PostgreSQL adapter puts the violated index in `meta.driverAdapterError.cause.constraint.index`, not always `meta.target`.
- **Resolution & Invariant**: Create snapshot and audit in one transaction. After rollback on the exact `LegalSourceSnapshot_snapshotRef_key` unique race, reload the committed winner and compare every immutable field; mismatched payload returns 409, unrelated constraints propagate. Keep both rollback and concurrent PostgreSQL tests.

### [2026-11-28] [LEGAL-SOURCE/CATALOG-AUDIT-ATOMICITY] Catalog Mutations And Audit Must Share A Transaction
- **Context / Symptom**: A creation audit failure left a LegalSource committed, while metadata updates had no audit; a broad P2002 handler could misclassify an AuditEvent conflict as a slug collision.
- **Root Cause**: Creation wrote the source and audit through separate Prisma clients, update omitted audit, and the retry classifier checked only the P2002 code.
- **Resolution & Invariant**: Create or update a source and write the actor/correlation-attributed AuditEvent in one transaction. Retry only an exact LegalSource.slug unique violation, including the Prisma adapter's index metadata; all other failures roll back and propagate. Preserve both scoped RED/GREEN tests and a dedicated PostgreSQL transaction test.

### [2026-11-28] [LEGAL-SOURCE/REPLAY-AND-WORKER-INPUT] Type Annotations Do Not Protect Runtime Replay Or Provenance
- **Context / Symptom**: A reused activation or index key accepted changed evidence; official-source worker payloads accepted malformed URLs or missing boolean identity; malformed URL escapes emitted raw URIError.
- **Root Cause**: Replay compared only a subset of immutable fields, worker request TypeScript types vanished at runtime, and filename decoding lacked a typed rejection path.
- **Resolution & Invariant**: Compare every persisted business-authority field on replay; validate required provenance URL and boolean at the service boundary before persistence; translate malformed URL decoding into the established import rejection. Preserve exact replay success plus mismatched replay and malformed input regression tests.

