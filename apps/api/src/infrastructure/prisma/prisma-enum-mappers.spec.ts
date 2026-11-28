import { describe, expect, it } from "@jest/globals";
import {
  AdmissionFundingPrincipal as PrismaAdmissionFundingPrincipal,
  AdmissionState as PrismaAdmissionState,
  AuditResourceType as PrismaAuditResourceType,
  AuthBackupEmailPolicy as PrismaAuthBackupEmailPolicy,
  AuthDecision as PrismaAuthDecision,
  AuthPrimaryEmailAddressPolicy as PrismaAuthPrimaryEmailAddressPolicy,
  AuthUserRole as PrismaAuthUserRole,
  BillingReconciliationState as PrismaBillingReconciliationState,
  CreditLedgerSource as PrismaCreditLedgerSource,
  CredentialProvider as PrismaCredentialProvider,
  CustomerTariffDraftStatus as PrismaCustomerTariffDraftStatus,
  LegalSourceDocumentCorpusRole as PrismaCorpusRole,
  LegalSourceDocumentIngestionState as PrismaLegalSourceDocumentIngestionState,
  LegalSourceDocumentOrigin as PrismaLegalSourceDocumentOrigin,
  LegalSourceLifecycleStatus as PrismaLegalSourceLifecycleStatus,
  ModelPricingScope as PrismaModelPricingScope,
  ModelUsageDebitMode as PrismaModelUsageDebitMode,
  OutboxAggregateType as PrismaOutboxAggregateType,
  OutboxStatus as PrismaOutboxStatus,
  OutputEvaluationState as PrismaOutputEvaluationState,
  ProviderCompletionState as PrismaProviderCompletionState,
  RepositoryConnectionStatus as PrismaRepositoryConnectionStatus,
  RepositoryScanJobStatus as PrismaRepositoryScanJobStatus,
  RepositoryScanTriggerSource as PrismaRepositoryScanTriggerSource,
  RepositorySnapshotStatus as PrismaRepositorySnapshotStatus,
  TokenBucketPolicy as PrismaTokenBucketPolicy,
} from "@prisma/client";

