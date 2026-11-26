import { ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION } from "@lcsp/contracts/assessment-domain";
import type { AssessmentFinalReportArtifactVersioned } from "@lcsp/contracts/assessment-report";

/** The primary repository coordinates every report version records, whatever its format. */
export interface ReportPrimaryPin {
  repositorySnapshotId: string;
  repositoryScanJobId: string;
  repositoryCommit: string;
}

/**
 * Business purpose: Read which repository a stored report treats as the assessment's primary one, so integrity
 * checks compare the same coordinates the case and artifact rows record regardless of the report version.
 * Business rules:
 * - Reports written for one repository (V1-V3) carry the primary coordinates directly in their pins.
 * - A multi-repository report (V4) records them as the first, ordinal-0 repository of its pinned set.
 * Execution flow:
 * 1. Return the first pinned repository of a V4 report.
 * 2. Otherwise return the pinned coordinates of the report.
 * Failure cases:
 * - A V4 report without a first repository cannot pass its schema, so none reaches this function.
 * Side effects:
 * - None; pure projection.
 */
export function reportPrimaryPin(
  report: AssessmentFinalReportArtifactVersioned,
): ReportPrimaryPin {
  if (report.schemaVersion === ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION) {
    const [primary] = report.pins.repositories;
    if (!primary) throw new Error("Final report has no pinned repository");
    return {
      repositorySnapshotId: primary.repositorySnapshotId,
      repositoryScanJobId: primary.repositoryScanJobId,
      repositoryCommit: primary.repositoryCommit,
    };
  }
  return {
    repositorySnapshotId: report.pins.repositorySnapshotId,
    repositoryScanJobId: report.pins.repositoryScanJobId,
    repositoryCommit: report.pins.repositoryCommit,
  };
}

/**
 * Business purpose: Confirm that a report's identity block repeats the repositories it pins.
 * Business rules:
 * - A single-repository report repeats the pinned snapshot and commit (commits compare case-insensitively).
 * - A multi-repository report repeats its set digest; its per-repository identity is checked by its schema.
 * Execution flow:
 * 1. Branch on the report format and compare the identity with the pins.
 * Failure cases:
 * - Returns false on any disagreement; the caller rejects the report as damaged.
 * Side effects:
 * - None; pure comparison.
 */
export function reportIdentityMatchesPins(
  report: Extract<
    AssessmentFinalReportArtifactVersioned,
    { identity: unknown }
  >,
): boolean {
  if (report.schemaVersion === ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION) {
    return (
      report.identity.repositorySetDigest === report.pins.repositorySetDigest
    );
  }
  return (
    report.identity.repositorySnapshotId === report.pins.repositorySnapshotId &&
    report.identity.repositoryCommit.toLowerCase() ===
      report.pins.repositoryCommit.toLowerCase()
  );
}

/**
 * Business purpose: Prove a stored multi-repository report still describes the repositories the assessment is
 * pinned to, so a report cannot be served or replayed against a different set of code.
 * Business rules:
 * - The report's set digest must equal the digest the case and the artifact row recorded.
 * - Every pinned repository's source prefix must still equal its authoritative snapshot's prefix.
 * Execution flow:
 * 1. Compare the report digest with the recorded digests.
 * 2. Read each pinned snapshot and compare its source prefix.
 * Failure cases:
 * - A digest mismatch, a missing snapshot or a drifted prefix throws; callers translate it to an integrity failure.
 * Side effects:
 * - Read-only snapshot lookups through the supplied reader.
 */
export async function assertReportRepositorySetCurrent(
  report: Extract<
    AssessmentFinalReportArtifactVersioned,
    { schemaVersion: typeof ASSESSMENT_FINAL_REPORT_V4_SCHEMA_VERSION }
  >,
  recorded: ReadonlyArray<string | null | undefined>,
  readSnapshot: (
    snapshotId: string,
  ) => Promise<{ sourcePathPrefix: string | null } | null>,
): Promise<void> {
  if (recorded.some((digest) => digest !== report.pins.repositorySetDigest)) {
    throw new Error(
      "Final report repository set does not match the pinned set",
    );
  }
  for (const pin of report.pins.repositories) {
    const snapshot = await readSnapshot(pin.repositorySnapshotId);
    if (!snapshot) {
      throw new Error("Final report pinned repository snapshot not found");
    }
    if ((snapshot.sourcePathPrefix ?? null) !== pin.sourcePathPrefix) {
      throw new Error(
        "Final report source path prefix does not match authoritative repository snapshot",
      );
    }
  }
}
