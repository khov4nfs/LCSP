import { describe, expect, it } from "@jest/globals";
import {
  AuditExportStatus as PrismaAuditExportStatus,
  AuditResourceType as PrismaAuditResourceType,
  AuthBackupEmailPolicy as PrismaAuthBackupEmailPolicy,
  AuthDecision as PrismaAuthDecision,
  AuthPrimaryEmailAddressPolicy as PrismaAuthPrimaryEmailAddressPolicy,
  AuthUserRole as PrismaAuthUserRole,
  CredentialProvider as PrismaCredentialProvider,
  LegalSourceDocumentCorpusRole as PrismaCorpusRole,
  LegalSourceDocumentIngestionState as PrismaLegalSourceDocumentIngestionState,
  LegalSourceDocumentOrigin as PrismaLegalSourceDocumentOrigin,
  LegalSourceLifecycleStatus as PrismaLegalSourceLifecycleStatus,
  OutboxAggregateType as PrismaOutboxAggregateType,
  OutboxStatus as PrismaOutboxStatus,
  RepositoryConnectionStatus as PrismaRepositoryConnectionStatus,
  RepositoryScanJobStatus as PrismaRepositoryScanJobStatus,
  RepositoryScanTriggerSource as PrismaRepositoryScanTriggerSource,
  RepositorySnapshotStatus as PrismaRepositorySnapshotStatus,
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
  fromPrismaAuthBackupEmailPolicy,
  fromPrismaAuthDecision,
  fromPrismaAuthPrimaryEmailAddressPolicy,
  fromPrismaAuthUserRole,
  fromPrismaCredentialProvider,
  fromPrismaLegalSourceDocumentCorpusRole,
  fromPrismaLegalSourceDocumentIngestionState,
  fromPrismaLegalSourceDocumentOrigin,
  fromPrismaLegalSourceLifecycleStatus,
  fromPrismaOutboxAggregateType,
  fromPrismaOutboxStatus,
  fromPrismaRepositoryConnectionStatus,
  fromPrismaRepositoryScanJobStatus,
  fromPrismaRepositoryScanTriggerSource,
  toPrismaAuditExportStatus,
  toPrismaAuditResourceType,
  toPrismaAuthBackupEmailPolicy,
  toPrismaAuthDecision,
  toPrismaAuthPrimaryEmailAddressPolicy,
  toPrismaAuthUserRole,
  toPrismaCredentialProvider,
  toPrismaLegalSourceDocumentCorpusRole,
  toPrismaLegalSourceDocumentIngestionState,
  toPrismaLegalSourceDocumentOrigin,
  toPrismaLegalSourceLifecycleStatus,
  toPrismaOutboxAggregateType,
  toPrismaOutboxStatus,
  toPrismaRepositoryConnectionStatus,
  toPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanTriggerSource,
  toPrismaRepositorySnapshotStatus,
} from "./prisma-enum-mappers.js";

describe("prisma-enum-mappers", () => {
  describe("Silent Fallback Hazard Reproducer (RED Test)", () => {
    it("R01: throws an Error when mapping an unknown contract provider (refuses silent GITHUB fallback)", () => {
      expect(() =>
        toPrismaCredentialProvider("unknown_provider" as unknown as CredentialProvider),
      ).toThrow("Unsupported credential provider");
    });

    it("R02: throws an Error when mapping an unknown Prisma credential provider (refuses silent GITHUB fallback)", () => {
      expect(() =>
        fromPrismaCredentialProvider("UNKNOWN_PRISMA" as unknown as PrismaCredentialProvider),
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
          fromPrismaAuthBackupEmailPolicy(toPrismaAuthBackupEmailPolicy(policy)),
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
          toPrismaOutboxAggregateType(fromPrismaOutboxAggregateType(prismaType)),
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
        expect(
          toPrismaOutboxStatus(fromPrismaOutboxStatus(prismaStatus)),
        ).toBe(prismaStatus);
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
  });
});
