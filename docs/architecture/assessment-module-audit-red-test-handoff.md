# Assessment Module Audit and RED-Test Handoff

> Ngày audit: 2026-11-22  
> Cập nhật quyết định kiến trúc: 2026-11-24  
> Phạm vi code: `apps/api/src/modules/assessment`, các RBAC/worker boundary trực tiếp phục vụ module, và `deepagents/assessment_root/client.py` cho trace propagation.  
> Trạng thái: **AUDIT ONLY — PRODUCTION CODE CHƯA ĐƯỢC SỬA**.  
> Người nhận bàn giao: Antigravity IDE.

## 1. Mục đích và cảnh báo vận hành

Tài liệu này tái kiểm tra các finding của đợt deep scan module Assessment, loại bỏ các kết luận dựa trên kiến trúc PBAC/organization đã lỗi thời, và định nghĩa các RED tests dùng làm reproducer trước khi sửa production code.

Các RED tests được thêm trực tiếp vào suite chính theo yêu cầu của chủ dự án. Vì vậy Jest/Pytest và CI sẽ **cố ý thất bại** cho tới khi Antigravity sửa đúng nguyên nhân. Không được làm xanh bằng cách xóa test, đổi thành `.skip`/`.todo`, nới expectation hoặc mock bỏ qua boundary đang được kiểm tra.

Kiến trúc authorization có hiệu lực cho audit này:

- Chỉ dùng RBAC với `ADMIN` và `CUSTOMER`; không dùng PBAC.
- Không có organization, organization membership, policy ID hay policy version.
- `CUSTOMER` chỉ truy cập assessment do mình sở hữu.
- `ADMIN` chỉ được đọc metadata vận hành; không được đọc case, evidence, report, provenance hoặc event payload.
- Worker dùng một API key chung kết hợp assessment execution lease. Rotation hai key không nằm trong phạm vi; khi cần đổi secret phải dùng coordinated drain/redeploy.

## 2. Baseline trước khi thêm RED tests

Baseline được chạy trước khi thay đổi test:

- 13 Jest spec mục tiêu: **69 tests passed**.
- `assessment-provenance.controller.spec.ts` cần chạy ngoài sandbox vì Supertest bind loopback bị `listen EPERM`; khi chạy ngoài sandbox: **9 passed**.
- `deepagents/tests/test_assessment_runtime_client_retries.py`: **18 passed**.
- Không có production file nào được sửa trong bước audit.

Lệnh Jest chuẩn phải có ESM option:

```bash
NODE_OPTIONS=--experimental-vm-modules pnpm --filter @lcsp/api exec jest --config ./jest.config.ts --no-watchman <spec-path>
```

## 3. Kết quả tái thẩm định

| ID     | Trạng thái          | Mức độ | Kết luận ngắn                                                                                                                                                                                                           |
| ------ | ------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ASM-01 | Rút finding         |      — | Role-based `RbacGuard` là kiến trúc đúng; không triển khai PBAC evaluator.                                                                                                                                              |
| ASM-02 | Rút finding         |      — | Không có organization là chủ đích và đã có migration loại bỏ tenancy cũ.                                                                                                                                                |
| ASM-03 | Accepted design     |      — | Hệ thống chủ đích dùng một `WORKER_API_KEY`; rotation hai key không nằm trong phạm vi triển khai.                                                                                                                       |
| ASM-04 | Điều chỉnh thiết kế |     P1 | RBAC audit failure đang bị nuốt mà không có durable fallback, retry, metric, alert hoặc degraded-state handling. Không áp dụng fail-closed đồng loạt cho mọi `ALLOW`.                                                   |
| ASM-05 | Xác nhận            |     P0 | Delete khóa assessment theo ID nhưng không đưa owner vào row-lock query; ownership có thể đổi giữa initial read và lock.                                                                                                |
| ASM-06 | Xác nhận            |     P1 | Một số customer loaders truy vấn theo ID rồi mới kiểm tra owner, trái persistence-boundary BOLA invariant.                                                                                                              |
| ASM-07 | Rút finding         |      — | Redact payload audit khi xóa là yêu cầu của zero-retention policy, không phải sửa lịch sử trái phép.                                                                                                                    |
| ASM-08 | Xác nhận            |     P1 | `AssessmentEventAppender` tạo AssessmentEvent/outbox nhưng không tạo canonical `AuditEvent` cho material evidence/lifecycle actions.                                                                                    |
| ASM-09 | Xác nhận            |     P1 | `AssessmentRuntimeClient` sinh correlation ID mới ở mỗi HTTP call nên một workflow không giữ được một trace ID xuyên suốt.                                                                                              |
| ASM-10 | Report-only         |     P2 | Một số audit/error/event literals vẫn phân tán; xử lý sau qua shared contracts, không viết behavioral RED test.                                                                                                         |
| ASM-11 | Xác nhận            |     P1 | Rename là read-check-write không có revision/CAS, nên concurrent stale writes đều có thể thành công.                                                                                                                    |
| ASM-12 | Xác nhận            |     P0 | Repository `saveWithClient()` dùng `upsert`; rename có thể tái tạo assessment vừa bị xóa.                                                                                                                               |
| ASM-13 | Xác nhận            |     P1 | Nhánh update của repository không persist `updatedAt` dù domain entity đã thay đổi timestamp.                                                                                                                           |
| ASM-14 | Đã xử lý            |      — | Budget extension hiện giữ `previousVersion` và `budgetExtensionHistory`; đã có regression test.                                                                                                                         |
| ASM-15 | Xác nhận một phần   |     P1 | DB đã có unique `(requestId,idempotencyKey)`, nhưng concurrent loser nhận Prisma `P2002` thay vì replay row thắng cuộc.                                                                                                 |
| ASM-16 | Xác nhận            |     P0 | Final-report bytes được ghi vào object storage trước khi transaction DB hoàn tất; DB rollback có thể để orphan bytes.                                                                                                   |
| ASM-17 | Xác nhận            |     P1 | Report loader gom storage/DB outage và integrity failure thành cùng HTTP 409.                                                                                                                                           |
| ASM-18 | Accepted design     |      — | Deletion policy yêu cầu external cleanup fail request và retry bằng DELETE idempotent; code hiện tuân theo, chưa yêu cầu background saga.                                                                               |
| ASM-19 | Xác nhận            |     P2 | Legal search deduplicate case-sensitive, làm `Register` và `register` chiếm hai term slots/AND clauses.                                                                                                                 |
| ASM-20 | Report-only         |     P2 | Application layer còn import Prisma; cần ports/UoW refactor nhưng không phải behavioral reproducer.                                                                                                                     |
| ASM-21 | Report-only         |     P2 | Runtime authority/tracking/PDF/controller có complexity và duplication cao; xử lý bằng refactor có characterization tests.                                                                                              |
| ASM-22 | Report-only         |     P2 | Dead APIs/DI lặp, root-capacity coverage và Playwright Chromium là cleanup/tooling gaps, không phải RED behavior.                                                                                                       |
| ASM-23 | Xác nhận            |     P0 | Quyền ADMIN không nhất quán: list trả rỗng, detail trả 404, nhưng provenance và content-rich runtime stream lại cho phép ADMIN.                                                                                         |
| ASM-24 | Task kiến trúc      |     P1 | Customer billing phải dùng một ví prepaid chung và debit actual usage theo từng invocation; payment không tạo runtime allowance. Admin runtime override là boundary độc lập và hai admin routes hiện còn trùng hành vi. |

