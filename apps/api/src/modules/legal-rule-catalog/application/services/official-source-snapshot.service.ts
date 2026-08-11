import { HttpStatus, Injectable } from "@nestjs/common";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { LEGAL_RULE_ERROR_CODES } from "@lcsp/contracts/legal-rule-catalog";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import type {
  OfficialSourceSnapshotRecord,
  RegisterOfficialSourceSnapshotRequest,
} from "../contracts/official-source-snapshot.contract.js";

const SNAPSHOT_REF_PATTERN = /^snapshot:[A-Za-z0-9:_-]{8,180}$/;
const SNAPSHOT_OBJECT_KEY_PATTERN =
  /^legal-source-snapshots\/[A-Za-z0-9._-]{3,120}\/[A-Za-z0-9._:-]{3,180}\/[a-fA-F0-9]{64}\/[A-Za-z0-9._-]{3,255}$/;
const SHA_256_PATTERN = /^sha256:[a-fA-F0-9]{64}$/;

@Injectable()
export class OfficialSourceSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async register(
    input: RegisterOfficialSourceSnapshotRequest,
    correlationId: string,
  ): Promise<OfficialSourceSnapshotRecord> {
    validateRegisterInput(input, correlationId);

    const existing = await this.prisma.legalSourceSnapshot.findUnique({
      where: { snapshotRef: input.snapshotRef },
    });
    if (existing) {
      if (!matchesExisting(existing, input)) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.sourceSnapshotConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return this.toRecord(existing);
    }

    const created = await this.prisma.legalSourceSnapshot.create({
      data: {
        snapshotRef: input.snapshotRef,
        snapshotId: snapshotIdFromRef(input.snapshotRef),
        catalogSourceRef: input.catalogSourceRef,
        adminCatalogVersion: input.adminCatalogVersion,
        documentId: input.documentId,
        documentNumber: normalizeOptional(input.documentNumber),
        sourceUrl: input.sourceUrl,
        finalUrl: normalizeOptional(input.finalUrl),
        contentType: input.contentType,
        byteLength: input.byteLength,
        contentSha256: input.contentSha256,
        snapshotObjectKey: input.snapshotObjectKey,
        provenanceRef: input.provenanceRef,
        retrievedAt: new Date(input.retrievedAt),
        sourceEffectStatus: normalizeOptional(input.sourceEffectStatus),
        normalizationSource: normalizeOptional(input.normalizationSource),
        identityVerified: input.documentIdentityVerified,
        correlationId,
      },
    });

    await this.auditWriter.write({
      eventType: "LEGAL_SOURCE_SNAPSHOT_STORED",
      actorId: null,
      organizationId: null,
      resourceType: null,
      resourceId: created.snapshotRef,
      decision: AUDIT_DECISIONS.allow,
      correlationId,
      payload: {
        snapshotRef: created.snapshotRef,
        snapshotId: created.snapshotId,
        documentId: created.documentId,
        contentSha256: created.contentSha256,
        snapshotObjectKey: created.snapshotObjectKey,
        catalogSourceRef: created.catalogSourceRef,
      },
    });

    return this.toRecord(created);
  }

  async get(
    input: { snapshotRef?: string; snapshotId?: string },
    correlationId: string,
  ): Promise<OfficialSourceSnapshotRecord> {
    const snapshotRef = input.snapshotRef?.trim() || undefined;
    const snapshotId = input.snapshotId?.trim() || undefined;
    if (!snapshotRef && !snapshotId) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const record = await this.prisma.legalSourceSnapshot.findFirst({
      where: snapshotRef ? { snapshotRef } : { snapshotId },
    });
    if (!record) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.sourceSnapshotNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    await this.auditWriter.write({
      eventType: "LEGAL_SOURCE_SNAPSHOT_READ",
      actorId: null,
      organizationId: null,
      resourceType: null,
      resourceId: record.snapshotRef,
      decision: AUDIT_DECISIONS.allow,
      correlationId,
      payload: {
        snapshotRef: record.snapshotRef,
        snapshotId: record.snapshotId,
        documentId: record.documentId,
      },
    });

    return this.toRecord(record);
  }

  private toRecord(
    snapshot: Awaited<
      ReturnType<typeof this.prisma.legalSourceSnapshot.create>
    >,
  ): OfficialSourceSnapshotRecord {
    return {
      snapshotRef: snapshot.snapshotRef,
      snapshotId: snapshot.snapshotId,
      catalogSourceRef: snapshot.catalogSourceRef,
      adminCatalogVersion: snapshot.adminCatalogVersion,
      documentId: snapshot.documentId,
      documentNumber: snapshot.documentNumber,
      sourceUrl: snapshot.sourceUrl,
      finalUrl: snapshot.finalUrl,
      contentType: snapshot.contentType,
      byteLength: snapshot.byteLength,
      contentSha256: snapshot.contentSha256,
      snapshotObjectKey: snapshot.snapshotObjectKey,
      provenanceRef: snapshot.provenanceRef,
      retrievedAt: snapshot.retrievedAt.toISOString(),
      sourceEffectStatus: snapshot.sourceEffectStatus,
      normalizationSource: snapshot.normalizationSource,
      documentIdentityVerified: snapshot.identityVerified,
      createdAt: snapshot.createdAt.toISOString(),
    };
  }
}