import {
  AUDIT_DECISIONS,
  AUDIT_EXPORT_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
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
  type AdmissionState,
  type CustomerTariffDraftStatus,
  type ModelPricingScope,
  type ReconciliationCaseState,
} from "@lcsp/contracts/billing";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  REPOSITORY_SNAPSHOT_STATUSES,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import {
  LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES,
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES,
  LEGAL_SOURCE_DOCUMENT_ORIGINS,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-source";
import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";

import {
  fromPrismaAdmissionFundingPrincipal,
  fromPrismaAdmissionState,
  fromPrismaAuthBackupEmailPolicy,
  fromPrismaAuthDecision,
  fromPrismaAuthPrimaryEmailAddressPolicy,
  fromPrismaAuthUserRole,
  fromPrismaBillingReconciliationState,
  fromPrismaCreditLedgerSource,
  fromPrismaCredentialProvider,
  fromPrismaCustomerTariffDraftStatus,
  fromPrismaLegalSourceDocumentCorpusRole,
  fromPrismaLegalSourceDocumentIngestionState,
  fromPrismaLegalSourceDocumentOrigin,
  fromPrismaLegalSourceLifecycleStatus,
  fromPrismaModelPricingScope,
  fromPrismaModelUsageDebitMode,
  fromPrismaOutboxAggregateType,
  fromPrismaOutboxStatus,
  fromPrismaOutputEvaluationState,
  fromPrismaProviderCompletionState,
  fromPrismaRepositoryConnectionStatus,
  fromPrismaRepositoryScanJobStatus,
  fromPrismaRepositoryScanTriggerSource,
  fromPrismaTokenBucketPolicy,
  toPrismaAdmissionFundingPrincipal,
  toPrismaAdmissionState,
  toPrismaAuditExportStatus,
  toPrismaAuditResourceType,
  toPrismaAuthBackupEmailPolicy,
  toPrismaAuthDecision,
  toPrismaAuthPrimaryEmailAddressPolicy,
  toPrismaAuthUserRole,
  toPrismaBillingReconciliationState,
  toPrismaCreditLedgerSource,
  toPrismaCredentialProvider,
  toPrismaCustomerTariffDraftStatus,
  toPrismaLegalSourceDocumentCorpusRole,
  toPrismaLegalSourceDocumentIngestionState,
  toPrismaLegalSourceDocumentOrigin,
  toPrismaLegalSourceLifecycleStatus,
  toPrismaModelPricingScope,
  toPrismaModelUsageDebitMode,
  toPrismaOutboxAggregateType,
  toPrismaOutboxStatus,
  toPrismaOutputEvaluationState,
  toPrismaProviderCompletionState,
  toPrismaRepositoryConnectionStatus,
  toPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanTriggerSource,
  toPrismaRepositorySnapshotStatus,
  toPrismaTokenBucketPolicy,
} from "./prisma-enum-mappers.js";

describe("prisma-enum-mappers", () => {
  describe("Silent Fallback Hazard Reproducer (RED Test)", () => {
    it("R01: throws an Error when mapping an unknown contract provider (refuses silent GITHUB fallback)", () => {
      expect(() =>
        toPrismaCredentialProvider(
          "unknown_provider" as unknown as CredentialProvider,
        ),
      ).toThrow("Unsupported credential provider");
    });

    it("R02: throws an Error when mapping an unknown Prisma credential provider (refuses silent GITHUB fallback)", () => {
      expect(() =>
        fromPrismaCredentialProvider(
          "UNKNOWN_PRISMA" as unknown as PrismaCredentialProvider,
        ),
      ).toThrow("Unsupported Prisma credential provider");
    });
  });

  describe("Round-Trip Integrity for all Mapped Enums", () => {
    it("round-trips AuthUserRole", () => {
      for (const role of Object.values(AUTH_USER_ROLES)) {
        expect(fromPrismaAuthUserRole(toPrismaAuthUserRole(role))).toBe(role);
      }
      for (const prismaRole of Object.values(PrismaAuthUserRole)) {
        expect(toPrismaAuthUserRole(fromPrismaAuthUserRole(prismaRole))).toBe(
          prismaRole,
        );
      }
    });

    it("round-trips AuthDecision", () => {
      for (const decision of Object.values(AUDIT_DECISIONS)) {
        expect(fromPrismaAuthDecision(toPrismaAuthDecision(decision))).toBe(
          decision,
        );
      }
      for (const prismaDecision of Object.values(PrismaAuthDecision)) {
        expect(
          toPrismaAuthDecision(fromPrismaAuthDecision(prismaDecision)),
        ).toBe(prismaDecision);
      }
    });

    it("round-trips AuthBackupEmailPolicy", () => {
      for (const policy of Object.values(AUTH_BACKUP_EMAIL_POLICIES)) {
        expect(
          fromPrismaAuthBackupEmailPolicy(
            toPrismaAuthBackupEmailPolicy(policy),
          ),
        ).toBe(policy);
      }
      for (const prismaPolicy of Object.values(PrismaAuthBackupEmailPolicy)) {
        expect(
          toPrismaAuthBackupEmailPolicy(
            fromPrismaAuthBackupEmailPolicy(prismaPolicy),
          ),
        ).toBe(prismaPolicy);
      }
    });

    it("round-trips AuthPrimaryEmailAddressPolicy", () => {
      for (const policy of Object.values(AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES)) {
        expect(
          fromPrismaAuthPrimaryEmailAddressPolicy(
            toPrismaAuthPrimaryEmailAddressPolicy(policy),
          ),
        ).toBe(policy);
      }
      for (const prismaPolicy of Object.values(
        PrismaAuthPrimaryEmailAddressPolicy,
      )) {
        expect(
          toPrismaAuthPrimaryEmailAddressPolicy(
            fromPrismaAuthPrimaryEmailAddressPolicy(prismaPolicy),
          ),
        ).toBe(prismaPolicy);
      }
    });

    it("round-trips CredentialProvider", () => {
      for (const provider of Object.values(CREDENTIAL_PROVIDERS)) {
        expect(
          fromPrismaCredentialProvider(toPrismaCredentialProvider(provider)),
        ).toBe(provider);
      }
      for (const prismaProvider of Object.values(PrismaCredentialProvider)) {
        expect(
          toPrismaCredentialProvider(
            fromPrismaCredentialProvider(prismaProvider),
          ),
        ).toBe(prismaProvider);
      }
    });

    it("round-trips OutboxAggregateType", () => {
      for (const type of Object.values(OUTBOX_AGGREGATE_TYPES)) {
        expect(
          fromPrismaOutboxAggregateType(toPrismaOutboxAggregateType(type)),
        ).toBe(type);
      }
      for (const prismaType of Object.values(PrismaOutboxAggregateType)) {
        expect(
          toPrismaOutboxAggregateType(
            fromPrismaOutboxAggregateType(prismaType),
          ),
        ).toBe(prismaType);
      }
    });

    it("round-trips OutboxStatus", () => {
      for (const status of Object.values(OUTBOX_STATUSES)) {
        expect(fromPrismaOutboxStatus(toPrismaOutboxStatus(status))).toBe(
          status,
        );
      }
      for (const prismaStatus of Object.values(PrismaOutboxStatus)) {
        expect(toPrismaOutboxStatus(fromPrismaOutboxStatus(prismaStatus))).toBe(
          prismaStatus,
        );
      }
    });

    it("round-trips RepositoryConnectionStatus", () => {
      for (const status of Object.values(REPOSITORY_CONNECTION_STATUSES)) {
        expect(
          fromPrismaRepositoryConnectionStatus(
            toPrismaRepositoryConnectionStatus(status),
          ),
        ).toBe(status);
      }
      for (const prismaStatus of Object.values(
        PrismaRepositoryConnectionStatus,
      )) {
        expect(
          toPrismaRepositoryConnectionStatus(
            fromPrismaRepositoryConnectionStatus(prismaStatus),
          ),
        ).toBe(prismaStatus);
      }
    });

    it("round-trips RepositoryScanJobStatus", () => {
      for (const status of Object.values(REPOSITORY_SCAN_JOB_STATUSES)) {
        expect(
          fromPrismaRepositoryScanJobStatus(
            toPrismaRepositoryScanJobStatus(status),
          ),
        ).toBe(status);
      }
      for (const prismaStatus of Object.values(PrismaRepositoryScanJobStatus)) {
        expect(
          toPrismaRepositoryScanJobStatus(
            fromPrismaRepositoryScanJobStatus(prismaStatus),
          ),
        ).toBe(prismaStatus);
      }
    });

    it("round-trips RepositoryScanTriggerSource", () => {
      for (const source of Object.values(REPOSITORY_SCAN_TRIGGER_SOURCES)) {
        expect(
          fromPrismaRepositoryScanTriggerSource(
            toPrismaRepositoryScanTriggerSource(source),
          ),
        ).toBe(source);
      }
      for (const prismaSource of Object.values(
        PrismaRepositoryScanTriggerSource,
      )) {
        expect(
          toPrismaRepositoryScanTriggerSource(
            fromPrismaRepositoryScanTriggerSource(prismaSource),
          ),
        ).toBe(prismaSource);
      }
    });

    it("maps RepositorySnapshotStatus and AuditResourceType and AuditExportStatus", () => {
      for (const status of Object.values(REPOSITORY_SNAPSHOT_STATUSES)) {
        expect(toPrismaRepositorySnapshotStatus(status)).toBe(
          PrismaRepositorySnapshotStatus.READY,
        );
      }
      for (const exportStatus of Object.values(AUDIT_EXPORT_STATUSES)) {
        expect(toPrismaAuditExportStatus(exportStatus)).toBeDefined();
      }
      for (const resType of Object.values(AUDIT_RESOURCE_TYPES)) {
        expect(toPrismaAuditResourceType(resType)).toBeDefined();
      }
    });

    it("round-trips LegalSourceLifecycleStatus", () => {
      for (const status of Object.values(LEGAL_SOURCE_LIFECYCLE_STATUSES)) {
        expect(
          fromPrismaLegalSourceLifecycleStatus(
            toPrismaLegalSourceLifecycleStatus(status),
          ),
        ).toBe(status);
      }
      for (const prismaStatus of Object.values(
        PrismaLegalSourceLifecycleStatus,
      )) {
        expect(
          toPrismaLegalSourceLifecycleStatus(
            fromPrismaLegalSourceLifecycleStatus(prismaStatus),
          ),
        ).toBe(prismaStatus);
      }
    });

    it("round-trips LegalSourceDocumentOrigin", () => {
      for (const origin of Object.values(LEGAL_SOURCE_DOCUMENT_ORIGINS)) {
        expect(
          fromPrismaLegalSourceDocumentOrigin(
            toPrismaLegalSourceDocumentOrigin(origin),
          ),
        ).toBe(origin);
      }
      for (const prismaOrigin of Object.values(
        PrismaLegalSourceDocumentOrigin,
      )) {
        expect(
          toPrismaLegalSourceDocumentOrigin(
            fromPrismaLegalSourceDocumentOrigin(prismaOrigin),
          ),
        ).toBe(prismaOrigin);
      }
    });

    it("round-trips LegalSourceDocumentIngestionState", () => {
      for (const state of Object.values(
        LEGAL_SOURCE_DOCUMENT_INGESTION_STATES,
      )) {
        expect(
          fromPrismaLegalSourceDocumentIngestionState(
            toPrismaLegalSourceDocumentIngestionState(state),
          ),
        ).toBe(state);
      }
      for (const prismaState of Object.values(
        PrismaLegalSourceDocumentIngestionState,
      )) {
        expect(
          toPrismaLegalSourceDocumentIngestionState(
            fromPrismaLegalSourceDocumentIngestionState(prismaState),
          ),
        ).toBe(prismaState);
      }
    });

    it("round-trips LegalSourceDocumentCorpusRole", () => {
      for (const role of Object.values(LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES)) {
        expect(
          fromPrismaLegalSourceDocumentCorpusRole(
            toPrismaLegalSourceDocumentCorpusRole(role),
          ),
        ).toBe(role);
      }
      for (const prismaRole of Object.values(PrismaCorpusRole)) {
        expect(
          toPrismaLegalSourceDocumentCorpusRole(
            fromPrismaLegalSourceDocumentCorpusRole(prismaRole),
          ),
        ).toBe(prismaRole);
      }
    });

    // Why: Verify 1:1 round-trip parity and fail-closed behavior for all WP8 direct-credit
    // pricing, admission, receipt, and output-evaluation mappers between @lcsp/contracts/billing
    // and generated @prisma/client enums.
    // How: Iterate both Object.values(CONTRACT_CONST) and Object.values(PrismaEnum) for each pair,
    // plus assert unknown runtime strings throw explicit Errors rather than falling back silently.
    // Invariants: Every WP8 enum member uses SCREAMING_SNAKE_CASE and maps bijectively.
    it("round-trips ModelPricingScope and fails closed on unknown values", () => {
      for (const scope of Object.values(MODEL_PRICING_SCOPES)) {
        expect(
          fromPrismaModelPricingScope(toPrismaModelPricingScope(scope)),
        ).toBe(scope);
      }
      for (const prismaScope of Object.values(PrismaModelPricingScope)) {
        expect(
          toPrismaModelPricingScope(fromPrismaModelPricingScope(prismaScope)),
        ).toBe(prismaScope);
      }
      expect(() =>
        toPrismaModelPricingScope(
          "UNKNOWN_SCOPE" as unknown as ModelPricingScope,
        ),
      ).toThrow("Unsupported model pricing scope");
      expect(() =>
        fromPrismaModelPricingScope(
          "UNKNOWN_PRISMA_SCOPE" as unknown as PrismaModelPricingScope,
        ),
      ).toThrow("Unsupported Prisma model pricing scope");
    });

    it("round-trips TokenBucketPolicy", () => {
      for (const policy of Object.values(TOKEN_BUCKET_POLICIES)) {
        expect(
          fromPrismaTokenBucketPolicy(toPrismaTokenBucketPolicy(policy)),
        ).toBe(policy);
      }
      for (const prismaPolicy of Object.values(PrismaTokenBucketPolicy)) {
        expect(
          toPrismaTokenBucketPolicy(fromPrismaTokenBucketPolicy(prismaPolicy)),
        ).toBe(prismaPolicy);
      }
    });

    it("round-trips ModelUsageDebitMode", () => {
      for (const mode of Object.values(MODEL_USAGE_DEBIT_MODES)) {
        expect(
          fromPrismaModelUsageDebitMode(toPrismaModelUsageDebitMode(mode)),
        ).toBe(mode);
      }
      for (const prismaMode of Object.values(PrismaModelUsageDebitMode)) {
        expect(
          toPrismaModelUsageDebitMode(
            fromPrismaModelUsageDebitMode(prismaMode),
          ),
        ).toBe(prismaMode);
      }
    });

    it("round-trips AdmissionFundingPrincipal", () => {
      for (const principal of Object.values(ADMISSION_FUNDING_PRINCIPALS)) {
        expect(
          fromPrismaAdmissionFundingPrincipal(
            toPrismaAdmissionFundingPrincipal(principal),
          ),
        ).toBe(principal);
      }
      for (const prismaPrincipal of Object.values(
        PrismaAdmissionFundingPrincipal,
      )) {
        expect(
          toPrismaAdmissionFundingPrincipal(
            fromPrismaAdmissionFundingPrincipal(prismaPrincipal),
          ),
        ).toBe(prismaPrincipal);
      }
    });

    it("round-trips AdmissionState and fails closed on unknown values", () => {
      for (const state of Object.values(ADMISSION_STATES)) {
        expect(fromPrismaAdmissionState(toPrismaAdmissionState(state))).toBe(
          state,
        );
      }
      for (const prismaState of Object.values(PrismaAdmissionState)) {
        expect(
          toPrismaAdmissionState(fromPrismaAdmissionState(prismaState)),
        ).toBe(prismaState);
      }
      expect(() =>
        toPrismaAdmissionState("UNKNOWN_STATE" as unknown as AdmissionState),
      ).toThrow("Unsupported admission state");
      expect(() =>
        fromPrismaAdmissionState(
          "UNKNOWN_PRISMA_STATE" as unknown as PrismaAdmissionState,
        ),
      ).toThrow("Unsupported Prisma admission state");
    });

    it("round-trips ProviderCompletionState", () => {
      for (const state of Object.values(PROVIDER_COMPLETION_STATES)) {
        expect(
          fromPrismaProviderCompletionState(
            toPrismaProviderCompletionState(state),
          ),
        ).toBe(state);
      }
      for (const prismaState of Object.values(PrismaProviderCompletionState)) {
        expect(
          toPrismaProviderCompletionState(
            fromPrismaProviderCompletionState(prismaState),
          ),
        ).toBe(prismaState);
      }
    });

    it("round-trips OutputEvaluationState", () => {
      for (const state of Object.values(OUTPUT_EVALUATION_STATES)) {
        expect(
          fromPrismaOutputEvaluationState(toPrismaOutputEvaluationState(state)),
        ).toBe(state);
      }
      for (const prismaState of Object.values(PrismaOutputEvaluationState)) {
        expect(
          toPrismaOutputEvaluationState(
            fromPrismaOutputEvaluationState(prismaState),
          ),
        ).toBe(prismaState);
      }
    });

    it("round-trips CreditLedgerSource", () => {
      for (const source of Object.values(CREDIT_LEDGER_SOURCES)) {
        expect(
          fromPrismaCreditLedgerSource(toPrismaCreditLedgerSource(source)),
        ).toBe(source);
      }
      for (const prismaSource of Object.values(PrismaCreditLedgerSource)) {
        expect(
          toPrismaCreditLedgerSource(
            fromPrismaCreditLedgerSource(prismaSource),
          ),
        ).toBe(prismaSource);
      }
    });

    it("round-trips BillingReconciliationState and fails closed on unknown values", () => {
      for (const state of Object.values(RECONCILIATION_CASE_STATES)) {
        expect(
          fromPrismaBillingReconciliationState(
            toPrismaBillingReconciliationState(state),
          ),
        ).toBe(state);
      }
      for (const prismaState of Object.values(
        PrismaBillingReconciliationState,
      )) {
        expect(
          toPrismaBillingReconciliationState(
            fromPrismaBillingReconciliationState(prismaState),
          ),
        ).toBe(prismaState);
      }
      expect(() =>
        toPrismaBillingReconciliationState(
          "UNKNOWN_RECON_STATE" as unknown as ReconciliationCaseState,
        ),
      ).toThrow("Unsupported billing reconciliation state");
      expect(() =>
        fromPrismaBillingReconciliationState(
          "UNKNOWN_PRISMA_RECON_STATE" as unknown as PrismaBillingReconciliationState,
        ),
      ).toThrow("Unsupported Prisma billing reconciliation state");
    });

    it("round-trips CustomerTariffDraftStatus and fails closed on unknown values", () => {
      for (const status of Object.values(CUSTOMER_TARIFF_DRAFT_STATUSES)) {
        expect(
          fromPrismaCustomerTariffDraftStatus(
            toPrismaCustomerTariffDraftStatus(status),
          ),
        ).toBe(status);
      }
      for (const prismaStatus of Object.values(
        PrismaCustomerTariffDraftStatus,
      )) {
        expect(
          toPrismaCustomerTariffDraftStatus(
            fromPrismaCustomerTariffDraftStatus(prismaStatus),
          ),
        ).toBe(prismaStatus);
      }
      expect(() =>
        toPrismaCustomerTariffDraftStatus(
          "UNKNOWN_DRAFT_STATUS" as unknown as CustomerTariffDraftStatus,
        ),
      ).toThrow("Unsupported customer tariff draft status");
      expect(() =>
        fromPrismaCustomerTariffDraftStatus(
          "UNKNOWN_PRISMA_DRAFT_STATUS" as unknown as PrismaCustomerTariffDraftStatus,
        ),
      ).toThrow("Unsupported Prisma customer tariff draft status");
    });

    it("maps AuditResourceType.CUSTOMER_MODEL_TARIFF and OutboxAggregateType.CUSTOMER_MODEL_TARIFF", () => {
      expect(
        toPrismaAuditResourceType(AUDIT_RESOURCE_TYPES.customerModelTariff),
      ).toBe(PrismaAuditResourceType.CUSTOMER_MODEL_TARIFF);
      expect(
        toPrismaOutboxAggregateType(OUTBOX_AGGREGATE_TYPES.customerModelTariff),
      ).toBe(PrismaOutboxAggregateType.CUSTOMER_MODEL_TARIFF);
      expect(
        fromPrismaOutboxAggregateType(
          PrismaOutboxAggregateType.CUSTOMER_MODEL_TARIFF,
        ),
      ).toBe(OUTBOX_AGGREGATE_TYPES.customerModelTariff);
    });

    it("maps OutboxAggregateType.BILLING_WALLET", () => {
      expect(
        toPrismaOutboxAggregateType(OUTBOX_AGGREGATE_TYPES.billingWallet),
      ).toBe(PrismaOutboxAggregateType.BILLING_WALLET);
      expect(
        fromPrismaOutboxAggregateType(PrismaOutboxAggregateType.BILLING_WALLET),
      ).toBe(OUTBOX_AGGREGATE_TYPES.billingWallet);
    });
  });

  describe("WP8 Mappers Prototype-Key Hardening (Object.hasOwn RED Test)", () => {
    const PROTOTYPE_KEYS = [
      "toString",
      "constructor",
      "valueOf",
      "__proto__",
    ] as const;

    it.each(PROTOTYPE_KEYS)(
      "rejects Object.prototype key %s across all WP8 mappers",
      (protoKey) => {
        const mappers: Array<(value: never) => unknown> = [
          toPrismaModelPricingScope,
          fromPrismaModelPricingScope,
          toPrismaTokenBucketPolicy,
          fromPrismaTokenBucketPolicy,
          toPrismaModelUsageDebitMode,
          fromPrismaModelUsageDebitMode,
          toPrismaAdmissionFundingPrincipal,
          fromPrismaAdmissionFundingPrincipal,
          toPrismaAdmissionState,
          fromPrismaAdmissionState,
          toPrismaProviderCompletionState,
          fromPrismaProviderCompletionState,
          toPrismaOutputEvaluationState,
          fromPrismaOutputEvaluationState,
          toPrismaCreditLedgerSource,
          fromPrismaCreditLedgerSource,
          toPrismaCustomerTariffDraftStatus,
          fromPrismaCustomerTariffDraftStatus,
          toPrismaBillingReconciliationState,
          fromPrismaBillingReconciliationState,
        ];

        for (const mapper of mappers) {
          expect(() => mapper(protoKey as never)).toThrow();
        }
      },
    );
  });
});
