import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  assessmentDetailSchema,
  assessmentEventsPageSchema,
  assessmentProvenanceArtifactSchema,
  assessmentRepositorySetupSchema,
  assessmentHumanRequestsResultSchema,
  ruleAuditCatalogSchema,
} from "@lcsp/contracts/assessment-domain";
import {
  activeLegalLibrarySchema,
  legalSourceChunkPageSchema,
  LEGAL_SOURCE_CHUNK_STATUSES,
} from "@lcsp/contracts/legal-source";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";

const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const EXECUTION_ID = "33333333-3333-4333-8333-333333333333";
const RULE_SET_ID = "44444444-4444-4444-8444-444444444444";
const SNAPSHOT_ID = "55555555-5555-4555-8555-555555555555";
const COMMIT = "c14f518a29b48c1e7a3d90214e6b5c92847120a1";

const DECISION_RET_ID = "66666666-6666-4666-8666-666666666666";
const DECISION_MFA_ID = "77777777-7777-4777-8777-777777777777";
const EVIDENCE_RET_ID = "88888888-8888-4888-8888-888888888888";
const EVIDENCE_MFA_ID = "99999999-9999-4999-8999-999999999999";

const DOC_147_ROW_ID = "doc-row-nd-147";
const DOC_13_ROW_ID = "doc-row-nd-13";
const DOC_147_ID = "nghi-dinh-so-147-2024-nd-cp";
const DOC_13_ID = "nghi-dinh-so-13-2023-nd-cp";

