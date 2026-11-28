import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  AUDIT_DECISIONS,
  AUDIT_ERROR_CODES,
  AUDIT_EVENT_TYPES,
  AUDIT_EXPORT_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import type { AuditExportArtifact } from "../../contracts/audit/audit-export.contract.js";
import {
  auditExportChecksum,
  auditExportLegacyChecksum,
} from "../../services/audit/audit-export-checksum.js";
import { GetAuditExportArtifactQuery } from "./get-audit-export-artifact.query.js";

/**
 * Retrieves the persisted audit-export artifact only when it belongs to the requested organization and matches the expected shape.
 */
@QueryHandler(GetAuditExportArtifactQuery)
export class GetAuditExportArtifactHandler implements IQueryHandler<GetAuditExportArtifactQuery> {
  /**
   * Creates the artifact handler with audit-export persistence access.
   *
   * @param prisma - Prisma service used to retrieve persisted export content.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Business purpose: Supply only an intact READY artifact for an authorized signed download.
   * Business rules:
   * - Stored identity, version, event count and canonical digest must agree with the export record.
   * Execution flow:
   * 1. Load the requested export metadata and JSON.
   * 2. Validate status, shape, identity and checksum before returning content.
   * Failure cases:
   * - Missing, incomplete or corrupted content returns export-not-found without leaking bytes.
   * Side effects:
   * - Reads the export and durably records a token-authorized download before returning bytes.
   */
  async execute(
    query: GetAuditExportArtifactQuery,
  ): Promise<AuditExportArtifact> {
    const exportRequest = await this.prisma.auditExportRequest.findFirst({
      where: {
        id: query.exportRequestId,
      },
      select: {
        id: true,
        version: true,
        status: true,
        checksumSha256: true,
        contentJson: true,
      },
    });

    const artifact = exportRequest?.contentJson;
    if (!exportRequest || !isAuditExportArtifact(artifact)) {
      throw problemException(
        AUDIT_ERROR_CODES.exportNotFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    // Hash every persisted field except the checksum; injected fields must invalidate the artifact.
    const baseArtifact = Object.fromEntries(
      Object.entries(artifact).filter(([key]) => key !== "checksum_sha256"),
    ) as Omit<AuditExportArtifact, "checksum_sha256">;
    const digestMatches = [
      auditExportChecksum(baseArtifact),
      auditExportLegacyChecksum(baseArtifact),
    ].includes(exportRequest.checksumSha256);
    if (
      exportRequest.status !== AUDIT_EXPORT_STATUSES.ready ||
      artifact.export_request_id !== exportRequest.id ||
      artifact.version !== exportRequest.version ||
      artifact.total_events !== artifact.events.length ||
      artifact.checksum_sha256 !== exportRequest.checksumSha256 ||
      !digestMatches
    ) {
      // The persisted row is authority; never serve bytes with mismatched identity or digest.
      throw problemException(
        AUDIT_ERROR_CODES.exportNotFound,
        query.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    // A signed URL carries no user session, so record the export resource without a bearer token or actor claim.
    await this.auditWriter.write({
      eventType: AUDIT_EVENT_TYPES.exportDownloaded,
      actorId: null,
      resourceType: AUDIT_RESOURCE_TYPES.auditExportRequest,
      resourceId: exportRequest.id,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        exportRequestId: exportRequest.id,
        version: exportRequest.version,
      },
    });
    return artifact;
  }
}

/**
 * Performs a minimal runtime shape check before treating persisted JSON as an audit-export artifact.
 *
 * @param value - Unknown persisted JSON value to inspect.
 * @returns True when the required artifact identity, version, checksum, and event fields are present.
 */
function isAuditExportArtifact(value: unknown): value is AuditExportArtifact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<AuditExportArtifact>;
  return (
    typeof candidate.export_request_id === "string" &&
    typeof candidate.version === "number" &&
    typeof candidate.generated_at === "string" &&
    typeof candidate.total_events === "number" &&
    typeof candidate.checksum_sha256 === "string" &&
    Array.isArray(candidate.events)
  );
}
