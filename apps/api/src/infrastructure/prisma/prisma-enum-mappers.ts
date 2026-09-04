import {
  AssessmentStatus as PrismaAssessmentStatus,
  AuditExportStatus as PrismaAuditExportStatus,
  AuditResourceType as PrismaAuditResourceType,
  AuthBackupEmailPolicy as PrismaAuthBackupEmailPolicy,
  AuthDecision as PrismaAuthDecision,
  AuthPrimaryEmailAddressPolicy as PrismaAuthPrimaryEmailAddressPolicy,
  AuthUserRole as PrismaAuthUserRole,
  AuthorizationReasonCode as PrismaAuthorizationReasonCode,
  ClassificationGuardrailStatus as PrismaClassificationGuardrailStatus,
  ConflictRecordStatus as PrismaConflictRecordStatus,
  DocumentRequestStatus as PrismaDocumentRequestStatus,
  DocumentType as PrismaDocumentType,
  EvidenceAcceptanceStatus as PrismaEvidenceAcceptanceStatus,
  LegalRuleMatchGuardrailStatus as PrismaLegalRuleMatchGuardrailStatus,
  LegalRuleLifecycleStatus as PrismaLegalRuleLifecycleStatus,
  OverallCoverageStatus as PrismaOverallCoverageStatus,
  OutboxAggregateType as PrismaOutboxAggregateType,
  OutboxStatus as PrismaOutboxStatus,
  RepositoryConnectionStatus as PrismaRepositoryConnectionStatus,
  RepositoryScanTriggerSource as PrismaRepositoryScanTriggerSource,
  RepositoryScanJobStatus as PrismaRepositoryScanJobStatus,
  RepositorySnapshotStatus as PrismaRepositorySnapshotStatus,
  VerifiedProfileStatus as PrismaVerifiedProfileStatus,
} from "@prisma/client";
import {
  ASSESSMENT_STATUS_CODES,
  type AssessmentStatusCode,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_EXPORT_STATUSES,
  AUDIT_DECISIONS,
  AUDIT_RESOURCE_TYPES,
  type AuditDecision,
  type AuditExportStatus,
  type AuditResourceType,
} from "@lcsp/contracts/audit";
import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_ERROR_CODES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  AUTH_USER_ROLES,
  type AuthBackupEmailPolicy,
  type AuthErrorCode,
  type AuthPrimaryEmailAddressPolicy,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import {
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_TYPES,
  type DocumentRequestStatus,
  type DocumentType,
} from "@lcsp/contracts/document";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  REPOSITORY_SNAPSHOT_STATUSES,
  type RepositoryConnectionStatus,
  type RepositoryScanJobStatus,
  type RepositoryScanTriggerSource,
  type RepositorySnapshotStatus,
} from "@lcsp/contracts/github-integration";
import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";
import type { LegalRuleLifecycleStatus } from "@lcsp/contracts/legal-rule-catalog";
import {
  OUTBOX_AGGREGATE_TYPES,
  type OutboxAggregateType,
  OUTBOX_STATUSES,
  type OutboxStatus,
} from "@lcsp/contracts/outbox";
import { RBAC_REASON_CODES, type RbacReasonCode } from "@lcsp/contracts/rbac";
import {
  CONFLICT_RECORD_STATUSES,
  CLASSIFICATION_GUARDRAIL_STATUSES,
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  OVERALL_COVERAGE_STATUSES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
  VERIFIED_PROFILE_STATUSES,
  type AIUsageFlowStatus,
  type ClassificationGuardrailStatus,
  type ClassificationResultStatus,
  type ConflictRecordStatus,
  type LegalRuleMatchGuardrailStatus,
  type LegalRuleMatchStatus,
  type OverallCoverageStatus,
  type TechnicalEvidenceReportStatus,
  type TechnicalProfileStatus,
  type VerifiedProfileStatus,
} from "@lcsp/contracts/scan";

type AuthorizationReasonCode = AuthErrorCode | RbacReasonCode;
type EvidenceAcceptanceContractStatus =
  | TechnicalEvidenceReportStatus
  | TechnicalProfileStatus
  | AIUsageFlowStatus
  | ClassificationResultStatus
  | LegalRuleMatchStatus;

const AUTH_BACKUP_EMAIL_POLICY_TO_PRISMA = {
  [AUTH_BACKUP_EMAIL_POLICIES.allVerified]:
    PrismaAuthBackupEmailPolicy.ALL_VERIFIED,
  [AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail]:
    PrismaAuthBackupEmailPolicy.RECOVERY_EMAIL,
} as const satisfies Record<AuthBackupEmailPolicy, PrismaAuthBackupEmailPolicy>;

const PRISMA_AUTH_BACKUP_EMAIL_POLICY_TO_CONTRACT = {
  [PrismaAuthBackupEmailPolicy.ALL_VERIFIED]:
    AUTH_BACKUP_EMAIL_POLICIES.allVerified,
  [PrismaAuthBackupEmailPolicy.RECOVERY_EMAIL]:
    AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail,
} as const satisfies Record<PrismaAuthBackupEmailPolicy, AuthBackupEmailPolicy>;

const AUTH_PRIMARY_EMAIL_ADDRESS_POLICY_TO_PRISMA = {
  [AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.accountEmail]:
    PrismaAuthPrimaryEmailAddressPolicy.ACCOUNT_EMAIL,
  [AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail]:
    PrismaAuthPrimaryEmailAddressPolicy.RECOVERY_EMAIL,
} as const satisfies Record<
  AuthPrimaryEmailAddressPolicy,
  PrismaAuthPrimaryEmailAddressPolicy
>;

const PRISMA_AUTH_PRIMARY_EMAIL_ADDRESS_POLICY_TO_CONTRACT = {
  [PrismaAuthPrimaryEmailAddressPolicy.ACCOUNT_EMAIL]:
    AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.accountEmail,
  [PrismaAuthPrimaryEmailAddressPolicy.RECOVERY_EMAIL]:
    AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail,
} as const satisfies Record<
  PrismaAuthPrimaryEmailAddressPolicy,
  AuthPrimaryEmailAddressPolicy
>;

const AUTH_DECISION_TO_PRISMA = {
  [AUDIT_DECISIONS.allow]: PrismaAuthDecision.ALLOW,
  [AUDIT_DECISIONS.deny]: PrismaAuthDecision.DENY,
} as const satisfies Record<AuditDecision, PrismaAuthDecision>;

const PRISMA_AUTH_DECISION_TO_CONTRACT = {
  [PrismaAuthDecision.ALLOW]: AUDIT_DECISIONS.allow,
  [PrismaAuthDecision.DENY]: AUDIT_DECISIONS.deny,
} as const satisfies Record<PrismaAuthDecision, AuditDecision>;

const ASSESSMENT_STATUS_TO_PRISMA = {
  [ASSESSMENT_STATUS_CODES.wizardInProgress]:
    PrismaAssessmentStatus.WIZARD_IN_PROGRESS,
  [ASSESSMENT_STATUS_CODES.wizardSubmitted]:
    PrismaAssessmentStatus.WIZARD_SUBMITTED,
  [ASSESSMENT_STATUS_CODES.evidenceRequired]:
    PrismaAssessmentStatus.EVIDENCE_REQUIRED,
  [ASSESSMENT_STATUS_CODES.scanInProgress]:
    PrismaAssessmentStatus.SCAN_IN_PROGRESS,
  [ASSESSMENT_STATUS_CODES.classificationLocked]:
    PrismaAssessmentStatus.CLASSIFICATION_LOCKED,
  [ASSESSMENT_STATUS_CODES.readyForReview]:
    PrismaAssessmentStatus.READY_FOR_REVIEW,
} as const satisfies Record<AssessmentStatusCode, PrismaAssessmentStatus>;

