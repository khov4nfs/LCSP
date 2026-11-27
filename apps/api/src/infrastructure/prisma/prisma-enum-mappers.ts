import { LegalSourceDocumentCorpusRole as PrismaCorpusRole } from "@prisma/client";
import {
  LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES as CorpusRoles,
  type LegalSourceDocumentCorpusRole,
} from "@lcsp/contracts/legal-source";
import {
  AdmissionFundingPrincipal as PrismaAdmissionFundingPrincipal,
  AdmissionState as PrismaAdmissionState,
  AuditExportStatus as PrismaAuditExportStatus,
  AuditResourceType as PrismaAuditResourceType,
  AuthBackupEmailPolicy as PrismaAuthBackupEmailPolicy,
  AuthDecision as PrismaAuthDecision,
  AuthPrimaryEmailAddressPolicy as PrismaAuthPrimaryEmailAddressPolicy,
  AuthUserRole as PrismaAuthUserRole,
  BillingReconciliationState as PrismaBillingReconciliationState,
  CreditLedgerSource as PrismaCreditLedgerSource,
  CustomerTariffDraftStatus as PrismaCustomerTariffDraftStatus,
  LegalSourceDocumentIngestionState as PrismaLegalSourceDocumentIngestionState,
  LegalSourceDocumentOrigin as PrismaLegalSourceDocumentOrigin,
  LegalSourceLifecycleStatus as PrismaLegalSourceLifecycleStatus,
  ModelPricingScope as PrismaModelPricingScope,
  ModelUsageDebitMode as PrismaModelUsageDebitMode,
  OutboxAggregateType as PrismaOutboxAggregateType,
  OutboxStatus as PrismaOutboxStatus,
  OutputEvaluationState as PrismaOutputEvaluationState,
  ProviderCompletionState as PrismaProviderCompletionState,
  CredentialProvider as PrismaCredentialProvider,
  RepositoryConnectionStatus as PrismaRepositoryConnectionStatus,
  RepositoryScanTriggerSource as PrismaRepositoryScanTriggerSource,
  RepositoryScanJobStatus as PrismaRepositoryScanJobStatus,
  RepositorySnapshotStatus as PrismaRepositorySnapshotStatus,
  TokenBucketPolicy as PrismaTokenBucketPolicy,
} from "@prisma/client";

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
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  AUTH_USER_ROLES,
  type AuthBackupEmailPolicy,
  type AuthPrimaryEmailAddressPolicy,
  type AuthUserRole,
} from "@lcsp/contracts/auth";

import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  REPOSITORY_SNAPSHOT_STATUSES,
  type CredentialProvider,
  type RepositoryConnectionStatus,
  type RepositoryScanJobStatus,
  type RepositoryScanTriggerSource,
  type RepositorySnapshotStatus,
} from "@lcsp/contracts/github-integration";

import {
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES,
  LEGAL_SOURCE_DOCUMENT_ORIGINS,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
  type LegalSourceDocumentIngestionState,
  type LegalSourceDocumentOrigin,
  type LegalSourceLifecycleStatus,
} from "@lcsp/contracts/legal-source";

import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  CREDIT_LEDGER_SOURCES,
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  OUTPUT_EVALUATION_STATES,
  PROVIDER_COMPLETION_STATES,
  RECONCILIATION_CASE_STATES,
  TOKEN_BUCKET_POLICIES,
  type AdmissionFundingPrincipal,
  type AdmissionState,
  type CreditLedgerSource,
  type CustomerTariffDraftStatus,
  type ModelPricingScope,
  type ModelUsageDebitMode,
  type OutputEvaluationState,
  type ProviderCompletionState,
  type ReconciliationCaseState,
  type TokenBucketPolicy,
} from "@lcsp/contracts/billing";

import {
  OUTBOX_AGGREGATE_TYPES,
  type OutboxAggregateType,
  OUTBOX_STATUSES,
  type OutboxStatus,
} from "@lcsp/contracts/outbox";

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

const AUDIT_EXPORT_STATUS_TO_PRISMA = {
  [AUDIT_EXPORT_STATUSES.queued]: PrismaAuditExportStatus.QUEUED,
  [AUDIT_EXPORT_STATUSES.generating]: PrismaAuditExportStatus.GENERATING,
  [AUDIT_EXPORT_STATUSES.ready]: PrismaAuditExportStatus.READY,
  [AUDIT_EXPORT_STATUSES.failed]: PrismaAuditExportStatus.FAILED,
} as const satisfies Record<AuditExportStatus, PrismaAuditExportStatus>;

const AUTH_USER_ROLE_TO_PRISMA = {
  [AUTH_USER_ROLES.admin]: PrismaAuthUserRole.ADMIN,
  [AUTH_USER_ROLES.customer]: PrismaAuthUserRole.CUSTOMER,
} as const satisfies Record<AuthUserRole, PrismaAuthUserRole>;

const PRISMA_AUTH_USER_ROLE_TO_CONTRACT = {
  [PrismaAuthUserRole.ADMIN]: AUTH_USER_ROLES.admin,
  [PrismaAuthUserRole.CUSTOMER]: AUTH_USER_ROLES.customer,
} as const satisfies Record<PrismaAuthUserRole, AuthUserRole>;

