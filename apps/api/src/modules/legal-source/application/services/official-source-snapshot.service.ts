import { HttpStatus, Injectable } from "@nestjs/common";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { LEGAL_SOURCE_ERROR_CODES } from "@lcsp/contracts/legal-source";
import { isRecord } from "@lcsp/contracts/shared";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
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

  /**
   * Business purpose: Preserve an immutable official-source snapshot together with its required audit evidence.
   * Business rules:
   * - One snapshot reference identifies one exact immutable payload; an identical concurrent registration may replay the winner.
   * Execution flow:
   * 1. Validate the worker payload and check for an existing identical snapshot.
   * 2. Insert the snapshot and audit in one transaction.
   * 3. On a snapshot-reference unique race, reload and compare the committed winner.
   * Failure cases:
   * - Invalid input or conflicting payload is rejected; audit failure rolls back the snapshot; unrelated database errors propagate.
   * Side effects:
   * - Creates one snapshot and its AuditEvent atomically, or reads an existing matching snapshot without new writes.
   */
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
          LEGAL_SOURCE_ERROR_CODES.sourceSnapshotConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return this.toRecord(existing);
    }

    try {
      // Why: An audit outage must not leave a durable official snapshot without provenance of its registration.
      // How: The snapshot insert and audit write share one PostgreSQL commit boundary.
      // Invariant: A rollback leaves neither row committed.
      const created = await this.prisma.$transaction(async (tx) => {
        const snapshot = await tx.legalSourceSnapshot.create({
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
        await this.auditWriter.writeInTx(
          {
            eventType: "LEGAL_SOURCE_SNAPSHOT_STORED",
            actorId: null,
            resourceType: null,
            resourceId: snapshot.snapshotRef,
            decision: AUDIT_DECISIONS.allow,
            correlationId,
            payload: {
              snapshotRef: snapshot.snapshotRef,
              snapshotId: snapshot.snapshotId,
              documentId: snapshot.documentId,
              contentSha256: snapshot.contentSha256,
              snapshotObjectKey: snapshot.snapshotObjectKey,
              catalogSourceRef: snapshot.catalogSourceRef,
            },
          },
          tx,
        );
        return snapshot;
      });
      return this.toRecord(created);
    } catch (error) {
      if (!isSnapshotReferenceUniqueRace(error)) throw error;
      // Why: Two workers can race after both observe no snapshot.
      // How: Read the committed winner outside the failed transaction and compare all immutable fields.
      // Invariant: A changed payload or missing winner never inherits the other worker's authority.
      const winner = await this.prisma.legalSourceSnapshot.findUnique({
        where: { snapshotRef: input.snapshotRef },
      });
      if (!winner) throw error;
      if (!matchesExisting(winner, input)) {
        throw problemException(
          LEGAL_SOURCE_ERROR_CODES.sourceSnapshotConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return this.toRecord(winner);
    }
  }

  async get(
    input: { snapshotRef?: string; snapshotId?: string },
    correlationId: string,
  ): Promise<OfficialSourceSnapshotRecord> {
    const snapshotRef = input.snapshotRef?.trim() || undefined;
    const snapshotId = input.snapshotId?.trim() || undefined;
    if (!snapshotRef && !snapshotId) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const record = await this.prisma.legalSourceSnapshot.findFirst({
      where: snapshotRef ? { snapshotRef } : { snapshotId },
    });
    if (!record) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.sourceSnapshotNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    await this.auditWriter.write({
      eventType: "LEGAL_SOURCE_SNAPSHOT_READ",
      actorId: null,
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

/**
 * Business purpose: Recognize only the unique race for an official snapshot reference.
 * Business rules:
 * - Other Prisma uniqueness failures remain persistence errors and cannot authorize replay.
 * Execution flow:
 * 1. Match Prisma's known P2002 error.
 * 2. Match the exact snapshot-reference target in array or constraint-name form.
 * Failure cases:
 * - Missing or unrelated target returns false and the caller propagates the original error.
 * Side effects:
 * - Pure error classification with no database access.
 */
function isSnapshotReferenceUniqueRace(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  // Why: A matching field name from another model is not this snapshot's unique race.
  // How: Reject an explicit non-snapshot model before inspecting compatible target shapes.
  // Invariant: An audit or unrelated table failure cannot be mistaken for idempotent registration.
  const modelName = error.meta?.modelName;
  if (typeof modelName === "string" && modelName !== "LegalSourceSnapshot") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.length === 1 && target[0] === "snapshotRef";
  }
  if (target === "LegalSourceSnapshot_snapshotRef_key") return true;
  // Why: Prisma 7's PostgreSQL adapter reports the exact unique index in nested driver metadata.
  // How: Match the model, violation kind and index name instead of parsing a database error message.
  // Invariant: A different unique constraint cannot trigger snapshot replay.
  const meta = error.meta;
  if (!isRecord(meta) || meta.modelName !== "LegalSourceSnapshot") return false;
  const adapter = meta.driverAdapterError;
  if (!isRecord(adapter) || !isRecord(adapter.cause)) return false;
  const cause = adapter.cause;
  return (
    cause.kind === "UniqueConstraintViolation" &&
    isRecord(cause.constraint) &&
    cause.constraint.index === "LegalSourceSnapshot_snapshotRef_key"
  );
}

/**
 * Business purpose: Reject malformed worker provenance before creating immutable official-source evidence.
 * Business rules:
 * - Required identity, source URL, content hash, object key, retrieval time and boolean verification must be valid at runtime.
 * - The object key must bind the requested document and content digest.
 * Execution flow:
 * 1. Check field shapes, URL syntax and verification flag.
 * 2. Check that the snapshot key names the same document and digest.
 * 3. Check the snapshot reference yields an identity.
 * Failure cases:
 * - Invalid fields return the ingest-invalid problem; mismatched key provenance returns snapshot conflict.
 * Side effects:
 * - Pure request validation; no database read or write occurs.
 */
function validateRegisterInput(
  input: RegisterOfficialSourceSnapshotRequest,
  correlationId: string,
): void {
  const valid =
    SNAPSHOT_REF_PATTERN.test(input.snapshotRef) &&
    Boolean(input.catalogSourceRef?.trim()) &&
    Boolean(input.adminCatalogVersion?.trim()) &&
    Boolean(input.documentId?.trim()) &&
    // Why: Worker types do not validate untrusted runtime provenance after deserialization.
    // How: Require a parseable HTTP(S) URL and a real boolean before any snapshot transaction.
    // Invariant: Invalid source identity cannot become immutable legal evidence.
    requiredUrlIsValid(input.sourceUrl) &&
    optionalUrlIsValid(input.finalUrl) &&
    typeof input.documentIdentityVerified === "boolean" &&
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
      LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }

  const snapshotId = snapshotIdFromRef(input.snapshotRef);
  if (!input.snapshotObjectKey.includes(`/${input.documentId}/`)) {
    throw problemException(
      LEGAL_SOURCE_ERROR_CODES.sourceSnapshotConflict,
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
      LEGAL_SOURCE_ERROR_CODES.sourceSnapshotConflict,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (!snapshotId) {
    throw problemException(
      LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
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

/**
 * Business purpose: Accept only a usable external provenance URL for an official-source snapshot.
 * Business rules:
 * - The source URL is required and must use HTTP or HTTPS with a hostname.
 * Execution flow:
 * 1. Parse the submitted URL.
 * 2. Check protocol and host without making a network request.
 * Failure cases:
 * - Missing, malformed, non-web, or hostless URLs return false for controlled request rejection.
 * Side effects:
 * - Pure validation; no DNS or persistence access.
 */
function requiredUrlIsValid(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname !== ""
    );
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