const PRISMA_ASSESSMENT_STATUS_TO_CONTRACT = {
  [PrismaAssessmentStatus.WIZARD_IN_PROGRESS]:
    ASSESSMENT_STATUS_CODES.wizardInProgress,
  [PrismaAssessmentStatus.WIZARD_SUBMITTED]:
    ASSESSMENT_STATUS_CODES.wizardSubmitted,
  [PrismaAssessmentStatus.EVIDENCE_REQUIRED]:
    ASSESSMENT_STATUS_CODES.evidenceRequired,
  [PrismaAssessmentStatus.SCAN_IN_PROGRESS]:
    ASSESSMENT_STATUS_CODES.scanInProgress,
  [PrismaAssessmentStatus.CLASSIFICATION_LOCKED]:
    ASSESSMENT_STATUS_CODES.classificationLocked,
  [PrismaAssessmentStatus.READY_FOR_REVIEW]:
    ASSESSMENT_STATUS_CODES.readyForReview,
} as const satisfies Record<PrismaAssessmentStatus, AssessmentStatusCode>;

const AUDIT_EXPORT_STATUS_TO_PRISMA = {
  [AUDIT_EXPORT_STATUSES.queued]: PrismaAuditExportStatus.QUEUED,
  [AUDIT_EXPORT_STATUSES.generating]: PrismaAuditExportStatus.GENERATING,
  [AUDIT_EXPORT_STATUSES.ready]: PrismaAuditExportStatus.READY,
  [AUDIT_EXPORT_STATUSES.failed]: PrismaAuditExportStatus.FAILED,
} as const satisfies Record<AuditExportStatus, PrismaAuditExportStatus>;

const PRISMA_AUDIT_EXPORT_STATUS_TO_CONTRACT = {
  [PrismaAuditExportStatus.QUEUED]: AUDIT_EXPORT_STATUSES.queued,
  [PrismaAuditExportStatus.GENERATING]: AUDIT_EXPORT_STATUSES.generating,
  [PrismaAuditExportStatus.READY]: AUDIT_EXPORT_STATUSES.ready,
  [PrismaAuditExportStatus.FAILED]: AUDIT_EXPORT_STATUSES.failed,
} as const satisfies Record<PrismaAuditExportStatus, AuditExportStatus>;

const AUTH_USER_ROLE_TO_PRISMA = {
  [AUTH_USER_ROLES.admin]: PrismaAuthUserRole.ADMIN,
  [AUTH_USER_ROLES.customer]: PrismaAuthUserRole.CUSTOMER,
} as const satisfies Record<AuthUserRole, PrismaAuthUserRole>;

const PRISMA_AUTH_USER_ROLE_TO_CONTRACT = {
  [PrismaAuthUserRole.ADMIN]: AUTH_USER_ROLES.admin,
  [PrismaAuthUserRole.CUSTOMER]: AUTH_USER_ROLES.customer,
} as const satisfies Record<PrismaAuthUserRole, AuthUserRole>;

const AUTHORIZATION_REASON_CODE_TO_PRISMA = {
  [AUTH_ERROR_CODES.accountNotFound]:
    PrismaAuthorizationReasonCode.ACCOUNT_NOT_FOUND,
  [RBAC_REASON_CODES.authorized]: PrismaAuthorizationReasonCode.AUTHORIZED,
  [AUTH_ERROR_CODES.authzEvaluatorFailure]:
    PrismaAuthorizationReasonCode.AUTHZ_EVALUATOR_FAILURE,
  [AUTH_ERROR_CODES.authzStateGateBlocked]:
    PrismaAuthorizationReasonCode.AUTHZ_STATE_GATE_BLOCKED,
  [AUTH_ERROR_CODES.authRequired]: PrismaAuthorizationReasonCode.AUTH_REQUIRED,
  [AUTH_ERROR_CODES.emailVerificationRequired]:
    PrismaAuthorizationReasonCode.EMAIL_VERIFICATION_REQUIRED,
  [AUTH_ERROR_CODES.invalidCredentials]:
    PrismaAuthorizationReasonCode.INVALID_CREDENTIALS,
  [AUTH_ERROR_CODES.invalidInviteState]:
    PrismaAuthorizationReasonCode.INVALID_INVITE_STATE,
  [AUTH_ERROR_CODES.invalidRedirectUri]:
    PrismaAuthorizationReasonCode.INVALID_REDIRECT_URI,
  [RBAC_REASON_CODES.loadError]: PrismaAuthorizationReasonCode.LOAD_ERROR,
  [AUTH_ERROR_CODES.mfaRequired]: PrismaAuthorizationReasonCode.MFA_REQUIRED,
  [AUTH_ERROR_CODES.mfaInvalid]: PrismaAuthorizationReasonCode.MFA_INVALID,
  [AUTH_ERROR_CODES.mfaRateLimited]:
    PrismaAuthorizationReasonCode.MFA_RATE_LIMITED,
  [AUTH_ERROR_CODES.oauthCallbackInvalid]:
    PrismaAuthorizationReasonCode.OAUTH_CALLBACK_INVALID,
  [AUTH_ERROR_CODES.oauthStateInvalid]:
    PrismaAuthorizationReasonCode.OAUTH_STATE_INVALID,
  [RBAC_REASON_CODES.denied]: PrismaAuthorizationReasonCode.RBAC_DENIED,
  [RBAC_REASON_CODES.metadataMissing]:
    PrismaAuthorizationReasonCode.RBAC_METADATA_MISSING,
  [AUTH_ERROR_CODES.reauthRequired]:
    PrismaAuthorizationReasonCode.REAUTH_REQUIRED,
  [AUTH_ERROR_CODES.recoveryInvalid]:
    PrismaAuthorizationReasonCode.RECOVERY_INVALID,
  [RBAC_REASON_CODES.sessionInvalid]:
    PrismaAuthorizationReasonCode.SESSION_INVALID,
  [AUTH_ERROR_CODES.temporaryLock]:
    PrismaAuthorizationReasonCode.TEMPORARY_LOCKED,
  [AUTH_ERROR_CODES.unsupportedProvider]:
    PrismaAuthorizationReasonCode.UNSUPPORTED_PROVIDER,
  [AUTH_ERROR_CODES.validationFailed]:
    PrismaAuthorizationReasonCode.VALIDATION_FAILED,
} as const satisfies Record<
  AuthorizationReasonCode,
  PrismaAuthorizationReasonCode
>;

const PRISMA_AUTHORIZATION_REASON_CODE_TO_CONTRACT = {
  [PrismaAuthorizationReasonCode.ACTION_NOT_GRANTED]: RBAC_REASON_CODES.denied,
  [PrismaAuthorizationReasonCode.ACCOUNT_NOT_FOUND]:
    AUTH_ERROR_CODES.accountNotFound,
  [PrismaAuthorizationReasonCode.AUTHORIZED]: RBAC_REASON_CODES.authorized,
  [PrismaAuthorizationReasonCode.AUTHZ_EVALUATOR_FAILURE]:
    AUTH_ERROR_CODES.authzEvaluatorFailure,
  [PrismaAuthorizationReasonCode.AUTHZ_STATE_GATE_BLOCKED]:
    AUTH_ERROR_CODES.authzStateGateBlocked,
  [PrismaAuthorizationReasonCode.AUTH_REQUIRED]: AUTH_ERROR_CODES.authRequired,
  [PrismaAuthorizationReasonCode.EMAIL_VERIFICATION_REQUIRED]:
    AUTH_ERROR_CODES.emailVerificationRequired,
  [PrismaAuthorizationReasonCode.EVALUATOR_ERROR]: RBAC_REASON_CODES.loadError,
  [PrismaAuthorizationReasonCode.INVALID_CREDENTIALS]:
    AUTH_ERROR_CODES.invalidCredentials,
  [PrismaAuthorizationReasonCode.INVALID_INVITE_STATE]:
    AUTH_ERROR_CODES.invalidInviteState,
  [PrismaAuthorizationReasonCode.INVALID_REDIRECT_URI]:
    AUTH_ERROR_CODES.invalidRedirectUri,
  [PrismaAuthorizationReasonCode.LOAD_ERROR]: RBAC_REASON_CODES.loadError,
  [PrismaAuthorizationReasonCode.MFA_REQUIRED]: AUTH_ERROR_CODES.mfaRequired,
  [PrismaAuthorizationReasonCode.MFA_INVALID]: AUTH_ERROR_CODES.mfaInvalid,
  [PrismaAuthorizationReasonCode.MFA_RATE_LIMITED]:
    AUTH_ERROR_CODES.mfaRateLimited,
  [PrismaAuthorizationReasonCode.OAUTH_CALLBACK_INVALID]:
    AUTH_ERROR_CODES.oauthCallbackInvalid,
  [PrismaAuthorizationReasonCode.OAUTH_STATE_INVALID]:
    AUTH_ERROR_CODES.oauthStateInvalid,
  [PrismaAuthorizationReasonCode.RBAC_DENIED]: RBAC_REASON_CODES.denied,
  [PrismaAuthorizationReasonCode.RBAC_METADATA_MISSING]:
    RBAC_REASON_CODES.metadataMissing,
  [PrismaAuthorizationReasonCode.REAUTH_REQUIRED]:
    AUTH_ERROR_CODES.reauthRequired,
  [PrismaAuthorizationReasonCode.RECOVERY_INVALID]:
    AUTH_ERROR_CODES.recoveryInvalid,
  [PrismaAuthorizationReasonCode.SESSION_INVALID]:
    RBAC_REASON_CODES.sessionInvalid,
  [PrismaAuthorizationReasonCode.STATE_GATE_FAILED]: RBAC_REASON_CODES.denied,
  [PrismaAuthorizationReasonCode.SUBJECT_ROLE_MISMATCH]:
    RBAC_REASON_CODES.denied,
  [PrismaAuthorizationReasonCode.TEMPORARY_LOCKED]:
    AUTH_ERROR_CODES.temporaryLock,
  [PrismaAuthorizationReasonCode.UNSUPPORTED_PROVIDER]:
    AUTH_ERROR_CODES.unsupportedProvider,
  [PrismaAuthorizationReasonCode.VALIDATION_FAILED]:
    AUTH_ERROR_CODES.validationFailed,
} as const satisfies Record<
  PrismaAuthorizationReasonCode,
  AuthorizationReasonCode
