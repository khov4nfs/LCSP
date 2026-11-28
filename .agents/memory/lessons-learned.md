# Lessons Learned — Working Index

This is the concise pre-task lookup. The [incident archive](./lessons-learned.archive.md) preserves original symptoms, causes, test conditions, and dates. Read the relevant archived entry before changing a critical boundary. Add new incidents using the three-field schema below; periodically merge recurring rules into this index without discarding the archive.

## New incident schema

```markdown
### [YYYY-MM-DD] [STACK/INVARIANT] Short title
- **Context / Symptom**: Observable failure.
- **Root Cause**: Incorrect assumption or code path.
- **Resolution & Invariant**: Durable rule and regression evidence.
```

## Process, architecture, and tooling

- Before creating a command/query, compare a neighboring module such as Auth: use a use-case folder, typed command, handler, registration index, and CQRS dispatch. Put shared validation outside service-to-handler callbacks. Keep a tested facade only if callers need it. [API/COMMAND-ARCHITECTURE-PARITY]
- Preserve existing AGENTS.md rules, five-section business documentation, explanatory comments, and local verification. Never commit, push, or open a PR without explicit instruction; PRs require assignee and labels. [PROCESS]
- Nest HTTP lifecycle code belongs in `platform/http`; move consumers instead of leaving re-export facades. Use `.js` NodeNext specifiers, typed injected config, safe parsing, and explicit enum mappings. [BACKEND/NESTJS]
- Verify Knip candidates have no consumers before removal. Use test globs, exclude `.venv` from Bandit, allow deliberately skipped CI jobs, and scope path filters to relevant changes. [DEVOPS/CI]
- Next server helpers require `server-only`; contract source imports must resolve for Next. Verify changed browser flows in Chromium. [FRONTEND, CONTRACTS]

## Authorization, persistence, and audit

- Scope resource lookups and row locks to the authenticated owner/resource before locking. Admin paths need explicit authority. A UUID is not authorization. [BACKEND/BOLA]
- CAS revisions must increase even with frozen clocks. Advance in-memory aggregate state only after commit. External cleanup needs a durable owner-bound lease outside long DB transactions. [BACKEND/CONCURRENCY]
- Replay only the exact Prisma unique constraint, including adapter metadata; reload the owner-scoped winner after rollback. Wrong constraints rethrow. [BACKEND/IDEMPOTENCY]
- Ordinary-read ALLOW requires primary audit or durable local fallback; both failing rejects ALLOW. DENY stays DENY. Persist sensitive download audit before bytes; keep event, audit and outbox records separate but atomic. [BACKEND/AUDIT]
- Separate customer assessment SSE from Admin operations SSE by RBAC route, projection, and client hook. [SECURITY/STREAMING]

## Legal sources, Rule Sets, and artifacts

- Immutable artifact publication: commit complete BUILDING authority, write/verify storage outside the DB transaction, then lock/revalidate all pins and hashes before ACTIVE. Resume same-digest retries; do not delete shared chunks. Normalize semantic pins and rebind foreign provenance to owner/parent on replay. [BACKEND/ARTIFACTS]
- Cancellation commits/audits `CANCEL_REQUESTED` before native stop; poll outside the transaction and close only on recognized terminal status. Submit/import/catalog paths share unresolved states and authenticated Admin actor. Catalog deletion takes the same lock as submission. Test races on PostgreSQL. [COMPLIANCE-RULE-SET]
- Rejection evidence needs unique immutable event identity and exact physical invocation plus receipt membership before `DOMAIN_REJECTED`. Preserve authorized owner-lifecycle deletion. Worker event/tool-call IDs alone are insufficient. [ASSESSMENT/RULE-REJECTION-JOURNAL]
- Diagnostics check Prisma's effective adapter target without revealing credentials. Canonicalize search before deduplication and bounding. [DIAGNOSTIC-DB, SEARCH]

## Billing and worker execution

- Admission exposure must cover every priced input/cache/reasoning/output bucket under provider bounds. Server route and configured ceilings outrank worker hints; enforce admitted output cap at dispatch. Missing customer tariff returns canonical 422. Keep pricing units and markup version aligned. [BILLING/PRICING, WORKER/ADMISSION]
- Settlement is atomic and idempotent across admission, receipt, wallet/ledger and review. Preserve signed balances, cache-write buckets and explicit zeros. Incomplete pinned rates go to durable review without debit/slot release. Recheck version/state and time after locks; expiry replay cannot overwrite in-flight consume. [BILLING/SETTLEMENT]
- Bind lease, deadline and physical invocation from Root through worker, local journal, consume and receipt. Provider usage is not output acceptance: begin at `NOT_EVALUATED`; require authenticated causation for verdict. Guard reconciliation mutations and distinguish platform funding. [BILLING/LEASE, OUTPUT-EVALUATION]
- Store encrypted response recovery before terminal settlement; use checkpoint-stable task IDs and dispatch only `ADMITTED` replays. Keep local ceilings and server slot release in sync. Delete recovery only after matching invocation and successful graph pending writes, including `deque`. [WORKER/RECOVERY]
- Payment pauses retain native checkpoints and wallet reason. Continue and admission each recheck solvency; cleanup failures must not replay paid calls. [ASSESSMENT/PAYMENT-REQUIRED]
- Reuse one inbound correlation ID through Root and retries. Offline physical-call tests need server-issued admission; production remains fail-closed. [PYTHON/TRACEABILITY]

## Other focused lessons

- Parse untrusted DOCX XML with `defusedxml` and test entity rejection. [SECURITY/PYTHON]
- Rootless archive fixtures use repository-relative paths; strip only a verified wrapper. [PYTHON/ARCHIVES]
- Discovery questions describe intended AI use; reuse accepted answers and pinned code after rule selection. [STACK: deepagents]
- Nested mobile dialogs preserve intrinsic card height and return focus to a mounted target; verify keyboard flows. [STACK: apps/web]

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
### [2026-11-28] [ADMIN/OVERVIEW-ACTIVITY-AUTHORITY] Dashboard Metrics Need Bounded Durable Facts
- **Context / Symptom**: Admin overview loaded every Assessment in a 90-day period, counted a later `updatedAt` as a new completion, and the web chart replaced real zero counts with fixture numbers.
- **Root Cause**: The handler projected records into Node.js and derived completion from mutable Assessment state; the consumer used truthy fallbacks for valid zeros.
- **Resolution & Invariant**: Aggregate fixed activity buckets in PostgreSQL from Assessment creation and durable COMPLETE lifecycle events; return zero as zero without sample bars. Session creation is labelled as last sign in, not last activity. Preserve RED/GREEN unit and PostgreSQL regressions.

