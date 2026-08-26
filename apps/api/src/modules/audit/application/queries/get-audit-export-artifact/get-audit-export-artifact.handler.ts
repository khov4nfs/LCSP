import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AUDIT_ERROR_CODES } from "@lcsp/contracts/audit";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { AuditExportArtifact } from "../../contracts/audit/audit-export.contract.js";
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads and validates one audit-export artifact.
   *
   * @param query - Organization, export request identifier, and correlation context.
   * @returns The persisted audit-export artifact.
   * @throws An export-not-found problem when the record is absent, cross-tenant, or structurally invalid.
   */
  async execute(
    query: GetAuditExportArtifactQuery,
  ): Promise<AuditExportArtifact> {
    const exportRequest = await this.prisma.auditExportRequest.findFirst({
      where: {
        id: query.exportRequestId,
      },
      select: {
        contentJson: true,
      },
    });

    if (!exportRequest || !isAuditExportArtifact(exportRequest.contentJson)) {
      throw problemException(
        AUDIT_ERROR_CODES.exportNotFound,
        query.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    return exportRequest.contentJson;
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