>;

const AUDIT_RESOURCE_TYPE_TO_PRISMA = {
  [AUDIT_RESOURCE_TYPES.aiUsageFlow]: PrismaAuditResourceType.AI_USAGE_FLOW,
  [AUDIT_RESOURCE_TYPES.assessment]: PrismaAuditResourceType.ASSESSMENT,
  [AUDIT_RESOURCE_TYPES.assessmentRecord]:
    PrismaAuditResourceType.ASSESSMENT_RECORD,
  [AUDIT_RESOURCE_TYPES.auditExportRequest]:
    PrismaAuditResourceType.AUDIT_EXPORT_REQUEST,
  [AUDIT_RESOURCE_TYPES.authInvitation]:
    PrismaAuditResourceType.AUTH_INVITATION,
  [AUDIT_RESOURCE_TYPES.authMfaRecoveryCode]:
    PrismaAuditResourceType.AUTH_MFA_RECOVERY_CODE,
  [AUDIT_RESOURCE_TYPES.authSession]: PrismaAuditResourceType.AUTH_SESSION,
  [AUDIT_RESOURCE_TYPES.classificationReviewRequest]:
    PrismaAuditResourceType.CLASSIFICATION_REVIEW_REQUEST,
  [AUDIT_RESOURCE_TYPES.classificationResult]:
    PrismaAuditResourceType.CLASSIFICATION_RESULT,
  [AUDIT_RESOURCE_TYPES.conflictRecord]:
    PrismaAuditResourceType.CONFLICT_RECORD,
  [AUDIT_RESOURCE_TYPES.documentRequest]:
    PrismaAuditResourceType.DOCUMENT_REQUEST,
  [AUDIT_RESOURCE_TYPES.githubAppInstallState]:
    PrismaAuditResourceType.GITHUB_APP_INSTALL_STATE,
  [AUDIT_RESOURCE_TYPES.httpRoute]: PrismaAuditResourceType.HTTP_ROUTE,
  [AUDIT_RESOURCE_TYPES.legalRule]: PrismaAuditResourceType.LEGAL_RULE,
  [AUDIT_RESOURCE_TYPES.legalRuleCatalogVersion]:
    PrismaAuditResourceType.LEGAL_RULE_CATALOG_VERSION,
  [AUDIT_RESOURCE_TYPES.legalRuleMatch]:
    PrismaAuditResourceType.LEGAL_RULE_MATCH,
  [AUDIT_RESOURCE_TYPES.outbox]: PrismaAuditResourceType.OUTBOX,
  [AUDIT_RESOURCE_TYPES.readinessExport]:
    PrismaAuditResourceType.READINESS_EXPORT,
  [AUDIT_RESOURCE_TYPES.repositoryConnection]:
    PrismaAuditResourceType.REPOSITORY_CONNECTION,
  [AUDIT_RESOURCE_TYPES.repositoryScanJob]:
    PrismaAuditResourceType.REPOSITORY_SCAN_JOB,
  [AUDIT_RESOURCE_TYPES.repositorySnapshot]:
    PrismaAuditResourceType.REPOSITORY_SNAPSHOT,
  [AUDIT_RESOURCE_TYPES.technicalEvidenceReport]:
    PrismaAuditResourceType.TECHNICAL_EVIDENCE_REPORT,
  [AUDIT_RESOURCE_TYPES.technicalProfile]:
    PrismaAuditResourceType.TECHNICAL_PROFILE,
  [AUDIT_RESOURCE_TYPES.verifiedProfile]:
    PrismaAuditResourceType.VERIFIED_PROFILE,
  [AUDIT_RESOURCE_TYPES.workerTask]: PrismaAuditResourceType.WORKER_TASK,
  [AUDIT_RESOURCE_TYPES.workspace]: PrismaAuditResourceType.WORKSPACE,
} as const satisfies Record<AuditResourceType, PrismaAuditResourceType>;

const PRISMA_AUDIT_RESOURCE_TYPE_TO_CONTRACT = {
  [PrismaAuditResourceType.AI_USAGE_FLOW]: AUDIT_RESOURCE_TYPES.aiUsageFlow,
  [PrismaAuditResourceType.ASSESSMENT]: AUDIT_RESOURCE_TYPES.assessment,
  [PrismaAuditResourceType.ASSESSMENT_RECORD]:
    AUDIT_RESOURCE_TYPES.assessmentRecord,
  [PrismaAuditResourceType.AUDIT_EXPORT_REQUEST]:
    AUDIT_RESOURCE_TYPES.auditExportRequest,
  [PrismaAuditResourceType.AUTH_INVITATION]:
    AUDIT_RESOURCE_TYPES.authInvitation,
  [PrismaAuditResourceType.AUTH_MFA_RECOVERY_CODE]:
    AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
  [PrismaAuditResourceType.AUTH_SESSION]: AUDIT_RESOURCE_TYPES.authSession,
  [PrismaAuditResourceType.CLASSIFICATION_REVIEW_REQUEST]:
    AUDIT_RESOURCE_TYPES.classificationReviewRequest,
  [PrismaAuditResourceType.CLASSIFICATION_RESULT]:
    AUDIT_RESOURCE_TYPES.classificationResult,
  [PrismaAuditResourceType.CONFLICT_RECORD]:
    AUDIT_RESOURCE_TYPES.conflictRecord,
  [PrismaAuditResourceType.DOCUMENT_REQUEST]:
    AUDIT_RESOURCE_TYPES.documentRequest,
  [PrismaAuditResourceType.GITHUB_APP_INSTALL_STATE]:
    AUDIT_RESOURCE_TYPES.githubAppInstallState,
  [PrismaAuditResourceType.HTTP_ROUTE]: AUDIT_RESOURCE_TYPES.httpRoute,
  [PrismaAuditResourceType.LEGAL_RULE]: AUDIT_RESOURCE_TYPES.legalRule,
  [PrismaAuditResourceType.LEGAL_RULE_CATALOG_VERSION]:
    AUDIT_RESOURCE_TYPES.legalRuleCatalogVersion,
  [PrismaAuditResourceType.LEGAL_RULE_MATCH]:
    AUDIT_RESOURCE_TYPES.legalRuleMatch,
  [PrismaAuditResourceType.OUTBOX]: AUDIT_RESOURCE_TYPES.outbox,
  [PrismaAuditResourceType.READINESS_EXPORT]:
    AUDIT_RESOURCE_TYPES.readinessExport,
  [PrismaAuditResourceType.REPOSITORY_CONNECTION]:
    AUDIT_RESOURCE_TYPES.repositoryConnection,
  [PrismaAuditResourceType.REPOSITORY_SCAN_JOB]:
    AUDIT_RESOURCE_TYPES.repositoryScanJob,
  [PrismaAuditResourceType.REPOSITORY_SNAPSHOT]:
    AUDIT_RESOURCE_TYPES.repositorySnapshot,
  [PrismaAuditResourceType.TECHNICAL_EVIDENCE_REPORT]:
    AUDIT_RESOURCE_TYPES.technicalEvidenceReport,
  [PrismaAuditResourceType.TECHNICAL_PROFILE]:
    AUDIT_RESOURCE_TYPES.technicalProfile,
  [PrismaAuditResourceType.VERIFIED_PROFILE]:
    AUDIT_RESOURCE_TYPES.verifiedProfile,
  [PrismaAuditResourceType.WORKER_TASK]: AUDIT_RESOURCE_TYPES.workerTask,
  [PrismaAuditResourceType.WORKSPACE]: AUDIT_RESOURCE_TYPES.workspace,
} as const satisfies Partial<
  Record<PrismaAuditResourceType, AuditResourceType>