## 4. Giải thích chi tiết lỗi và phương hướng xử lý

> Các đoạn code trong phần này được rút gọn để minh họa hành vi. Đây là phương án bàn giao cho Antigravity, chưa phải production patch.

### ASM-03 — Giữ một Worker API key duy nhất

**Vị trí:** `apps/api/src/platform/rbac/guards/worker-api-key.guard.ts:39`  
**Trạng thái:** accepted design; `ASM-WORKER-01` đã được rút khỏi implementation scope.

Code hiện tại chỉ đọc một key:

```ts
const expected = config.get("worker.apiKey");
if (!constantTimeEqual(received, expected)) {
  throw unauthorizedProblem();
}
```

Hệ thống hiện dùng một pre-shared secret duy nhất qua biến môi trường `WORKER_API_KEY`. Đây là lựa chọn kiến trúc đã được user chấp nhận; không xây API quản lý key và không bổ sung current/previous key window.

Khi cần thay key, operator phải cập nhật secret cho NestJS API và Python workers bằng coordinated deployment. API và worker dùng key khác nhau trong thời gian chuyển đổi sẽ gây `401`; đây là trade-off vận hành được chấp nhận thay vì tăng độ phức tạp của runtime authentication.

```text
1. Tạm dừng nhận assessment work mới hoặc drain worker đang chạy.
2. Cập nhật cùng một WORKER_API_KEY trong secret store của API và workers.
3. Redeploy/restart các service trong maintenance window được kiểm soát.
4. Xác nhận worker callback/preflight thành công trước khi nhận work mới.
```

Key không được ghi vào source code, log hoặc API response. So sánh constant-time hiện tại vẫn được giữ. API key chỉ xác thực worker; các endpoint theo assessment vẫn phải kiểm tra execution lease và không được dùng key chung như object authorization.

### ASM-04 — Authorization audit failure chưa có cơ chế phục hồi

**Vị trí:** `apps/api/src/platform/rbac/rbac.guard.ts:293`, `apps/api/src/platform/rbac/rbac-preflight.service.ts:95`  
**Test contract cần viết lại:** `ASM-RBAC-01`, `ASM-RBAC-02` hiện đang yêu cầu fail-closed cho mọi `ALLOW`; expectation này không còn phù hợp với thiết kế hybrid bên dưới.

Hành vi hiện tại tương đương:

```ts
try {
  await decisions.append({ decision: "ALLOW" });
} catch (error) {
  logger.error(error); // Lỗi chỉ được log rồi bị nuốt.
}

return true; // Request vẫn được phép chạy.
```

**Root cause:** authorization audit đang được xử lý theo kiểu best-effort không bền vững. Khi primary audit write lỗi, code chỉ ghi application log rồi bỏ qua; không có durable fallback, retry, metric, alert hay trạng thái degraded để operator biết audit trail đang mất dữ liệu.

**Luồng lỗi:** người dùng gọi API → RBAC xác định hợp lệ → ghi audit thất bại → guard vẫn trả `true` → business handler chạy mà không có bằng chứng authorization bền vững.

RBAC role check vẫn thực hiện đúng; lỗi nằm ở khả năng truy vết và phục hồi audit, không phải hệ thống tự cấp quyền cho actor không hợp lệ. Vì vậy finding được điều chỉnh từ P0 xuống **P1**.

**Không nên sửa bằng cách fail-closed mọi request:** nếu audit database lỗi mà mọi `GET` đều trả `503`, audit subsystem trở thành single point of failure và có thể bị lợi dụng để gây denial of service.

**Fix đề xuất — hybrid audit policy:**

| Loại hành động                                         | Khi primary authorization audit lỗi                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Read metadata/detail thông thường, đã owner-scope đúng | Tiếp tục sau RBAC `ALLOW`, nhưng phải enqueue durable fallback, tăng metric và phát alert.                |
| `DENY`                                                 | Luôn từ chối; audit failure không bao giờ biến DENY thành ALLOW.                                          |
| Download/export/provenance nhạy cảm                    | Không trả bytes nếu business export audit không ghi được; trả safe `503`.                                 |
| Mutation dữ liệu                                       | Business mutation và canonical AuditEvent nằm trong cùng DB transaction; audit lỗi thì rollback mutation. |
| Mutation có external side effect                       | Mutation, AuditEvent và outbox cùng transaction; worker xử lý external action sau commit.                 |

Authorization decision logging cho read thông thường:

```ts
const allowed = evaluateRbac(user, requiredRoles);
if (!allowed) {
  await bestEffortAuditDeny();
  throw forbiddenProblem();
}

try {
  await authorizationAudit.append(allowDecision);
} catch (error) {
  await fallbackAuditOutbox.enqueue(allowDecision);
  metrics.increment("rbac.audit.write_failed");
  alerting.notifyAuditDegraded(error);
}

return true;
```

Business mutation audit phải atomic với thay đổi dữ liệu:

```ts
await prisma.$transaction(async (tx) => {
  await tx.assessment.update({
    where: { id: assessmentId, ownerId: actorId },
    data: mutation,
  });

  await tx.auditEvent.create({
    data: { actorId, assessmentId, eventType, correlationId },
  });
});
```

Nếu `auditEvent.create()` lỗi, transaction rollback nên mutation không được commit. Với export/download, audit receipt phải được ghi trước khi response stream bắt đầu.

**Test contract thay thế:**

- `ASM-RBAC-01`: read thông thường vẫn được phép sau RBAC `ALLOW`, nhưng primary audit failure bắt buộc tạo durable fallback cùng metric/alert.
- `ASM-RBAC-02`: quyết định `DENY` vẫn trả `403` khi audit subsystem lỗi.
- Các mutation nhạy cảm phải có handler-level test chứng minh audit failure rollback mutation.
- Export/download phải có test chứng minh audit failure không trả file và response là safe `503`.

### ASM-05 — Delete có ownership race dưới row lock

**Vị trí:** `apps/api/src/modules/assessment/application/commands/delete-assessment/delete-assessment.handler.ts:123`  
**RED test:** `ASM-OWNER-01`

Row hiện chỉ được khóa theo assessment ID:

```sql
SELECT id
FROM "Assessment"
WHERE id = assessmentId
FOR UPDATE
```

Owner đã được kiểm tra trước transaction, nhưng row sau khi khóa không được kiểm tra owner lại.

**Root cause:** authorization decision sử dụng aggregate cũ được đọc trước transaction, trong khi delete side effects sử dụng row hiện tại sau đó.