const AUDIT_RESOURCE_TYPE_TO_PRISMA = {
  [AUDIT_RESOURCE_TYPES.assessment]: PrismaAuditResourceType.ASSESSMENT,
  [AUDIT_RESOURCE_TYPES.assessmentRecord]:
    PrismaAuditResourceType.ASSESSMENT_RECORD,
  [AUDIT_RESOURCE_TYPES.auditExportRequest]:
    PrismaAuditResourceType.AUDIT_EXPORT_REQUEST,
  [AUDIT_RESOURCE_TYPES.authAccount]: PrismaAuditResourceType.AUTH_ACCOUNT,
  [AUDIT_RESOURCE_TYPES.authInvitation]:
    PrismaAuditResourceType.AUTH_INVITATION,
  [AUDIT_RESOURCE_TYPES.authMfaRecoveryCode]:
    PrismaAuditResourceType.AUTH_MFA_RECOVERY_CODE,
  [AUDIT_RESOURCE_TYPES.authSession]: PrismaAuditResourceType.AUTH_SESSION,
  [AUDIT_RESOURCE_TYPES.githubAppInstallState]:
    PrismaAuditResourceType.GITHUB_APP_INSTALL_STATE,
  [AUDIT_RESOURCE_TYPES.httpRoute]: PrismaAuditResourceType.HTTP_ROUTE,
  [AUDIT_RESOURCE_TYPES.complianceRuleSetVersion]:
    PrismaAuditResourceType.COMPLIANCE_RULE_SET_VERSION,
  [AUDIT_RESOURCE_TYPES.customerModelTariff]:
    PrismaAuditResourceType.CUSTOMER_MODEL_TARIFF,
  [AUDIT_RESOURCE_TYPES.legalRequirement]:
    PrismaAuditResourceType.LEGAL_REQUIREMENT,
  [AUDIT_RESOURCE_TYPES.legalSourceVersion]:
    PrismaAuditResourceType.LEGAL_SOURCE_VERSION,
  [AUDIT_RESOURCE_TYPES.legalSource]: PrismaAuditResourceType.LEGAL_SOURCE,
  [AUDIT_RESOURCE_TYPES.outbox]: PrismaAuditResourceType.OUTBOX,
  [AUDIT_RESOURCE_TYPES.repositoryConnection]:
    PrismaAuditResourceType.REPOSITORY_CONNECTION,
  [AUDIT_RESOURCE_TYPES.repositoryScanJob]:
    PrismaAuditResourceType.REPOSITORY_SCAN_JOB,
  [AUDIT_RESOURCE_TYPES.repositorySnapshot]:
    PrismaAuditResourceType.REPOSITORY_SNAPSHOT,
  [AUDIT_RESOURCE_TYPES.workerTask]: PrismaAuditResourceType.WORKER_TASK,
  [AUDIT_RESOURCE_TYPES.workspace]: PrismaAuditResourceType.WORKSPACE,
} as const satisfies Record<AuditResourceType, PrismaAuditResourceType>;

const OUTBOX_AGGREGATE_TYPE_TO_PRISMA = {
  [OUTBOX_AGGREGATE_TYPES.billingPayment]:
    PrismaOutboxAggregateType.BILLING_PAYMENT,
  [OUTBOX_AGGREGATE_TYPES.billingWallet]:
    PrismaOutboxAggregateType.BILLING_WALLET,
  [OUTBOX_AGGREGATE_TYPES.customerModelTariff]:
    PrismaOutboxAggregateType.CUSTOMER_MODEL_TARIFF,
  [OUTBOX_AGGREGATE_TYPES.assessment]: PrismaOutboxAggregateType.ASSESSMENT,
  [OUTBOX_AGGREGATE_TYPES.authUser]: PrismaOutboxAggregateType.AUTH_USER,
  [OUTBOX_AGGREGATE_TYPES.legalSourceVersion]:
    PrismaOutboxAggregateType.LEGAL_SOURCE_VERSION,
  [OUTBOX_AGGREGATE_TYPES.legalSource]: PrismaOutboxAggregateType.LEGAL_SOURCE,
  [OUTBOX_AGGREGATE_TYPES.complianceRuleSetVersion]:
    PrismaOutboxAggregateType.COMPLIANCE_RULE_SET_VERSION,
  [OUTBOX_AGGREGATE_TYPES.repositoryScanJob]:
    PrismaOutboxAggregateType.REPOSITORY_SCAN_JOB,
  [OUTBOX_AGGREGATE_TYPES.repositorySnapshot]:
    PrismaOutboxAggregateType.REPOSITORY_SNAPSHOT,
} as const satisfies Record<OutboxAggregateType, PrismaOutboxAggregateType>;

const PRISMA_OUTBOX_AGGREGATE_TYPE_TO_CONTRACT = {
  [PrismaOutboxAggregateType.BILLING_PAYMENT]:
    OUTBOX_AGGREGATE_TYPES.billingPayment,
  [PrismaOutboxAggregateType.BILLING_WALLET]:
    OUTBOX_AGGREGATE_TYPES.billingWallet,
  [PrismaOutboxAggregateType.CUSTOMER_MODEL_TARIFF]:
    OUTBOX_AGGREGATE_TYPES.customerModelTariff,
  [PrismaOutboxAggregateType.ASSESSMENT]: OUTBOX_AGGREGATE_TYPES.assessment,
  [PrismaOutboxAggregateType.AUTH_USER]: OUTBOX_AGGREGATE_TYPES.authUser,
  [PrismaOutboxAggregateType.LEGAL_SOURCE_VERSION]:
    OUTBOX_AGGREGATE_TYPES.legalSourceVersion,
  [PrismaOutboxAggregateType.LEGAL_SOURCE]: OUTBOX_AGGREGATE_TYPES.legalSource,
  [PrismaOutboxAggregateType.COMPLIANCE_RULE_SET_VERSION]:
    OUTBOX_AGGREGATE_TYPES.complianceRuleSetVersion,
  [PrismaOutboxAggregateType.REPOSITORY_SCAN_JOB]:
    OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
  [PrismaOutboxAggregateType.REPOSITORY_SNAPSHOT]:
    OUTBOX_AGGREGATE_TYPES.repositorySnapshot,
} as const satisfies Record<PrismaOutboxAggregateType, OutboxAggregateType>;

const OUTBOX_STATUS_TO_PRISMA = {
  [OUTBOX_STATUSES.pending]: PrismaOutboxStatus.PENDING,
  [OUTBOX_STATUSES.ownedPending]: PrismaOutboxStatus.OWNED_PENDING,
  [OUTBOX_STATUSES.published]: PrismaOutboxStatus.PUBLISHED,
  [OUTBOX_STATUSES.failed]: PrismaOutboxStatus.FAILED,
  [OUTBOX_STATUSES.dlq]: PrismaOutboxStatus.DLQ,
  [OUTBOX_STATUSES.cancelled]: PrismaOutboxStatus.CANCELLED,
} as const satisfies Record<OutboxStatus, PrismaOutboxStatus>;