>;

const OUTBOX_AGGREGATE_TYPE_TO_PRISMA = {
  [OUTBOX_AGGREGATE_TYPES.aiUsageFlow]: PrismaOutboxAggregateType.AI_USAGE_FLOW,
  [OUTBOX_AGGREGATE_TYPES.assessment]: PrismaOutboxAggregateType.ASSESSMENT,
  [OUTBOX_AGGREGATE_TYPES.authUser]: PrismaOutboxAggregateType.AUTH_USER,
  [OUTBOX_AGGREGATE_TYPES.classificationReviewRequest]:
    PrismaOutboxAggregateType.CLASSIFICATION_REVIEW_REQUEST,
  [OUTBOX_AGGREGATE_TYPES.classificationResult]:
    PrismaOutboxAggregateType.CLASSIFICATION_RESULT,
  [OUTBOX_AGGREGATE_TYPES.documentRequest]:
    PrismaOutboxAggregateType.DOCUMENT_REQUEST,
  [OUTBOX_AGGREGATE_TYPES.legalCorpusVersion]:
    PrismaOutboxAggregateType.LEGAL_CORPUS_VERSION,
  [OUTBOX_AGGREGATE_TYPES.legalRuleMatch]:
    PrismaOutboxAggregateType.LEGAL_RULE_MATCH,
  [OUTBOX_AGGREGATE_TYPES.repositoryScanJob]:
    PrismaOutboxAggregateType.REPOSITORY_SCAN_JOB,
  [OUTBOX_AGGREGATE_TYPES.repositorySnapshot]:
    PrismaOutboxAggregateType.REPOSITORY_SNAPSHOT,
  [OUTBOX_AGGREGATE_TYPES.technicalEvidenceReport]:
    PrismaOutboxAggregateType.TECHNICAL_EVIDENCE_REPORT,
  [OUTBOX_AGGREGATE_TYPES.technicalProfile]:
    PrismaOutboxAggregateType.TECHNICAL_PROFILE,
  [OUTBOX_AGGREGATE_TYPES.targetedReanalysisRequest]:
    PrismaOutboxAggregateType.TARGETED_REANALYSIS_REQUEST,
  [OUTBOX_AGGREGATE_TYPES.verifiedProfile]:
    PrismaOutboxAggregateType.VERIFIED_PROFILE,
} as const satisfies Record<OutboxAggregateType, PrismaOutboxAggregateType>;

const PRISMA_OUTBOX_AGGREGATE_TYPE_TO_CONTRACT = {
  [PrismaOutboxAggregateType.AI_USAGE_FLOW]: OUTBOX_AGGREGATE_TYPES.aiUsageFlow,
  [PrismaOutboxAggregateType.ASSESSMENT]: OUTBOX_AGGREGATE_TYPES.assessment,
  [PrismaOutboxAggregateType.AUTH_USER]: OUTBOX_AGGREGATE_TYPES.authUser,
  [PrismaOutboxAggregateType.CLASSIFICATION_REVIEW_REQUEST]:
    OUTBOX_AGGREGATE_TYPES.classificationReviewRequest,
  [PrismaOutboxAggregateType.CLASSIFICATION_RESULT]:
    OUTBOX_AGGREGATE_TYPES.classificationResult,
  [PrismaOutboxAggregateType.DOCUMENT_REQUEST]:
    OUTBOX_AGGREGATE_TYPES.documentRequest,
  [PrismaOutboxAggregateType.LEGAL_CORPUS_VERSION]:
    OUTBOX_AGGREGATE_TYPES.legalCorpusVersion,
  [PrismaOutboxAggregateType.LEGAL_RULE_MATCH]:
    OUTBOX_AGGREGATE_TYPES.legalRuleMatch,
  [PrismaOutboxAggregateType.REPOSITORY_SCAN_JOB]:
    OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
  [PrismaOutboxAggregateType.REPOSITORY_SNAPSHOT]:
    OUTBOX_AGGREGATE_TYPES.repositorySnapshot,
  [PrismaOutboxAggregateType.TECHNICAL_EVIDENCE_REPORT]:
    OUTBOX_AGGREGATE_TYPES.technicalEvidenceReport,
  [PrismaOutboxAggregateType.TECHNICAL_PROFILE]:
    OUTBOX_AGGREGATE_TYPES.technicalProfile,
  [PrismaOutboxAggregateType.TARGETED_REANALYSIS_REQUEST]:
    OUTBOX_AGGREGATE_TYPES.targetedReanalysisRequest,
  [PrismaOutboxAggregateType.VERIFIED_PROFILE]:
    OUTBOX_AGGREGATE_TYPES.verifiedProfile,
} as const satisfies Partial<
  Record<PrismaOutboxAggregateType, OutboxAggregateType>
>;

const OUTBOX_STATUS_TO_PRISMA = {
  [OUTBOX_STATUSES.pending]: PrismaOutboxStatus.PENDING,
  [OUTBOX_STATUSES.published]: PrismaOutboxStatus.PUBLISHED,
  [OUTBOX_STATUSES.failed]: PrismaOutboxStatus.FAILED,
  [OUTBOX_STATUSES.dlq]: PrismaOutboxStatus.DLQ,
} as const satisfies Record<OutboxStatus, PrismaOutboxStatus>;

const PRISMA_OUTBOX_STATUS_TO_CONTRACT = {
  [PrismaOutboxStatus.PENDING]: OUTBOX_STATUSES.pending,
  [PrismaOutboxStatus.PUBLISHED]: OUTBOX_STATUSES.published,
  [PrismaOutboxStatus.FAILED]: OUTBOX_STATUSES.failed,
  [PrismaOutboxStatus.DLQ]: OUTBOX_STATUSES.dlq,
} as const satisfies Record<PrismaOutboxStatus, OutboxStatus>;

const REPOSITORY_CONNECTION_STATUS_TO_PRISMA = {
  [REPOSITORY_CONNECTION_STATUSES.active]:
    PrismaRepositoryConnectionStatus.ACTIVE,
  [REPOSITORY_CONNECTION_STATUSES.revoked]:
    PrismaRepositoryConnectionStatus.REVOKED,
} as const satisfies Record<
  RepositoryConnectionStatus,
  PrismaRepositoryConnectionStatus
>;

const PRISMA_REPOSITORY_CONNECTION_STATUS_TO_CONTRACT = {
  [PrismaRepositoryConnectionStatus.ACTIVE]:
    REPOSITORY_CONNECTION_STATUSES.active,
  [PrismaRepositoryConnectionStatus.REVOKED]:
    REPOSITORY_CONNECTION_STATUSES.revoked,
} as const satisfies Record<
  PrismaRepositoryConnectionStatus,
  RepositoryConnectionStatus