// 1. Validated Detail Payload
const detailData = assessmentDetailSchema.parse({
  assessment_id: ASSESSMENT_ID,
  name: "Dịch vụ mạng xã hội & quản lý tài khoản",
  owner_id: "legaltech-lead",
  created_at: "2026-11-18T00:00:00.000Z",
  updated_at: "2026-11-18T02:30:00.000Z",
  correlationId: "audit-run-enterprise-01",
  lifecycle: {
    state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    assessmentRevision: 4,
  },
  runtime: {
    threadId: THREAD_ID,
    rootAgentVersion: "root-agent-v2",
    checkpointNamespace: ASSESSMENT_ID,
    checkpointId: "ckpt-final-audit",
    currentExecutionId: EXECUTION_ID,
    executionState: AGENT_EXECUTION_STATES.RUNNING,
    eventSequence: 15,
    startedAt: "2026-11-18T00:00:00.000Z",
    lastResumedAt: null,
    updatedAt: "2026-11-18T02:30:00.000Z",
  },
  usage: {
    partial: false,
    invocationCount: 14,
    totalTokens: 184500,
  },
  case: {
    caseRevision: 1,
    auditRequestRevision: 1,
    auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
    ruleSetVersionId: RULE_SET_ID,
    ruleSet: {
      ruleSetVersionId: RULE_SET_ID,
      version: "2026.11-enterprise",
      legalSourceVersion: "2024.Q4-VN",
      legalRequirementCount: 12,
      assessmentRuleCount: 8,
    },
    repositorySnapshotId: SNAPSHOT_ID,
    repositoryScanJobId: "scan-job-enterprise-01",
    repositoryCommit: COMMIT,
    coverage: [
      {
        assessmentRuleId: "ER-RETENTION",
        assessmentRuleVersion: "2026.11",
        concept: "Lưu trữ dữ liệu người dùng & nhật ký mạng xã hội",
        resolutionState: "RESOLVED",
        currentDecisionId: DECISION_RET_ID,
        decisionRevision: 1,
      },
      {
        assessmentRuleId: "ER-MFA",
        assessmentRuleVersion: "2026.11",
        concept: "Xác thực đa yếu tố & bảo vệ dữ liệu cá nhân",
        resolutionState: "RESOLVED",
        currentDecisionId: DECISION_MFA_ID,
        decisionRevision: 1,
      },
    ],
    decisions: [
      {
        decisionId: DECISION_RET_ID,
        assessmentId: ASSESSMENT_ID,
        assessmentRuleId: "ER-RETENTION",
        scopeId: "ASSESSMENT",
        decisionRevision: 1,
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
        createdAt: "2026-11-18T01:15:00.000Z",
        decision: {
          assessmentRuleId: "ER-RETENTION",
          assessmentRuleVersion: "2026.11",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: RULE_SET_ID,
          repositorySnapshotId: SNAPSHOT_ID,
          repositoryCommit: COMMIT,
          caseRevision: 1,
          legalContextRefs: [{ legalContextId: "LC-INTERNET-147" }],
          applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
          applicabilityBasis: [
            {
              legalRequirementId: "LR-RET-90D",
              kind: "OPERATIVE_SCOPE",
              index: 0,
              finding: "ESTABLISHED",
              rationale: "Repository cung cấp dịch vụ mạng xã hội nội bộ và xử lý lưu vết tài khoản người dùng theo cấu hình microservice.",
              references: [],
            },
          ],
          compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
          rationale: "Hệ thống cấu hình thời hạn tự động dọn dẹp nhật ký là 30 ngày (RETENTION_DAYS = 30), không đáp ứng yêu cầu tối thiểu 90 ngày theo luật định.",
          references: [
            {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId: EVIDENCE_RET_ID,
            },
          ],
          criteria: [
            {
              criterionId: "C-RET-1",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
              rationale: "Cấu hình xóa nhật ký đặt thời hạn 30 ngày kể từ ngày tạo, vi phạm nghĩa vụ lưu trữ tối thiểu 90 ngày.",
              references: [
                {
                  type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
                  evidenceId: EVIDENCE_RET_ID,
                },
              ],
            },
          ],
        },
      },
      {
        decisionId: DECISION_MFA_ID,
        assessmentId: ASSESSMENT_ID,
        assessmentRuleId: "ER-MFA",
        scopeId: "ASSESSMENT",
        decisionRevision: 1,
        state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
        createdAt: "2026-11-18T01:45:00.000Z",
        decision: {
          assessmentRuleId: "ER-MFA",
          assessmentRuleVersion: "2026.11",
          scopeId: "ASSESSMENT",
          ruleSetVersionId: RULE_SET_ID,
          repositorySnapshotId: SNAPSHOT_ID,
          repositoryCommit: COMMIT,
          caseRevision: 1,
          legalContextRefs: [{ legalContextId: "LC-PRIVACY-13" }],
          applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
          applicabilityBasis: [
            {
              legalRequirementId: "LR-MFA-SEC",
              kind: "OPERATIVE_SCOPE",
              index: 0,
              finding: "ESTABLISHED",
              rationale: "Repository xử lý thông tin cá nhân và quản lý phiên xác thực tài khoản có quyền truy cập dữ liệu nhạy cảm.",
              references: [],
            },
          ],
          compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
          rationale: "Quy trình xác thực người dùng đã bắt buộc kích hoạt TOTP/SMS OTP và kiểm tra chữ ký token trước khi cấp quyền truy cập tài nguyên bảo mật.",
          references: [
            {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId: EVIDENCE_MFA_ID,
            },
          ],
          criteria: [
            {
              criterionId: "C-MFA-1",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
              rationale: "Cơ chế bảo vệ kỹ thuật bằng TOTP và SMS OTP được thực thi bắt buộc tại middleware gateway.",
              references: [
                {
                  type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
                  evidenceId: EVIDENCE_MFA_ID,
                },
              ],
            },
          ],
        },
      },
    ],
    facts: [],
    artifacts: [],
  },
});

