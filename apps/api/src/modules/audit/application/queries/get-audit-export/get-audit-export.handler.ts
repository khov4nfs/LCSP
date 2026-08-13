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

@QueryHandler(GetAuditExportQuery)
export class GetAuditExportHandler implements IQueryHandler<GetAuditExportQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AuditExportStorageService,
  ) {}

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
