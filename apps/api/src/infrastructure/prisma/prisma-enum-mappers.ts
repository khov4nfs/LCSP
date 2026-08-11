import {
  AssessmentStatus as PrismaAssessmentStatus,
  AuditExportStatus as PrismaAuditExportStatus,
  AuditResourceType as PrismaAuditResourceType,
  AuthBackupEmailPolicy as PrismaAuthBackupEmailPolicy,
  AuthDecision as PrismaAuthDecision,
  AuthInvitationState as PrismaAuthInvitationState,
  AuthMembershipStatus as PrismaAuthMembershipStatus,
  AuthPrimaryEmailAddressPolicy as PrismaAuthPrimaryEmailAddressPolicy,
  AuthStateGate as PrismaAuthStateGate,
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
  ReadinessExportStatus as PrismaReadinessExportStatus,
  RepositoryConnectionStatus as PrismaRepositoryConnectionStatus,
  RepositoryScanTriggerSource as PrismaRepositoryScanTriggerSource,
  RepositoryScanJobStatus as PrismaRepositoryScanJobStatus,
  RepositorySnapshotStatus as PrismaRepositorySnapshotStatus,
  VerifiedProfileStatus as PrismaVerifiedProfileStatus,
  WizardProfileStatus as PrismaWizardProfileStatus,
} from "@prisma/client";
import {
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
  type AssessmentStatusCode,
  type PersistedWizardStatusCode,
  type WizardStatusCode,
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
  AUTH_INVITATION_STATES,
  AUTH_MEMBERSHIP_STATUSES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  type AuthBackupEmailPolicy,
  type AuthErrorCode,
  type AuthInvitationState,
  type AuthMembershipStatus,
  type AuthPrimaryEmailAddressPolicy,
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
import {
  PBAC_REASON_CODE,
  PBAC_STATE_GATES,
  type PbacReasonCode,
  type StateGate,
} from "@lcsp/contracts/pbac";
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
import {
  READINESS_EXPORT_STATUSES,
  type ReadinessExportStatus,
} from "@lcsp/contracts/wizard";

type AuthorizationReasonCode = AuthErrorCode | PbacReasonCode;
type EvidenceAcceptanceContractStatus =
  | TechnicalEvidenceReportStatus
  | TechnicalProfileStatus
  | AIUsageFlowStatus
  | ClassificationResultStatus
  | LegalRuleMatchStatus;

const AUTH_MEMBERSHIP_STATUS_TO_PRISMA = {
  [AUTH_MEMBERSHIP_STATUSES.invited]: PrismaAuthMembershipStatus.INVITED,
  [AUTH_MEMBERSHIP_STATUSES.active]: PrismaAuthMembershipStatus.ACTIVE,
  [AUTH_MEMBERSHIP_STATUSES.revoked]: PrismaAuthMembershipStatus.REVOKED,
} as const satisfies Record<AuthMembershipStatus, PrismaAuthMembershipStatus>;

const PRISMA_AUTH_MEMBERSHIP_STATUS_TO_CONTRACT = {
  [PrismaAuthMembershipStatus.INVITED]: AUTH_MEMBERSHIP_STATUSES.invited,
  [PrismaAuthMembershipStatus.ACTIVE]: AUTH_MEMBERSHIP_STATUSES.active,
  [PrismaAuthMembershipStatus.REVOKED]: AUTH_MEMBERSHIP_STATUSES.revoked,
} as const satisfies Record<PrismaAuthMembershipStatus, AuthMembershipStatus>;

const AUTH_INVITATION_STATE_TO_PRISMA = {
  [AUTH_INVITATION_STATES.approved]: PrismaAuthInvitationState.APPROVED,
  [AUTH_INVITATION_STATES.pending]: PrismaAuthInvitationState.PENDING,
  [AUTH_INVITATION_STATES.consumed]: PrismaAuthInvitationState.CONSUMED,
} as const satisfies Record<AuthInvitationState, PrismaAuthInvitationState>;

const PRISMA_AUTH_INVITATION_STATE_TO_CONTRACT = {
  [PrismaAuthInvitationState.APPROVED]: AUTH_INVITATION_STATES.approved,
  [PrismaAuthInvitationState.PENDING]: AUTH_INVITATION_STATES.pending,
  [PrismaAuthInvitationState.CONSUMED]: AUTH_INVITATION_STATES.consumed,
} as const satisfies Record<PrismaAuthInvitationState, AuthInvitationState>;

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

const WIZARD_STATUS_TO_PRISMA = {
  [WIZARD_STATUS_CODES.inProgress]: PrismaWizardProfileStatus.IN_PROGRESS,
  [WIZARD_STATUS_CODES.submitted]: PrismaWizardProfileStatus.SUBMITTED,
} as const satisfies Record<
  PersistedWizardStatusCode,
  PrismaWizardProfileStatus
>;

const PRISMA_WIZARD_STATUS_TO_CONTRACT = {
  [PrismaWizardProfileStatus.NOT_STARTED]: WIZARD_STATUS_CODES.notStarted,
  [PrismaWizardProfileStatus.IN_PROGRESS]: WIZARD_STATUS_CODES.inProgress,
  [PrismaWizardProfileStatus.SUBMITTED]: WIZARD_STATUS_CODES.submitted,
} as const satisfies Record<PrismaWizardProfileStatus, WizardStatusCode>;

const READINESS_EXPORT_STATUS_TO_PRISMA = {
  [READINESS_EXPORT_STATUSES.generated]: PrismaReadinessExportStatus.GENERATED,
  [READINESS_EXPORT_STATUSES.blocked]: PrismaReadinessExportStatus.BLOCKED,
} as const satisfies Record<ReadinessExportStatus, PrismaReadinessExportStatus>;

const PRISMA_READINESS_EXPORT_STATUS_TO_CONTRACT = {
  [PrismaReadinessExportStatus.GENERATED]: READINESS_EXPORT_STATUSES.generated,
  [PrismaReadinessExportStatus.BLOCKED]: READINESS_EXPORT_STATUSES.blocked,
} as const satisfies Record<PrismaReadinessExportStatus, ReadinessExportStatus>;

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

const AUTH_STATE_GATE_TO_PRISMA = {
  [PBAC_STATE_GATES.membershipActive]: PrismaAuthStateGate.MEMBERSHIP_ACTIVE,
} as const satisfies Record<StateGate, PrismaAuthStateGate>;

const PRISMA_AUTH_STATE_GATE_TO_CONTRACT = {
  [PrismaAuthStateGate.MEMBERSHIP_ACTIVE]: PBAC_STATE_GATES.membershipActive,
} as const satisfies Record<PrismaAuthStateGate, StateGate>;

const AUTHORIZATION_REASON_CODE_TO_PRISMA = {
  [PBAC_REASON_CODE.actionNotGranted]:
    PrismaAuthorizationReasonCode.ACTION_NOT_GRANTED,
  [AUTH_ERROR_CODES.accountNotFound]:
    PrismaAuthorizationReasonCode.ACCOUNT_NOT_FOUND,
  [PBAC_REASON_CODE.authorized]: PrismaAuthorizationReasonCode.AUTHORIZED,
  [AUTH_ERROR_CODES.authzEvaluatorFailure]:
    PrismaAuthorizationReasonCode.AUTHZ_EVALUATOR_FAILURE,
  [AUTH_ERROR_CODES.authzPolicyUnavailable]:
    PrismaAuthorizationReasonCode.AUTHZ_POLICY_UNAVAILABLE,
  [AUTH_ERROR_CODES.authzStateGateBlocked]:
    PrismaAuthorizationReasonCode.AUTHZ_STATE_GATE_BLOCKED,
  [AUTH_ERROR_CODES.authzSubjectIncomplete]:
    PrismaAuthorizationReasonCode.AUTHZ_SUBJECT_INCOMPLETE,
  [AUTH_ERROR_CODES.authzTenantScopeMismatch]:
    PrismaAuthorizationReasonCode.AUTHZ_TENANT_SCOPE_MISMATCH,
  [AUTH_ERROR_CODES.authRequired]: PrismaAuthorizationReasonCode.AUTH_REQUIRED,
  [AUTH_ERROR_CODES.emailVerificationRequired]:
    PrismaAuthorizationReasonCode.EMAIL_VERIFICATION_REQUIRED,
  [PBAC_REASON_CODE.evaluatorError]:
    PrismaAuthorizationReasonCode.EVALUATOR_ERROR,
  [AUTH_ERROR_CODES.invalidCredentials]:
    PrismaAuthorizationReasonCode.INVALID_CREDENTIALS,
  [AUTH_ERROR_CODES.invalidInviteState]:
    PrismaAuthorizationReasonCode.INVALID_INVITE_STATE,
  [AUTH_ERROR_CODES.invalidRedirectUri]:
    PrismaAuthorizationReasonCode.INVALID_REDIRECT_URI,
  [PBAC_REASON_CODE.loadError]: PrismaAuthorizationReasonCode.LOAD_ERROR,
  [PBAC_REASON_CODE.membershipMissing]:
    PrismaAuthorizationReasonCode.MEMBERSHIP_MISSING,
  [AUTH_ERROR_CODES.mfaRequired]: PrismaAuthorizationReasonCode.MFA_REQUIRED,
  [AUTH_ERROR_CODES.mfaInvalid]: PrismaAuthorizationReasonCode.MFA_INVALID,
  [AUTH_ERROR_CODES.mfaRateLimited]:
    PrismaAuthorizationReasonCode.MFA_RATE_LIMITED,
  [AUTH_ERROR_CODES.oauthCallbackInvalid]:
    PrismaAuthorizationReasonCode.OAUTH_CALLBACK_INVALID,
  [AUTH_ERROR_CODES.oauthStateInvalid]:
    PrismaAuthorizationReasonCode.OAUTH_STATE_INVALID,
  [PBAC_REASON_CODE.organizationMismatch]:
    PrismaAuthorizationReasonCode.ORGANIZATION_MISMATCH,
  [PBAC_REASON_CODE.denied]: PrismaAuthorizationReasonCode.PBAC_DENIED,
  [PBAC_REASON_CODE.metadataMissing]:
    PrismaAuthorizationReasonCode.PBAC_METADATA_MISSING,
  [PBAC_REASON_CODE.policyNotFound]:
    PrismaAuthorizationReasonCode.POLICY_NOT_FOUND,
  [AUTH_ERROR_CODES.reauthRequired]:
    PrismaAuthorizationReasonCode.REAUTH_REQUIRED,
  [AUTH_ERROR_CODES.recoveryInvalid]:
    PrismaAuthorizationReasonCode.RECOVERY_INVALID,
  [PBAC_REASON_CODE.sessionInvalid]:
    PrismaAuthorizationReasonCode.SESSION_INVALID,
  [PBAC_REASON_CODE.stateGateFailed]:
    PrismaAuthorizationReasonCode.STATE_GATE_FAILED,
  [PBAC_REASON_CODE.subjectRoleMismatch]:
    PrismaAuthorizationReasonCode.SUBJECT_ROLE_MISMATCH,
  [PBAC_REASON_CODE.subjectAttributeMissing]:
    PrismaAuthorizationReasonCode.SUBJECT_ATTRIBUTE_MISSING,
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
  [PrismaAuthorizationReasonCode.ACTION_NOT_GRANTED]:
    PBAC_REASON_CODE.actionNotGranted,
  [PrismaAuthorizationReasonCode.ACCOUNT_NOT_FOUND]:
    AUTH_ERROR_CODES.accountNotFound,
  [PrismaAuthorizationReasonCode.AUTHORIZED]: PBAC_REASON_CODE.authorized,
  [PrismaAuthorizationReasonCode.AUTHZ_EVALUATOR_FAILURE]:
    AUTH_ERROR_CODES.authzEvaluatorFailure,
  [PrismaAuthorizationReasonCode.AUTHZ_POLICY_UNAVAILABLE]:
    AUTH_ERROR_CODES.authzPolicyUnavailable,
  [PrismaAuthorizationReasonCode.AUTHZ_STATE_GATE_BLOCKED]:
    AUTH_ERROR_CODES.authzStateGateBlocked,
  [PrismaAuthorizationReasonCode.AUTHZ_SUBJECT_INCOMPLETE]:
    AUTH_ERROR_CODES.authzSubjectIncomplete,
  [PrismaAuthorizationReasonCode.AUTHZ_TENANT_SCOPE_MISMATCH]:
    AUTH_ERROR_CODES.authzTenantScopeMismatch,
  [PrismaAuthorizationReasonCode.AUTH_REQUIRED]: AUTH_ERROR_CODES.authRequired,
  [PrismaAuthorizationReasonCode.EMAIL_VERIFICATION_REQUIRED]:
    AUTH_ERROR_CODES.emailVerificationRequired,
  [PrismaAuthorizationReasonCode.EVALUATOR_ERROR]:
    PBAC_REASON_CODE.evaluatorError,
  [PrismaAuthorizationReasonCode.INVALID_CREDENTIALS]:
    AUTH_ERROR_CODES.invalidCredentials,
  [PrismaAuthorizationReasonCode.INVALID_INVITE_STATE]:
    AUTH_ERROR_CODES.invalidInviteState,
  [PrismaAuthorizationReasonCode.INVALID_REDIRECT_URI]:
    AUTH_ERROR_CODES.invalidRedirectUri,
  [PrismaAuthorizationReasonCode.LOAD_ERROR]: PBAC_REASON_CODE.loadError,
  [PrismaAuthorizationReasonCode.MEMBERSHIP_MISSING]:
    PBAC_REASON_CODE.membershipMissing,
  [PrismaAuthorizationReasonCode.MFA_REQUIRED]: AUTH_ERROR_CODES.mfaRequired,
  [PrismaAuthorizationReasonCode.MFA_INVALID]: AUTH_ERROR_CODES.mfaInvalid,
  [PrismaAuthorizationReasonCode.MFA_RATE_LIMITED]:
    AUTH_ERROR_CODES.mfaRateLimited,
  [PrismaAuthorizationReasonCode.OAUTH_CALLBACK_INVALID]:
    AUTH_ERROR_CODES.oauthCallbackInvalid,
  [PrismaAuthorizationReasonCode.OAUTH_STATE_INVALID]:
    AUTH_ERROR_CODES.oauthStateInvalid,
  [PrismaAuthorizationReasonCode.ORGANIZATION_MISMATCH]:
    PBAC_REASON_CODE.organizationMismatch,
  [PrismaAuthorizationReasonCode.PBAC_DENIED]: PBAC_REASON_CODE.denied,
  [PrismaAuthorizationReasonCode.PBAC_METADATA_MISSING]:
    PBAC_REASON_CODE.metadataMissing,
  [PrismaAuthorizationReasonCode.POLICY_NOT_FOUND]:
    PBAC_REASON_CODE.policyNotFound,
  [PrismaAuthorizationReasonCode.REAUTH_REQUIRED]:
    AUTH_ERROR_CODES.reauthRequired,
  [PrismaAuthorizationReasonCode.RECOVERY_INVALID]:
    AUTH_ERROR_CODES.recoveryInvalid,
  [PrismaAuthorizationReasonCode.SESSION_INVALID]:
    PBAC_REASON_CODE.sessionInvalid,
  [PrismaAuthorizationReasonCode.STATE_GATE_FAILED]:
    PBAC_REASON_CODE.stateGateFailed,
  [PrismaAuthorizationReasonCode.SUBJECT_ROLE_MISMATCH]:
    PBAC_REASON_CODE.subjectRoleMismatch,
  [PrismaAuthorizationReasonCode.SUBJECT_ATTRIBUTE_MISSING]:
    PBAC_REASON_CODE.subjectAttributeMissing,
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
  [AUDIT_RESOURCE_TYPES.authMembership]:
    PrismaAuditResourceType.AUTH_MEMBERSHIP,
  [AUDIT_RESOURCE_TYPES.authMfaRecoveryCode]:
    PrismaAuditResourceType.AUTH_MFA_RECOVERY_CODE,
  [AUDIT_RESOURCE_TYPES.authOrganization]:
    PrismaAuditResourceType.AUTH_ORGANIZATION,
  [AUDIT_RESOURCE_TYPES.authSession]: PrismaAuditResourceType.AUTH_SESSION,
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
  [AUDIT_RESOURCE_TYPES.wizardProfile]: PrismaAuditResourceType.WIZARD_PROFILE,
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
  [PrismaAuditResourceType.AUTH_MEMBERSHIP]:
    AUDIT_RESOURCE_TYPES.authMembership,
  [PrismaAuditResourceType.AUTH_MFA_RECOVERY_CODE]:
    AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
  [PrismaAuditResourceType.AUTH_ORGANIZATION]:
    AUDIT_RESOURCE_TYPES.authOrganization,
  [PrismaAuditResourceType.AUTH_SESSION]: AUDIT_RESOURCE_TYPES.authSession,
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
  [PrismaAuditResourceType.WIZARD_PROFILE]: AUDIT_RESOURCE_TYPES.wizardProfile,
} as const satisfies Record<PrismaAuditResourceType, AuditResourceType>;

const OUTBOX_AGGREGATE_TYPE_TO_PRISMA = {
  [OUTBOX_AGGREGATE_TYPES.aiUsageFlow]: PrismaOutboxAggregateType.AI_USAGE_FLOW,
  [OUTBOX_AGGREGATE_TYPES.assessment]: PrismaOutboxAggregateType.ASSESSMENT,
  [OUTBOX_AGGREGATE_TYPES.authUser]: PrismaOutboxAggregateType.AUTH_USER,
  [OUTBOX_AGGREGATE_TYPES.classificationResult]:
    PrismaOutboxAggregateType.CLASSIFICATION_RESULT,
  [OUTBOX_AGGREGATE_TYPES.documentRequest]:
    PrismaOutboxAggregateType.DOCUMENT_REQUEST,
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
  [OUTBOX_AGGREGATE_TYPES.wizardProfile]:
    PrismaOutboxAggregateType.WIZARD_PROFILE,
} as const satisfies Record<OutboxAggregateType, PrismaOutboxAggregateType>;

const PRISMA_OUTBOX_AGGREGATE_TYPE_TO_CONTRACT = {
  [PrismaOutboxAggregateType.AI_USAGE_FLOW]: OUTBOX_AGGREGATE_TYPES.aiUsageFlow,
  [PrismaOutboxAggregateType.ASSESSMENT]: OUTBOX_AGGREGATE_TYPES.assessment,
  [PrismaOutboxAggregateType.AUTH_USER]: OUTBOX_AGGREGATE_TYPES.authUser,
  [PrismaOutboxAggregateType.CLASSIFICATION_RESULT]:
    OUTBOX_AGGREGATE_TYPES.classificationResult,
  [PrismaOutboxAggregateType.DOCUMENT_REQUEST]:
    OUTBOX_AGGREGATE_TYPES.documentRequest,
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
  [PrismaOutboxAggregateType.WIZARD_PROFILE]:
    OUTBOX_AGGREGATE_TYPES.wizardProfile,
} as const satisfies Record<PrismaOutboxAggregateType, OutboxAggregateType>;

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
} as const satisfies Record<VerifiedProfileStatus, PrismaVerifiedProfileStatus>;

