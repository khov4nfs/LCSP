import { createHash } from "node:crypto";

import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  LEGACY_ARTIFACT_AVAILABILITIES,
  LEGACY_MIGRATION_AUDIT_EVENT_TYPES,
  LEGACY_MIGRATION_ERROR_CODES,
} from "@lcsp/contracts/legacy-migration";
import { HttpStatus } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { LegacyArchiveReadRepository } from "../../../infrastructure/persistence/legacy-archive-read.repository.js";
import { LegacyArchiveBlobStore } from "../../../infrastructure/storage/legacy-archive-blob.store.js";
import {
  DownloadLegacyArchiveReportQuery,
  type LegacyArchiveReportFile,
} from "./download-legacy-archive-report.query.js";

@QueryHandler(DownloadLegacyArchiveReportQuery)
export class DownloadLegacyArchiveReportHandler implements IQueryHandler<DownloadLegacyArchiveReportQuery> {
  constructor(
    private readonly archive: LegacyArchiveReadRepository,
    private readonly blobs: LegacyArchiveBlobStore,
    private readonly audit: AuditWriterService,
  ) {}

  async execute(
    query: DownloadLegacyArchiveReportQuery,
  ): Promise<LegacyArchiveReportFile> {
    const target = await this.archive.downloadable(
      query.ownerId,
      query.assessmentId,
      query.recordId,
    );
    if (!target)
      throw problemException(
        LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_ARTIFACT_NOT_AVAILABLE,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );

    let content: Buffer;
    if (target.blob) {
      // Bytes are served only after they re-hash to the hash recorded at copy time.
      try {
        content = await this.blobs.read(target.blob.storageRef);
      } catch {
        throw this.integrityFailure(query.correlationId);
      }
      if (
        content.length !== target.blob.sizeBytes ||
        createHash("sha256").update(content).digest("hex") !==
          target.blob.contentSha256
      )
        throw this.integrityFailure(query.correlationId);
    } else {
      content = target.inline!;
    }

    const sha256 = createHash("sha256").update(content).digest("hex");
    await this.audit.write({
      eventType:
        LEGACY_MIGRATION_AUDIT_EVENT_TYPES.LEGACY_ARCHIVE_REPORT_DOWNLOADED,
      actorId: query.ownerId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: query.assessmentId,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        recordId: target.recordId,
        availability: LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE,
        sha256,
        sizeBytes: content.length,
      },
    });
    return {
      recordId: target.recordId,
      filename: `legacy-report-${target.recordId}.${target.extension}`,
      mediaType: target.mediaType,
      content,
      sha256,
    };
  }

  private integrityFailure(correlationId: string) {
    return problemException(
      LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_ARTIFACT_INTEGRITY_FAILED,
      correlationId,
      { status: HttpStatus.INTERNAL_SERVER_ERROR },
    );
  }
}
