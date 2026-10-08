import { createHash } from "node:crypto";

import {
  LEGACY_ARCHIVE_SOURCES,
  LEGACY_ARTIFACT_AVAILABILITIES,
  type LegacyArchiveDetail,
  type LegacyArchiveReportItem,
  type LegacyArchiveSummary,
} from "@lcsp/contracts/legacy-migration";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  availabilityOf,
  mediaTypeForReference,
  utcIso,
} from "../../domain/legacy-report-availability.js";

const REPORT_SOURCES = [
  LEGACY_ARCHIVE_SOURCES.DOCUMENT_REQUEST,
  LEGACY_ARCHIVE_SOURCES.READINESS_EXPORT,
] as const;

type ReportRecord = Prisma.LegacyArchiveRecordGetPayload<{
  include: { blob: true };
}>;

export type ArchivedReportDownload = {
  recordId: string;
  assessmentId: string;
  mediaType: string;
  extension: string;
  /** Inline exports are served from the archived row; byte copies from the verified blob. */
  inline: Buffer | null;
  blob: { storageRef: string; contentSha256: string; sizeBytes: number } | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** Read-only access to the legacy archive. Every query is scoped to the owning customer. */
@Injectable()
export class LegacyArchiveReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    ownerId: string,
    page: number,
    pageSize: number,
  ): Promise<{ archives: LegacyArchiveSummary[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.legacyAssessmentArchive.findMany({
        where: { ownerId },
        include: { assessment: { select: { name: true } } },
        orderBy: [{ legacyUpdatedAt: "desc" }, { assessmentId: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.legacyAssessmentArchive.count({ where: { ownerId } }),
    ]);
    const records = await this.prisma.legacyArchiveRecord.findMany({
      where: {
        assessmentId: { in: rows.map((row) => row.assessmentId) },
        sourceTable: { in: [...REPORT_SOURCES] },
      },
      select: { assessmentId: true, reconciliationClass: true },
    });
    const counts = new Map<string, { reports: number; downloadable: number }>();
    for (const record of records) {
      if (!record.assessmentId || !record.reconciliationClass) continue;
      const entry = counts.get(record.assessmentId) ?? {
        reports: 0,
        downloadable: 0,
      };
      entry.reports += 1;
      if (
        availabilityOf(record.reconciliationClass) ===
        LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE
      )
        entry.downloadable += 1;
      counts.set(record.assessmentId, entry);
    }
    return {
      archives: rows.map((row) => ({
        assessment_id: row.assessmentId,
        name: row.assessment.name,
        disposition: row.disposition,
        legacy_status: row.legacyStatus,
        legacy_created_at: row.legacyCreatedAt.toISOString(),
        legacy_updated_at: row.legacyUpdatedAt.toISOString(),
        archived_at: row.archivedAt.toISOString(),
        v2_lifecycle_state: row.v2LifecycleState,
        report_count: counts.get(row.assessmentId)?.reports ?? 0,
        downloadable_report_count:
          counts.get(row.assessmentId)?.downloadable ?? 0,
      })),
      total,
    };
  }

  /** `null` when the assessment is not archived OR belongs to another customer (indistinguishable). */
  async detail(
    ownerId: string,
    assessmentId: string,
  ): Promise<Omit<LegacyArchiveDetail, "correlationId"> | null> {
    const row = await this.prisma.legacyAssessmentArchive.findFirst({
      where: { assessmentId, ownerId },
      include: { assessment: { select: { name: true } } },
    });
    if (!row) return null;
    const records = await this.reportRecords(assessmentId);
    const reports = records.map((record) => this.toReportItem(record));
    return {
      assessment_id: row.assessmentId,
      name: row.assessment.name,
      disposition: row.disposition,
      legacy_status: row.legacyStatus,
      legacy_created_at: row.legacyCreatedAt.toISOString(),
      legacy_updated_at: row.legacyUpdatedAt.toISOString(),
      archived_at: row.archivedAt.toISOString(),
      v2_lifecycle_state: row.v2LifecycleState,
      report_count: reports.length,
      downloadable_report_count: reports.filter(
        (report) =>
          report.availability === LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE,
      ).length,
      reports,
    };
  }

  /** `null` unless the record belongs to this customer's archived assessment AND is downloadable. */
  async downloadable(
    ownerId: string,
    assessmentId: string,
    recordId: string,
  ): Promise<ArchivedReportDownload | null> {
    const owned = await this.prisma.legacyAssessmentArchive.findFirst({
      where: { assessmentId, ownerId },
      select: { assessmentId: true },
    });
    if (!owned) return null;
    const record = await this.prisma.legacyArchiveRecord.findFirst({
      where: {
        id: recordId,
        assessmentId,
        sourceTable: { in: [...REPORT_SOURCES] },
      },
      include: { blob: true },
    });
    if (
      !record?.reconciliationClass ||
      availabilityOf(record.reconciliationClass) !==
        LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE
    )
      return null;
    const payload = asRecord(record.payload);
    if (record.blob) {
      const type = mediaTypeForReference(text(payload.documentUrl));
      return {
        recordId: record.id,
        assessmentId,
        ...type,
        inline: null,
        blob: {
          storageRef: record.blob.storageRef,
          contentSha256: record.blob.contentSha256,
          sizeBytes: record.blob.sizeBytes,
        },
      };
    }
    if (payload.contentJson === undefined || payload.contentJson === null)
      return null;
    return {
      recordId: record.id,
      assessmentId,
      mediaType: "application/json",
      extension: "json",
      inline: Buffer.from(JSON.stringify(payload.contentJson), "utf8"),
      blob: null,
    };
  }

  private reportRecords(assessmentId: string): Promise<ReportRecord[]> {
    return this.prisma.legacyArchiveRecord.findMany({
      where: { assessmentId, sourceTable: { in: [...REPORT_SOURCES] } },
      include: { blob: true },
      orderBy: [{ sourceTable: "asc" }, { sourceId: "asc" }],
    });
  }

  private toReportItem(record: ReportRecord): LegacyArchiveReportItem {
    // Report records always carry a classification (a DB CHECK pairs it with the source).
    const reconciliationClass = record.reconciliationClass!;
    const reconciliationReason = record.reconciliationReason!;
    const payload = asRecord(record.payload);
    const isExport =
      record.sourceTable === LEGACY_ARCHIVE_SOURCES.READINESS_EXPORT;
    const inline =
      !record.blob &&
      payload.contentJson !== undefined &&
      payload.contentJson !== null
        ? Buffer.from(JSON.stringify(payload.contentJson), "utf8")
        : null;
    return {
      recordId: record.id,
      sourceTable: isExport
        ? LEGACY_ARCHIVE_SOURCES.READINESS_EXPORT
        : LEGACY_ARCHIVE_SOURCES.DOCUMENT_REQUEST,
      documentType: isExport ? "READINESS_EXPORT" : text(payload.documentType),
      requestStatus: text(payload.status),
      requestedAt: utcIso(isExport ? payload.generatedAt : payload.createdAt),
      reconciliationClass,
      reconciliationReason,
      availability: availabilityOf(reconciliationClass),
      sizeBytes: record.blob?.sizeBytes ?? inline?.length ?? null,
      contentSha256:
        record.blob?.contentSha256 ??
        (inline ? createHash("sha256").update(inline).digest("hex") : null),
    };
  }
}
