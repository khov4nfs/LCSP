# 07 — Dữ liệu, sự kiện và bảo mật

## Nhóm dữ liệu chính

```text
Identity và Organization
Policy / PolicyVersion / AuthorizationDecision
Assessment và WizardProfile
RepositoryConnection và RepositorySnapshot
TrustedScanTrigger và ScanMappingResolution
RepositoryScanJob và scanner evidence
TechnicalProfile và AIUsageFlow
Conflict và VerifiedProfile
Legal corpus và LegalRuleMatch
RiskClassification và GapAnalysis
GeneratedDocument
AuditEvent và OutboxEvent
```

Các artifact quan trọng được version hóa và giữ lịch sử bất biến. Rerun tạo chuỗi artifact mới thay vì ghi đè kết quả cũ.

## Quy tắc persistence

PostgreSQL là nguồn chuẩn cho trạng thái nghiệp vụ và metadata. Object storage lưu legal source snapshots và document artifacts. Database lưu storage reference, hash, version và trạng thái.

Không lưu dài hạn:

- raw repository source;
- repository archive;
- full AST;
- secret, credential hoặc provider token;
- full customer prompt;
- raw subprocess output chưa validate.

## Transaction và Outbox

Mọi thay đổi trạng thái có tác vụ bất đồng bộ phải dùng transaction:

```text
validate actor/service, PBAC và state guard
-> ghi domain object
-> ghi AuditEvent
-> ghi OutboxEvent
-> commit
```

Outbox publisher phát message sau transaction. Cách này tránh trạng thái đã lưu nhưng message bị mất hoặc message đã phát khi transaction chưa thành công.

## Queue chuẩn

Các queue chính:

- `lcsp.scan-trigger-worker.v1`;
- `lcsp.scan-worker.v1`;
- `lcsp.technical-profile-worker.v1`;
- `lcsp.ai-usage-flow-worker.v1`;
- `lcsp.reconciliation-worker.v1`;
- `lcsp.legal-source-ingest.v1`;
- `lcsp.legal-source-vbpl-effected-chunk-set.v1`;
- `lcsp.legal-index-build.v1`;
- `lcsp.legal-matching-worker.v1`;
- `lcsp.classification-worker.v1`;
- `lcsp.gap-analysis-worker.v1`;
- `lcsp.document-worker.v1`.

Message payload chỉ chứa ID, version, status, hash và reference đã làm sạch. Consumer phải idempotent, retry có giới hạn và đưa message hết retry vào DLQ.

## Audit

AuditEvent ghi actor/service identity, organization, resource/action, policy ID/version khi áp dụng, decision/outcome, thời gian, correlation/causation, version refs và metadata an toàn. Audit không chứa raw source, secret, full prompt hoặc token.

Các sự kiện phải audit gồm authentication, PBAC denial/allow for material actions, assessment transition, trusted scan trigger, mapping decision, scan, cleanup failure, conflict resolution, corpus approval, legal matching, classification, document generation và audit export. Structured attestation là `SUPERSEDED_FOR_ACTIVE_MVP`.

## Bảo mật và riêng tư

- Tenant scope và PBAC được kiểm tra phía server.
- Non-Manager hoặc subject không có policy phù hợp bị deny phía server; dữ liệu trả ra luôn được giới hạn theo PBAC và redaction policy.
- OAuth/OIDC login không cấp GitHub repository access.
- GitHub App chỉ đọc repository đã chọn.
- Scanner không chạy mã khách hàng.
- Workspace bị giới hạn quyền, kích thước, thời gian và network.
- Evidence hiển thị dưới dạng path/symbol/line/hash thay vì source body.
- External model chỉ nhận structured sanitized metadata.
- Thiếu redaction hoặc cleanup phải fail closed.
- Missing/ambiguous scan mapping tạo `PENDING_MAPPING`, `BLOCKED_MAPPING` hoặc `WAITING_FOR_CONTEXT`, không scan best-effort.

## Recovery

- Duplicate command: no-op hoặc resume an toàn theo trạng thái đã lưu.
- Failed scan: tạo ScanJob mới, giữ lịch sử lỗi.
- Stuck outbox: retry/backoff hoặc operator replay sau khi sửa nguyên nhân.
- Corpus/index lỗi: sửa nguồn hoặc rebuild index với attempt/version mới.
- Provider lỗi: chỉ retry lỗi transient; domain guard vẫn blocked cho đến khi upstream thay đổi.
- Artifact upload dở dang: cleanup/reconciliation job có audit.
