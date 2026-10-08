import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  LEGACY_CLOSURE_MARKERS,
  LEGACY_MIGRATION_AUDIT_EVENT_TYPES,
  LEGACY_MIGRATION_ERROR_CODES,
} from "@lcsp/contracts/legacy-migration";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { SQL_ARCHIVE_SOURCES } from "../../../infrastructure/persistence/legacy-archive-registry.js";
import { LegacyArchiveRepository } from "../../../infrastructure/persistence/legacy-archive.repository.js";
import { LegacyMigrationError } from "../../legacy-migration.error.js";
import { legacyAuditEvent } from "../../services/legacy-audit.js";
import { LegacyReportArchiver } from "../../services/legacy-report-archiver.service.js";
import {
  ArchiveLegacyDataCommand,
  type ArchiveLegacyDataResult,
} from "./archive-legacy-data.command.js";

@CommandHandler(ArchiveLegacyDataCommand)
export class ArchiveLegacyDataHandler implements ICommandHandler<ArchiveLegacyDataCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: LegacyArchiveRepository,
    private readonly reports: LegacyReportArchiver,
    private readonly audit: AuditWriterService,
  ) {}

  async execute(
    command: ArchiveLegacyDataCommand,
  ): Promise<ArchiveLegacyDataResult> {
    const archivedBySource: Record<string, number> = {};
    // 1. Original rows first (set-based, idempotent). Nothing below mutates V1 until this is done.
    for (const rule of SQL_ARCHIVE_SOURCES)
      archivedBySource[rule.source] = await this.archive.archiveSqlSource(
        this.prisma,
        command.runId,
        rule,
      );

    // 2. Report-related records: reconciliation decides class/reason, bytes only if really present.
    const reports = await this.reports.archiveReports(
      command.runId,
      command.report,
    );

    if (reports.undetermined.length > 0 || reports.copyFailed.length > 0) {
      // Presence is unknown, or an existing artifact could not be copied and verified. Closing V1
      // work or writing summaries now would freeze an incomplete archive, so stop; a re-run resumes.
      await this.archive.recordPhase(command.runId, "ARCHIVE", {
        archivedBySource,
        reports,
        incomplete: true,
      });
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_INCOMPLETE,
        `${reports.undetermined.length} report location(s) could not be inspected and ${reports.copyFailed.length} persisted artifact(s) could not be copied (${
          [
            ...new Set(reports.copyFailed.map((failure) => failure.reason)),
          ].join(", ") || "no copy failure"
        }); fix and re-run`,
      );
    }

    // 3. Operator-supplied filesystem artifacts (rule cache/bundle exports): path, size, real hash.
    const filesystemArtifacts = await this.inventoryFilesystemArtifacts(
      command.runId,
      command.filesystemArtifactDirs,
    );

    // 4. Close in-flight V1 work. The UPDATE itself requires the archived original to exist.
    const closedInFlight: Record<string, number> = {};
    for (const rule of this.archive.closureRules())
      closedInFlight[rule.source] = await this.archive.closeInFlight(
        this.prisma,
        rule,
        LEGACY_CLOSURE_MARKERS.CUTOVER_CANCELLED,
      );

    // 5. Terminal V1 assessments: read-only summary, no V2 lifecycle, audited.
    const archivedTerminal = await this.prisma.$transaction(async (tx) => {
      const ids = await this.archive.archiveTerminalAssessments(
        tx,
        command.runId,
      );
      for (const assessmentId of ids)
        await this.audit.writeInTx(
          legacyAuditEvent({
            eventType:
              LEGACY_MIGRATION_AUDIT_EVENT_TYPES.LEGACY_ASSESSMENT_ARCHIVED,
            correlationId: command.correlationId,
            resourceType: AUDIT_RESOURCE_TYPES.assessment,
            resourceId: assessmentId,
            assessmentId,
            payload: { runId: command.runId },
          }),
          tx,
        );
      return ids.length;
    });

    const result: ArchiveLegacyDataResult = {
      archivedBySource,
      reports,
      filesystemArtifacts,
      closedInFlight,
      terminalAssessmentsArchived: archivedTerminal,
    };
    await this.archive.recordPhase(command.runId, "ARCHIVE", result);
    return result;
  }

  private async inventoryFilesystemArtifacts(
    runId: string,
    directories: readonly string[],
  ): Promise<number> {
    let inserted = 0;
    for (const directory of directories) {
      const root = await fs.promises.realpath(directory);
      for (const file of await listFiles(root)) {
        const bytes = await fs.promises.readFile(file);
        const relative = path.relative(root, file).split(path.sep).join("/");
        inserted += await this.archive.archiveFilesystemArtifact(this.prisma, {
          runId,
          // The directory label keeps two exports with the same relative path distinct.
          sourceId: `${path.basename(root)}:${relative}`,
          payload: {
            relativePath: relative,
            sizeBytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        });
      }
    }
    return inserted;
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.promises.readdir(directory, {
    withFileTypes: true,
  })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found.sort();
}