>;

const REPOSITORY_SNAPSHOT_STATUS_TO_PRISMA = {
  [REPOSITORY_SNAPSHOT_STATUSES.ready]: PrismaRepositorySnapshotStatus.READY,
} as const satisfies Record<
  RepositorySnapshotStatus,
  PrismaRepositorySnapshotStatus
>;

const PRISMA_REPOSITORY_SNAPSHOT_STATUS_TO_CONTRACT = {
  [PrismaRepositorySnapshotStatus.READY]: REPOSITORY_SNAPSHOT_STATUSES.ready,
} as const satisfies Record<
  PrismaRepositorySnapshotStatus,
  RepositorySnapshotStatus
>;

const REPOSITORY_SCAN_TRIGGER_SOURCE_TO_PRISMA = {
  [REPOSITORY_SCAN_TRIGGER_SOURCES.manual]:
    PrismaRepositoryScanTriggerSource.MANUAL,
  [REPOSITORY_SCAN_TRIGGER_SOURCES.trusted]:
    PrismaRepositoryScanTriggerSource.TRUSTED,
} as const satisfies Record<
  RepositoryScanTriggerSource,
  PrismaRepositoryScanTriggerSource
>;

const PRISMA_REPOSITORY_SCAN_TRIGGER_SOURCE_TO_CONTRACT = {
  [PrismaRepositoryScanTriggerSource.MANUAL]:
    REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
  [PrismaRepositoryScanTriggerSource.TRUSTED]:
    REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
} as const satisfies Record<
  PrismaRepositoryScanTriggerSource,
  RepositoryScanTriggerSource
>;

const EVIDENCE_ACCEPTANCE_STATUS_TO_PRISMA = {
  [TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted]:
    PrismaEvidenceAcceptanceStatus.ACCEPTED,
  [TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected]:
    PrismaEvidenceAcceptanceStatus.REJECTED,
} as const satisfies Record<
  EvidenceAcceptanceContractStatus,
  PrismaEvidenceAcceptanceStatus
>;

const PRISMA_EVIDENCE_ACCEPTANCE_STATUS_TO_CONTRACT = {
  [PrismaEvidenceAcceptanceStatus.ACCEPTED]:
    TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
  [PrismaEvidenceAcceptanceStatus.REJECTED]:
    TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected,
} as const satisfies Record<
  PrismaEvidenceAcceptanceStatus,
  TechnicalEvidenceReportStatus
>;

const CLASSIFICATION_GUARDRAIL_STATUS_TO_PRISMA = {
  [CLASSIFICATION_GUARDRAIL_STATUSES.passed]:
    PrismaClassificationGuardrailStatus.PASSED,
  [CLASSIFICATION_GUARDRAIL_STATUSES.degraded]:
    PrismaClassificationGuardrailStatus.DEGRADED,
  [CLASSIFICATION_GUARDRAIL_STATUSES.blocked]:
    PrismaClassificationGuardrailStatus.BLOCKED,
} as const satisfies Record<
  ClassificationGuardrailStatus,
  PrismaClassificationGuardrailStatus
>;

const PRISMA_CLASSIFICATION_GUARDRAIL_STATUS_TO_CONTRACT = {
  [PrismaClassificationGuardrailStatus.PASSED]:
    CLASSIFICATION_GUARDRAIL_STATUSES.passed,
  [PrismaClassificationGuardrailStatus.DEGRADED]:
    CLASSIFICATION_GUARDRAIL_STATUSES.degraded,
  [PrismaClassificationGuardrailStatus.BLOCKED]:
    CLASSIFICATION_GUARDRAIL_STATUSES.blocked,
} as const satisfies Record<
  PrismaClassificationGuardrailStatus,
  ClassificationGuardrailStatus
>;

const LEGAL_RULE_MATCH_GUARDRAIL_STATUS_TO_PRISMA = {
  [LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed]:
    PrismaLegalRuleMatchGuardrailStatus.PASSED,
  [LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked]:
    PrismaLegalRuleMatchGuardrailStatus.BLOCKED,
} as const satisfies Record<
  LegalRuleMatchGuardrailStatus,
  PrismaLegalRuleMatchGuardrailStatus
>;

const PRISMA_LEGAL_RULE_MATCH_GUARDRAIL_STATUS_TO_CONTRACT = {
  [PrismaLegalRuleMatchGuardrailStatus.PASSED]:
    LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
  [PrismaLegalRuleMatchGuardrailStatus.BLOCKED]:
    LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked,
} as const satisfies Record<
  PrismaLegalRuleMatchGuardrailStatus,
  LegalRuleMatchGuardrailStatus
>;

const REPOSITORY_SCAN_JOB_STATUS_TO_PRISMA = {
  [REPOSITORY_SCAN_JOB_STATUSES.queued]: PrismaRepositoryScanJobStatus.QUEUED,
  [REPOSITORY_SCAN_JOB_STATUSES.running]: PrismaRepositoryScanJobStatus.RUNNING,
  [REPOSITORY_SCAN_JOB_STATUSES.completed]:
    PrismaRepositoryScanJobStatus.COMPLETED,
  [REPOSITORY_SCAN_JOB_STATUSES.failed]: PrismaRepositoryScanJobStatus.FAILED,
  [REPOSITORY_SCAN_JOB_STATUSES.blocked]: PrismaRepositoryScanJobStatus.BLOCKED,
  [REPOSITORY_SCAN_JOB_STATUSES.pendingMapping]:
    PrismaRepositoryScanJobStatus.PENDING_MAPPING,
  [REPOSITORY_SCAN_JOB_STATUSES.blockedMapping]:
    PrismaRepositoryScanJobStatus.BLOCKED_MAPPING,
  [REPOSITORY_SCAN_JOB_STATUSES.waitingForContext]:
    PrismaRepositoryScanJobStatus.WAITING_FOR_CONTEXT,
  [REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot]:
    PrismaRepositoryScanJobStatus.READY_TO_SNAPSHOT,
} as const satisfies Record<
  RepositoryScanJobStatus,
  PrismaRepositoryScanJobStatus
>;

const PRISMA_REPOSITORY_SCAN_JOB_STATUS_TO_CONTRACT = {
  [PrismaRepositoryScanJobStatus.QUEUED]: REPOSITORY_SCAN_JOB_STATUSES.queued,
  [PrismaRepositoryScanJobStatus.RUNNING]: REPOSITORY_SCAN_JOB_STATUSES.running,
  [PrismaRepositoryScanJobStatus.COMPLETED]:
    REPOSITORY_SCAN_JOB_STATUSES.completed,
  [PrismaRepositoryScanJobStatus.FAILED]: REPOSITORY_SCAN_JOB_STATUSES.failed,
  [PrismaRepositoryScanJobStatus.BLOCKED]: REPOSITORY_SCAN_JOB_STATUSES.blocked,
  [PrismaRepositoryScanJobStatus.PENDING_MAPPING]:
    REPOSITORY_SCAN_JOB_STATUSES.pendingMapping,
  [PrismaRepositoryScanJobStatus.BLOCKED_MAPPING]:
    REPOSITORY_SCAN_JOB_STATUSES.blockedMapping,
  [PrismaRepositoryScanJobStatus.WAITING_FOR_CONTEXT]:
    REPOSITORY_SCAN_JOB_STATUSES.waitingForContext,
  [PrismaRepositoryScanJobStatus.READY_TO_SNAPSHOT]:
    REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot,
} as const satisfies Record<
  PrismaRepositoryScanJobStatus,
  RepositoryScanJobStatus
>;

const CONFLICT_RECORD_STATUS_TO_PRISMA = {
  [CONFLICT_RECORD_STATUSES.pending]: PrismaConflictRecordStatus.PENDING,
  [CONFLICT_RECORD_STATUSES.resolved]: PrismaConflictRecordStatus.RESOLVED,
  [CONFLICT_RECORD_STATUSES.dismissed]: PrismaConflictRecordStatus.DISMISSED,
} as const satisfies Record<ConflictRecordStatus, PrismaConflictRecordStatus>;