function validateRegisterInput(
  input: RegisterOfficialSourceSnapshotRequest,
  correlationId: string,
): void {
  const valid =
    SNAPSHOT_REF_PATTERN.test(input.snapshotRef) &&
    Boolean(input.catalogSourceRef?.trim()) &&
    Boolean(input.adminCatalogVersion?.trim()) &&
    Boolean(input.documentId?.trim()) &&
    Boolean(input.sourceUrl?.trim()) &&
    optionalUrlIsValid(input.finalUrl) &&
    Boolean(input.contentType?.trim()) &&
    Number.isInteger(input.byteLength) &&
    input.byteLength >= 0 &&
    SHA_256_PATTERN.test(input.contentSha256) &&
    SNAPSHOT_OBJECT_KEY_PATTERN.test(input.snapshotObjectKey) &&
    Boolean(input.provenanceRef?.trim()) &&
    !Number.isNaN(Date.parse(input.retrievedAt)) &&
    optionalScalarLooksSafe(input.sourceEffectStatus) &&
    optionalScalarLooksSafe(input.normalizationSource) &&
    optionalScalarLooksSafe(input.documentNumber);
  if (!valid) {
    throw problemException(
      LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }

  const snapshotId = snapshotIdFromRef(input.snapshotRef);
  if (!input.snapshotObjectKey.includes(`/${input.documentId}/`)) {
    throw problemException(
      LEGAL_RULE_ERROR_CODES.sourceSnapshotConflict,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    !input.snapshotObjectKey.includes(
      input.contentSha256.replace(/^sha256:/, ""),
    )
  ) {
    throw problemException(
      LEGAL_RULE_ERROR_CODES.sourceSnapshotConflict,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (!snapshotId) {
    throw problemException(
      LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
}

function snapshotIdFromRef(snapshotRef: string): string {
  return snapshotRef.replace(/^snapshot:/, "");
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function optionalUrlIsValid(value: string | null | undefined): boolean {
  if (!value) {
    return true;
  }
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.hostname);
  } catch {
    return false;
  }
}

function optionalScalarLooksSafe(value: string | null | undefined): boolean {
  return value == null || value.trim().length <= 255;
}

function matchesExisting(
  existing: {
    snapshotId: string;
    catalogSourceRef: string;
    adminCatalogVersion: string;
    documentId: string;
    documentNumber: string | null;
    sourceUrl: string;
    finalUrl: string | null;
    contentType: string;
    byteLength: number;
    contentSha256: string;
    snapshotObjectKey: string;
    provenanceRef: string;
    sourceEffectStatus: string | null;
    normalizationSource: string | null;
    identityVerified: boolean;
    retrievedAt: Date;
  },
  input: RegisterOfficialSourceSnapshotRequest,
): boolean {
  return (
    existing.snapshotId === snapshotIdFromRef(input.snapshotRef) &&
    existing.catalogSourceRef === input.catalogSourceRef &&
    existing.adminCatalogVersion === input.adminCatalogVersion &&
    existing.documentId === input.documentId &&
    existing.documentNumber === normalizeOptional(input.documentNumber) &&
    existing.sourceUrl === input.sourceUrl &&
    existing.finalUrl === normalizeOptional(input.finalUrl) &&
    existing.contentType === input.contentType &&
    existing.byteLength === input.byteLength &&
    existing.contentSha256 === input.contentSha256 &&
    existing.snapshotObjectKey === input.snapshotObjectKey &&
    existing.provenanceRef === input.provenanceRef &&
    existing.sourceEffectStatus ===
      normalizeOptional(input.sourceEffectStatus) &&
    existing.normalizationSource ===
      normalizeOptional(input.normalizationSource) &&
    existing.identityVerified === input.documentIdentityVerified &&
    existing.retrievedAt.toISOString() ===
      new Date(input.retrievedAt).toISOString()
  );
}
