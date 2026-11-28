# NestJS Backend Agent Instructions (`apps/api`)

## 1. Role & Scope

`apps/api` contains the core NestJS backend services. It enforces Clean Architecture (Hexagonal boundaries), thin controllers, domain-driven use-cases, and strict BOLA authorization.

---

## 2. Layer Responsibilities & Contrastive Examples

### Layer A: `controllers/` (Transport Layer)

- **Role**: Map HTTP routes, validate DTOs, extract authenticated user context, and return standard Result Envelope.
- **Rule**: NEVER query the database or execute business calculations inside controllers.

```typescript
// ❌ BAD: Controller performing database query directly
@Controller("documents")
export class DocumentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":id")
  async getDocument(@Param("id") id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException();
    return doc; // ❌ Leaking bare model without envelope
  }
}

// ✅ GOOD: Thin controller delegating to Use-Case / Service
@Controller("documents")
export class DocumentController {
  constructor(private readonly getDocumentUseCase: GetDocumentUseCase) {}

  @Get(":id")
  async getDocument(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const doc = await this.getDocumentUseCase.execute({ id, actor: user });
    return { ok: true, data: doc };
  }
}
```

### Layer B: `services/` / `use-cases/` (Application & Domain Logic)

- **Role**: Enforce business invariants, owner/resource-scoped RBAC authorization, state transitions, and audit records.
- **Rule**: NEVER import `express.Request`, `Response`, or read HTTP cookies in services.
- **Documentation**: MUST include the 5-section JSDoc header before every business function.

```typescript
// ✅ GOOD: Pure business function with mandatory 5-section JSDoc
/**
 * Business purpose: Validates and transitions an assessment to SUBMITTED state.
 * Business rules: Only the assessment owner or an explicitly authorized Admin can submit.
 * Execution flow: 1. Verify existence -> 2. Check owner/resource-scoped RBAC -> 3. Mutate status -> 4. Emit audit log.
 * Failure cases: Throws AssessmentNotFoundError or PermissionDeniedProblem.
 * Side effects: Updates database row and publishes RabbitMQ domain event.
 */
async submitAssessment(input: SubmitAssessmentInput): Promise<AssessmentResult> {
  // Business logic execution
}
```

### Layer C: `dtos/` (Input Validation & Mass Assignment Prevention)

- **Rule**: NEVER accept raw unvalidated payloads. Always use DTOs with `class-validator`.

```typescript
// ❌ BAD: Accepting arbitrary untyped payload
@Post()
async create(@Body() body: any) { ... }

// ✅ GOOD: Strict DTO with class-validator
export class CreateAssessmentDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsEnum(ASSESSMENT_STATUSES) // or validated contract value
  status!: AssessmentStatus;
}
```

---

## 3. Security Standards (OWASP API Security Top 10)

### BOLA Prevention (API1:2023)

- **Rule**: Every database query accessing a resource by ID MUST be scoped to the authenticated owner/resource relationship; active MVP authorization has no organization boundary.

```typescript
// ❌ BAD: Vulnerable to BOLA / IDOR (any authenticated user can read any document)
const doc = await prisma.document.findUnique({
  where: { id: documentId },
});

// ✅ GOOD: Scoped to the authenticated workspace
const doc = await prisma.document.findFirst({
  where: {
    id: documentId,
    ownerId: user.id,
  },
});
```

### Error Masking (RFC 7807)

- **Rule**: NEVER leak stack traces, SQL errors, or internal hostnames to production clients. Catch unexpected errors and transform them through the global Problem filter.

---

## 4. Verification Checklist (Before declaring complete)

