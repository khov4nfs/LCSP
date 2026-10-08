import { randomUUID } from "node:crypto";

import {
  LEGACY_CORRELATION_PREFIXES,
  LEGACY_MIGRATION_AUDIT_EVENT_TYPES,
  LEGACY_MIGRATION_ERROR_CODES,
  LEGACY_MIGRATION_PHASES,
  LEGACY_MIGRATION_RUN_KINDS,
  LEGACY_MIGRATION_RUN_STATUSES,
  LEGACY_MIGRATION_TOOL_VERSION,
  type LegacyMigrationRunKind,
  type LegacyMigrationValidationReport,
} from "@lcsp/contracts/legacy-migration";
import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { Injectable } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { LegacyArchiveRepository } from "../../infrastructure/persistence/legacy-archive.repository.js";
import { LegacyValidationRepository } from "../../infrastructure/persistence/legacy-validation.repository.js";
import { ArchiveLegacyDataCommand } from "../commands/archive-legacy-data/archive-legacy-data.command.js";
import { BackfillLegacyAssessmentsCommand } from "../commands/backfill-legacy-assessments/backfill-legacy-assessments.command.js";
import { QuiesceLegacyRuntimeCommand } from "../commands/quiesce-legacy-runtime/quiesce-legacy-runtime.command.js";
import { LegacyMigrationError } from "../legacy-migration.error.js";
import type {
  LegacyMigrationExecution,
  LegacyReportPolicyOptions,
} from "../legacy-migration.types.js";
import {
  PreflightLegacyMigrationQuery,
  type PreflightReport,
} from "../queries/preflight-legacy-migration/preflight-legacy-migration.query.js";
import { ValidateLegacyMigrationQuery } from "../queries/validate-legacy-migration/validate-legacy-migration.query.js";
import { legacyAuditEvent } from "./legacy-audit.js";

export type ExecutionOutcome = {
  runId: string;
  phases: Record<string, unknown>;
  validation: LegacyMigrationValidationReport | null;
};

/** Orchestrates the cutover phases in their only safe order. Every phase is idempotent. */
@Injectable()
export class LegacyMigrationRunner {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    private readonly archive: LegacyArchiveRepository,
    private readonly validation: LegacyValidationRepository,
    private readonly audit: AuditWriterService,
  ) {}

  preflight(report: LegacyReportPolicyOptions): Promise<PreflightReport> {
    return this.queries.execute(new PreflightLegacyMigrationQuery(report));
  }

  /**
   * Opens a run: preflight, then the ledger row with the pre-migration V2 artifact fingerprint.
   * A CUTOVER refuses to start while any preflight blocker remains.
   */
  async start(
    kind: LegacyMigrationRunKind,
    report: LegacyReportPolicyOptions,
  ): Promise<{ runId: string; preflight: PreflightReport }> {
    const preflight = await this.preflight(report);
    if (
      kind === LEGACY_MIGRATION_RUN_KINDS.CUTOVER &&
      preflight.blockers.length > 0
    )
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.PREFLIGHT_BLOCKED,
        preflight.blockers.join(","),
      );
    const runId = await this.archive.createRun({
      kind,
      toolVersion: LEGACY_MIGRATION_TOOL_VERSION,
      parameters: { startedBy: "cli" },
    });
    await this.archive.recordPhase(runId, LEGACY_MIGRATION_PHASES.PREFLIGHT, {
      ...preflight,
      v2ArtifactFingerprint: await this.validation.v2ArtifactFingerprint(),
    });
    return { runId, preflight };
  }

  async execute(
    execution: LegacyMigrationExecution,
  ): Promise<ExecutionOutcome> {
    const run = await this.archive.findRun(execution.runId);
    if (!run)
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.RUN_NOT_FOUND,
        execution.runId,
      );
    const wanted = new Set(execution.phases);
    const outcome: ExecutionOutcome = {
      runId: run.id,
      phases: {},
      validation: null,
    };
    try {
      if (wanted.has(LEGACY_MIGRATION_PHASES.QUIESCE))
        outcome.phases.QUIESCE = await this.commands.execute(
          new QuiesceLegacyRuntimeCommand(run.id, execution.correlationId),
        );
      if (wanted.has(LEGACY_MIGRATION_PHASES.ARCHIVE))
        outcome.phases.ARCHIVE = await this.commands.execute(
          new ArchiveLegacyDataCommand(
            run.id,
            execution.report,
            execution.filesystemArtifactDirs,
            execution.correlationId,
          ),
        );
      if (wanted.has(LEGACY_MIGRATION_PHASES.BACKFILL))
        outcome.phases.BACKFILL = await this.commands.execute(
          new BackfillLegacyAssessmentsCommand(
            run.id,
            execution.backfillBatchSize,
            execution.correlationId,
          ),
        );
      if (wanted.has(LEGACY_MIGRATION_PHASES.VALIDATE))
        outcome.validation = await this.queries.execute(
          new ValidateLegacyMigrationQuery(run.id, execution.sampleSize),
        );
    } catch (error) {
      await this.archive.finishRun(
        run.id,
        LEGACY_MIGRATION_RUN_STATUSES.FAILED,
      );
      throw error;
    }

    const failed = (outcome.validation?.summary.blockingFailures ?? 0) > 0;
    await this.archive.finishRun(
      run.id,
      failed
        ? LEGACY_MIGRATION_RUN_STATUSES.FAILED
        : LEGACY_MIGRATION_RUN_STATUSES.COMPLETED,
    );
    await this.audit.write(
      legacyAuditEvent({
        eventType:
          LEGACY_MIGRATION_AUDIT_EVENT_TYPES.LEGACY_MIGRATION_RUN_COMPLETED,
        correlationId: execution.correlationId,
        resourceType: AUDIT_RESOURCE_TYPES.assessment,
        resourceId: null,
        payload: {
          runId: run.id,
          phases: [...wanted],
          blockingFailures:
            outcome.validation?.summary.blockingFailures ?? null,
        },
      }),
    );
    return outcome;
  }

  static newCorrelationId(): string {
    return `${LEGACY_CORRELATION_PREFIXES.MIGRATION}${randomUUID()}`;
  }
}
