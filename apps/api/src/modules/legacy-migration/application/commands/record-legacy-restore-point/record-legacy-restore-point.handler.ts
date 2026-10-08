import { LEGACY_MIGRATION_ERROR_CODES } from "@lcsp/contracts/legacy-migration";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { LegacyArchiveRepository } from "../../../infrastructure/persistence/legacy-archive.repository.js";
import { LegacyMigrationError } from "../../legacy-migration.error.js";
import {
  CloseLegacyRestoreBoundaryCommand,
  RecordLegacyRestorePointCommand,
  type RestorePointResult,
} from "./record-legacy-restore-point.command.js";

const view = (run: {
  id: string;
  restorePointRef: string | null;
  restorePointVerifiedAt: Date | null;
  restoreBoundaryClosedAt: Date | null;
}): RestorePointResult => ({
  runId: run.id,
  restorePointRef: run.restorePointRef,
  verified: run.restorePointVerifiedAt !== null,
  boundaryClosed: run.restoreBoundaryClosedAt !== null,
});

@CommandHandler(RecordLegacyRestorePointCommand)
export class RecordLegacyRestorePointHandler implements ICommandHandler<RecordLegacyRestorePointCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: LegacyArchiveRepository,
  ) {}

  async execute(
    command: RecordLegacyRestorePointCommand,
  ): Promise<RestorePointResult> {
    const run = await this.prisma.legacyMigrationRun.findUnique({
      where: { id: command.runId },
    });
    if (!run)
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.RUN_NOT_FOUND,
        command.runId,
      );
    // After the first accepted V2 write the restore point is historical: it can no longer be (re)recorded.
    if ((await this.archive.restoreState()).boundaryClosedAt)
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.REQUEST_INVALID,
        "rollback boundary is closed; forward repair only",
      );
    const now = new Date();
    const updated = await this.prisma.legacyMigrationRun.update({
      where: { id: command.runId },
      data: {
        restorePointRef: command.ref,
        restorePointDigest: command.digest,
        restorePointRecordedAt: run.restorePointRecordedAt ?? now,
        restorePointVerifiedAt: command.verified
          ? now
          : run.restorePointVerifiedAt,
      },
    });
    return view(updated);
  }
}

@CommandHandler(CloseLegacyRestoreBoundaryCommand)
export class CloseLegacyRestoreBoundaryHandler implements ICommandHandler<CloseLegacyRestoreBoundaryCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    command: CloseLegacyRestoreBoundaryCommand,
  ): Promise<RestorePointResult> {
    const run = await this.prisma.legacyMigrationRun.findUnique({
      where: { id: command.runId },
    });
    if (!run)
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.RUN_NOT_FOUND,
        command.runId,
      );
    const updated = run.restoreBoundaryClosedAt
      ? run
      : await this.prisma.legacyMigrationRun.update({
          where: { id: command.runId },
          data: { restoreBoundaryClosedAt: new Date() },
        });
    return view(updated);
  }
}