const PRISMA_CONFLICT_RECORD_STATUS_TO_CONTRACT = {
  [PrismaConflictRecordStatus.PENDING]: CONFLICT_RECORD_STATUSES.pending,
  [PrismaConflictRecordStatus.RESOLVED]: CONFLICT_RECORD_STATUSES.resolved,
  [PrismaConflictRecordStatus.DISMISSED]: CONFLICT_RECORD_STATUSES.dismissed,
} as const satisfies Record<PrismaConflictRecordStatus, ConflictRecordStatus>;

const VERIFIED_PROFILE_STATUS_TO_PRISMA = {
  [VERIFIED_PROFILE_STATUSES.pendingApproval]:
    PrismaVerifiedProfileStatus.PENDING_APPROVAL,
  [VERIFIED_PROFILE_STATUSES.approved]: PrismaVerifiedProfileStatus.APPROVED,
  [VERIFIED_PROFILE_STATUSES.autoApproved]:
    PrismaVerifiedProfileStatus.AUTO_APPROVED,
  [VERIFIED_PROFILE_STATUSES.stale]: PrismaVerifiedProfileStatus.STALE,
} as const satisfies Record<VerifiedProfileStatus, PrismaVerifiedProfileStatus>;

const PRISMA_VERIFIED_PROFILE_STATUS_TO_CONTRACT = {
  [PrismaVerifiedProfileStatus.PENDING_APPROVAL]:
    VERIFIED_PROFILE_STATUSES.pendingApproval,
  [PrismaVerifiedProfileStatus.APPROVED]: VERIFIED_PROFILE_STATUSES.approved,
  [PrismaVerifiedProfileStatus.AUTO_APPROVED]:
    VERIFIED_PROFILE_STATUSES.autoApproved,
  [PrismaVerifiedProfileStatus.STALE]: VERIFIED_PROFILE_STATUSES.stale,
} as const satisfies Record<PrismaVerifiedProfileStatus, VerifiedProfileStatus>;

const DOCUMENT_REQUEST_STATUS_TO_PRISMA = {
  [DOCUMENT_REQUEST_STATUSES.queued]: PrismaDocumentRequestStatus.QUEUED,
  [DOCUMENT_REQUEST_STATUSES.generating]:
    PrismaDocumentRequestStatus.GENERATING,
  [DOCUMENT_REQUEST_STATUSES.ready]: PrismaDocumentRequestStatus.READY,
  [DOCUMENT_REQUEST_STATUSES.failed]: PrismaDocumentRequestStatus.FAILED,
  [DOCUMENT_REQUEST_STATUSES.blocked]: PrismaDocumentRequestStatus.BLOCKED,
} as const satisfies Record<DocumentRequestStatus, PrismaDocumentRequestStatus>;

const PRISMA_DOCUMENT_REQUEST_STATUS_TO_CONTRACT = {
  [PrismaDocumentRequestStatus.QUEUED]: DOCUMENT_REQUEST_STATUSES.queued,
  [PrismaDocumentRequestStatus.GENERATING]:
    DOCUMENT_REQUEST_STATUSES.generating,
  [PrismaDocumentRequestStatus.READY]: DOCUMENT_REQUEST_STATUSES.ready,
  [PrismaDocumentRequestStatus.FAILED]: DOCUMENT_REQUEST_STATUSES.failed,
  [PrismaDocumentRequestStatus.BLOCKED]: DOCUMENT_REQUEST_STATUSES.blocked,
} as const satisfies Record<PrismaDocumentRequestStatus, DocumentRequestStatus>;

const DOCUMENT_TYPE_TO_PRISMA = {
  [DOCUMENT_TYPES.finalReport]: PrismaDocumentType.FINAL_REPORT,
  [DOCUMENT_TYPES.gapAnalysis]: PrismaDocumentType.GAP_ANALYSIS,
  [DOCUMENT_TYPES.readinessExport]: PrismaDocumentType.READINESS_EXPORT,
} as const satisfies Record<DocumentType, PrismaDocumentType>;

const PRISMA_DOCUMENT_TYPE_TO_CONTRACT = {
  [PrismaDocumentType.FINAL_REPORT]: DOCUMENT_TYPES.finalReport,
  [PrismaDocumentType.GAP_ANALYSIS]: DOCUMENT_TYPES.gapAnalysis,
  [PrismaDocumentType.READINESS_EXPORT]: DOCUMENT_TYPES.readinessExport,
} as const satisfies Record<PrismaDocumentType, DocumentType>;

const OVERALL_COVERAGE_STATUS_TO_PRISMA = {
  [OVERALL_COVERAGE_STATUSES.noCitation]:
    PrismaOverallCoverageStatus.NO_CITATION,
  [OVERALL_COVERAGE_STATUSES.partialCitation]:
    PrismaOverallCoverageStatus.PARTIAL_CITATION,
  [OVERALL_COVERAGE_STATUSES.completeCitation]:
    PrismaOverallCoverageStatus.COMPLETE_CITATION,
} as const satisfies Record<OverallCoverageStatus, PrismaOverallCoverageStatus>;

const PRISMA_OVERALL_COVERAGE_STATUS_TO_CONTRACT = {
  [PrismaOverallCoverageStatus.NO_CITATION]:
    OVERALL_COVERAGE_STATUSES.noCitation,
  [PrismaOverallCoverageStatus.PARTIAL_CITATION]:
    OVERALL_COVERAGE_STATUSES.partialCitation,
  [PrismaOverallCoverageStatus.COMPLETE_CITATION]:
    OVERALL_COVERAGE_STATUSES.completeCitation,
} as const satisfies Record<PrismaOverallCoverageStatus, OverallCoverageStatus>;

const LEGAL_RULE_LIFECYCLE_STATUS_TO_PRISMA = {
  [LEGAL_RULE_LIFECYCLE_STATUSES.draft]: PrismaLegalRuleLifecycleStatus.DRAFT,
  [LEGAL_RULE_LIFECYCLE_STATUSES.approved]:
    PrismaLegalRuleLifecycleStatus.APPROVED,
  [LEGAL_RULE_LIFECYCLE_STATUSES.rejected]:
    PrismaLegalRuleLifecycleStatus.REJECTED,
  [LEGAL_RULE_LIFECYCLE_STATUSES.superseded]:
    PrismaLegalRuleLifecycleStatus.SUPERSEDED,
} as const satisfies Record<
  LegalRuleLifecycleStatus,
  PrismaLegalRuleLifecycleStatus
>;

const PRISMA_LEGAL_RULE_LIFECYCLE_STATUS_TO_CONTRACT = {
  [PrismaLegalRuleLifecycleStatus.DRAFT]: LEGAL_RULE_LIFECYCLE_STATUSES.draft,
  [PrismaLegalRuleLifecycleStatus.APPROVED]:
    LEGAL_RULE_LIFECYCLE_STATUSES.approved,
  [PrismaLegalRuleLifecycleStatus.REJECTED]:
    LEGAL_RULE_LIFECYCLE_STATUSES.rejected,
  [PrismaLegalRuleLifecycleStatus.SUPERSEDED]:
    LEGAL_RULE_LIFECYCLE_STATUSES.superseded,
} as const satisfies Record<
  PrismaLegalRuleLifecycleStatus,
  LegalRuleLifecycleStatus
>;

/** Maps a document-request status from the contract layer to Prisma. @param status - Contract status. @returns Prisma status. */
export function toPrismaDocumentRequestStatus(
  status: DocumentRequestStatus,
): PrismaDocumentRequestStatus {
  return DOCUMENT_REQUEST_STATUS_TO_PRISMA[status];
}

/** Maps a document-request status from Prisma to the contract layer. @param status - Prisma status. @returns Contract status. */
export function fromPrismaDocumentRequestStatus(
  status: PrismaDocumentRequestStatus,
): DocumentRequestStatus {
  return PRISMA_DOCUMENT_REQUEST_STATUS_TO_CONTRACT[status];
}

