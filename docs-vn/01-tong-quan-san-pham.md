# 01 — Tổng quan sản phẩm

## LCSP là gì

LCSP là nền tảng hỗ trợ doanh nghiệp sử dụng AI tại Việt Nam đánh giá mức độ sẵn sàng tuân thủ dựa trên bằng chứng. Hệ thống kết hợp thông tin do Manager khai báo, bằng chứng kỹ thuật từ kho mã, đối chiếu xung đột, tra cứu pháp lý có trích dẫn, phân loại rủi ro, phân tích khoảng trống, tạo tài liệu và nhật ký kiểm toán.

LCSP không được tạo kết luận pháp lý khi thiếu bằng chứng hoặc trích dẫn. Compliance certification, formal legal opinion và direct regulator submission đã được phân loại `REMOVED_FROM_PRODUCT`, không phải capability tương lai.

## Phase 5.2L

- PBAC thay RBAC làm nguồn quyết định quyền truy cập.
- Structured attestation là `SUPERSEDED_FOR_ACTIVE_MVP`.
- `FR-050` là Automatic Trusted Scan Initiation, không phải upload Local/CI scanner report.
- `FR-051` manual evidence JSON là `REMOVED_FROM_PRODUCT`.
- Python Worker Platform sở hữu toàn bộ asynchronous domain workloads.
- Scanner toolchain gồm Syft, Knip, deptry, Semgrep custom rules, tree-sitter/custom parser, `ast`/`libcst` và bounded `ts-morph`.

## Người dùng và trách nhiệm

### Manager

Là chủ thể chính của assessment. Manager có thể hoàn thành toàn bộ luồng MVP không cần cộng tác viên bên ngoài: tạo assessment, khai báo WizardProfile, kết nối repository, theo dõi scan, xử lý xung đột, xem kết quả pháp lý, phân loại, gap analysis, tải báo cáo và xuất audit.

### Cộng tác viên kỹ thuật

Luồng Developer invitation/task đã được retired khỏi active MVP. Không còn màn hình, BFF/API handler, entity hoặc policy active cho invitation acceptance, scoped task workspace hay structured attestation.

### Internal Legal Operator

Là vai trò vận hành nội bộ, dùng API/CLI để xác minh nguồn văn bản, kiểm tra dữ liệu đã chuẩn hóa, duyệt LegalCorpusVersion và khởi tạo chỉ mục. Vai trò này không thuộc UX dành cho Manager trong MVP.

## Phạm vi MVP mục tiêu

- đăng nhập, MFA/OAuth và PBAC theo tổ chức;
- assessment và WizardProfile;
- GitHub App chỉ đọc, trusted scan trigger và repository snapshot theo commit;
- Python Worker Platform cho toàn bộ asynchronous domain workloads;
- scanner toolchain đa công cụ và TechnicalEvidenceReport;
- TechnicalProfile, AIUsageFlow, reconciliation và VerifiedProfile;
- legal corpus có provenance, immutable version và internal approval;
- ChromaDB structure-first vectorless legal retrieval;
- real LLM provider cho bài nghiệm thu A-to-Z;
- RiskClassification, GapAnalysis, GeneratedDocument và AuditEvent.

## Phân loại phần không active

### Removed from product

- compliance certification;
- formal legal opinion;
- direct regulator submission;
- manual technical evidence JSON upload (`FR-051`).

### Superseded for active MVP

- structured attestation (`FR-045`, `FR-046`, `UC-018`, `AC-013` lịch sử);
- upload scanner report từ Local/CI; `FR-050` đã được thay nghĩa bằng Automatic Trusted Scan Initiation.

### Deferred/Post-MVP

- delegated free-form technical clarification (`FR-052`);
- enterprise SSO/SAML/SCIM;
- customer-facing legal corpus administration;
- scanner accuracy claim vượt quá empirical acceptance.

## Nguyên tắc sản phẩm

1. Evidence-first: không phân loại dựa trên Wizard hoặc package/model name đơn lẻ.
2. Fail-closed: thiếu bằng chứng, conflict, corpus hoặc citation thì chặn hoặc hạ cấp rõ ràng.
3. PBAC-controlled: role chỉ là attribute/template, không phải authorization source of truth.
4. Manager-completable: golden path không phụ thuộc cộng tác viên bên ngoài.
5. Traceable: kết quả liên kết tới evidence, legal citation, policy/version và audit.
6. Privacy-by-design: không gửi raw source, secret hoặc full prompt sang LLM.

## Review gate

Target scope trên đã được phản ánh ở nhiều tài liệu nhưng active-document closure chưa đạt. Xem `12-review-truoc-ux-phase-5-2l.md` trước khi dùng làm input cho canonical UX.
