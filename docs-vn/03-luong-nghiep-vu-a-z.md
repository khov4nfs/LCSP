# 03 — Luồng nghiệp vụ A-to-Z

## Luồng Manager chuẩn

```text
1. Đăng nhập
2. Chọn tổ chức
3. Tạo Assessment
4. Hoàn thành WizardProfile
5. Kết nối GitHub App
6. Chọn repository hoặc nhận trusted trigger
7. Trigger xác định branch/commit hoặc tạo trạng thái mapping an toàn
8. Tạo RepositorySnapshot và yêu cầu Repository Scan
9. Python Scanner Worker tạo TechnicalEvidenceReport
10. Tạo TechnicalProfile
11. Tạo AIUsageFlow
12. Reconciliation phát hiện conflict hoặc xác nhận sẵn sàng
13. Manager giải quyết conflict khi có
14. Tạo VerifiedProfile
15. ChromaDB vectorless retrieval và LegalRuleMatch
16. RiskClassification và GapAnalysis
17. Tạo, lưu và tải GeneratedDocument
18. Xem và xuất Audit Trail
```

## Trạng thái assessment chính

```text
CREATED
-> WIZARD_PROFILE_READY
-> REPOSITORY_CONNECTED
-> TRUSTED_SCAN_TRIGGERED
-> PENDING_MAPPING hoặc BLOCKED_MAPPING hoặc WAITING_FOR_CONTEXT hoặc SNAPSHOT_CREATED
-> SNAPSHOT_CREATED
-> SCAN_REQUESTED
-> SCAN_RUNNING
-> SCAN_COMPLETED
-> TECHNICAL_PROFILE_READY
-> AI_USAGE_FLOW_READY
-> RECONCILIATION_REQUIRED hoặc VERIFIED_PROFILE_READY
-> LEGAL_MATCHING_READY
-> CLASSIFICATION_READY hoặc CLASSIFICATION_BLOCKED
-> GAP_ANALYSIS_READY hoặc GAP_ANALYSIS_BLOCKED
-> DOCUMENT_GENERATED hoặc DOCUMENT_BLOCKED
```

Không được đi tắt từ Wizard sang risk, từ scan sang classification, từ VerifiedProfile sang classification khi chưa legal matching, hoặc từ classification sang final document khi chưa GapAnalysis.

## Luồng scan

Backend kiểm tra PBAC, nhận trusted trigger và tạo `TrustedScanTrigger`, mapping state, `AuditEvent`, rồi chỉ tạo `RepositoryScanJob` khi context an toàn. Python Scanner Worker khóa job, tạo workspace, lấy snapshot, chạy Syft, Knip, deptry, Python `ast`/`libcst`, bounded `ts-morph`, tree-sitter/custom parser và Semgrep custom rules, tạo evidence/report, chạy gate, xóa workspace rồi mới ghi trạng thái terminal và outbox event.

Scan hoàn tất chỉ khi report `QUALITY_VALID` và cleanup đã được xác minh. Mọi rerun tạo job/evidence chain mới, không sửa lịch sử.

## Luồng reconciliation

WizardProfile, TechnicalProfile và AIUsageFlow được so sánh. Nếu có khác biệt quan trọng, hệ thống tạo conflict và khóa classification. Manager xem hai phía, evidence refs, nhập lý do và chọn cách giải quyết. Scanner evidence vẫn bất biến. Structured attestation không thuộc active MVP.

## Luồng pháp lý

VerifiedProfile được chuyển thành query facets đã làm sạch. ChromaDB vectorless retriever lọc theo corpus đã duyệt, nguồn, ngày hiệu lực và metadata; sau đó dùng full-text/metadata candidates, direct ID lookup, parent-context assembly và one-hop xref expansion. Mỗi kết quả phải dựng lại citation đến văn bản, điều, khoản, điểm, URL nguồn, hash, corpus version và context role.

Nếu thiếu citation hoặc legal basis, hệ thống không được tạo kết luận chắc chắn.

## Luồng classification và báo cáo

Python Classification worker dùng VerifiedProfile và LegalRuleMatch, gọi LLM Gateway khi cần, kiểm tra schema và guardrails rồi lưu kết quả hoặc blocked state. Python GapAnalysis worker dẫn xuất nghĩa vụ và khoảng trống. Python Document worker chỉ phát hành final report khi mọi gate hợp lệ.

Readiness-only export có thể được tạo trước nhưng phải ghi rõ chưa phải risk classification và không chứa nhãn HIGH/MEDIUM/LOW.

## Luồng cộng tác kỹ thuật

```text
Retired khỏi active MVP:
Developer invitation
-> invitation acceptance
-> scoped task workspace
-> membership revocation UI/API
```

Golden path hiện là Manager-owned. Không còn flow active cho Developer task hoặc structured attestation.

## Luồng legal operations nội bộ

```text
Xác minh source URL
-> ingest snapshot và hash
-> chuẩn hóa văn bản
-> review
-> duyệt LegalCorpusVersion
-> xây ChromaDB vectorless legal index
-> mở corpus cho legal matching
```

Đây là luồng vận hành API/CLI nội bộ, không phải UX khách hàng.
