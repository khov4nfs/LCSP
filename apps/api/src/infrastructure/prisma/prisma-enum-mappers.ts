import {
  AuditExportStatus as PrismaAuditExportStatus,
  AuditResourceType as PrismaAuditResourceType,
  AuthBackupEmailPolicy as PrismaAuthBackupEmailPolicy,
  AuthDecision as PrismaAuthDecision,
  AuthPrimaryEmailAddressPolicy as PrismaAuthPrimaryEmailAddressPolicy,
  AuthUserRole as PrismaAuthUserRole,
  LegalRuleLifecycleStatus as PrismaLegalRuleLifecycleStatus,
  OutboxAggregateType as PrismaOutboxAggregateType,
  OutboxStatus as PrismaOutboxStatus,
  CredentialProvider as PrismaCredentialProvider,
  RepositoryConnectionStatus as PrismaRepositoryConnectionStatus,
  RepositoryScanTriggerSource as PrismaRepositoryScanTriggerSource,
  RepositoryScanJobStatus as PrismaRepositoryScanJobStatus,
  RepositorySnapshotStatus as PrismaRepositorySnapshotStatus,
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

import { LEGAL_RULE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-rule-catalog";

import { type LegalRuleLifecycleStatus } from "@lcsp/contracts/legal-rule-catalog";

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
  [AUDIT_RESOURCE_TYPES.legalPortfolioVersion]:
    PrismaAuditResourceType.LEGAL_PORTFOLIO_VERSION,
  [AUDIT_RESOURCE_TYPES.legalRule]: PrismaAuditResourceType.LEGAL_RULE,
  [AUDIT_RESOURCE_TYPES.legalCorpusVersion]:
    PrismaAuditResourceType.LEGAL_CORPUS_VERSION,
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
  [OUTBOX_AGGREGATE_TYPES.assessment]: PrismaOutboxAggregateType.ASSESSMENT,
  [OUTBOX_AGGREGATE_TYPES.authUser]: PrismaOutboxAggregateType.AUTH_USER,
  [OUTBOX_AGGREGATE_TYPES.legalCorpusVersion]:
    PrismaOutboxAggregateType.LEGAL_CORPUS_VERSION,
  [OUTBOX_AGGREGATE_TYPES.legalPortfolioVersion]:
    PrismaOutboxAggregateType.LEGAL_PORTFOLIO_VERSION,
  [OUTBOX_AGGREGATE_TYPES.repositoryScanJob]:
    PrismaOutboxAggregateType.REPOSITORY_SCAN_JOB,
  [OUTBOX_AGGREGATE_TYPES.repositorySnapshot]:
    PrismaOutboxAggregateType.REPOSITORY_SNAPSHOT,
} as const satisfies Record<OutboxAggregateType, PrismaOutboxAggregateType>;

const PRISMA_OUTBOX_AGGREGATE_TYPE_TO_CONTRACT = {
  [PrismaOutboxAggregateType.BILLING_PAYMENT]:
    OUTBOX_AGGREGATE_TYPES.billingPayment,
  [PrismaOutboxAggregateType.ASSESSMENT]: OUTBOX_AGGREGATE_TYPES.assessment,
  [PrismaOutboxAggregateType.AUTH_USER]: OUTBOX_AGGREGATE_TYPES.authUser,
  [PrismaOutboxAggregateType.LEGAL_CORPUS_VERSION]:
    OUTBOX_AGGREGATE_TYPES.legalCorpusVersion,
  [PrismaOutboxAggregateType.LEGAL_PORTFOLIO_VERSION]:
    OUTBOX_AGGREGATE_TYPES.legalPortfolioVersion,
  [PrismaOutboxAggregateType.REPOSITORY_SCAN_JOB]:
    OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
  [PrismaOutboxAggregateType.REPOSITORY_SNAPSHOT]:
    OUTBOX_AGGREGATE_TYPES.repositorySnapshot,
} as const satisfies Partial<
  Record<PrismaOutboxAggregateType, OutboxAggregateType>
>;

const OUTBOX_STATUS_TO_PRISMA = {
  [OUTBOX_STATUSES.pending]: PrismaOutboxStatus.PENDING,
  [OUTBOX_STATUSES.published]: PrismaOutboxStatus.PUBLISHED,
  [OUTBOX_STATUSES.failed]: PrismaOutboxStatus.FAILED,
  [OUTBOX_STATUSES.dlq]: PrismaOutboxStatus.DLQ,
  [OUTBOX_STATUSES.cancelled]: PrismaOutboxStatus.CANCELLED,
} as const satisfies Record<OutboxStatus, PrismaOutboxStatus>;

const PRISMA_OUTBOX_STATUS_TO_CONTRACT = {
  [PrismaOutboxStatus.PENDING]: OUTBOX_STATUSES.pending,
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

/** Maps credential provider from the contract layer to Prisma. @param provider - Contract credential provider. @returns Prisma credential provider. */
export function toPrismaCredentialProvider(
  provider: CredentialProvider,
): PrismaCredentialProvider {
  switch (provider) {
    case CREDENTIAL_PROVIDERS.gitlab:
      return PrismaCredentialProvider.GITLAB;
    case CREDENTIAL_PROVIDERS.bitbucket:
      return PrismaCredentialProvider.BITBUCKET;
    case CREDENTIAL_PROVIDERS.azureDevOps:
      return PrismaCredentialProvider.AZURE_DEVOPS;
    default:
      return PrismaCredentialProvider.GITHUB;
  }
}

/** Maps credential provider from Prisma to the contract layer. @param provider - Prisma credential provider. @returns Contract credential provider. */
export function fromPrismaCredentialProvider(
  provider: PrismaCredentialProvider,
): CredentialProvider {
  switch (provider) {
    case PrismaCredentialProvider.GITLAB:
      return CREDENTIAL_PROVIDERS.gitlab;
    case PrismaCredentialProvider.BITBUCKET:
      return CREDENTIAL_PROVIDERS.bitbucket;
    case PrismaCredentialProvider.AZURE_DEVOPS:
      return CREDENTIAL_PROVIDERS.azureDevOps;
    default:
      return CREDENTIAL_PROVIDERS.github;
  }
}
