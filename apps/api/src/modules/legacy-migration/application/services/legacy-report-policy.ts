import type { LegacyReportPolicy } from "../../domain/legacy-report-classification.js";
import type { LegacyReportPolicyOptions } from "../legacy-migration.types.js";

/** One policy shape for preflight and archive, so they can never disagree about a location. */
export function buildLegacyReportPolicy(
  options: LegacyReportPolicyOptions,
): LegacyReportPolicy {
  return {
    attestedNonPersistingHosts: new Set(
      options.attestedNonPersistingHosts.map((host) => host.toLowerCase()),
    ),
    readableHttpHosts: new Set(
      options.httpHosts.map((host) => host.toLowerCase()),
    ),
    hasFileRoot: options.fileRoots.length > 0,
  };
}