// 2. Validated Rule Catalog
const catalogData = ruleAuditCatalogSchema.parse({
  assessmentId: ASSESSMENT_ID,
  auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
  auditRevision: 1,
  ruleSetVersionId: RULE_SET_ID,
  ruleSetDigest: "digest-enterprise-v1",
  repositorySnapshotId: SNAPSHOT_ID,
  repositoryCommit: COMMIT,
  latestRequestId: null,
  latestRequestStatus: null,
  total: 2,
  offset: 0,
  nextOffset: null,
  localizationFallback: false,
  localizationState: "READY",
  groupingState: "APPROVED",
  groups: [],
  excludedRuleCount: 0,
  rules: [
    {
      assessmentRuleId: "ER-RETENTION",
      assessmentRuleVersion: "2026.11",
      concept: "Lưu trữ dữ liệu người dùng & nhật ký mạng xã hội",
      summary: "Doanh nghiệp cung cấp dịch vụ mạng xã hội phải lưu trữ thông tin tài khoản, nhật ký đăng nhập và nhật ký xử lý tối thiểu 90 ngày.",
      legalRequirements: [
        {
          legalRequirementId: "LR-RET-90D",
          title: "Nghĩa vụ lưu trữ dữ liệu người dùng mạng xã hội tối thiểu 90 ngày",
          sources: [
            {
              documentId: DOC_147_ID,
              locator: "Điều 23, Khoản 2, Điểm b",
            },
          ],
        },
      ],
      progress: "RESULT_READY",
      decisionId: DECISION_RET_ID,
      membership: null,
    },
    {
      assessmentRuleId: "ER-MFA",
      assessmentRuleVersion: "2026.11",
      concept: "Xác thực đa yếu tố & bảo vệ dữ liệu cá nhân",
      summary: "Bắt buộc áp dụng biện pháp kỹ thuật xác thực đa yếu tố (MFA) khi quản lý tài khoản và xử lý dữ liệu cá nhân.",
      legalRequirements: [
        {
          legalRequirementId: "LR-MFA-SEC",
          title: "Biện pháp kỹ thuật bảo vệ dữ liệu cá nhân trong xử lý tài khoản",
          sources: [
            {
              documentId: DOC_13_ID,
              locator: "Điều 9, Khoản 3",
            },
          ],
        },
      ],
      progress: "RESULT_READY",
      decisionId: DECISION_MFA_ID,
      membership: null,
    },
  ],
});

// 3. Validated Legal Library
const libraryData = activeLegalLibrarySchema.parse({
  versionId: "legal-lib-vn-2024",
  version: "2024.12",
  sourceName: "Cơ sở dữ liệu Quốc gia về Văn bản Pháp luật",
  activatedAt: "2024-12-25T00:00:00.000Z",
  documents: [
    {
      id: DOC_147_ROW_ID,
      documentId: DOC_147_ID,
      title: "Nghị định số 147/2024/NĐ-CP về quản lý, cung cấp, sử dụng dịch vụ Internet và thông tin trên mạng",
      sourceUrl: "https://vanban.chinhphu.vn/?pageid=27160&docid=211756",
      sourceEffectStatus: "EFFECTIVE",
      effectiveDate: "2024-12-25",
      chunkCount: 154,
      mediaType: "application/pdf",
      hasOriginal: true,
    },
    {
      id: DOC_13_ROW_ID,
      documentId: DOC_13_ID,
      title: "Nghị định số 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân",
      sourceUrl: "https://vanban.chinhphu.vn/?pageid=27160&docid=207705",
      sourceEffectStatus: "EFFECTIVE",
      effectiveDate: "2023-07-01",
      chunkCount: 88,
      mediaType: "application/pdf",
      hasOriginal: true,
    },
  ],
});