**Luồng lỗi:** request A đọc assessment thuộc owner A → ownership đổi sang B → request A khóa row chỉ theo ID → không revalidate owner → xóa dữ liệu hiện đã thuộc B.

**Fix đề xuất:** owner phải nằm trong authoritative lock/read và được kiểm tra trước mọi side effect.

```ts
const lockedRows = await tx.$queryRaw`
  SELECT id, "ownerId"
  FROM "Assessment"
  WHERE id = ${assessmentId}
    AND "ownerId" = ${actorId}
  FOR UPDATE
`;

if (lockedRows.length === 0) throw notFoundProblem();

// Chỉ sau boundary này mới được revoke, erase, release và delete.
```

Wrong owner hoặc ownership race phải trả `404` và không được tạo bất kỳ side effect nào.

### ASM-06 — Detail query tải dữ liệu trước khi kiểm tra owner

**Vị trí:** `apps/api/src/modules/assessment/infrastructure/persistence/assessment-detail.loader.ts:97`  
**RED test:** `ASM-OWNER-02`

Hiện tại:

```ts
const row = await tx.assessment.findUnique({
  where: { id: assessmentId },
  include: { runtime: true, domainCase: true },
});

if (row.ownerId !== sessionUserId) throw notFoundProblem();
```

**Root cause:** owner được kiểm tra sau khi database đã tải assessment, runtime và case của resource. Response cuối cùng có thể là `404`, nhưng dữ liệu không thuộc actor vẫn đã đi qua persistence boundary và được hydrate vào process.

**Fix đề xuất:** database query đầu tiên phải scope đồng thời theo resource ID và owner ID.

```ts
const row = await tx.assessment.findFirst({
  where: { id: assessmentId, ownerId: sessionUserId },
  include: { runtime: true, domainCase: true },
});

if (!row) throw notFoundProblem();
```

Đây là yêu cầu BOLA prevention; post-load owner check không thay thế được query-level authorization.

### ASM-08 — AssessmentEvent không tạo canonical AuditEvent

**Vị trí:** `apps/api/src/modules/assessment/application/services/assessment-event-appender.service.ts:132`  
**RED test:** `ASM-AUDIT-01`

Appender hiện ghi event timeline và outbox:

```ts
await tx.assessmentEvent.create({ data: event });
await outbox.enqueue(message, tx);
```

Nhưng không có canonical audit write:

```ts
await tx.auditEvent.create(...);
```

**Root cause:** event history, audit history và message delivery đang bị coi như có thể thay thế nhau. Thực tế chúng có trách nhiệm khác nhau:

- `AssessmentEvent`: timeline nghiệp vụ của assessment.
- `AuditEvent`: bằng chứng ai hoặc service nào đã làm gì và kết quả ra sao.
- Outbox: đảm bảo message được vận chuyển; không phải audit store.

**Fix đề xuất:** material event phải ghi AssessmentEvent, sanitized AuditEvent và outbox trong cùng Prisma transaction.

```ts
await tx.assessmentEvent.create({ data: event });
await tx.auditEvent.create({
  data: { actorId, assessmentId, eventType, correlationId, payload },
});
await outbox.enqueue(message, tx);
```

Nếu audit write thất bại thì transaction phải rollback; không được commit một nửa bằng chứng.

### ASM-09 — Một Root workflow sinh nhiều correlation ID

**Vị trí:** `deepagents/assessment_root/client.py:45`  
**RED test:** `ASM-TRACE-01`

Hiện tại `_headers()` sinh UUID mới mỗi lần được gọi:

```python
def _headers(self, *, with_lease: bool):
    return {
        "x-worker-api-key": self._worker_key,
        "x-correlation-id": str(uuid.uuid4()),
    }
```

**Root cause:** correlation ID gắn với HTTP attempt thay vì Root execution.

**Luồng lỗi:** `GET context` có trace A → `GET rule-set` có trace B → `POST evidence` có trace C → retry lại có trace D. Log NestJS, Python, audit và outbox không thể ghép thành một workflow.

**Fix đề xuất:** tạo correlation ID khi bắt đầu execution/claim và reuse cho mọi call cùng retry trong execution đó.

```python
class AssessmentRuntimeClient:
    def __init__(self, ...):
        self.correlation_id = str(uuid.uuid4())

    def _headers(self, *, with_lease: bool):
        return {
            WORKER_KEY_HEADER: self._worker_key,
            CORRELATION_HEADER: self.correlation_id,
        }
```

Chỉ tạo ID mới khi bắt đầu một execution boundary mới.

### ASM-11/12/13 — Rename lost update, resurrection và timestamp sai

**Vị trí:** `apps/api/src/modules/assessment/application/commands/rename-assessment/rename-assessment.handler.ts:75`, `apps/api/src/modules/assessment/infrastructure/persistence/prisma-assessment.repository.ts:67`  
**RED tests:** `ASM-RENAME-01/02/03`

Handler đọc entity ngoài transaction rồi mới lưu:

```ts
const assessment = await repository.findById(id);
assessment.rename(newName);

await prisma.$transaction(async (tx) => {
  await repository.saveInTx(assessment, tx);
});
```

Repository lại dùng `upsert`:

```ts
await client.assessment.upsert({
  where: { id: assessment.id },
  create: completeAssessmentData,
  update: {
    name: assessment.name,
    description: assessment.description,
    // updatedAt bị thiếu.
  },
});
```

Ba vấn đề phát sinh:

1. **Lost update:** hai request cùng đọc version cũ, cả hai đều báo thành công và writer sau ghi đè writer trước.
2. **Resurrection:** assessment bị xóa giữa read và write sẽ bị `upsert` tạo lại, dù command chỉ là rename.
3. **Timestamp sai:** entity đã đổi `updatedAt` nhưng nhánh update không persist timestamp mới.

**Fix đề xuất:** tách create path và update path. Rename dùng owner-scoped compare-and-set trong transaction, dựa trên revision hoặc expected `updatedAt`.

```ts
const result = await tx.assessment.updateMany({
  where: {
    id: assessmentId,
    ownerId: actorId,
    updatedAt: expectedUpdatedAt,
  },
  data: {
    name: normalizedName,
    updatedAt: newUpdatedAt,
  },
});

if (result.count === 0) throw renameConflictOrNotFound();
```

Rename không được sử dụng `upsert`. Audit rename phải nằm trong cùng transaction với successful CAS update.

### ASM-15 — Export idempotency vẫn lỗi khi có concurrent request

**Vị trí:** `apps/api/src/modules/assessment/application/services/assessment-rule-audit.service.ts:865`  
**RED test:** `ASM-EXPORT-01`

Hiện tại service thực hiện find-then-create:

```ts
const existing = await tx.assessmentRuleAuditExport.findUnique({ where: key });
if (existing) return existing;

await tx.assessmentRuleAuditExport.create({ data: exportData });
```

**Root cause:** lookup và create không phải một atomic operation.

**Luồng lỗi:** request A find chưa có → request B find chưa có → A create thành công → B create nhận Prisma `P2002`. Request B đáng lẽ replay kết quả của A nhưng lại thất bại.