const PRISMA_VERIFIED_PROFILE_STATUS_TO_CONTRACT = {
  [PrismaVerifiedProfileStatus.PENDING_APPROVAL]:
    VERIFIED_PROFILE_STATUSES.pendingApproval,
  [PrismaVerifiedProfileStatus.APPROVED]: VERIFIED_PROFILE_STATUSES.approved,
  [PrismaVerifiedProfileStatus.AUTO_APPROVED]:
    VERIFIED_PROFILE_STATUSES.autoApproved,
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

export function toPrismaDocumentRequestStatus(
  status: DocumentRequestStatus,
): PrismaDocumentRequestStatus {
  return DOCUMENT_REQUEST_STATUS_TO_PRISMA[status];
}

export function fromPrismaDocumentRequestStatus(
  status: PrismaDocumentRequestStatus,
): DocumentRequestStatus {
  return PRISMA_DOCUMENT_REQUEST_STATUS_TO_CONTRACT[status];
}

export function toPrismaDocumentType(
  documentType: DocumentType,
): PrismaDocumentType {
  return DOCUMENT_TYPE_TO_PRISMA[documentType];
}

export function fromPrismaDocumentType(
  documentType: PrismaDocumentType,
): DocumentType {
  return PRISMA_DOCUMENT_TYPE_TO_CONTRACT[documentType];
}

export function toPrismaOverallCoverageStatus(
  status: OverallCoverageStatus,
): PrismaOverallCoverageStatus {
  return OVERALL_COVERAGE_STATUS_TO_PRISMA[status];
}

export function fromPrismaOverallCoverageStatus(
  status: PrismaOverallCoverageStatus,
): OverallCoverageStatus {
  return PRISMA_OVERALL_COVERAGE_STATUS_TO_CONTRACT[status];
}

export function toPrismaLegalRuleLifecycleStatus(
  status: LegalRuleLifecycleStatus,
): PrismaLegalRuleLifecycleStatus {
  return LEGAL_RULE_LIFECYCLE_STATUS_TO_PRISMA[status];
}

export function fromPrismaLegalRuleLifecycleStatus(
  status: PrismaLegalRuleLifecycleStatus,
): LegalRuleLifecycleStatus {
  return PRISMA_LEGAL_RULE_LIFECYCLE_STATUS_TO_CONTRACT[status];
}

export function toPrismaAssessmentStatus(
  status: AssessmentStatusCode,
): PrismaAssessmentStatus {
  return ASSESSMENT_STATUS_TO_PRISMA[status];
}

export function fromPrismaAssessmentStatus(
  status: PrismaAssessmentStatus,
): AssessmentStatusCode {
  return PRISMA_ASSESSMENT_STATUS_TO_CONTRACT[status];
}

export function toPrismaWizardStatus(
  status: PersistedWizardStatusCode,
): PrismaWizardProfileStatus {
  return WIZARD_STATUS_TO_PRISMA[status];
}

export function fromPrismaWizardStatus(
  status: PrismaWizardProfileStatus,
): WizardStatusCode {
  return PRISMA_WIZARD_STATUS_TO_CONTRACT[status];
}

export function toPrismaReadinessExportStatus(
  status: ReadinessExportStatus,
): PrismaReadinessExportStatus {
  return READINESS_EXPORT_STATUS_TO_PRISMA[status];
}

export function fromPrismaReadinessExportStatus(
  status: PrismaReadinessExportStatus,
): ReadinessExportStatus {
  return PRISMA_READINESS_EXPORT_STATUS_TO_CONTRACT[status];
}

export function toPrismaAuditExportStatus(
  status: AuditExportStatus,
): PrismaAuditExportStatus {
  return AUDIT_EXPORT_STATUS_TO_PRISMA[status];
}

export function fromPrismaAuditExportStatus(
  status: PrismaAuditExportStatus,
): AuditExportStatus {
  return PRISMA_AUDIT_EXPORT_STATUS_TO_CONTRACT[status];
}

export function toPrismaAuthStateGate(
  stateGate: StateGate,
): PrismaAuthStateGate {
  return AUTH_STATE_GATE_TO_PRISMA[stateGate];
}

export function fromPrismaAuthStateGate(
  stateGate: PrismaAuthStateGate,
): StateGate {
  return PRISMA_AUTH_STATE_GATE_TO_CONTRACT[stateGate];
}

export function toPrismaAuthorizationReasonCode(
  reasonCode: AuthorizationReasonCode,
): PrismaAuthorizationReasonCode {
  return AUTHORIZATION_REASON_CODE_TO_PRISMA[reasonCode];
}

export function fromPrismaAuthorizationReasonCode(
  reasonCode: PrismaAuthorizationReasonCode,
): AuthorizationReasonCode {
  return PRISMA_AUTHORIZATION_REASON_CODE_TO_CONTRACT[reasonCode];
}

export function toPrismaAuditResourceType(
  resourceType: AuditResourceType,
): PrismaAuditResourceType {
  return AUDIT_RESOURCE_TYPE_TO_PRISMA[resourceType];
}

export function fromPrismaAuditResourceType(
  resourceType: PrismaAuditResourceType,
): AuditResourceType {
  return PRISMA_AUDIT_RESOURCE_TYPE_TO_CONTRACT[resourceType];
}

export function toPrismaOutboxAggregateType(
  aggregateType: OutboxAggregateType,
): PrismaOutboxAggregateType {
  return OUTBOX_AGGREGATE_TYPE_TO_PRISMA[aggregateType];
}

export function fromPrismaOutboxAggregateType(
  aggregateType: PrismaOutboxAggregateType,
): OutboxAggregateType {
  return PRISMA_OUTBOX_AGGREGATE_TYPE_TO_CONTRACT[aggregateType];
}

export function toPrismaOutboxStatus(status: OutboxStatus): PrismaOutboxStatus {
  return OUTBOX_STATUS_TO_PRISMA[status];
}

export function fromPrismaOutboxStatus(
  status: PrismaOutboxStatus,
): OutboxStatus {
  return PRISMA_OUTBOX_STATUS_TO_CONTRACT[status];
}

export function toPrismaRepositoryScanJobStatus(
  status: RepositoryScanJobStatus,
): PrismaRepositoryScanJobStatus {
  return REPOSITORY_SCAN_JOB_STATUS_TO_PRISMA[status];
}

export function fromPrismaRepositoryScanJobStatus(
  status: PrismaRepositoryScanJobStatus,
): RepositoryScanJobStatus {
  return PRISMA_REPOSITORY_SCAN_JOB_STATUS_TO_CONTRACT[status];
}

export function toPrismaConflictRecordStatus(
  status: ConflictRecordStatus,
): PrismaConflictRecordStatus {
  return CONFLICT_RECORD_STATUS_TO_PRISMA[status];
}

export function fromPrismaConflictRecordStatus(
  status: PrismaConflictRecordStatus,
): ConflictRecordStatus {
  return PRISMA_CONFLICT_RECORD_STATUS_TO_CONTRACT[status];
}

export function toPrismaVerifiedProfileStatus(
  status: VerifiedProfileStatus,
): PrismaVerifiedProfileStatus {
  return VERIFIED_PROFILE_STATUS_TO_PRISMA[status];
}

export function fromPrismaVerifiedProfileStatus(
  status: PrismaVerifiedProfileStatus,
): VerifiedProfileStatus {
  return PRISMA_VERIFIED_PROFILE_STATUS_TO_CONTRACT[status];
}

export function toPrismaAuthMembershipStatus(
  status: AuthMembershipStatus,
): PrismaAuthMembershipStatus {
  return AUTH_MEMBERSHIP_STATUS_TO_PRISMA[status];
}

export function fromPrismaAuthMembershipStatus(
  status: PrismaAuthMembershipStatus,
): AuthMembershipStatus {
  return PRISMA_AUTH_MEMBERSHIP_STATUS_TO_CONTRACT[status];
}

export function toPrismaAuthBackupEmailPolicy(
  policy: AuthBackupEmailPolicy,
): PrismaAuthBackupEmailPolicy {
  return AUTH_BACKUP_EMAIL_POLICY_TO_PRISMA[policy];
}

export function fromPrismaAuthBackupEmailPolicy(
  policy: PrismaAuthBackupEmailPolicy,
): AuthBackupEmailPolicy {
  return PRISMA_AUTH_BACKUP_EMAIL_POLICY_TO_CONTRACT[policy];
}

export function toPrismaAuthPrimaryEmailAddressPolicy(
  policy: AuthPrimaryEmailAddressPolicy,
): PrismaAuthPrimaryEmailAddressPolicy {
  return AUTH_PRIMARY_EMAIL_ADDRESS_POLICY_TO_PRISMA[policy];
}

export function fromPrismaAuthPrimaryEmailAddressPolicy(
  policy: PrismaAuthPrimaryEmailAddressPolicy,
): AuthPrimaryEmailAddressPolicy {
  return PRISMA_AUTH_PRIMARY_EMAIL_ADDRESS_POLICY_TO_CONTRACT[policy];
}

export function toPrismaAuthInvitationState(
  state: AuthInvitationState,
): PrismaAuthInvitationState {
  return AUTH_INVITATION_STATE_TO_PRISMA[state];
}

export function fromPrismaAuthInvitationState(
  state: PrismaAuthInvitationState,
): AuthInvitationState {
  return PRISMA_AUTH_INVITATION_STATE_TO_CONTRACT[state];
}

export function toPrismaAuthDecision(
  decision: AuditDecision,
): PrismaAuthDecision {
  return AUTH_DECISION_TO_PRISMA[decision];
}

export function fromPrismaAuthDecision(
  decision: PrismaAuthDecision,
): AuditDecision {
  return PRISMA_AUTH_DECISION_TO_CONTRACT[decision];
}

export function toPrismaRepositoryConnectionStatus(
  status: RepositoryConnectionStatus,
): PrismaRepositoryConnectionStatus {
  return REPOSITORY_CONNECTION_STATUS_TO_PRISMA[status];
}

export function fromPrismaRepositoryConnectionStatus(
  status: PrismaRepositoryConnectionStatus,
): RepositoryConnectionStatus {
  return PRISMA_REPOSITORY_CONNECTION_STATUS_TO_CONTRACT[status];
}

export function toPrismaRepositorySnapshotStatus(
  status: RepositorySnapshotStatus,
): PrismaRepositorySnapshotStatus {
  return REPOSITORY_SNAPSHOT_STATUS_TO_PRISMA[status];
}

export function fromPrismaRepositorySnapshotStatus(
  status: PrismaRepositorySnapshotStatus,
): RepositorySnapshotStatus {
  return PRISMA_REPOSITORY_SNAPSHOT_STATUS_TO_CONTRACT[status];
}

export function toPrismaRepositoryScanTriggerSource(
  source: RepositoryScanTriggerSource,
): PrismaRepositoryScanTriggerSource {
  return REPOSITORY_SCAN_TRIGGER_SOURCE_TO_PRISMA[source];
}

export function fromPrismaRepositoryScanTriggerSource(
  source: PrismaRepositoryScanTriggerSource,
): RepositoryScanTriggerSource {
  return PRISMA_REPOSITORY_SCAN_TRIGGER_SOURCE_TO_CONTRACT[source];
}

export function toPrismaEvidenceAcceptanceStatus(
  status: EvidenceAcceptanceContractStatus,
): PrismaEvidenceAcceptanceStatus {
  return EVIDENCE_ACCEPTANCE_STATUS_TO_PRISMA[status];
}

export function fromPrismaEvidenceAcceptanceStatus(
  status: PrismaEvidenceAcceptanceStatus,
): TechnicalEvidenceReportStatus {
  return PRISMA_EVIDENCE_ACCEPTANCE_STATUS_TO_CONTRACT[status];
}

export function toPrismaClassificationGuardrailStatus(
  status: ClassificationGuardrailStatus,
): PrismaClassificationGuardrailStatus {
  return CLASSIFICATION_GUARDRAIL_STATUS_TO_PRISMA[status];
}

export function fromPrismaClassificationGuardrailStatus(
  status: PrismaClassificationGuardrailStatus,
): ClassificationGuardrailStatus {
  return PRISMA_CLASSIFICATION_GUARDRAIL_STATUS_TO_CONTRACT[status];
}

export function toPrismaLegalRuleMatchGuardrailStatus(
  status: LegalRuleMatchGuardrailStatus,
): PrismaLegalRuleMatchGuardrailStatus {
  return LEGAL_RULE_MATCH_GUARDRAIL_STATUS_TO_PRISMA[status];
}

export function fromPrismaLegalRuleMatchGuardrailStatus(
  status: PrismaLegalRuleMatchGuardrailStatus,
): LegalRuleMatchGuardrailStatus {
  return PRISMA_LEGAL_RULE_MATCH_GUARDRAIL_STATUS_TO_CONTRACT[status];
}
