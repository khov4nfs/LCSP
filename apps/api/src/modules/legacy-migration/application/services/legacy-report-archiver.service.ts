import { DOCUMENT_REQUEST_STATUSES } from "@lcsp/contracts/document";
import {
  LEGACY_ARCHIVE_SOURCES,
  type LegacyArtifactReconciliationClass,
  type LegacyArtifactReconciliationReason,
} from "@lcsp/contracts/legacy-migration";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  classifyLegacyReadinessExport,
  classifyLegacyReportProbe,
  classifyLegacyReportReference,
  type LegacyReportOutcome,
  type LegacyReportPolicy,
  type LegacyReportProbe,
} from "../../domain/legacy-report-classification.js";
import { parseLegacyReportReference } from "../../domain/legacy-report-reference.js";
import { LegacyArchiveRepository } from "../../infrastructure/persistence/legacy-archive.repository.js";
import { LegacyArchiveBlobStore } from "../../../legacy-archive/infrastructure/storage/legacy-archive-blob.store.js";
import { LegacyReportSourceReader } from "../../infrastructure/storage/legacy-report-source.reader.js";
import type {
  LegacyReportPolicyOptions,
  ReportArchiveResult,
} from "../legacy-migration.types.js";
import { buildLegacyReportPolicy } from "./legacy-report-policy.js";

const BATCH = 100;

type PendingBlob = {
  contentSha256: string;
  sizeBytes: number;
  storageRef: string;
};

/**
 * Archives and reconciles every report-related V1 record (DocumentRequest, ReadinessExport).
 * Presence is only ever claimed for bytes that were really read AND re-verified from storage; a
 * location that cannot be read is left unarchived (undetermined) instead of being guessed at.
 */
@Injectable()
export class LegacyReportArchiver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: LegacyArchiveRepository,
    private readonly blobs: LegacyArchiveBlobStore,
  ) {}

  async archiveReports(
    runId: string,
    options: LegacyReportPolicyOptions,
  ): Promise<ReportArchiveResult> {
    const policy = buildLegacyReportPolicy(options);
    const reader = new LegacyReportSourceReader({
      fileRoots: options.fileRoots,
      httpHosts: policy.readableHttpHosts,
      maxBytes: options.maxBytes,
      httpTimeoutMs: options.httpTimeoutMs,
    });
    const result: ReportArchiveResult = {
      archived: 0,
      byClass: {},
      byReason: {},
      undetermined: [],
      copyFailed: [],
    };
    const skip = new Set<string>();

    for (;;) {
      const ids = (
        await this.archive.listUnarchivedIds(
          this.prisma,
          LEGACY_ARCHIVE_SOURCES.DOCUMENT_REQUEST,
          BATCH + skip.size,
        )
      ).filter((id) => !skip.has(id));
      if (ids.length === 0) break;
      for (const id of ids.slice(0, BATCH)) {
        const done = await this.archiveDocumentRequest(
          runId,
          id,
          policy,
          reader,
          result,
        );
        if (!done) skip.add(id);
      }
    }

    for (;;) {
      const ids = await this.archive.listUnarchivedIds(
        this.prisma,
        LEGACY_ARCHIVE_SOURCES.READINESS_EXPORT,
        BATCH,
      );
      if (ids.length === 0) break;
      for (const id of ids)
        await this.archiveReadinessExport(runId, id, result);
    }
    return result;
  }

  private async archiveDocumentRequest(
    runId: string,
    id: string,
    policy: LegacyReportPolicy,
    reader: LegacyReportSourceReader,
    result: ReportArchiveResult,
  ): Promise<boolean> {
    const row = await this.prisma.documentRequest.findUnique({
      where: { id },
      select: { status: true, documentUrl: true },
    });
    if (!row) return true;
    const reference = parseLegacyReportReference(row.documentUrl);
    let outcome = classifyLegacyReportReference(
      reference,
      row.status === DOCUMENT_REQUEST_STATUSES.ready,
      policy,
    );
    let blob: PendingBlob | null = null;
    if (outcome === null) {
      const read = await reader.read(reference);
      if (read.kind === "UNDETERMINED") {
        result.undetermined.push({
          source: LEGACY_ARCHIVE_SOURCES.DOCUMENT_REQUEST,
          sourceId: id,
        });
        return false;
      }
      let probe: LegacyReportProbe;
      if (read.kind === "BYTES") {
        const stored = await this.blobs.write(read.bytes);
        // Identity is proven twice: the stored bytes must hash to the source bytes' hash.
        probe =
          stored.contentSha256 === read.sha256 &&
          stored.sizeBytes === read.bytes.length
            ? {
                kind: "COPIED",
                sha256: stored.contentSha256,
                sizeBytes: stored.sizeBytes,
              }
            : { kind: "COPY_FAILED", reason: "COPY_VERIFICATION_MISMATCH" };
        if (probe.kind === "COPIED") blob = stored;
      } else if (read.kind === "COPY_FAILED") {
        probe = { kind: "COPY_FAILED", reason: read.reason };
      } else {
        probe = { kind: read.kind };
      }
      if (probe.kind === "COPY_FAILED") {
        result.copyFailed.push({
          source: LEGACY_ARCHIVE_SOURCES.DOCUMENT_REQUEST,
          sourceId: id,
          reason: probe.reason,
        });
        return false;
      }
      outcome = classifyLegacyReportProbe(probe);
    }
    await this.persist(
      runId,
      LEGACY_ARCHIVE_SOURCES.DOCUMENT_REQUEST,
      id,
      outcome,
      blob,
      result,
    );
    return true;
  }

  private async archiveReadinessExport(
    runId: string,
    id: string,
    result: ReportArchiveResult,
  ): Promise<void> {
    const row = await this.prisma.readinessExport.findUnique({
      where: { id },
      select: { status: true, contentJson: true },
    });
    if (!row) return;
    const outcome = classifyLegacyReadinessExport({
      status: row.status,
      hasContent: row.contentJson !== null,
    });
    await this.persist(
      runId,
      LEGACY_ARCHIVE_SOURCES.READINESS_EXPORT,
      id,
      outcome,
      null,
      result,
    );
  }

  private async persist(
    runId: string,
    source:
      | typeof LEGACY_ARCHIVE_SOURCES.DOCUMENT_REQUEST
      | typeof LEGACY_ARCHIVE_SOURCES.READINESS_EXPORT,
    sourceId: string,
    outcome: LegacyReportOutcome,
    blob: PendingBlob | null,
    result: ReportArchiveResult,
  ): Promise<void> {
    const inserted = await this.prisma.$transaction(async (tx) => {
      const recordId = await this.archive.insertReportRecord(tx, {
        runId,
        source,
        sourceId,
        reconciliationClass: outcome.reconciliationClass,
        reconciliationReason: outcome.reconciliationReason,
      });
      if (recordId && blob)
        await this.archive.insertBlob(tx, {
          recordId,
          contentSha256: blob.contentSha256,
          sizeBytes: blob.sizeBytes,
          storageRef: blob.storageRef,
          mediaType: null,
        });
      return recordId !== null;
    });
    if (!inserted) return;
    result.archived += 1;
    tally(result.byClass, outcome.reconciliationClass);
    tally(result.byReason, outcome.reconciliationReason);
  }
}

function tally<
  K extends
    LegacyArtifactReconciliationClass | LegacyArtifactReconciliationReason,
>(into: Partial<Record<K, number>>, key: K): void {
  into[key] = (into[key] ?? 0) + 1;
}
