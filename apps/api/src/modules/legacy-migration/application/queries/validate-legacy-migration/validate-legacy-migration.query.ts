import type { LegacyMigrationValidationReport } from "@lcsp/contracts/legacy-migration";
import { Query } from "@nestjs/cqrs";

/** Read-only reconciliation of one migration run: counts, hashes, FKs, pins, artifacts, boundary. */
export class ValidateLegacyMigrationQuery extends Query<LegacyMigrationValidationReport> {
  constructor(
    public readonly runId: string,
    /** Archived rows deep-compared per source by an independent implementation. */
    public readonly sampleSize: number,
  ) {
    super();
  }
}