**Fix đề xuất:** chỉ catch `P2002` của đúng composite unique `(requestId, idempotencyKey)`, reload row thắng cuộc rồi trả metadata đã commit.

```ts
try {
  return await createExport();
} catch (error) {
  if (!isExactExportIdempotencyConflict(error)) throw error;

  const winner = await findByRequestAndIdempotencyKey(requestId, key);
  if (!winner) throw error;
  return toExportMetadata(winner);
}
```

Các unique constraint khác không được coi là replay hợp lệ.

### ASM-16 — Final-report storage và database có thể split-brain

**Vị trí:** `apps/api/src/modules/assessment/application/commands/submit-assessment-final-report/submit-assessment-final-report.handler.ts:423`  
**Test contract cần viết lại:** `ASM-REPORT-01` hiện yêu cầu compensating erase; expectation này không còn phù hợp với hướng synchronous two-phase bên dưới.

Hiện tại bytes được ghi trước DB row:

```ts
await storage.writeImmutableArtifact(artifactId, content);
await tx.assessmentArtifact.create({ data: databaseArtifact });
```

**Root cause:** object storage không tham gia PostgreSQL transaction. DB rollback không thể rollback file đã ghi.

**Luồng lỗi:** storage write thành công → DB create hoặc transaction commit thất bại → database không có artifact row → storage vẫn giữ orphan bytes không có owner authoritative.

**Không ưu tiên compensating erase:** storage đang dùng content-addressed chunks. Hai artifact có nội dung giống nhau có thể cùng tham chiếu một chunk; xóa bù không có reference protection đầy đủ có nguy cơ xóa chunk mà artifact khác vẫn cần.

**Fix đề xuất — synchronous two-phase `BUILDING → storage → ACTIVE`:** schema và shared contracts đã có các lifecycle `BUILDING`, `ACTIVE`, `SUPERSEDED`, `INVALID`, nên không cần thêm enum mới.

#### Pha 1 — Tạo authoritative BUILDING row

Build canonical report, tính `requestDigest`, content hash, size và deterministic manifest; sau đó persist artifact `BUILDING` trong transaction đầu tiên. Assessment chưa được chuyển sang `COMPLETE`.

```ts
const prepared = await prisma.$transaction(async (tx) => {
  const report = await buildAssessmentFinalReportV3(...);
  const content = canonicalJson(report);
  const hash = sha256Hex(content);
  const sizeBytes = Buffer.byteLength(content);
  const manifest = buildDeterministicManifest({ artifactId, hash, sizeBytes });

  await tx.assessmentArtifact.create({
    data: {
      artifactId,
      assessmentId,
      lifecycleState: ArtifactLifecycleState.BUILDING,
      reportRequestDigest: requestDigest,
      contentSha256: `sha256:${hash}`,
      sizeBytes,
      storageRef: JSON.stringify(manifest),
      // Các authoritative pins hiện có.
    },
  });

  return { artifactId, content, hash, sizeBytes, manifest, requestDigest };
});
```

Sau pha này, database đã biết artifact nào đang được xây dựng. Report loader vẫn từ chối vì artifact chưa `ACTIVE`.

#### Pha 2 — Ghi và verify storage ngay trong request

Đây vẫn là synchronous user flow, không phải background generation.

```ts
const stored = await storage.writeImmutableArtifact(
  prepared.artifactId,
  prepared.content,
);

if (
  stored.manifest.hash !== prepared.hash ||
  stored.sizeBytes !== prepared.sizeBytes
) {
  throw artifactIntegrityProblem();
}
```

Storage write hiện có tính idempotent theo content hash. Retry cùng content sẽ verify chunk hiện có thay vì tạo một bản sao khác.

#### Pha 3 — Activate trong transaction thứ hai

Re-read và khóa BUILDING row, xác nhận request digest/hash/manifest vẫn khớp, sau đó chuyển artifact sang `ACTIVE` và assessment sang `COMPLETE` trong cùng transaction.

```ts
await prisma.$transaction(async (tx) => {
  const artifact = await lockBuildingArtifact(tx, prepared.artifactId);
  assertSameDigestAndContent(artifact, prepared);

  await tx.assessmentArtifact.update({
    where: { artifactId: prepared.artifactId },
    data: {
      lifecycleState: ArtifactLifecycleState.ACTIVE,
      activatedAt: new Date(),
    },
  });

  await appendArtifactActivatedEventAndAudit(tx, prepared);
  await transitionAssessmentToComplete(tx, assessmentId);
});
```

Chỉ sau khi pha 3 commit thành công, handler mới trả success. Vì vậy happy path vẫn là:

```text
User request
→ BUILDING row
→ storage write + verify
→ ACTIVE + assessment COMPLETE
→ trả kết quả ngay
```

#### Recovery và request digest

`reportRequestDigest = sha256(canonicalJson(request))` là dấu vân tay server-side của payload tạo report.

- Retry cùng assessment, kind và digest: resume BUILDING artifact hiện có, verify storage rồi activate; không tạo artifact mới.
- Cùng assessment/kind nhưng digest khác khi một BUILDING artifact tồn tại: trả safe `409`, không ghi đè request đang xử lý.
- Activation DB lỗi sau storage write: BUILDING row vẫn tồn tại và giữ expected hash/manifest, nên file không còn là orphan vô danh.

Reconciliation job chỉ là safety net cho BUILDING artifact bị bỏ lại khi process crash và client không retry. Nó không nằm trên happy path và không làm user phải chờ background job để nhận report.

**Test contract thay thế:**

- `ASM-REPORT-01A`: transaction pha 1 thất bại thì storage không được gọi.
- `ASM-REPORT-01B`: storage thất bại thì artifact không ACTIVE và assessment không COMPLETE.
- `ASM-REPORT-01C`: activation transaction thất bại thì BUILDING row còn tồn tại; retry cùng digest resume cùng artifact ID và không tạo artifact thứ hai.
- `ASM-REPORT-01D`: report loader chỉ phục vụ `ACTIVE`; BUILDING/INVALID không trả content.

### ASM-17 — Storage outage bị báo sai thành report hỏng 409

**Vị trí:** `apps/api/src/modules/assessment/infrastructure/persistence/assessment-report.loader.ts:176`  
**RED test:** `ASM-REPORT-02`

Catch-all hiện tại chuyển mọi non-HTTP exception thành cùng một problem:

```ts
try {
  const content = await storage.readAndReconstruct(manifest);
  validateIntegrity(content);
} catch (error) {
  if (error instanceof HttpException) throw error;
  throw finalReportInvalid409();
}
```

**Root cause:** integrity failure và dependency outage không được phân loại riêng.

Vì vậy hash mismatch hợp lệ là `409`, nhưng S3/MinIO unavailable hoặc DB timeout cũng bị trả `409`. Client sẽ nghĩ report hỏng vĩnh viễn và không retry.

**Fix đề xuất:** schema/hash/pin mismatch giữ `409`; storage/database timeout hoặc unavailable trả safe `503`; unexpected internal failure trả masked `500`.