- [ ] Run fast scoped test for changed file: `pnpm --filter @lcsp/api exec jest --config ./jest.config.ts <path-to-spec>` (~2s)
- [ ] Run architecture boundary check: `pnpm run check:architecture`
- [ ] Run business logic documentation audit: `pnpm run check:business-logic-docs`
- [ ] Run import policy check: `pnpm run check:imports`
- [ ] Verify explanatory comments are added on all changed code, especially core domain, RBAC, transactions, and security boundaries.
- [ ] For changes to Assessment Root admission queries, run the full PostgreSQL capacity integration spec so the 10,001-command fairness case runs after the smaller fixtures.
- [ ] For PAT rotation changes, run PostgreSQL regressions for expiry, rollback and concurrent disconnect so stale rotations cannot restore credentials.
- [ ] Verify no controller imports `prisma` or `*repository*` directly.
- [ ] Verify HTTP lifecycle primitives (filters, interceptors, pipes, middlewares) strictly reside in `apps/api/src/platform/http/` without re-export facades.
- [ ] For optimistic CAS writes, verify the next revision is strictly newer and a stateful frozen-clock concurrency test permits exactly one writer.
- [ ] For destructive external cleanup, verify an owner-bound durable fence grants one renewable lease token until every side effect completes or the operation is safely rejected; concurrent requests must not share a cleanup claim, and interactive database transactions must not span external I/O.
- [ ] For Rule Set Preparation cancellation, commit and audit `CANCEL_REQUESTED` before contacting Agent Server; keep it unresolved until a recognized terminal native status is confirmed, and verify submission/reactivation cannot pass that fence.
- [ ] For selected-rule preparation, pass the authenticated Admin actor into cancellation audit and apply the canonical unresolved-state set to submit/import/catalog paths; verify `CANCEL_REQUESTED` cannot create a new revision or permit catalog deletion.
- [ ] For selected-rule catalog deletion, take the catalog row lock before checking unresolved results and removing descendants; verify a PostgreSQL race against a submitting writer rather than relying only on mocked query order.
- [ ] For Legal Source deletion, use the canonical unresolved preparation states in both impact and transaction-time delete checks; `CANCEL_REQUESTED` must block until a confirmed terminal native outcome. Verify against the dedicated PostgreSQL deletion integration suite.
- [ ] For Legal Source activation and ingestion, acquire the version lock before reloading corpus, retrieval index, and ingestion attempt; a pre-lock read is never mutation authority. A `Serializable` snapshot taken at the earlier advisory-lock query remains stale after waiting for the version lock, so verify the post-lock read on PostgreSQL with a competing document deletion and retain a normal activation success test.
- [ ] For official Legal Source snapshot registration, commit snapshot and audit in one transaction; classify only the exact snapshot-reference P2002 index, including Prisma 7 adapter metadata, then compare the committed winner outside the failed transaction. Test audit rollback and a real concurrent insert.
- [ ] For Legal Source catalog create/update, persist mutation and actor/correlation-attributed audit in one transaction; retry a generated slug only for the exact LegalSource slug unique index, never for an AuditEvent P2002. Verify rollback and slug suffix against PostgreSQL.
- [ ] For Legal Source activation/index replay, compare all persisted authority fields before returning the original result; exact replay must remain read-only. Validate worker provenance URLs and booleans before snapshot persistence, and convert malformed URL escapes into typed import rejection.
- [ ] For diagnostic database isolation, compare the allowlist against the effective Prisma adapter target, not a separately read environment URL, and avoid exposing datasource credentials.
- [ ] For transaction-scoped aggregate saves, verify in-memory persistence state advances only after the outer transaction commits.
- [ ] Keep customer assessment SSE and ADMIN operations telemetry on separate RBAC routes; ADMIN streams must bind one validated operational resource, re-check its event boundary after subscription, and emit only its allowlisted public projection.
- [ ] For immutable artifact publication, commit complete BUILDING authority before external storage, bound and verify the storage operation, then lock and revalidate every identity/pin/schema/content field before atomically activating the artifact and completing its aggregate; same-digest retries resume and shared chunks are never compensating-deleted.
- [ ] For immutable artifact replay/read, normalize semantic identifiers consistently across handlers and loaders, and resolve every foreign provenance pin back to its authoritative owner and parent resource before accepting it.
- [ ] For RBAC audit outages, verify ordinary-read ALLOW has deterministic durable local fallback plus degraded telemetry, both audit sinks failing rejects ALLOW, DENY remains DENY, and local recovery does not depend on RabbitMQ; sensitive downloads must persist business audit before returning bytes, while material AssessmentEvent, AuditEvent, and outbox rows remain separate but transactionally atomic.
- [ ] For idempotent create races, classify only the exact Prisma unique constraint (including the installed adapter's source-derived metadata shape), cover that shape with a faithful regression fixture, reload owner-scoped allowlisted winner metadata outside the rolled-back transaction, and rethrow the original error for wrong constraints or a missing winner.
- [ ] For billable admission, calculate maximum exposure from every tariff-supported input/cache/reasoning bucket within the provider token bounds using the canonical integer calculator; verify a cache-write rate above ordinary input cannot produce an in-bound charge above `initialExposureMicrocredits`.
- [ ] For customer admission without an active effective tariff, verify the live HTTP/PostgreSQL path returns canonical 422 `modelPricingNoCoverage` and writes no admission; a worker mock of HTTP 422 alone does not prove the server contract.
- [ ] For billable settlement, retain 5-minute/1-hour cache-write counts across worker schema, replay fingerprint, calculator, and receipt; preserve explicit zero counts, and route any completed usage with unsupported or incomplete pinned rates to durable integrity review without debit or slot release.
- [ ] For confirmed model usage, persist a separate `ModelOutputEvaluation` row tied to the physical invocation with `NOT_EVALUATED`; provider completion never implies schema/domain acceptance, and later verdicts must not change the financial receipt.
- [ ] For a rule-authoring rejection verdict, verify the persisted preparation journal event is uniquely constrained per run/event ID and immutable in PostgreSQL; a worker-supplied event ID is never server-generated proof. Require exact physical invocation causation and receipt tool-call membership before updating `ModelOutputEvaluation`, and test duplicate insertion and direct payload tamper at the DB boundary.
- [ ] For a PAYMENT_REQUIRED Assessment pause, persist the native checkpoint and distinct wallet reason; customer Continue must recheck the owner-bound shared wallet before enqueueing Root work, while the next billable admission independently locks and rechecks solvency.
- [ ] For reconciliation decisions, verify platform-sponsored cases use the platform advisory lock without requiring a customer wallet; when a sweeper opens a case, preserve the admission's actual provider correlation ID so independent evidence is checked against the dispatched request.
- [ ] For every Admin reconciliation mutation route, verify an explicit `BILLING_ACTIONS.reconciliationDecision` guard in addition to the Admin role; case read failures must preserve the request correlation ID and case identifiers must pass transport validation.
- [ ] For bounded keyword search, canonicalize once with the required Unicode form and locale-independent casing before filtering, stable deduplication and limit application; verify duplicates cannot consume query-predicate slots or weaken pinned-resource scope.