/** Maps a document type from the contract layer to Prisma. @param documentType - Contract document type. @returns Prisma document type. */
export function toPrismaDocumentType(
  documentType: DocumentType,
): PrismaDocumentType {
  return DOCUMENT_TYPE_TO_PRISMA[documentType];
}

/** Maps a document type from Prisma to the contract layer. @param documentType - Prisma document type. @returns Contract document type. */
export function fromPrismaDocumentType(
  documentType: PrismaDocumentType,
): DocumentType {
  return PRISMA_DOCUMENT_TYPE_TO_CONTRACT[documentType];
}

/** Maps overall evidence coverage status from the contract layer to Prisma. @param status - Contract coverage status. @returns Prisma coverage status. */
export function toPrismaOverallCoverageStatus(
  status: OverallCoverageStatus,
): PrismaOverallCoverageStatus {
  return OVERALL_COVERAGE_STATUS_TO_PRISMA[status];
}

/** Maps overall evidence coverage status from Prisma to the contract layer. @param status - Prisma coverage status. @returns Contract coverage status. */
export function fromPrismaOverallCoverageStatus(
  status: PrismaOverallCoverageStatus,
): OverallCoverageStatus {
  return PRISMA_OVERALL_COVERAGE_STATUS_TO_CONTRACT[status];
}

/** Maps legal-rule lifecycle status from the contract layer to Prisma. @param status - Contract lifecycle status. @returns Prisma lifecycle status. */
export function toPrismaLegalRuleLifecycleStatus(
  status: LegalRuleLifecycleStatus,
): PrismaLegalRuleLifecycleStatus {
  return LEGAL_RULE_LIFECYCLE_STATUS_TO_PRISMA[status];
}

/** Maps legal-rule lifecycle status from Prisma to the contract layer. @param status - Prisma lifecycle status. @returns Contract lifecycle status. */
export function fromPrismaLegalRuleLifecycleStatus(
  status: PrismaLegalRuleLifecycleStatus,
): LegalRuleLifecycleStatus {
  return PRISMA_LEGAL_RULE_LIFECYCLE_STATUS_TO_CONTRACT[status];
}

/** Maps assessment status from the contract layer to Prisma. @param status - Contract assessment status. @returns Prisma assessment status. */
export function toPrismaAssessmentStatus(
  status: AssessmentStatusCode,
): PrismaAssessmentStatus {
  return ASSESSMENT_STATUS_TO_PRISMA[status];
}

/** Maps assessment status from Prisma to the contract layer. @param status - Prisma assessment status. @returns Contract assessment status. */
export function fromPrismaAssessmentStatus(
  status: PrismaAssessmentStatus,
): AssessmentStatusCode {
  return PRISMA_ASSESSMENT_STATUS_TO_CONTRACT[status];
}

/** Maps audit-export status from the contract layer to Prisma. @param status - Contract audit-export status. @returns Prisma audit-export status. */
export function toPrismaAuditExportStatus(
  status: AuditExportStatus,
): PrismaAuditExportStatus {
  return AUDIT_EXPORT_STATUS_TO_PRISMA[status];
}

/** Maps audit-export status from Prisma to the contract layer. @param status - Prisma audit-export status. @returns Contract audit-export status. */
export function fromPrismaAuditExportStatus(
  status: PrismaAuditExportStatus,
): AuditExportStatus {
  return PRISMA_AUDIT_EXPORT_STATUS_TO_CONTRACT[status];
}

/** Maps an authorization reason code from the contract layer to Prisma. @param reasonCode - Contract auth/RBAC reason code. @returns Prisma authorization reason code. */
export function toPrismaAuthorizationReasonCode(
  reasonCode: AuthorizationReasonCode,
): PrismaAuthorizationReasonCode {
  return AUTHORIZATION_REASON_CODE_TO_PRISMA[reasonCode];
}

/** Maps an authorization reason code from Prisma to the contract layer. @param reasonCode - Prisma authorization reason code. @returns Contract auth/RBAC reason code. */
export function fromPrismaAuthorizationReasonCode(
  reasonCode: PrismaAuthorizationReasonCode,
): AuthorizationReasonCode {
  return PRISMA_AUTHORIZATION_REASON_CODE_TO_CONTRACT[reasonCode];
}

export function toPrismaAuthUserRole(role: AuthUserRole): PrismaAuthUserRole {
  return AUTH_USER_ROLE_TO_PRISMA[role];
}

export function fromPrismaAuthUserRole(role: PrismaAuthUserRole): AuthUserRole {
  return PRISMA_AUTH_USER_ROLE_TO_CONTRACT[role];
}

/** Maps an audit resource type from the contract layer to Prisma. @param resourceType - Contract audit resource type. @returns Prisma audit resource type. */
export function toPrismaAuditResourceType(
  resourceType: AuditResourceType,
): PrismaAuditResourceType {
  return AUDIT_RESOURCE_TYPE_TO_PRISMA[resourceType];
}

/** Maps an audit resource type from Prisma to the contract layer. @param resourceType - Prisma audit resource type. @returns Contract audit resource type. */
export function fromPrismaAuditResourceType(
  resourceType: PrismaAuditResourceType,
): AuditResourceType {
  const mapped = PRISMA_AUDIT_RESOURCE_TYPE_TO_CONTRACT[resourceType];
  if (!mapped) {
    throw new Error(`Unsupported legacy audit resource type: ${resourceType}`);
  }
  return mapped;
}

/** Maps an outbox aggregate type from the contract layer to Prisma. @param aggregateType - Contract outbox aggregate type. @returns Prisma aggregate type. */
export function toPrismaOutboxAggregateType(
  aggregateType: OutboxAggregateType,
): PrismaOutboxAggregateType {
  return OUTBOX_AGGREGATE_TYPE_TO_PRISMA[aggregateType];
}

/** Maps an outbox aggregate type from Prisma to the contract layer. @param aggregateType - Prisma outbox aggregate type. @returns Contract aggregate type. */
export function fromPrismaOutboxAggregateType(
  aggregateType: PrismaOutboxAggregateType,
): OutboxAggregateType {
  const mapped = PRISMA_OUTBOX_AGGREGATE_TYPE_TO_CONTRACT[aggregateType];
  if (!mapped) {
    throw new Error(
      `Unsupported legacy outbox aggregate type: ${aggregateType}`,
    );
  }
  return mapped;
}

/** Maps outbox delivery status from the contract layer to Prisma. @param status - Contract outbox status. @returns Prisma outbox status. */
export function toPrismaOutboxStatus(status: OutboxStatus): PrismaOutboxStatus {
  return OUTBOX_STATUS_TO_PRISMA[status];
}

/** Maps outbox delivery status from Prisma to the contract layer. @param status - Prisma outbox status. @returns Contract outbox status. */
export function fromPrismaOutboxStatus(
  status: PrismaOutboxStatus,
): OutboxStatus {
  return PRISMA_OUTBOX_STATUS_TO_CONTRACT[status];
}

/** Maps repository scan-job status from the contract layer to Prisma. @param status - Contract scan-job status. @returns Prisma scan-job status. */
export function toPrismaRepositoryScanJobStatus(
  status: RepositoryScanJobStatus,
): PrismaRepositoryScanJobStatus {
  return REPOSITORY_SCAN_JOB_STATUS_TO_PRISMA[status];
}

/** Maps repository scan-job status from Prisma to the contract layer. @param status - Prisma scan-job status. @returns Contract scan-job status. */
export function fromPrismaRepositoryScanJobStatus(
  status: PrismaRepositoryScanJobStatus,
): RepositoryScanJobStatus {
  return PRISMA_REPOSITORY_SCAN_JOB_STATUS_TO_CONTRACT[status];
}

/** Maps conflict-record status from the contract layer to Prisma. @param status - Contract conflict status. @returns Prisma conflict status. */
export function toPrismaConflictRecordStatus(
  status: ConflictRecordStatus,
): PrismaConflictRecordStatus {
  return CONFLICT_RECORD_STATUS_TO_PRISMA[status];
}

