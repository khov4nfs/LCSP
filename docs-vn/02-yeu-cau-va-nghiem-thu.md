# 02 — Yêu cầu và nghiệm thu

## Bộ định danh chuẩn

- Use case active: `UC-001..UC-017`; `UC-018` là lịch sử và `SUPERSEDED_FOR_ACTIVE_MVP`.
- Functional requirement: `FR-001..FR-056`.
- Phase 5.2L: `FR-050` active dưới nghĩa Automatic Trusted Scan Initiation.
- `FR-045/FR-046` structured attestation là `SUPERSEDED_FOR_ACTIVE_MVP`.
- `FR-051` manual evidence JSON là `REMOVED_FROM_PRODUCT`.
- Deferred: `FR-052`.
- Acceptance criteria: `AC-001..AC-041` và `AC-050A..AC-050F`.
- Active NFR: `NFR-001..NFR-030`, `NFR-033..NFR-035`.

Các ID cũ như `UC-MXX-XX`, `FR-E*`, `FR-057..FR-082`, `NFR-031`, `NFR-032` chỉ còn ý nghĩa lịch sử hoặc alias; không được dùng làm traceability mới.

## Nhóm yêu cầu chức năng

### Danh tính và quản trị

Đăng ký, đăng nhập, MFA, session, OAuth/OIDC, organization, membership và PBAC policy. OAuth login và GitHub repository permission là hai quyền độc lập.

### Assessment và repository

Manager tạo assessment, hoàn thành WizardProfile, kết nối GitHub App chỉ đọc. Trusted trigger từ webhook, scheduler, backend hoặc Manager action tạo/resume scan workflow an toàn theo organization, repository, assessment, branch và commit.

### Scanner và evidence

Python Scanner Worker chạy Syft, Knip, deptry, `ast`/`libcst`, bounded `ts-morph`, tree-sitter/custom parser và Semgrep custom rules để tạo dependency facts, SourceFile metadata, graph, EvidenceReference, TechnicalFinding và TechnicalEvidenceReport. Chỉ report đạt schema, privacy và quality gate mới được dùng tiếp.

### Intelligence và reconciliation

Hệ thống tạo TechnicalProfile, AIUsageFlow, phát hiện conflict, cho Manager giải quyết và tạo VerifiedProfile. Critical unknown hoặc conflict chưa giải quyết sẽ khóa bước sau.

### Legal matching và classification

Hệ thống chỉ dùng LegalCorpusVersion đã duyệt và đã có ChromaDB vectorless legal index. Retrieval phải trả về citation đầy đủ, phân biệt primary/parent/referenced context và chỉ cho phép citation trong retrieved allowlist; classification chỉ chạy sau VerifiedProfile và LegalRuleMatch.

### Reporting và audit

GapAnalysis và final report yêu cầu đủ classification, legal basis, citation và không có conflict. Readiness-only export được phép sớm hơn nhưng không có risk level. Mọi sự kiện quan trọng được audit và có thể xuất bản ghi đã làm sạch.

## Yêu cầu phi chức năng trọng yếu

- Xác thực, session, MFA, rate limit và OAuth an toàn.
- Tenant isolation và PBAC phía server.
- Không raw source sang LLM hoặc lưu trữ dài hạn.
- Evidence provenance, hash, version và immutable history.
- Fail-closed khi thiếu evidence, citation hoặc corpus.
- RabbitMQ/outbox có idempotency, retry và DLQ.
- Trạng thái UI rõ ràng: loading, empty, insufficient, blocked, failed, retry, rerun.
- Kiểm soát chi phí LLM. Embedding không bắt buộc cho legal retrieval MVP.
- Legal corpus đã duyệt phải bất biến.
- Python Worker phải chạy trong workspace hạn chế và xác minh cleanup.

## Nghiệm thu A-to-Z

Bài nghiệm thu chuẩn sử dụng hạ tầng thật:

- PostgreSQL và RabbitMQ thật;
- S3-compatible object storage thật;
- repository fixture thật theo commit;
- approved legal corpus và ChromaDB vectorless legal index thật;
- LLM provider thật;
- document artifact và audit export thật.

Manager phải hoàn thành từ đăng nhập đến xuất audit mà không phụ thuộc cộng tác viên bên ngoài. Mock LLM không đủ điều kiện cho nghiệm thu A-to-Z.

## Negative paths bắt buộc

Các tình huống cần có hành vi rõ ràng gồm invalid webhook signature, untrusted trigger source, PBAC denied, thiếu/ambiguous mapping, repository không truy cập được, parser/tool lỗi từng file, dynamic Python flow, cleanup thất bại, conflict chưa giải quyết, corpus chưa duyệt, zero citation candidate, provider timeout, model output sai schema, duplicate message, outbox publish lỗi và document guardrail vi phạm.

## Quy tắc traceability

Mỗi story tương lai phải liên kết tối thiểu:

```text
UC -> FR -> AC -> NFR -> UX state -> domain state -> implementation area -> recovery behavior
```

UX cần được rebase hoặc tạo lại từ bộ tài liệu active đã rút gọn; canonical epics/stories vẫn chưa có, vì vậy story coverage chưa thể đánh giá và implementation chưa được phép bắt đầu.
