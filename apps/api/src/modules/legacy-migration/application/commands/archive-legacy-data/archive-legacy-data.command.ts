import { Command } from "@nestjs/cqrs";

import type {
  ReportArchiveResult,
  LegacyReportPolicyOptions,
} from "../../legacy-migration.types.js";

export type ArchiveLegacyDataResult = {
  archivedBySource: Record<string, number>;
  reports: ReportArchiveResult;
  filesystemArtifacts: number;
  closedInFlight: Record<string, number>;
  terminalAssessmentsArchived: number;
};

/**
 * Archives V1 history (original rows first), reconciles report records, inventories filesystem
 * artifacts, then closes in-flight V1 work and writes terminal-assessment summaries.
 */
export class ArchiveLegacyDataCommand extends Command<ArchiveLegacyDataResult> {
  constructor(
    public readonly runId: string,
    public readonly report: LegacyReportPolicyOptions,
    public readonly filesystemArtifactDirs: readonly string[],
    public readonly correlationId: string,
  ) {
    super();
  }
}