/** Maps conflict-record status from Prisma to the contract layer. @param status - Prisma conflict status. @returns Contract conflict status. */
export function fromPrismaConflictRecordStatus(
  status: PrismaConflictRecordStatus,
): ConflictRecordStatus {
  return PRISMA_CONFLICT_RECORD_STATUS_TO_CONTRACT[status];
}

/** Maps verified-profile status from the contract layer to Prisma. @param status - Contract verified-profile status. @returns Prisma verified-profile status. */
export function toPrismaVerifiedProfileStatus(
  status: VerifiedProfileStatus,
): PrismaVerifiedProfileStatus {
  return VERIFIED_PROFILE_STATUS_TO_PRISMA[status];
}

/** Maps verified-profile status from Prisma to the contract layer. @param status - Prisma verified-profile status. @returns Contract verified-profile status. */
export function fromPrismaVerifiedProfileStatus(
  status: PrismaVerifiedProfileStatus,
): VerifiedProfileStatus {
  return PRISMA_VERIFIED_PROFILE_STATUS_TO_CONTRACT[status];
}

/** Maps backup-email policy from the contract layer to Prisma. @param policy - Contract backup-email policy. @returns Prisma backup-email policy. */
export function toPrismaAuthBackupEmailPolicy(
  policy: AuthBackupEmailPolicy,
): PrismaAuthBackupEmailPolicy {
  return AUTH_BACKUP_EMAIL_POLICY_TO_PRISMA[policy];
}

/** Maps backup-email policy from Prisma to the contract layer. @param policy - Prisma backup-email policy. @returns Contract backup-email policy. */
export function fromPrismaAuthBackupEmailPolicy(
  policy: PrismaAuthBackupEmailPolicy,
): AuthBackupEmailPolicy {
  return PRISMA_AUTH_BACKUP_EMAIL_POLICY_TO_CONTRACT[policy];
}

/** Maps primary-email address policy from the contract layer to Prisma. @param policy - Contract primary-email policy. @returns Prisma primary-email policy. */
export function toPrismaAuthPrimaryEmailAddressPolicy(
  policy: AuthPrimaryEmailAddressPolicy,
): PrismaAuthPrimaryEmailAddressPolicy {
  return AUTH_PRIMARY_EMAIL_ADDRESS_POLICY_TO_PRISMA[policy];
}

/** Maps primary-email address policy from Prisma to the contract layer. @param policy - Prisma primary-email policy. @returns Contract primary-email policy. */
export function fromPrismaAuthPrimaryEmailAddressPolicy(
  policy: PrismaAuthPrimaryEmailAddressPolicy,
): AuthPrimaryEmailAddressPolicy {
  return PRISMA_AUTH_PRIMARY_EMAIL_ADDRESS_POLICY_TO_CONTRACT[policy];
}

/** Maps an audit authorization decision from the contract layer to Prisma. @param decision - Contract audit decision. @returns Prisma auth decision. */
export function toPrismaAuthDecision(
  decision: AuditDecision,
): PrismaAuthDecision {
  return AUTH_DECISION_TO_PRISMA[decision];
}

/** Maps an authorization decision from Prisma to the audit contract. @param decision - Prisma auth decision. @returns Contract audit decision. */
export function fromPrismaAuthDecision(
  decision: PrismaAuthDecision,
): AuditDecision {
  return PRISMA_AUTH_DECISION_TO_CONTRACT[decision];
}

/** Maps repository-connection status from the contract layer to Prisma. @param status - Contract repository-connection status. @returns Prisma repository-connection status. */
export function toPrismaRepositoryConnectionStatus(
  status: RepositoryConnectionStatus,
): PrismaRepositoryConnectionStatus {
  return REPOSITORY_CONNECTION_STATUS_TO_PRISMA[status];
}

/** Maps repository-connection status from Prisma to the contract layer. @param status - Prisma repository-connection status. @returns Contract repository-connection status. */
export function fromPrismaRepositoryConnectionStatus(
  status: PrismaRepositoryConnectionStatus,
): RepositoryConnectionStatus {
  return PRISMA_REPOSITORY_CONNECTION_STATUS_TO_CONTRACT[status];
}

/** Maps repository-snapshot status from the contract layer to Prisma. @param status - Contract repository-snapshot status. @returns Prisma repository-snapshot status. */
export function toPrismaRepositorySnapshotStatus(
  status: RepositorySnapshotStatus,
): PrismaRepositorySnapshotStatus {
  return REPOSITORY_SNAPSHOT_STATUS_TO_PRISMA[status];
}

/** Maps repository-snapshot status from Prisma to the contract layer. @param status - Prisma repository-snapshot status. @returns Contract repository-snapshot status. */
export function fromPrismaRepositorySnapshotStatus(
  status: PrismaRepositorySnapshotStatus,
): RepositorySnapshotStatus {
  return PRISMA_REPOSITORY_SNAPSHOT_STATUS_TO_CONTRACT[status];
}

/** Maps scan trigger source from the contract layer to Prisma. @param source - Contract scan trigger source. @returns Prisma scan trigger source. */
export function toPrismaRepositoryScanTriggerSource(
  source: RepositoryScanTriggerSource,
): PrismaRepositoryScanTriggerSource {
  return REPOSITORY_SCAN_TRIGGER_SOURCE_TO_PRISMA[source];
}

/** Maps scan trigger source from Prisma to the contract layer. @param source - Prisma scan trigger source. @returns Contract scan trigger source. */
export function fromPrismaRepositoryScanTriggerSource(
  source: PrismaRepositoryScanTriggerSource,
): RepositoryScanTriggerSource {
  return PRISMA_REPOSITORY_SCAN_TRIGGER_SOURCE_TO_CONTRACT[source];
}

/** Maps an evidence-acceptance-compatible contract status to Prisma. @param status - Contract acceptance/rejection status. @returns Prisma evidence acceptance status. */
export function toPrismaEvidenceAcceptanceStatus(
  status: EvidenceAcceptanceContractStatus,
): PrismaEvidenceAcceptanceStatus {
  return EVIDENCE_ACCEPTANCE_STATUS_TO_PRISMA[status];
}

/** Maps Prisma evidence acceptance status to the technical-evidence contract status. @param status - Prisma evidence acceptance status. @returns Contract evidence status. */
export function fromPrismaEvidenceAcceptanceStatus(
  status: PrismaEvidenceAcceptanceStatus,
): TechnicalEvidenceReportStatus {
  return PRISMA_EVIDENCE_ACCEPTANCE_STATUS_TO_CONTRACT[status];
}

/** Maps classification guardrail status from the contract layer to Prisma. @param status - Contract classification guardrail status. @returns Prisma guardrail status. */
export function toPrismaClassificationGuardrailStatus(
  status: ClassificationGuardrailStatus,
): PrismaClassificationGuardrailStatus {
  return CLASSIFICATION_GUARDRAIL_STATUS_TO_PRISMA[status];
}

/** Maps classification guardrail status from Prisma to the contract layer. @param status - Prisma classification guardrail status. @returns Contract guardrail status. */
export function fromPrismaClassificationGuardrailStatus(
  status: PrismaClassificationGuardrailStatus,
): ClassificationGuardrailStatus {
  return PRISMA_CLASSIFICATION_GUARDRAIL_STATUS_TO_CONTRACT[status];
}

/** Maps legal-rule-match guardrail status from the contract layer to Prisma. @param status - Contract legal-rule guardrail status. @returns Prisma guardrail status. */
export function toPrismaLegalRuleMatchGuardrailStatus(
  status: LegalRuleMatchGuardrailStatus,
): PrismaLegalRuleMatchGuardrailStatus {
  return LEGAL_RULE_MATCH_GUARDRAIL_STATUS_TO_PRISMA[status];
}

/** Maps legal-rule-match guardrail status from Prisma to the contract layer. @param status - Prisma legal-rule guardrail status. @returns Contract guardrail status. */
export function fromPrismaLegalRuleMatchGuardrailStatus(
  status: PrismaLegalRuleMatchGuardrailStatus,
): LegalRuleMatchGuardrailStatus {
  return PRISMA_LEGAL_RULE_MATCH_GUARDRAIL_STATUS_TO_CONTRACT[status];
}