// 4. Validated Chunks for Document 147
const chunksDoc147Data = legalSourceChunkPageSchema.parse({
  items: [
    {
      id: "chunk-147-23-2-b",
      locator: "Điều 23, Khoản 2, Điểm b",
      content:
        "Doanh nghiệp cung cấp dịch vụ mạng xã hội có trách nhiệm: Lưu trữ thông tin tài khoản, thời gian đăng nhập, đăng xuất, địa chỉ IP của người sử dụng và nhật ký xử lý thông tin được đăng tải tối thiểu 90 ngày kể từ thời điểm thông tin được khởi tạo hoặc tiếp nhận.",
      contentSha256: "a".repeat(64),
      hierarchy: { article: "23", clause: "2", point: "b" },
      legalEffectStatus: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
      legalStatusSourceRef: null,
      pageStart: 18,
      pageEnd: 19,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
});

// 5. Validated Chunks for Document 13
const chunksDoc13Data = legalSourceChunkPageSchema.parse({
  items: [
    {
      id: "chunk-13-9-3",
      locator: "Điều 9, Khoản 3",
      content:
        "Bên Kiểm soát dữ liệu cá nhân, Bên Xử lý dữ liệu cá nhân phải áp dụng các biện pháp quản lý, kỹ thuật phù hợp với tính chất của hoạt động xử lý dữ liệu cá nhân nhằm ngăn chặn việc truy cập, thay đổi, sử dụng, tiết lộ trái phép thông tin cá nhân.",
      contentSha256: "b".repeat(64),
      hierarchy: { article: "9", clause: "3" },
      legalEffectStatus: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
      legalStatusSourceRef: null,
      pageStart: 7,
      pageEnd: 8,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
});

// 6. Validated Provenance
const provenanceData = assessmentProvenanceArtifactSchema.parse({
  schemaVersion: ASSESSMENT_PROVENANCE_SCHEMA_VERSION,
  assessmentId: ASSESSMENT_ID,
  name: "Dịch vụ mạng xã hội & quản lý tài khoản",
  ownerId: "legaltech-lead",
  generatedAt: "2026-11-18T02:00:00.000Z",
  contentFingerprintSha256: "0".repeat(64),
  checksumSha256: "0".repeat(64),
  correlationId: "audit-run-enterprise-01",
  lifecycle: { state: "ACTIVE", assessmentRevision: 4 },
  pins: {
    ruleSet: {
      ruleSetVersionId: RULE_SET_ID,
      version: "2026.11-enterprise",
      legalSourceVersion: "2024.Q4-VN",
      legalRequirementCount: 12,
      assessmentRuleCount: 8,
    },
    repositorySnapshotId: SNAPSHOT_ID,
    repositoryScanJobId: "scan-job-enterprise-01",
    repositoryCommit: COMMIT,
    pinnedAt: "2026-11-18T00:00:00.000Z",
  },
  runtime: {
    threadId: THREAD_ID,
    rootAgentVersion: "root-agent-v2",
    checkpointNamespace: ASSESSMENT_ID,
    checkpointId: "ckpt-final-audit",
    currentExecutionId: EXECUTION_ID,
    executionState: "RUNNING",
    eventSequence: 15,
    startedAt: "2026-11-18T00:00:00.000Z",
    lastResumedAt: null,
    updatedAt: "2026-11-18T02:30:00.000Z",
  },
  acceptedFacts: [],
  acceptedEvidence: [
    {
      evidenceId: EVIDENCE_RET_ID,
      assessmentId: ASSESSMENT_ID,
      type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
      state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
      repositoryCommit: COMMIT,
      contentSha256: `sha256:${"a".repeat(64)}`,
      payload: {
        path: "src/services/notice-retention.service.ts",
        startLine: 45,
        endLine: 62,
        excerpt:
          "// Chính sách xóa nhật ký tự động theo cấu hình hệ thống\nconst RETENTION_DAYS = 30;\nconst expiryDate = new Date(Date.now() - RETENTION_DAYS * 86400000);\nawait db.auditLogs.deleteMany({ createdAt: { $lt: expiryDate } });",
        scopes: ["retention-cron-job"],
        queries: ["RETENTION_DAYS = 30"],
      },
      createdAt: "2026-11-18T01:10:00.000Z",
    },
    {
      evidenceId: EVIDENCE_MFA_ID,
      assessmentId: ASSESSMENT_ID,
      type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
      state: ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
      repositoryCommit: COMMIT,
      contentSha256: `sha256:${"b".repeat(64)}`,
      payload: {
        path: "src/auth/guards/mfa-enforcement.guard.ts",
        startLine: 28,
        endLine: 48,
        excerpt:
          "// Bắt buộc xác thực đa yếu tố đối với quyền truy cập tài khoản\nif (user.requiresMfa && !request.session.isMfaVerified) {\n  throw new UnauthorizedException('MFA_VERIFICATION_REQUIRED');\n}\nreturn true;",
        scopes: ["auth-middleware"],
        queries: ["mfa-enforcement"],
      },
      createdAt: "2026-11-18T01:40:00.000Z",
    },
  ],
  humanResolutions: [],
  decisions: [],
  coverage: [],
  events: [],
  artifacts: [],
});

// 7. Validated Events Stream
const eventsData = assessmentEventsPageSchema.parse({
  assessmentId: ASSESSMENT_ID,
  hasMore: false,
  nextAfterSequence: null,
  events: [
    {
      eventId: "00000000-0000-4000-8000-000000000001",
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence: 1,
      timestamp: "2026-11-18T00:00:00.000Z",
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
      payload: {
        fromState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
        toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        assessmentRevision: 1,
      },
    },
    {
      eventId: "00000000-0000-4000-8000-000000000002",
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence: 2,
      timestamp: "2026-11-18T00:00:05.000Z",
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
      executionId: EXECUTION_ID,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
      payload: {
        fromState: AGENT_EXECUTION_STATES.QUEUED,
        toState: AGENT_EXECUTION_STATES.RUNNING,
      },
    },
    {
      eventId: "00000000-0000-4000-8000-000000000003",
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence: 3,
      timestamp: "2026-11-18T01:15:00.000Z",
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.DECISION_ACCEPTED,
      payload: {
        decisionId: DECISION_RET_ID,
        assessmentRuleId: "ER-RETENTION",
        decisionRevision: 1,
      },
    },
    {
      eventId: "00000000-0000-4000-8000-000000000004",
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence: 4,
      timestamp: "2026-11-18T01:45:00.000Z",
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.DECISION_ACCEPTED,
      payload: {
        decisionId: DECISION_MFA_ID,
        assessmentRuleId: "ER-MFA",
        decisionRevision: 1,
      },
    },
  ],
});

// 8. Validated Repository Setup
const repositorySetupData = assessmentRepositorySetupSchema.parse({
  assessmentId: ASSESSMENT_ID,
  lifecycle: null,
  connection: {
    connectionId: "conn-enterprise-gh",
    provider: CREDENTIAL_PROVIDERS.github,
    repositoryId: "repo-notice-service",
    repositoryFullName: "acme/notice-service",
    defaultBranch: "main",
    status: REPOSITORY_CONNECTION_STATUSES.active,
  },
  snapshot: {
    id: SNAPSHOT_ID,
    assessmentId: ASSESSMENT_ID,
    connectionId: "conn-enterprise-gh",
    provider: CREDENTIAL_PROVIDERS.github,
    repositoryFullName: "acme/notice-service",
    branch: "main",
    commitSha: COMMIT,
    sourcePathPrefix: null,
    createdAt: "2026-11-18T00:00:00.000Z",
  },
  scanJob: null,
});

// 9. Validated Human-in-the-Loop (HITL) Requests
const requestsData = assessmentHumanRequestsResultSchema.parse({
  caseRevision: 1,
  requests: [
    // 1. Boolean (Có / Không)
    {
      requestId: "00000000-0000-4000-9000-000000000001",
      requestRevision: 1,
      openedCaseRevision: 1,
      assessmentRuleId: "ER-PII-SCOPE",
      criterionIds: ["CRIT-PII-SCOPE"],
      question:
        "Hệ thống acme/notice-service có trực tiếp thu thập hoặc xử lý dữ liệu định danh cá nhân (PII như CCCD, số điện thoại, tài khoản ngân hàng) của người dùng tại Việt Nam không?",
      unresolvedFact:
        "Không tìm thấy trường schema hoặc model PII rõ ràng trong mã nguồn frontend/backend.",
      decisionImpact: [
        "Xác định phạm vi áp dụng bắt buộc của Điều 9 & Điều 26 Nghị định 13/2023/NĐ-CP về Đánh giá tác động xử lý dữ liệu cá nhân.",
      ],
      resolutionAttempts: [
        "Đã quét 42 schema files trong thư mục src/schemas và models/.",
      ],
      controlType: "BOOLEAN",
      choices: [
        {
          value: "YES",
          label: "Có (Hệ thống có lưu trữ hoặc xử lý PII)",
        },
        {
          value: "NO",
          label: "Không (Chỉ lưu trữ dữ liệu kỹ thuật và token vô danh)",
        },
      ],
      status: "OPEN",
      checkpointId: null,
      resolvedFactId: null,
      answers: [],
      dependencies: [],
      factNeed: null,
    },
    // 2. Single-Select Dropdown (>5 choices)
    {
      requestId: "00000000-0000-4000-9000-000000000002",
      requestRevision: 1,
      openedCaseRevision: 1,
      assessmentRuleId: "ER-RETENTION-POLICY",
      criterionIds: ["CRIT-LOG-RETENTION"],
      question:
        "Theo chính sách vận hành thực tế tại môi trường Production (AWS CloudWatch / S3 Glacier), thời hạn lưu trữ dữ liệu nhật ký xác thực người dùng được cấu hình là bao lâu?",
      unresolvedFact:
        "Mã nguồn đang cấu hình RETENTION_DAYS = 30 trong code, nhưng có thể có lifecycle rule bên ngoài hệ thống lưu trữ.",
      decisionImpact: [
        "Đánh giá tính tuân thủ quy định lưu trữ tối thiểu 90 ngày theo Điều 16 Nghị định 147/2024/NĐ-CP.",
      ],
      resolutionAttempts: [
        "Đã kiểm tra file notice-retention.service.ts và docker-compose.yml.",
      ],
      controlType: "SINGLE_SELECT",
      choices: [
        {
          value: "DAYS_30",
          label: "30 ngày (Theo mặc định cấu hình code hiện tại)",
        },
        {
          value: "DAYS_60",
          label: "60 ngày (Theo chính sách backup định kỳ)",
        },
        {
          value: "DAYS_90",
          label: "90 ngày (Đáp ứng mức tối thiểu theo NĐ 147/2024)",
        },
        {
          value: "DAYS_180",
          label: "180 ngày (6 tháng - Khuyến nghị kiểm toán an ninh mạng)",
        },
        {
          value: "DAYS_365",
          label: "365 ngày (1 năm - Lưu trữ dài hạn)",
        },
        {
          value: "CUSTOM",
          label: "Cấu hình tùy chỉnh khác / Chưa rõ",
        },
      ],
      status: "OPEN",
      checkpointId: null,
      resolvedFactId: null,
      answers: [],
      dependencies: [],
      factNeed: null,
    },
    // 3. Multi-Select Checkboxes
    {
      requestId: "00000000-0000-4000-9000-000000000003",
      requestRevision: 1,
      openedCaseRevision: 1,
      assessmentRuleId: "ER-SECURITY-CONTROLS",
      criterionIds: ["CRIT-SECURITY-MEASURES"],
      question:
        "Những biện pháp bảo mật kỹ thuật nào sau đây đã được kích hoạt trong hạ tầng triển khai dịch vụ thông báo?",
      unresolvedFact:
        "Chưa thể kiểm chứng cấu hình hạ tầng mạng và mã hóa tầng lưu trữ vật lý từ source code repository.",
      decisionImpact: [
        "Cung cấp bằng chứng bổ sung cho tiêu chí Bảo vệ dữ liệu cá nhân theo Điều 26 Nghị định 13/2023/NĐ-CP.",
      ],
      resolutionAttempts: [
        "Đã quét mã nguồn backend, chỉ phát hiện MFA middleware, chưa thấy cấu hình KMS encryption.",
      ],
      controlType: "MULTI_SELECT",
      choices: [
        {
          value: "MFA_ENABLED",
          label: "Xác thực đa yếu tố (MFA) bắt buộc cho tài khoản quản trị",
        },
        {
          value: "AES_ENCRYPTED",
          label: "Mã hóa cơ sở dữ liệu tĩnh (AES-256 / AWS KMS)",
        },
        {
          value: "RBAC_ENFORCED",
          label: "Kiểm soát truy cập dựa trên vai trò (RBAC / Least Privilege)",
        },
        {
          value: "AUDIT_TRAIL",
          label: "Ghi nhật ký kiểm toán bất biến (Immutable Audit Trail / CloudTrail)",
        },
      ],
      status: "OPEN",
      checkpointId: null,
      resolvedFactId: null,
      answers: [],
      dependencies: [],
      factNeed: null,
    },
    // 4. Free-form Textarea
    {
      requestId: "00000000-0000-4000-9000-000000000004",
      requestRevision: 1,
      openedCaseRevision: 1,
      assessmentRuleId: "ER-DPO-CONTACT",
      criterionIds: ["CRIT-DPO-REGISTRATION"],
      question:
        "Vui lòng cung cấp thông tin liên hệ của Bộ phận Bảo vệ dữ liệu cá nhân (DPO) hoặc quy trình tiếp nhận yêu cầu xóa/chỉnh sửa dữ liệu của chủ thể dữ liệu (DSR):",
      unresolvedFact:
        "Không tìm thấy trang chính sách quyền riêng tư (Privacy Policy) công khai hoặc API xử lý quyền yêu cầu xóa dữ liệu.",
      decisionImpact: [
        "Hoàn tất hồ sơ đánh giá tuân thủ quyền của chủ thể dữ liệu theo Điều 9 & Điều 14 Nghị định 13/2023/NĐ-CP.",
      ],
      resolutionAttempts: [
        "Đã tìm kiếm các từ khóa 'dpo', 'privacy', 'gdpr', 'data-deletion' trong toàn bộ codebase.",
      ],
      controlType: "FREE_TEXT",
      choices: [],
      status: "OPEN",
      checkpointId: null,
      resolvedFactId: null,
      answers: [],
      dependencies: [],
      factNeed: null,
    },
    // 5. Resolved / Closed Turn
    {
      requestId: "00000000-0000-4000-9000-000000000005",
      requestRevision: 1,
      openedCaseRevision: 1,
      assessmentRuleId: "ER-CROSS-BORDER",
      criterionIds: ["CRIT-CROSS-BORDER-TRANSFER"],
      question:
        "Dịch vụ có thực hiện truyền đưa dữ liệu cá nhân của công dân Việt Nam ra máy chủ đặt tại nước ngoài không?",
      unresolvedFact:
        "Phát hiện endpoint gọi đến domain aws.us-east-1 trong notice-webhook.service.ts.",
      decisionImpact: [
        "Áp dụng Điều 25 Nghị định 13/2023/NĐ-CP về Đánh giá tác động chuyển dữ liệu cá nhân ra nước ngoài.",
      ],
      resolutionAttempts: [
        "Đã quét file cấu hình webhook và biến môi trường AWS_REGION.",
      ],
      controlType: "BOOLEAN",
      choices: [
        {
          value: "YES",
          label: "Có (Máy chủ đặt tại AWS Singapore / US)",
        },
        {
          value: "NO",
          label: "Không (Toàn bộ dữ liệu đặt tại Data Center Việt Nam)",
        },
      ],
      status: "RESOLVED",
      checkpointId: null,
      resolvedFactId: null,
      answers: [
        {
          idempotencyKey: "ans-cross-border-001",
          requestDigest: "c".repeat(64),
          actorId: "legaltech-lead",
          answeredAt: "2026-11-18T01:20:00.000Z",
          caseRevision: 1,
          requestRevision: 1,
          doesNotKnow: false,
          answer: "YES",
          selectedChoice: {
            value: "YES",
            label: "Có (Máy chủ đặt tại AWS Singapore / US)",
          },
        },
      ],
      dependencies: [],
      factNeed: null,
    },
  ],
});

const bundle = {
  detail: detailData,
  catalog: catalogData,
  library: libraryData,
  chunksDoc147: chunksDoc147Data,
  chunksDoc13: chunksDoc13Data,
  provenance: provenanceData,
  events: eventsData,
  repositorySetup: repositorySetupData,
  requests: requestsData,
};

const targetPath = resolve(
  import.meta.dirname,
  "../apps/web/src/public/assets/mocks/enterprise-legal-compliance-workspace.json",
);

writeFileSync(targetPath, JSON.stringify(bundle, null, 2), "utf8");
console.log("Successfully generated and validated mock bundle at:", targetPath);
