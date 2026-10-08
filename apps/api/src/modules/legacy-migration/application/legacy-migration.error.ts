import type { LEGACY_MIGRATION_ERROR_CODES } from "@lcsp/contracts/legacy-migration";

export type LegacyMigrationErrorCode =
  (typeof LEGACY_MIGRATION_ERROR_CODES)[keyof typeof LEGACY_MIGRATION_ERROR_CODES];

/** CLI/tooling failure with a stable code; the migration tooling has no HTTP surface for these. */
export class LegacyMigrationError extends Error {
  constructor(
    readonly code: LegacyMigrationErrorCode,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "LegacyMigrationError";
  }
}
