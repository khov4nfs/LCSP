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
@Controller('documents')
export class DocumentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async getDocument(@Param('id') id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException();
    return doc; // ❌ Leaking bare model without envelope
  }
}

// ✅ GOOD: Thin controller delegating to Use-Case / Service
@Controller('documents')
export class DocumentController {
  constructor(private readonly getDocumentUseCase: GetDocumentUseCase) {}

  @Get(':id')
  async getDocument(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const doc = await this.getDocumentUseCase.execute({ id, actor: user });
    return { ok: true, data: doc };
  }
}
```

### Layer B: `services/` / `use-cases/` (Application & Domain Logic)
- **Role**: Enforce business invariants, PBAC authorization, state transitions, and audit records.
- **Rule**: NEVER import `express.Request`, `Response`, or read HTTP cookies in services.
- **Documentation**: MUST include the 5-section JSDoc header before every business function.

```typescript
// ✅ GOOD: Pure business function with mandatory 5-section JSDoc
/**
 * Business purpose: Validates and transitions an assessment to SUBMITTED state.
 * Business rules: Only assessment owner or workspace admin can submit.
 * Execution flow: 1. Verify existence -> 2. Check PBAC -> 3. Mutate status -> 4. Emit audit log.
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
- **Rule**: Every database query accessing a resource by ID MUST be scoped to the authenticated user/workspace.

```typescript
// ❌ BAD: Vulnerable to BOLA / IDOR (any authenticated user can read any document)
const doc = await prisma.document.findUnique({
  where: { id: documentId },
});

// ✅ GOOD: Scoped to the authenticated workspace
const doc = await prisma.document.findFirst({
  where: {
    id: documentId,
    workspaceId: user.workspaceId,
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
- [ ] Verify explanatory comments are added on all changed code, especially core domain, PBAC, transactions, and security boundaries.
- [ ] Verify no controller imports `prisma` or `*repository*` directly.
- [ ] Verify HTTP lifecycle primitives (filters, interceptors, pipes, middlewares) strictly reside in `apps/api/src/platform/http/` without re-export facades.
- [ ] For optimistic CAS writes, verify the next revision is strictly newer and a stateful frozen-clock concurrency test permits exactly one writer.
- [ ] For destructive external cleanup, verify an owner-bound durable fence grants one renewable lease token until every side effect completes or the operation is safely rejected; concurrent requests must not share a cleanup claim, and interactive database transactions must not span external I/O.
- [ ] For transaction-scoped aggregate saves, verify in-memory persistence state advances only after the outer transaction commits.