```ts
catch (error) {
  if (isIntegrityFailure(error)) throw finalReportInvalid409();
  if (isDependencyUnavailable(error)) throw dependencyUnavailable503();
  throw maskedInternalError500();
}
```

Không được trả exception message, storage path hoặc internal hostname cho client.

### ASM-19 — Legal search deduplicate sai hoa/thường

**Vị trí:** `apps/api/src/modules/assessment/application/queries/search-pinned-legal-source/search-pinned-legal-source.handler.ts:28`  
**RED test:** `ASM-LEGAL-01`

`Set` hiện nhận raw terms nên xem `Register`, `register` và `REGISTER` là ba giá trị khác nhau, trong khi DB search và snippet matching lại case-insensitive.

```ts
new Set(["Register", "register", "REGISTER"]); // Có 3 phần tử.
```

**Hậu quả:** case variants chiếm nhiều term slot và tạo các `AND` predicate dư thừa, có thể làm query hẹp hoặc tốn chi phí không cần thiết.

**Fix đề xuất:** Unicode-normalize, trim và lowercase trước dedupe/bounding.

```ts
const normalizedTerms = rawTerms.map((term) =>
  term.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
);
const uniqueTerms = [...new Set(normalizedTerms)].slice(0, MAX_TERMS);
```

### ASM-23 — Quyền ADMIN metadata-only đang không nhất quán

**Vị trí:** `assessment-detail.loader.ts:44`, `assessment-provenance.controller.ts:63`, `workspace-runtime-events.controller.ts:37`  
**RED tests:** `ASM-ADMIN-01` đến `ASM-ADMIN-04`

Ba boundary hiện cho ba kết quả khác nhau:

```ts
// List: ADMIN nhận collection rỗng.
if (role !== CUSTOMER) return { assessments: [] };

// Detail: ADMIN nhận 404.
if (role !== CUSTOMER) throw notFoundProblem();

// Provenance và content-rich runtime stream: ADMIN lại được cho qua.
@RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
```

**Root cause:** chưa có một projection và authorization contract thống nhất cho định nghĩa “ADMIN chỉ đọc metadata”.

**Fix đề xuất:** tách hai read model rõ ràng:

- Customer projection: owner-scoped, được đọc case/evidence/report/runtime của chính mình.
- Admin metadata projection: chỉ gồm `assessment_id`, `owner_id`, `name`, lifecycle/execution state và timestamps.
- Admin không được hydrate case, evidence, final report, provenance hoặc event payload.

Provenance và customer content-rich SSE phải loại ADMIN:

```ts
@RequireRoles(AUTH_USER_ROLES.customer)
```

Các admin mutation vận hành như capacity, budget hoặc stop phải được đánh giá riêng; quyền metadata không tự động cấp quyền mutation.

### ASM-24 — Tách customer billing khỏi admin runtime-budget override

**Vị trí:** `assessment-runtime-control.controller.ts:122`, `admin-assessment-budget.controller.ts:45`, `assessment-runtime-control.service.ts:93`  
**Trạng thái:** task kiến trúc đã được chấp nhận; chưa có RED test và chưa sửa production code.

Hiện có hai routes chỉ cho ADMIN nhưng cùng tạo một `ControlAssessmentRuntimeCommand` với action `RESUME` và cùng truyền `budgetExtension`:

```http
POST /assessments/:assessmentId/runtime/extend-budget
POST /admin/assessments/:assessmentId/budget-extension
```

Customer không thể gọi hai routes này và cũng không thể gửi `budgetExtension` qua `/runtime/continue`. Service hiện trực tiếp ghi allowance mới vào `blockerReference`, chuyển turn từ `STOPPED` sang `RESUME_REQUESTED`, rồi enqueue `ROOT_REQUESTED`.

Payload hiện tại là runtime safety allowance, không phải payment:

```json
{
  "version": 2,
  "additionalModelCalls": 50,
  "additionalTotalTokens": 150000,
  "overrideNoProgress": false,
  "auditReason": "Admin operational override"
}
```

Nó không chứa amount, currency, payment ID, invoice, checkout session hoặc billing-ledger receipt. Vì vậy endpoint không phải luồng “customer hết tiền → admin phê duyệt”. Nó là operational override cho token/call limits; no-progress không còn là assessment blocker.

**Quyết định kiến trúc:** giữ khả năng admin override cho support, system-failure compensation hoặc provider failure; customer top-up bình thường đi qua billing và không cần admin đứng giữa. Không yêu cầu Admin mở khóa no-progress.

#### Quyết định mới: ví prepaid chung, không payment-driven runtime allocation

Customer không cấp credits riêng cho từng assessment. Mọi assessment của cùng customer dùng chung một wallet:

```text
Customer checkout/top-up
→ payment được billing xác nhận
→ billing ledger ghi credit vào ví chung đúng một lần
→ các assessment dùng ví đó theo actual usage
```

Payment/top-up **không** tạo `budgetExtension`, không tự tăng raw model-call/token allowance và không tự resume assessment. Vì vậy không tạo source `PAYMENT` trong runtime-budget extension. Billing ledger và runtime safety control là hai authority tách biệt:

- Wallet trả lời: customer còn bao nhiêu credits để chi tiêu.
- Runtime control trả lời: execution có được tiếp tục theo các safety gates còn hiệu lực hay không.
- Customer không được gửi raw model-call/token allowance.
- No-progress chỉ là dữ liệu chẩn đoán, không chặn assessment hoặc yêu cầu Admin override.

#### Actual-usage debit trong lúc assessment chạy

Billing không chờ assessment hoàn thành. WP8 chỉ tính model usage; paid-tool billing được defer tới work package riêng. Mỗi physical provider call là một billable unit có canonical `invocationId`:

```text
Trước model call
→ server-issued admission kiểm tra ví dương, runtime/lease, allowlist, pricing và wallet slot
→ pin resolved model + pricing snapshot cho physical invocation
→ gọi provider
→ nhận provider-reported usage
→ transaction atomic: usage receipt + MODEL_USAGE_DEBIT + signed wallet projection + outbox
→ nếu số dư <= 0, chặn paid call mới và checkpoint đúng assessment khi cần
```

Thiết kế không reserve/hold credits và không hoàn tiền phần giữ dư. Customer dùng bao nhiêu thì ledger debit bấy nhiêu. Retry/fallback provider call là physical invocation mới liên kết bằng `logicalOperationId`; replay cùng `invocationId` phải trả cùng receipt và không debit lần hai.

Assessment có thể đổi model, provider hoặc pricing version giữa các call. Mỗi call pin snapshot riêng; assessment total chỉ là aggregate để hiển thị, không phải settlement unit.

Nhiều assessment được phép chạy đồng thời trên cùng wallet. Pilot dùng `maxInFlightBillableInvocationsPerWallet = 1`: đây chỉ là concurrency guard, không giới hạn số assessment, không giữ/trừ credits và không tự nó giới hạn monetary exposure. Admission phải pin `maximumExposureMicrocredits` được tính từ tariff và applied input/context/output hard bounds. Vì actual charge chỉ biết sau response, invocation đã in-flight trước khi wallet về 0 vẫn có thể settle làm số dư âm trong admitted maximum exposure; usage vượt bound chuyển billing-integrity review.

