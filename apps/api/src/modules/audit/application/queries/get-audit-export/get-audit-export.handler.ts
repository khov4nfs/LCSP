import {
  AUDIT_ERROR_CODES,
  AUDIT_EXPORT_STATUSES,
  type AuditExportStatus,
} from "@lcsp/contracts/audit";
import { ORGANIZATION_SCOPE_ERROR_CODES } from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AuditExportStorageService } from "../../../infrastructure/storage/audit-export-storage.service.js";
import type { AuditExportStatusDto } from "../../contracts/audit/audit-export.contract.js";
import { GetAuditExportQuery } from "./get-audit-export.query.js";

const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1_000;

/**
 * Resolves audit-export lifecycle metadata and issues a short-lived signed download URL once the artifact is ready.
 */
@QueryHandler(GetAuditExportQuery)
export class GetAuditExportHandler implements IQueryHandler<GetAuditExportQuery> {
  /**
   * Creates the status handler with export persistence and signed-download support.
   *
   * @param prisma - Prisma service used to retrieve export request state.
   * @param storage - Storage/signing service used to create expiring download URLs.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AuditExportStorageService,
  ) {}

  /**
   * Validates organization scope and returns current export status plus download metadata when ready.
   *
   * @param query - Organization boundary, export identifier, session scope, and correlation context.
   * @returns Audit-export status DTO with an optional short-lived download URL.
   * @throws When organization scope mismatches or the export request cannot be found.
   */
  async execute(query: GetAuditExportQuery): Promise<AuditExportStatusDto> {
    if (query.organizationId !== query.sessionOrganizationId) {
      throw problemException(
        ORGANIZATION_SCOPE_ERROR_CODES.mismatch,
        query.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const exportRequest = await this.prisma.auditExportRequest.findFirst({
      where: {
        id: query.exportRequestId,
        organizationId: query.organizationId,
      },
      select: {
        id: true,
        fromDate: true,
        toDate: true,
        status: true,
        version: true,
        checksumSha256: true,
        correlationId: true,
        createdAt: true,
        completedAt: true,
      },
    });

    if (!exportRequest) {
      throw problemException(
        AUDIT_ERROR_CODES.exportNotFound,
        query.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    const status = toAuditExportStatus(
      exportRequest.status,
      query.correlationId,
    );
    const download =
      status === AUDIT_EXPORT_STATUSES.ready
        ? this.buildDownload(query.organizationId, exportRequest.id)
        : null;

    return {
      export_request_id: exportRequest.id,
      status,
      from_date: exportRequest.fromDate.toISOString(),
      to_date: exportRequest.toDate.toISOString(),
      version: exportRequest.version,
      generated_at: exportRequest.completedAt?.toISOString() ?? null,
      checksum_sha256: exportRequest.checksumSha256,
      requested_at: exportRequest.createdAt.toISOString(),
      completed_at: exportRequest.completedAt?.toISOString() ?? null,
      download_url: download?.url ?? null,
      download_url_expires_at: download?.expiresAt ?? null,
      correlationId: exportRequest.correlationId,
    };
  }

  /**
   * Creates a five-minute signed download URL for a ready audit export.
   *
   * @param organizationId - Organization that owns the export.
   * @param exportRequestId - Export request identifier embedded in the signed token.
   * @returns Signed relative URL and its ISO expiration timestamp.
   */
  private buildDownload(
    organizationId: string,
    exportRequestId: string,
  ): { url: string; expiresAt: string } {
    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_MS);
    return {
      url: this.storage.createSignedDownloadUrl({
        organizationId,
        exportRequestId,
        expiresAt,
      }),
      expiresAt: expiresAt.toISOString(),
    };
  }
}

/**
 * Narrows a persisted export status string to the supported audit-export lifecycle contract.
 *
 * @param value - Persisted export status value.
 * @param correlationId - Correlation identifier attached to failures.
 * @returns Supported audit-export status.
 * @throws An export-not-found problem for unknown persistence states.
 */
function toAuditExportStatus(
  value: string,
  correlationId: string,
): AuditExportStatus {
  switch (value) {
    case AUDIT_EXPORT_STATUSES.queued:
    case AUDIT_EXPORT_STATUSES.generating:
    case AUDIT_EXPORT_STATUSES.ready:
    case AUDIT_EXPORT_STATUSES.failed:
      return value;
    default:
      throw problemException(AUDIT_ERROR_CODES.exportNotFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
  }
}