const PRISMA_OUTBOX_STATUS_TO_CONTRACT = {
  [PrismaOutboxStatus.PENDING]: OUTBOX_STATUSES.pending,
  [PrismaOutboxStatus.OWNED_PENDING]: OUTBOX_STATUSES.ownedPending,
  [PrismaOutboxStatus.PUBLISHED]: OUTBOX_STATUSES.published,
  [PrismaOutboxStatus.FAILED]: OUTBOX_STATUSES.failed,
  [PrismaOutboxStatus.DLQ]: OUTBOX_STATUSES.dlq,
  [PrismaOutboxStatus.CANCELLED]: OUTBOX_STATUSES.cancelled,
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
  [REPOSITORY_SCAN_JOB_STATUSES.waitingForCredits]:
    PrismaRepositoryScanJobStatus.WAITING_FOR_CREDITS,
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
  [PrismaRepositoryScanJobStatus.WAITING_FOR_CREDITS]:
    REPOSITORY_SCAN_JOB_STATUSES.waitingForCredits,
  [PrismaRepositoryScanJobStatus.READY_TO_SNAPSHOT]:
    REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot,
} as const satisfies Record<
  PrismaRepositoryScanJobStatus,
  RepositoryScanJobStatus
>;

const LEGAL_SOURCE_LIFECYCLE_STATUS_TO_PRISMA = {
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.draft]:
    PrismaLegalSourceLifecycleStatus.DRAFT,
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.active]:
    PrismaLegalSourceLifecycleStatus.ACTIVE,
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid]:
    PrismaLegalSourceLifecycleStatus.INVALID,
  [LEGAL_SOURCE_LIFECYCLE_STATUSES.superseded]:
    PrismaLegalSourceLifecycleStatus.SUPERSEDED,
} as const satisfies Record<
  LegalSourceLifecycleStatus,
  PrismaLegalSourceLifecycleStatus
>;

const PRISMA_LEGAL_SOURCE_LIFECYCLE_STATUS_TO_CONTRACT = {
  [PrismaLegalSourceLifecycleStatus.DRAFT]:
    LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
  [PrismaLegalSourceLifecycleStatus.ACTIVE]:
    LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
  [PrismaLegalSourceLifecycleStatus.INVALID]:
    LEGAL_SOURCE_LIFECYCLE_STATUSES.invalid,
  [PrismaLegalSourceLifecycleStatus.SUPERSEDED]:
    LEGAL_SOURCE_LIFECYCLE_STATUSES.superseded,
} as const satisfies Record<
  PrismaLegalSourceLifecycleStatus,
  LegalSourceLifecycleStatus
>;

/** Maps legal-source lifecycle status from the contract layer to Prisma. @param status - Contract lifecycle status. @returns Prisma lifecycle status. */
export function toPrismaLegalSourceLifecycleStatus(
  status: LegalSourceLifecycleStatus,
): PrismaLegalSourceLifecycleStatus {
  return LEGAL_SOURCE_LIFECYCLE_STATUS_TO_PRISMA[status];
}

/** Maps legal-source lifecycle status from Prisma to the contract layer. @param status - Prisma lifecycle status. @returns Contract lifecycle status. */
export function fromPrismaLegalSourceLifecycleStatus(
  status: PrismaLegalSourceLifecycleStatus,
): LegalSourceLifecycleStatus {
  return PRISMA_LEGAL_SOURCE_LIFECYCLE_STATUS_TO_CONTRACT[status];
}

/** Maps audit-export status from the contract layer to Prisma. @param status - Contract audit-export status. @returns Prisma audit-export status. */
export function toPrismaAuditExportStatus(
  status: AuditExportStatus,
): PrismaAuditExportStatus {
  return AUDIT_EXPORT_STATUS_TO_PRISMA[status];
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

const CREDENTIAL_PROVIDER_TO_PRISMA = {
  [CREDENTIAL_PROVIDERS.github]: PrismaCredentialProvider.GITHUB,
  [CREDENTIAL_PROVIDERS.gitlab]: PrismaCredentialProvider.GITLAB,
  [CREDENTIAL_PROVIDERS.bitbucket]: PrismaCredentialProvider.BITBUCKET,
  [CREDENTIAL_PROVIDERS.azureDevOps]: PrismaCredentialProvider.AZURE_DEVOPS,
} as const satisfies Record<CredentialProvider, PrismaCredentialProvider>;

const PRISMA_CREDENTIAL_PROVIDER_TO_CONTRACT = {
  [PrismaCredentialProvider.GITHUB]: CREDENTIAL_PROVIDERS.github,
  [PrismaCredentialProvider.GITLAB]: CREDENTIAL_PROVIDERS.gitlab,
  [PrismaCredentialProvider.BITBUCKET]: CREDENTIAL_PROVIDERS.bitbucket,
  [PrismaCredentialProvider.AZURE_DEVOPS]: CREDENTIAL_PROVIDERS.azureDevOps,
} as const satisfies Record<PrismaCredentialProvider, CredentialProvider>;

/** Maps credential provider from the contract layer to Prisma. @param provider - Contract credential provider. @returns Prisma credential provider. */
export function toPrismaCredentialProvider(
  provider: CredentialProvider,
): PrismaCredentialProvider {
  const mapped = CREDENTIAL_PROVIDER_TO_PRISMA[provider];
  if (!mapped) {
    throw new Error(`Unsupported credential provider: ${provider}`);
  }
  return mapped;
}

/** Maps credential provider from Prisma to the contract layer. @param provider - Prisma credential provider. @returns Contract credential provider. */
export function fromPrismaCredentialProvider(
  provider: PrismaCredentialProvider,
): CredentialProvider {
  const mapped = PRISMA_CREDENTIAL_PROVIDER_TO_CONTRACT[provider];
  if (!mapped) {
    throw new Error(`Unsupported Prisma credential provider: ${provider}`);
  }
  return mapped;
}

const LEGAL_SOURCE_DOCUMENT_ORIGIN_TO_PRISMA = {
  [LEGAL_SOURCE_DOCUMENT_ORIGINS.UPLOAD]:
    PrismaLegalSourceDocumentOrigin.UPLOAD,
  [LEGAL_SOURCE_DOCUMENT_ORIGINS.URL_IMPORT]:
    PrismaLegalSourceDocumentOrigin.URL_IMPORT,
  [LEGAL_SOURCE_DOCUMENT_ORIGINS.MIGRATED]:
    PrismaLegalSourceDocumentOrigin.MIGRATED,
} as const satisfies Record<
  LegalSourceDocumentOrigin,
  PrismaLegalSourceDocumentOrigin
>;

const PRISMA_LEGAL_SOURCE_DOCUMENT_ORIGIN_TO_CONTRACT = {
  [PrismaLegalSourceDocumentOrigin.UPLOAD]:
    LEGAL_SOURCE_DOCUMENT_ORIGINS.UPLOAD,
  [PrismaLegalSourceDocumentOrigin.URL_IMPORT]:
    LEGAL_SOURCE_DOCUMENT_ORIGINS.URL_IMPORT,
  [PrismaLegalSourceDocumentOrigin.MIGRATED]:
    LEGAL_SOURCE_DOCUMENT_ORIGINS.MIGRATED,
} as const satisfies Record<
  PrismaLegalSourceDocumentOrigin,
  LegalSourceDocumentOrigin
>;

const LEGAL_SOURCE_DOCUMENT_INGESTION_STATE_TO_PRISMA = {
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PENDING]:
    PrismaLegalSourceDocumentIngestionState.PENDING,
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PROCESSING]:
    PrismaLegalSourceDocumentIngestionState.PROCESSING,
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.READY]:
    PrismaLegalSourceDocumentIngestionState.READY,
  [LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.FAILED]:
    PrismaLegalSourceDocumentIngestionState.FAILED,
} as const satisfies Record<
  LegalSourceDocumentIngestionState,
  PrismaLegalSourceDocumentIngestionState
