import type {
  LegacyArtifactReconciliationClass,
  LegacyArtifactReconciliationReason,
  LegacyMigrationPhase,
} from "@lcsp/contracts/legacy-migration";

/** Where (and whether) the archive may read V1 report bytes. Empty = nothing is readable. */
export type LegacyReportPolicyOptions = {
  fileRoots: readonly string[];
  httpHosts: readonly string[];
  attestedNonPersistingHosts: readonly string[];
  maxBytes: number;
  httpTimeoutMs: number;
};

export type LegacyMigrationExecution = {
  runId: string;
  phases: readonly LegacyMigrationPhase[];
  report: LegacyReportPolicyOptions;
  /** Directories of filesystem artifacts (rule cache/bundle exports) to inventory with hashes. */
  filesystemArtifactDirs: readonly string[];
  backfillBatchSize: number;
  sampleSize: number;
  correlationId: string;
};

export type ReportArchiveResult = {
  archived: number;
  byClass: Partial<Record<LegacyArtifactReconciliationClass, number>>;
  byReason: Partial<Record<LegacyArtifactReconciliationReason, number>>;
  /** Locations whose presence could not be established; left unarchived so a re-run can decide. */
  undetermined: { source: string; sourceId: string }[];
  /**
   * Artifacts that DO exist but could not be copied and verified. They are not recorded: the archive
   * stops before anything is closed or summarised, and a re-run (after the I/O or size limit is
   * fixed) resumes. Nothing is ever frozen over an incomplete archive.
   */
  copyFailed: { source: string; sourceId: string; reason: string }[];
};

/**
 * The migration prepares V2 state and starts nothing: there is deliberately no phase that enqueues a
 * Root command, calls a model or touches accounting. Re-evaluation is a separate, explicit action.
 */
export const DEFAULT_PHASES: readonly LegacyMigrationPhase[] = [
  "QUIESCE",
  "ARCHIVE",
  "BACKFILL",
  "VALIDATE",
];