- Wallet `<= 0` từ chối mọi paid invocation mới.
- Hệ thống best-effort cancel/drain work đã in-flight nhưng vẫn ghi nhận usage provider đã tính phí.
- Top-up sau đó bù số âm trước; chỉ phần còn lại mới khả dụng.
- Không tính lãi hoặc phí phạt; customer vẫn được đăng nhập, đọc/tải dữ liệu và report cũ nhưng không phát sinh paid work mới.
- Top-up không tự resume; customer chủ động `Continue`, và runtime phải đánh giá lại mọi blocker.

Provider-confirmed usage vẫn bị charge nếu output bị truncated, schema invalid hoặc domain rejected. Timeout chưa biết usage chuyển `OUTCOME_UNKNOWN`, giữ wallet slot và chờ late receipt/audited reconciliation; không tự coi usage bằng zero. Waiver/refund ghi immutable `COMPENSATION`, không sửa debit gốc.

#### Direct-credit pricing và Admin Model Pricing

Top-up giữ quy đổi hiện tại:

```text
1 VND = 1 public credit
1 public credit = 1_000_000 internal microcredits
```

Customer wire format là canonical decimal string tối đa 6 chữ số thập phân, không exponent/JS number, và phải round-trip chính xác về microcredits. Migration không rescale/reinterpret legacy `*Credits` columns tại chỗ: dùng shadow microcredit columns + unit version, fence/drain old writers, atomic dual-write từ immutable payment input, idempotent backfill, per-wallet reconciliation, mismatch alarms và explicit cutover/rollback criteria.

Runtime không dùng USD/VND, FX hoặc multiplier `1.8` để tính từng call. Immutable pricing snapshot định giá trực tiếp mỗi token bucket bằng microcredits/token. Resolution order:

```text
EXACT_MODEL → PROVIDER_DEFAULT → GLOBAL_DEFAULT → reject before provider call
```

Fallback chỉ áp dụng cho resolved model có trong runtime model allowlist. Admission lưu `requestedModel`, `resolvedModel`, `pricingSnapshotId` và `pricingResolution`. Model lạ hoặc lỗi chính tả không được hợp thức hóa bằng global default.

Admin Billing cần section `Model Pricing` với ba nhóm exact/provider/global. `ModelPricingDraft` mutable nhưng không billable; publish copy sang immutable append-only snapshot. Versioned assignment dùng database UTC clock và half-open interval `[effectiveFrom,effectiveTo)`; SCHEDULED/ACTIVE/SUPERSEDED là derived read status. Publish idempotent phải commit snapshot assignment và canonical AuditEvent atomically, còn database constraint ngăn interval overlap trong cùng scope. Preview dùng cùng canonical calculator với settlement.

Contract RED tests đã sẵn sàng; production implementation/debit enablement thì chưa. Global default là optional nếu exact/provider coverage đã bao phủ mọi allowlisted model. Ngoài tariff approval, phải đóng admission binding, mixed-unit cutover, maximum exposure, immutable assignment, provider-call no-bypass và versioned reconciliation/compensation gates. Không dùng quote `1.8` hiện tại làm tariff authority và không tự phát minh số rate.

Settlement không tin financial identity do callback gửi. `invocationId` phải resolve immutable server-issued admission; API derive user/wallet/assessment/run/lease/provider/resolved model/pricing/policy từ admission. Missing, foreign, expired hoặc mismatched admission fail closed không ghi financial state; unbound callback tối đa chỉ được quarantine làm non-billable telemetry.

#### Output-cap và telemetry calibration

Không đặt business cap riêng cho từng operation ở giai đoạn này vì chưa có production telemetry đủ để hiệu chỉnh. Quyết định hiện tại:

- Giữ `65536` trong model route hiện tại như provider hard cap tạm thời; đây không phải business cap tối ưu và không phải số token được tính tiền trước.
- Bỏ universal fallback `4096`: mọi production model route phải khai báo `max_output_tokens > 0`; thiếu hoặc invalid phải fail startup hoặc fail trước provider call, không tự chọn một số tùy ý.
- Chưa thêm operation-specific cap hoặc calibration warning threshold.
- Không thêm blocker mới chỉ vì output cao hơn trung bình. Statistical cost anomaly chỉ là telemetry/warning; chỉ billing-integrity contradiction mới được fail closed/review.
- Không dùng no-progress làm blocker trong thiết kế Prompt 8. Các runtime safety gates khác vẫn được kiểm tra độc lập với ví.

Telemetry hiện đã lưu nhiều token buckets nhưng chưa đủ để audit cap theo operation. Trước thời gian quan sát thực tế, mỗi settled usage phải lưu tối thiểu:

```text
operationType
routeId / protocol / policyVersion
appliedMaxOutputTokens
finishReason
responseStatus
visibleOutputTokens / outputTokens / reasoningTokens / totalTokens
durationMs / modelStepId / attemptOrdinal
providerCompletion: COMPLETED | MAX_TOKENS | TRUNCATED | FAILED | OUTCOME_UNKNOWN
outputOutcome: ACCEPTED | SCHEMA_INVALID | DOMAIN_REJECTED | NOT_EVALUATED
```

Không lưu raw prompt, raw response hoặc customer source. Analytics sau thời gian quan sát phải tính P50/P90/P95/P99, cap-hit rate, truncate rate và accepted-output rate theo `operationType + provider + model + policyVersion` trước khi đề xuất business cap.

#### Luồng admin override được giữ lại

Admin override là runtime safety/operational boundary độc lập với wallet và chỉ dành cho:

- Bù budget do lỗi hệ thống hoặc model provider.
- Operational recovery có lý do audit; không dùng để giả lập payment hoặc cộng credits vào wallet.
- Cho phép operational recovery cho lỗi hệ thống/provider theo quyền Admin và audit hợp lệ.
- Emergency recovery có actor, timestamp và version lineage đầy đủ.

Giữ dedicated admin boundary, nhưng định danh nghiệp vụ phải là `runtime budget override`, không phải approval của customer request. `auditReason` là bắt buộc cho override; `authorizedBy`, `authorizedAt`, `previousVersion` và history phải tiếp tục được lưu.

#### Hợp nhất hai routes

Route canonical nên là dedicated admin route:

```http
POST /admin/assessments/:assessmentId/budget-extension
```

Route cũ dưới customer-shaped runtime namespace:

```http
POST /assessments/:assessmentId/runtime/extend-budget
```

phải được đánh dấu deprecated, kiểm tra caller hiện có, rồi loại bỏ sau compatibility window. Trong thời gian chuyển tiếp, cả hai không được diverge logic; route cũ chỉ forward vào cùng command/service và vẫn ADMIN-only.

#### Safety boundary