>;

const PRISMA_LEGAL_SOURCE_DOCUMENT_INGESTION_STATE_TO_CONTRACT = {
  [PrismaLegalSourceDocumentIngestionState.PENDING]:
    LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PENDING,
  [PrismaLegalSourceDocumentIngestionState.PROCESSING]:
    LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.PROCESSING,
  [PrismaLegalSourceDocumentIngestionState.READY]:
    LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.READY,
  [PrismaLegalSourceDocumentIngestionState.FAILED]:
    LEGAL_SOURCE_DOCUMENT_INGESTION_STATES.FAILED,
} as const satisfies Record<
  PrismaLegalSourceDocumentIngestionState,
  LegalSourceDocumentIngestionState
>;

/** Maps a managed document's origin from the contract layer to Prisma. */
export function toPrismaLegalSourceDocumentOrigin(
  origin: LegalSourceDocumentOrigin,
): PrismaLegalSourceDocumentOrigin {
  return LEGAL_SOURCE_DOCUMENT_ORIGIN_TO_PRISMA[origin];
}

/** Maps a managed document's origin from Prisma to the contract layer. */
export function fromPrismaLegalSourceDocumentOrigin(
  origin: PrismaLegalSourceDocumentOrigin,
): LegalSourceDocumentOrigin {
  return PRISMA_LEGAL_SOURCE_DOCUMENT_ORIGIN_TO_CONTRACT[origin];
}

/** Maps a document ingestion state from the contract layer to Prisma. */
export function toPrismaLegalSourceDocumentIngestionState(
  state: LegalSourceDocumentIngestionState,
): PrismaLegalSourceDocumentIngestionState {
  return LEGAL_SOURCE_DOCUMENT_INGESTION_STATE_TO_PRISMA[state];
}

/** Maps a document ingestion state from Prisma to the contract layer. */
export function fromPrismaLegalSourceDocumentIngestionState(
  state: PrismaLegalSourceDocumentIngestionState,
): LegalSourceDocumentIngestionState {
  return PRISMA_LEGAL_SOURCE_DOCUMENT_INGESTION_STATE_TO_CONTRACT[state];
}

const LEGAL_SOURCE_DOCUMENT_CORPUS_ROLE_TO_PRISMA = {
  [CorpusRoles.OPERATIVE]: PrismaCorpusRole.OPERATIVE,
  [CorpusRoles.REFERENCE_ONLY]: PrismaCorpusRole.REFERENCE_ONLY,
} as const satisfies Record<LegalSourceDocumentCorpusRole, PrismaCorpusRole>;

const PRISMA_LEGAL_SOURCE_DOCUMENT_CORPUS_ROLE_TO_CONTRACT = {
  [PrismaCorpusRole.OPERATIVE]: CorpusRoles.OPERATIVE,
  [PrismaCorpusRole.REFERENCE_ONLY]: CorpusRoles.REFERENCE_ONLY,
} as const satisfies Record<PrismaCorpusRole, LegalSourceDocumentCorpusRole>;

/** Maps legal source document corpus role from the contract layer to Prisma. */
export function toPrismaLegalSourceDocumentCorpusRole(
  role: LegalSourceDocumentCorpusRole,
): PrismaCorpusRole {
  const mapped = LEGAL_SOURCE_DOCUMENT_CORPUS_ROLE_TO_PRISMA[role];
  if (!mapped) {
    throw new Error(`Unsupported legal source document corpus role: ${role}`);
  }
  return mapped;
}