- Customer top-up chỉ cộng credits vào ví chung và bù số dư âm; không cấp runtime allowance.
- Runtime safety controls còn hiệu lực độc lập với wallet; no-progress không phải assessment blocker.
- Chưa thêm business output cap hoặc runtime blocker mới trước khi telemetry được audit.
- Admin override phải có canonical AuditEvent trong cùng transaction với extension/resume request.
- Extension version phải tăng nghiêm ngặt; retry cùng admin override identity phải replay thay vì cấp allowance hai lần.

**Test contract cần bổ sung:**

- `ASM-BUDGET-01`: customer không thể gửi raw runtime allowance hoặc gọi admin override route.
- `ASM-BUDGET-02`: confirmed payment chỉ credit ví chung đúng một lần; retry cùng payment/ledger ID không double-credit và không tạo runtime extension.
- `ASM-BUDGET-03`: model usage debit ví chung đúng một lần theo admitted `invocationId`; callback không thể override wallet/assessment/model/pricing authority; nhiều assessment cùng owner dùng chung wallet và không tạo reservation.
- `ASM-BUDGET-04`: wallet `<= 0` chặn paid invocation mới; in-flight settlement vẫn được ghi nhận, top-up bù âm trước và không tự resume.
- `ASM-BUDGET-05`: admin override yêu cầu audit reason, actor/version/history, canonical AuditEvent và hai routes không diverge trong compatibility window.
- `ASM-PRICING-01`: Admin draft/publish RBAC, publish idempotency, immutable snapshot, DB-time half-open assignment và non-overlapping intervals.
- `ASM-PRICING-02`: exact → provider default → global default; model ngoài runtime allowlist bị reject.
- `ASM-PRICING-03`: integer microcredit calculation; không runtime FX/`1.8`; missing token-bucket rate không thành zero.
- `ASM-PRICING-04`: assessment đổi model/provider/pricing version; mỗi physical invocation pin và settle độc lập.
- `ASM-USAGE-01`: route thiếu/invalid `max_output_tokens` fail trước provider; không còn silent fallback `4096`, route hiện tại vẫn áp `65536`.
- `ASM-USAGE-02`: settled usage tách provider completion/finish evidence khỏi downstream output evaluation, đồng thời persist applied cap, operation và retry lineage mà không lưu raw content.
- `ASM-USAGE-03`: admin analytics phân biệt completed/incomplete/truncated/unknown usage và có dữ liệu grouping phục vụ percentile calibration.
- `ASM-USAGE-04`: chưa có operation business cap hoặc warning threshold; high usage hợp lệ tiếp tục, `MAX_TOKENS`/truncated output không được persist như domain success.

### 4.1 Những finding không cần sửa

Các mục dưới đây được giữ rõ trong báo cáo để Antigravity không triển khai sai kiến trúc:

- Không triển khai lại PBAC; hệ thống hiện chỉ dùng RBAC.
- Không thêm organization hoặc organization membership.
- Redact audit payload khi xóa assessment là đúng zero-retention policy.
- Budget extension history đã có regression coverage.
- External deletion failure và retry bằng DELETE idempotent là thiết kế được chấp nhận.

### 4.2 Thứ tự sửa đề xuất

1. Delete ownership race.
2. Rename resurrection và lost update.
3. Final-report orphan artifact.
4. ADMIN metadata boundary.
5. Owner-scoped detail query.
6. Canonical AuditEvent và atomic business audit cho mutation/export.
7. Authorization-audit fallback, retry, metric và alert.
8. Correlation propagation, export race và report error classification.
9. Triển khai shared-wallet actual-usage telemetry/debit, tách khỏi admin runtime-budget override và hợp nhất duplicate admin routes.
10. Legal-search normalization và các cleanup/refactor report-only.

## 5. RED test contract cho Antigravity

| Test ID             | Spec dự kiến                                                 | Hành vi cần làm xanh                                                                                                          |
| ------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| ASM-RBAC-01         | `src/platform/rbac/rbac.guard.spec.ts`                       | Read `ALLOW` vẫn tiếp tục nhưng primary audit failure phải tạo durable fallback, metric và alert.                             |
| ASM-RBAC-02         | `src/platform/rbac/rbac-preflight.service.spec.ts`           | Preflight `DENY` vẫn trả decision `DENY` khi audit subsystem lỗi; controller tiếp tục ánh xạ quyết định đó thành `403`.       |
| ASM-ADMIN-01/02     | `assessment-detail.loader.spec.ts`                           | ADMIN nhận metadata list/detail nhưng không nhận nội dung nhạy cảm.                                                           |
| ASM-ADMIN-03        | `assessment-admin-rbac.red.spec.ts`                          | Provenance metadata không chứa ADMIN role.                                                                                    |
| ASM-ADMIN-04        | `assessment-admin-rbac.red.spec.ts`                          | Content-rich stream không chứa ADMIN role.                                                                                    |
| ASM-OWNER-01        | `delete-assessment.handler.spec.ts`                          | Ownership đổi trước row lock làm delete dừng trước side effects.                                                              |
| ASM-OWNER-02        | `assessment-detail.loader.spec.ts`                           | Initial customer detail query chứa `id + ownerId`.                                                                            |
| ASM-AUDIT-01        | `assessment-event-appender.service.spec.ts`                  | Material event ghi canonical AuditEvent trong cùng tx.                                                                        |
| ASM-TRACE-01        | `deepagents/tests/test_assessment_runtime_client_retries.py` | Một client execution reuse một correlation ID qua nhiều call/retry.                                                           |
| ASM-RENAME-01/02/03 | `prisma-assessment.repository.red.spec.ts`                   | Stale concurrent rename bị từ chối; update không upsert/recreate và persist timestamp/revision.                               |
| ASM-EXPORT-01       | `assessment-rule-audit.service.spec.ts`                      | P2002 đúng key được replay thành công.                                                                                        |
| ASM-REPORT-01A/B/C  | `submit-assessment-final-report.handler.spec.ts`             | Synchronous two-phase giữ BUILDING authority qua storage/activation failure và retry cùng digest không tạo artifact thứ hai.  |
| ASM-REPORT-01D      | `assessment-report.loader.spec.ts`                           | Chỉ artifact ACTIVE được trả content; BUILDING/INVALID bị từ chối.                                                            |
| ASM-REPORT-02       | `assessment-report.loader.spec.ts`                           | Dependency outage trả 503, integrity failure vẫn 409.                                                                         |
| ASM-LEGAL-01        | `search-pinned-legal-source.handler.spec.ts`                 | Case variants chỉ tạo một normalized search term.                                                                             |
| ASM-BUDGET-01/02    | Billing payment/wallet specs mới                             | Customer không truyền raw allowance; confirmed payment credit ví chung idempotently và không tạo runtime extension.           |
| ASM-BUDGET-03/04    | Usage settlement/wallet/runtime specs mới                    | Actual usage debit đúng một lần; nhiều assessment dùng chung wallet; wallet `<= 0` chặn paid work mới và top-up bù âm trước.  |
| ASM-BUDGET-05       | Admin runtime-control/controller specs                       | Admin override có audit lineage; hai routes không diverge trước khi legacy route được deprecate.                              |
| ASM-PRICING-01..04  | Contracts + billing pricing + Admin BFF/UI specs             | Direct-credit pricing lifecycle/resolution/calculator đúng; multi-model assessment pin và settle từng invocation độc lập.     |
| ASM-USAGE-01..04    | Deepagents usage metering + billing usage/analytics specs    | Không silent fallback `4096`; persist applied cap/finish/operation/outcome và thu thập đủ dữ liệu trước khi đặt business cap. |

## 6. Quy tắc sửa của Antigravity

1. Rewrite `ASM-RBAC-01/02` và `ASM-REPORT-01` theo contract mới trước; với các ID còn lại, chạy riêng RED test hiện có và quan sát failure trước khi sửa.
2. `ASM-PRICING-01..04`, `ASM-BUDGET-01..05` và `ASM-USAGE-01..04` là planned contracts chưa có execution receipt; phải viết test, chạy riêng và xác nhận RED trước bất kỳ production change nào cho luồng pricing, billing, usage telemetry hoặc runtime override.
3. Giải thích **Root cause** và **Fix** trước production change.
4. Ngoài ba tests đã được đánh dấu superseded và `ASM-WORKER-01` đã được rút theo quyết định kiến trúc, không thay đổi expectation để né lỗi.
5. Business function bị đổi phải có JSDoc/docstring đủ năm mục và explanatory comments theo AGENTS.
6. Chạy lại targeted test đến GREEN, sau đó chạy các spec lân cận.
7. Khi toàn bộ `[RED][ASM-*]` xanh, chạy architecture/import/business-doc checks và cập nhật Graphify.

## 7. RED execution receipts

Đã viết 18 behavioral reproducer ở lần audit đầu. Sau review kiến trúc, **14 reproducer vẫn hợp lệ**; `ASM-RBAC-01/02` và `ASM-REPORT-01` hiện đã superseded và phải được viết lại trước khi sửa production code. `ASM-WORKER-01` đã được rút vì hệ thống chủ đích giữ một worker key. Không được làm xanh test report cũ bằng compensating erase đơn giản trên shared content-addressed chunks.

Các contract `ASM-PRICING-01..04`, `ASM-BUDGET-01..05` và `ASM-USAGE-01..04` được bổ sung sau review nghiệp vụ, **chưa được tính vào 18 reproducer trên và chưa có RED execution receipt**. Đây là đầu việc test-first của phase triển khai sau khi user duyệt plan. Production hiện chưa có actual-usage wallet debit; production enablement còn chờ initial ACTIVE tariff values được owner phê duyệt, và telemetry hiện chưa đủ để hiệu chỉnh operation-specific output cap.

Lệnh chung cho từng Jest spec:

```bash
NODE_OPTIONS=--experimental-vm-modules pnpm --filter @lcsp/api exec jest --config ./jest.config.ts <spec-path> --runInBand --no-watchman
```

| Test ID       | Command                                                            | Kết quả RED                                                                                                                                               |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ASM-RBAC-01   | Jest `rbac.guard.spec.ts`                                          | **Superseded:** test cũ yêu cầu reject mọi `ALLOW`; phải thay bằng expectation durable fallback + metric/alert cho read thông thường.                     |
| ASM-RBAC-02   | Jest `rbac-preflight.service.spec.ts`                              | **Superseded:** test cũ yêu cầu đổi `ALLOW` thành `DENY`; phải thay bằng test DENY không đổi kết quả khi audit lỗi.                                       |
| ASM-WORKER-01 | Jest `worker-api-key.guard.spec.ts`                                | **Withdrawn:** hệ thống chủ đích dùng một key; rotation thực hiện bằng coordinated secret update/redeploy.                                                |
| ASM-ADMIN-01  | Jest `assessment-detail.loader.spec.ts`                            | ADMIN nhận list rỗng thay vì metadata row.                                                                                                                |
| ASM-ADMIN-02  | Jest `assessment-detail.loader.spec.ts`                            | ADMIN detail bị 404 thay vì metadata-only projection.                                                                                                     |
| ASM-ADMIN-03  | Jest `assessment-admin-rbac.red.spec.ts`                           | Provenance roles còn chứa `ADMIN`.                                                                                                                        |
| ASM-ADMIN-04  | Jest `assessment-admin-rbac.red.spec.ts`                           | Runtime stream roles còn chứa `ADMIN`.                                                                                                                    |
| ASM-OWNER-01  | Jest `delete-assessment.handler.spec.ts`                           | Delete vẫn resolve thành công sau ownership race.                                                                                                         |
| ASM-OWNER-02  | Jest `assessment-detail.loader.spec.ts`                            | Query đầu chỉ có `id`, thiếu `ownerId`.                                                                                                                   |
| ASM-AUDIT-01  | Jest `assessment-event-appender.service.spec.ts`                   | Canonical AuditEvent create có `0` call.                                                                                                                  |
| ASM-TRACE-01  | `uv run pytest tests/test_assessment_runtime_client_retries.py -q` | Hai call trong cùng lease sinh hai correlation ID khác nhau; 18 test nền vẫn pass.                                                                        |
| ASM-RENAME-01 | Jest `prisma-assessment.repository.red.spec.ts`                    | Hai stale writer đều fulfilled; không có loser bị reject.                                                                                                 |
| ASM-RENAME-02 | Jest `prisma-assessment.repository.red.spec.ts`                    | Update path gọi `upsert` một lần.                                                                                                                         |
| ASM-RENAME-03 | Jest `prisma-assessment.repository.red.spec.ts`                    | Không có update persist `updatedAt`.                                                                                                                      |
| ASM-EXPORT-01 | Jest `assessment-rule-audit.service.spec.ts`                       | Exact-key `P2002` bị throw thay vì reload winner.                                                                                                         |
| ASM-REPORT-01 | Jest `submit-assessment-final-report.handler.spec.ts`              | **Superseded:** test cũ yêu cầu compensating erase; thay bằng `ASM-REPORT-01A/B/C/D` cho synchronous BUILDING → storage → ACTIVE và same-digest recovery. |
| ASM-REPORT-02 | Jest `assessment-report.loader.spec.ts`                            | Storage outage nhận HTTP `409`, mong đợi `503`.                                                                                                           |
| ASM-LEGAL-01  | Jest `search-pinned-legal-source.handler.spec.ts`                  | `Register/register/REGISTER` vẫn tạo ba terms.                                                                                                            |

Tổng quan lần chạy ban đầu: 18 reproducer thất bại đúng assertion tại thời điểm viết. Sau review kiến trúc, 14 assertion còn hiệu lực, 3 assertion (`ASM-RBAC-01`, `ASM-RBAC-02`, `ASM-REPORT-01`) đã superseded và `ASM-WORKER-01` đã withdrawn. `69` Jest baseline tests và `18` Pytest baseline tests vẫn là bằng chứng GREEN trước khi thêm reproducer. Antigravity phải rewrite ba test superseded theo contract mới trước, bỏ qua test worker đã rút, sau đó mới triển khai production fix.