/** Maps legal source document corpus role from Prisma to the contract layer. */
export function fromPrismaLegalSourceDocumentCorpusRole(
  role: PrismaCorpusRole,
): LegalSourceDocumentCorpusRole {
  const mapped = PRISMA_LEGAL_SOURCE_DOCUMENT_CORPUS_ROLE_TO_CONTRACT[role];
  if (!mapped) {
    throw new Error(
      `Unsupported Prisma legal source document corpus role: ${role}`,
    );
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// WP8 Direct-Credit Pricing, Admission, Usage Receipt & Evaluation Mappers
// Why: Keep Prisma enum representations isolated at the persistence boundary so
// domain services and controllers strictly consume canonical @lcsp/contracts
// `as const` types without leaking Prisma enums across layers, while preventing
// prototype-chain lookups (e.g. "toString", "constructor", "__proto__") from
// failing open when untrusted runtime strings reach a mapper.
// How: Exhaustive `satisfies Record<...>` lookup tables map bijectively between
// `@lcsp/contracts/billing` and `@prisma/client`, and `mapEnumValue` checks
// `typeof value === "string" && Object.hasOwn(lookup, value)` before indexing.
// Invariants: All mapped values use SCREAMING_SNAKE_CASE, 1:1 round-trip
// parity is verified by `prisma-enum-mappers.spec.ts`, and prototype keys
// always throw explicit Errors.
// ---------------------------------------------------------------------------

/**
 * Why: Plain object indexing (`lookup[key]`) resolves `Object.prototype` properties
 * such as `"toString"`, `"constructor"`, `"valueOf"`, and `"__proto__"` as truthy.
 * How: Require a string key and `Object.hasOwn(lookup, value)` before returning the
 * mapped enum value; otherwise throw a descriptive Error.
 * Invariants: Never returns inherited prototype methods or undefined values.
 */
function mapEnumValue<K extends string, V>(
  lookup: Record<K, V>,
  value: unknown,
  errorLabel: string,
): V {
  if (typeof value !== "string" || !Object.hasOwn(lookup, value)) {
    throw new Error(`${errorLabel}: ${String(value)}`);
  }
  return lookup[value as K];
}

const MODEL_PRICING_SCOPE_TO_PRISMA = {
  [MODEL_PRICING_SCOPES.exactModel]: PrismaModelPricingScope.EXACT_MODEL,
  [MODEL_PRICING_SCOPES.providerDefault]:
    PrismaModelPricingScope.PROVIDER_DEFAULT,
  [MODEL_PRICING_SCOPES.globalDefault]: PrismaModelPricingScope.GLOBAL_DEFAULT,
} as const satisfies Record<ModelPricingScope, PrismaModelPricingScope>;

const PRISMA_MODEL_PRICING_SCOPE_TO_CONTRACT = {
  [PrismaModelPricingScope.EXACT_MODEL]: MODEL_PRICING_SCOPES.exactModel,
  [PrismaModelPricingScope.PROVIDER_DEFAULT]:
    MODEL_PRICING_SCOPES.providerDefault,
  [PrismaModelPricingScope.GLOBAL_DEFAULT]: MODEL_PRICING_SCOPES.globalDefault,
} as const satisfies Record<PrismaModelPricingScope, ModelPricingScope>;

/** Maps model pricing scope from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaModelPricingScope(
  scope: ModelPricingScope,
): PrismaModelPricingScope {
  return mapEnumValue(
    MODEL_PRICING_SCOPE_TO_PRISMA,
    scope,
    "Unsupported model pricing scope",
  );
}

/** Maps model pricing scope from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaModelPricingScope(
  scope: PrismaModelPricingScope,
): ModelPricingScope {
  return mapEnumValue(
    PRISMA_MODEL_PRICING_SCOPE_TO_CONTRACT,
    scope,
    "Unsupported Prisma model pricing scope",
  );
}

const TOKEN_BUCKET_POLICY_TO_PRISMA = {
  [TOKEN_BUCKET_POLICIES.separateRate]: PrismaTokenBucketPolicy.SEPARATE_RATE,
  [TOKEN_BUCKET_POLICIES.useOutputRate]:
    PrismaTokenBucketPolicy.USE_OUTPUT_RATE,
  [TOKEN_BUCKET_POLICIES.includedInOutput]:
    PrismaTokenBucketPolicy.INCLUDED_IN_OUTPUT,
  [TOKEN_BUCKET_POLICIES.unsupported]: PrismaTokenBucketPolicy.UNSUPPORTED,
} as const satisfies Record<TokenBucketPolicy, PrismaTokenBucketPolicy>;

const PRISMA_TOKEN_BUCKET_POLICY_TO_CONTRACT = {
  [PrismaTokenBucketPolicy.SEPARATE_RATE]: TOKEN_BUCKET_POLICIES.separateRate,
  [PrismaTokenBucketPolicy.USE_OUTPUT_RATE]:
    TOKEN_BUCKET_POLICIES.useOutputRate,
  [PrismaTokenBucketPolicy.INCLUDED_IN_OUTPUT]:
    TOKEN_BUCKET_POLICIES.includedInOutput,
  [PrismaTokenBucketPolicy.UNSUPPORTED]: TOKEN_BUCKET_POLICIES.unsupported,
} as const satisfies Record<PrismaTokenBucketPolicy, TokenBucketPolicy>;

/** Maps token-bucket billing policy from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaTokenBucketPolicy(
  policy: TokenBucketPolicy,
): PrismaTokenBucketPolicy {
  return mapEnumValue(
    TOKEN_BUCKET_POLICY_TO_PRISMA,
    policy,
    "Unsupported token bucket policy",
  );
}

/** Maps token-bucket billing policy from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaTokenBucketPolicy(
  policy: PrismaTokenBucketPolicy,
): TokenBucketPolicy {
  return mapEnumValue(
    PRISMA_TOKEN_BUCKET_POLICY_TO_CONTRACT,
    policy,
    "Unsupported Prisma token bucket policy",
  );
}

const MODEL_USAGE_DEBIT_MODE_TO_PRISMA = {
  [MODEL_USAGE_DEBIT_MODES.OFF]: PrismaModelUsageDebitMode.OFF,
  [MODEL_USAGE_DEBIT_MODES.SHADOW]: PrismaModelUsageDebitMode.SHADOW,
  [MODEL_USAGE_DEBIT_MODES.ON]: PrismaModelUsageDebitMode.ON,
} as const satisfies Record<ModelUsageDebitMode, PrismaModelUsageDebitMode>;

const PRISMA_MODEL_USAGE_DEBIT_MODE_TO_CONTRACT = {
  [PrismaModelUsageDebitMode.OFF]: MODEL_USAGE_DEBIT_MODES.OFF,
  [PrismaModelUsageDebitMode.SHADOW]: MODEL_USAGE_DEBIT_MODES.SHADOW,
  [PrismaModelUsageDebitMode.ON]: MODEL_USAGE_DEBIT_MODES.ON,
} as const satisfies Record<PrismaModelUsageDebitMode, ModelUsageDebitMode>;

/** Maps model-usage debit rollout mode from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaModelUsageDebitMode(
  mode: ModelUsageDebitMode,
): PrismaModelUsageDebitMode {
  return mapEnumValue(
    MODEL_USAGE_DEBIT_MODE_TO_PRISMA,
    mode,
    "Unsupported model usage debit mode",
  );
}

/** Maps model-usage debit rollout mode from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaModelUsageDebitMode(
  mode: PrismaModelUsageDebitMode,
): ModelUsageDebitMode {
  return mapEnumValue(
    PRISMA_MODEL_USAGE_DEBIT_MODE_TO_CONTRACT,
    mode,
    "Unsupported Prisma model usage debit mode",
  );
}

const ADMISSION_FUNDING_PRINCIPAL_TO_PRISMA = {
  [ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET]:
    PrismaAdmissionFundingPrincipal.CUSTOMER_WALLET,
  [ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED]:
    PrismaAdmissionFundingPrincipal.PLATFORM_SPONSORED,
} as const satisfies Record<
  AdmissionFundingPrincipal,
  PrismaAdmissionFundingPrincipal
>;

const PRISMA_ADMISSION_FUNDING_PRINCIPAL_TO_CONTRACT = {
  [PrismaAdmissionFundingPrincipal.CUSTOMER_WALLET]:
    ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
  [PrismaAdmissionFundingPrincipal.PLATFORM_SPONSORED]:
    ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
} as const satisfies Record<
  PrismaAdmissionFundingPrincipal,
  AdmissionFundingPrincipal
>;

/** Maps admission funding principal from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaAdmissionFundingPrincipal(
  principal: AdmissionFundingPrincipal,
): PrismaAdmissionFundingPrincipal {
  return mapEnumValue(
    ADMISSION_FUNDING_PRINCIPAL_TO_PRISMA,
    principal,
    "Unsupported admission funding principal",
  );
}

/** Maps admission funding principal from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaAdmissionFundingPrincipal(
  principal: PrismaAdmissionFundingPrincipal,
): AdmissionFundingPrincipal {
  return mapEnumValue(
    PRISMA_ADMISSION_FUNDING_PRINCIPAL_TO_CONTRACT,
    principal,
    "Unsupported Prisma admission funding principal",
  );
}

const ADMISSION_STATE_TO_PRISMA = {
  [ADMISSION_STATES.REQUESTED]: PrismaAdmissionState.REQUESTED,
  [ADMISSION_STATES.ADMITTED]: PrismaAdmissionState.ADMITTED,
  [ADMISSION_STATES.REJECTED]: PrismaAdmissionState.REJECTED,
  [ADMISSION_STATES.IN_FLIGHT]: PrismaAdmissionState.IN_FLIGHT,
  [ADMISSION_STATES.EXPIRED]: PrismaAdmissionState.EXPIRED,
  [ADMISSION_STATES.REVOKED]: PrismaAdmissionState.REVOKED,
  [ADMISSION_STATES.DISPATCH_UNKNOWN]: PrismaAdmissionState.DISPATCH_UNKNOWN,
  [ADMISSION_STATES.OUTCOME_UNKNOWN]: PrismaAdmissionState.OUTCOME_UNKNOWN,
  [ADMISSION_STATES.CONFIRMED_NO_USAGE]:
    PrismaAdmissionState.CONFIRMED_NO_USAGE,
  [ADMISSION_STATES.SETTLED]: PrismaAdmissionState.SETTLED,
  [ADMISSION_STATES.BILLING_INTEGRITY_REVIEW]:
    PrismaAdmissionState.BILLING_INTEGRITY_REVIEW,
  [ADMISSION_STATES.COMPENSATED]: PrismaAdmissionState.COMPENSATED,
} as const satisfies Record<AdmissionState, PrismaAdmissionState>;

const PRISMA_ADMISSION_STATE_TO_CONTRACT = {
  [PrismaAdmissionState.REQUESTED]: ADMISSION_STATES.REQUESTED,
  [PrismaAdmissionState.ADMITTED]: ADMISSION_STATES.ADMITTED,
  [PrismaAdmissionState.REJECTED]: ADMISSION_STATES.REJECTED,
  [PrismaAdmissionState.IN_FLIGHT]: ADMISSION_STATES.IN_FLIGHT,
  [PrismaAdmissionState.EXPIRED]: ADMISSION_STATES.EXPIRED,
  [PrismaAdmissionState.REVOKED]: ADMISSION_STATES.REVOKED,
  [PrismaAdmissionState.DISPATCH_UNKNOWN]: ADMISSION_STATES.DISPATCH_UNKNOWN,
  [PrismaAdmissionState.OUTCOME_UNKNOWN]: ADMISSION_STATES.OUTCOME_UNKNOWN,
  [PrismaAdmissionState.CONFIRMED_NO_USAGE]:
    ADMISSION_STATES.CONFIRMED_NO_USAGE,
  [PrismaAdmissionState.SETTLED]: ADMISSION_STATES.SETTLED,
  [PrismaAdmissionState.BILLING_INTEGRITY_REVIEW]:
    ADMISSION_STATES.BILLING_INTEGRITY_REVIEW,
  [PrismaAdmissionState.COMPENSATED]: ADMISSION_STATES.COMPENSATED,
} as const satisfies Record<PrismaAdmissionState, AdmissionState>;

/** Maps billable invocation admission state from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaAdmissionState(
  state: AdmissionState,
): PrismaAdmissionState {
  return mapEnumValue(
    ADMISSION_STATE_TO_PRISMA,
    state,
    "Unsupported admission state",
  );
}

/** Maps billable invocation admission state from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaAdmissionState(
  state: PrismaAdmissionState,
): AdmissionState {
  return mapEnumValue(
    PRISMA_ADMISSION_STATE_TO_CONTRACT,
    state,
    "Unsupported Prisma admission state",
  );
}

const PROVIDER_COMPLETION_STATE_TO_PRISMA = {
  [PROVIDER_COMPLETION_STATES.COMPLETED]:
    PrismaProviderCompletionState.COMPLETED,
  [PROVIDER_COMPLETION_STATES.MAX_TOKENS]:
    PrismaProviderCompletionState.MAX_TOKENS,
  [PROVIDER_COMPLETION_STATES.TRUNCATED]:
    PrismaProviderCompletionState.TRUNCATED,
  [PROVIDER_COMPLETION_STATES.FAILED]: PrismaProviderCompletionState.FAILED,
  [PROVIDER_COMPLETION_STATES.OUTCOME_UNKNOWN]:
    PrismaProviderCompletionState.OUTCOME_UNKNOWN,
} as const satisfies Record<
  ProviderCompletionState,
  PrismaProviderCompletionState
>;

const PRISMA_PROVIDER_COMPLETION_STATE_TO_CONTRACT = {
  [PrismaProviderCompletionState.COMPLETED]:
    PROVIDER_COMPLETION_STATES.COMPLETED,
  [PrismaProviderCompletionState.MAX_TOKENS]:
    PROVIDER_COMPLETION_STATES.MAX_TOKENS,
  [PrismaProviderCompletionState.TRUNCATED]:
    PROVIDER_COMPLETION_STATES.TRUNCATED,
  [PrismaProviderCompletionState.FAILED]: PROVIDER_COMPLETION_STATES.FAILED,
  [PrismaProviderCompletionState.OUTCOME_UNKNOWN]:
    PROVIDER_COMPLETION_STATES.OUTCOME_UNKNOWN,
} as const satisfies Record<
  PrismaProviderCompletionState,
  ProviderCompletionState
>;

/** Maps provider completion state from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaProviderCompletionState(
  state: ProviderCompletionState,
): PrismaProviderCompletionState {
  return mapEnumValue(
    PROVIDER_COMPLETION_STATE_TO_PRISMA,
    state,
    "Unsupported provider completion state",
  );
}

/** Maps provider completion state from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaProviderCompletionState(
  state: PrismaProviderCompletionState,
): ProviderCompletionState {
  return mapEnumValue(
    PRISMA_PROVIDER_COMPLETION_STATE_TO_CONTRACT,
    state,
    "Unsupported Prisma provider completion state",
  );
}

const OUTPUT_EVALUATION_STATE_TO_PRISMA = {
  [OUTPUT_EVALUATION_STATES.ACCEPTED]: PrismaOutputEvaluationState.ACCEPTED,
  [OUTPUT_EVALUATION_STATES.SCHEMA_INVALID]:
    PrismaOutputEvaluationState.SCHEMA_INVALID,
  [OUTPUT_EVALUATION_STATES.DOMAIN_REJECTED]:
    PrismaOutputEvaluationState.DOMAIN_REJECTED,
  [OUTPUT_EVALUATION_STATES.NOT_EVALUATED]:
    PrismaOutputEvaluationState.NOT_EVALUATED,
} as const satisfies Record<OutputEvaluationState, PrismaOutputEvaluationState>;

const PRISMA_OUTPUT_EVALUATION_STATE_TO_CONTRACT = {
  [PrismaOutputEvaluationState.ACCEPTED]: OUTPUT_EVALUATION_STATES.ACCEPTED,
  [PrismaOutputEvaluationState.SCHEMA_INVALID]:
    OUTPUT_EVALUATION_STATES.SCHEMA_INVALID,
  [PrismaOutputEvaluationState.DOMAIN_REJECTED]:
    OUTPUT_EVALUATION_STATES.DOMAIN_REJECTED,
  [PrismaOutputEvaluationState.NOT_EVALUATED]:
    OUTPUT_EVALUATION_STATES.NOT_EVALUATED,
} as const satisfies Record<PrismaOutputEvaluationState, OutputEvaluationState>;

/** Maps output evaluation state from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaOutputEvaluationState(
  state: OutputEvaluationState,
): PrismaOutputEvaluationState {
  return mapEnumValue(
    OUTPUT_EVALUATION_STATE_TO_PRISMA,
    state,
    "Unsupported output evaluation state",
  );
}

/** Maps output evaluation state from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaOutputEvaluationState(
  state: PrismaOutputEvaluationState,
): OutputEvaluationState {
  return mapEnumValue(
    PRISMA_OUTPUT_EVALUATION_STATE_TO_CONTRACT,
    state,
    "Unsupported Prisma output evaluation state",
  );
}

const CREDIT_LEDGER_SOURCE_TO_PRISMA = {
  [CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT]:
    PrismaCreditLedgerSource.BILLING_ORDER_CREDIT,
  [CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT]:
    PrismaCreditLedgerSource.MODEL_USAGE_DEBIT,
  [CREDIT_LEDGER_SOURCES.COMPENSATION]: PrismaCreditLedgerSource.COMPENSATION,
  [CREDIT_LEDGER_SOURCES.GOODWILL_CREDIT]:
    PrismaCreditLedgerSource.GOODWILL_CREDIT,
} as const satisfies Record<CreditLedgerSource, PrismaCreditLedgerSource>;

const PRISMA_CREDIT_LEDGER_SOURCE_TO_CONTRACT = {
  [PrismaCreditLedgerSource.BILLING_ORDER_CREDIT]:
    CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
  [PrismaCreditLedgerSource.MODEL_USAGE_DEBIT]:
    CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
  [PrismaCreditLedgerSource.COMPENSATION]: CREDIT_LEDGER_SOURCES.COMPENSATION,
  [PrismaCreditLedgerSource.GOODWILL_CREDIT]:
    CREDIT_LEDGER_SOURCES.GOODWILL_CREDIT,
} as const satisfies Record<PrismaCreditLedgerSource, CreditLedgerSource>;

/** Maps credit ledger source from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaCreditLedgerSource(
  source: CreditLedgerSource,
): PrismaCreditLedgerSource {
  return mapEnumValue(
    CREDIT_LEDGER_SOURCE_TO_PRISMA,
    source,
    "Unsupported credit ledger source",
  );
}

/** Maps credit ledger source from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaCreditLedgerSource(
  source: PrismaCreditLedgerSource,
): CreditLedgerSource {
  return mapEnumValue(
    PRISMA_CREDIT_LEDGER_SOURCE_TO_CONTRACT,
    source,
    "Unsupported Prisma credit ledger source",
  );
}

// Why: Isolates Prisma's CustomerTariffDraftStatus enum at the persistence boundary so
// domain services and controllers strictly consume `@lcsp/contracts/billing` constants.
// How: Exhaustive bidirectional maps checked with `mapEnumValue` (using `Object.hasOwn`).
// Invariants: Rejects unknown strings and prototype keys (`toString`, `constructor`, `__proto__`).
const CUSTOMER_TARIFF_DRAFT_STATUS_TO_PRISMA = {
  [CUSTOMER_TARIFF_DRAFT_STATUSES.draft]: PrismaCustomerTariffDraftStatus.DRAFT,
  [CUSTOMER_TARIFF_DRAFT_STATUSES.published]:
    PrismaCustomerTariffDraftStatus.PUBLISHED,
  [CUSTOMER_TARIFF_DRAFT_STATUSES.abandoned]:
    PrismaCustomerTariffDraftStatus.ABANDONED,
} as const satisfies Record<
  CustomerTariffDraftStatus,
  PrismaCustomerTariffDraftStatus
>;

const PRISMA_CUSTOMER_TARIFF_DRAFT_STATUS_TO_CONTRACT = {
  [PrismaCustomerTariffDraftStatus.DRAFT]: CUSTOMER_TARIFF_DRAFT_STATUSES.draft,
  [PrismaCustomerTariffDraftStatus.PUBLISHED]:
    CUSTOMER_TARIFF_DRAFT_STATUSES.published,
  [PrismaCustomerTariffDraftStatus.ABANDONED]:
    CUSTOMER_TARIFF_DRAFT_STATUSES.abandoned,
} as const satisfies Record<
  PrismaCustomerTariffDraftStatus,
  CustomerTariffDraftStatus
>;

/** Maps customer tariff draft status from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaCustomerTariffDraftStatus(
  status: CustomerTariffDraftStatus,
): PrismaCustomerTariffDraftStatus {
  return mapEnumValue(
    CUSTOMER_TARIFF_DRAFT_STATUS_TO_PRISMA,
    status,
    "Unsupported customer tariff draft status",
  );
}

/** Maps customer tariff draft status from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaCustomerTariffDraftStatus(
  status: PrismaCustomerTariffDraftStatus,
): CustomerTariffDraftStatus {
  return mapEnumValue(
    PRISMA_CUSTOMER_TARIFF_DRAFT_STATUS_TO_CONTRACT,
    status,
    "Unsupported Prisma customer tariff draft status",
  );
}

const RECONCILIATION_STATE_TO_PRISMA = {
  [RECONCILIATION_CASE_STATES.OPEN]: PrismaBillingReconciliationState.OPEN,
  [RECONCILIATION_CASE_STATES.EVIDENCE_PENDING]:
    PrismaBillingReconciliationState.EVIDENCE_PENDING,
  [RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW]:
    PrismaBillingReconciliationState.INTEGRITY_REVIEW,
  [RECONCILIATION_CASE_STATES.SETTLED_WITH_USAGE]:
    PrismaBillingReconciliationState.SETTLED_WITH_USAGE,
  [RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE]:
    PrismaBillingReconciliationState.CONFIRMED_NO_USAGE,
  [RECONCILIATION_CASE_STATES.ESCALATED]:
    PrismaBillingReconciliationState.ESCALATED,
  [RECONCILIATION_CASE_STATES.CLOSED]: PrismaBillingReconciliationState.CLOSED,
} as const satisfies Record<
  ReconciliationCaseState,
  PrismaBillingReconciliationState
>;

const PRISMA_RECONCILIATION_STATE_TO_CONTRACT = {
  [PrismaBillingReconciliationState.OPEN]: RECONCILIATION_CASE_STATES.OPEN,
  [PrismaBillingReconciliationState.EVIDENCE_PENDING]:
    RECONCILIATION_CASE_STATES.EVIDENCE_PENDING,
  [PrismaBillingReconciliationState.INTEGRITY_REVIEW]:
    RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
  [PrismaBillingReconciliationState.SETTLED_WITH_USAGE]:
    RECONCILIATION_CASE_STATES.SETTLED_WITH_USAGE,
  [PrismaBillingReconciliationState.CONFIRMED_NO_USAGE]:
    RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE,
  [PrismaBillingReconciliationState.ESCALATED]:
    RECONCILIATION_CASE_STATES.ESCALATED,
  [PrismaBillingReconciliationState.CLOSED]: RECONCILIATION_CASE_STATES.CLOSED,
} as const satisfies Record<
  PrismaBillingReconciliationState,
  ReconciliationCaseState
>;

/** Maps billing reconciliation state from `@lcsp/contracts/billing` to Prisma. */
export function toPrismaBillingReconciliationState(
  state: ReconciliationCaseState,
): PrismaBillingReconciliationState {
  return mapEnumValue(
    RECONCILIATION_STATE_TO_PRISMA,
    state,
    "Unsupported billing reconciliation state",
  );
}

/** Maps billing reconciliation state from Prisma to `@lcsp/contracts/billing`. */
export function fromPrismaBillingReconciliationState(
  state: PrismaBillingReconciliationState,
): ReconciliationCaseState {
  return mapEnumValue(
    PRISMA_RECONCILIATION_STATE_TO_CONTRACT,
    state,
    "Unsupported Prisma billing reconciliation state",
  );
}
