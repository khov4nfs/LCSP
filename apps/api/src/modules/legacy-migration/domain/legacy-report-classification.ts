import {
  LEGACY_ARTIFACT_RECONCILIATION_CLASSES as CLASS,
  LEGACY_ARTIFACT_RECONCILIATION_REASONS as REASON,
  LEGACY_PLACEHOLDER_STORAGE_HOSTS,
  type LegacyArtifactReconciliationClass,
  type LegacyArtifactReconciliationReason,
} from "@lcsp/contracts/legacy-migration";

import type { LegacyReportReference } from "./legacy-report-reference.js";

export type LegacyReportOutcome = {
  reconciliationClass: LegacyArtifactReconciliationClass;
  reconciliationReason: LegacyArtifactReconciliationReason;
};

/**
 * What reading the referenced location actually produced. Only `COPIED` carries bytes, and only
 * after the copy was re-read and its sha256/size were verified identical to the source bytes.
 */
export type LegacyReportProbe =
  | { kind: "COPIED"; sha256: string; sizeBytes: number }
  | { kind: "MISSING" }
  | { kind: "OUTSIDE_ALLOWED_ROOT" }
  | {
      kind: "COPY_FAILED";
      reason:
        | typeof REASON.COPY_IO_ERROR
        | typeof REASON.COPY_SIZE_LIMIT_EXCEEDED
        | typeof REASON.COPY_VERIFICATION_MISMATCH;
    };

export type LegacyReportPolicy = {
  /** Hosts an operator attested never held retained bytes (in addition to the built-in placeholder). */
  attestedNonPersistingHosts: ReadonlySet<string>;
  /** Hosts the archive is configured to fetch from (HTTP) — everything else is not readable. */
  readableHttpHosts: ReadonlySet<string>;
  /** True when a filesystem root is configured for `file:` references. */
  hasFileRoot: boolean;
};

const PLACEHOLDER_HOSTS: ReadonlySet<string> = new Set(
  LEGACY_PLACEHOLDER_STORAGE_HOSTS,
);

const outcome = (
  reconciliationClass: LegacyArtifactReconciliationClass,
  reconciliationReason: LegacyArtifactReconciliationReason,
): LegacyReportOutcome => ({ reconciliationClass, reconciliationReason });

/**
 * Decides without I/O whether the reference already has a definitive outcome. Returns `null` when
 * the location must be read (a configured, readable location that may hold persisted bytes).
 */
export function classifyLegacyReportReference(
  reference: LegacyReportReference,
  requestIsReady: boolean,
  policy: LegacyReportPolicy,
): LegacyReportOutcome | null {
  switch (reference.kind) {
    case "NONE":
      return outcome(
        CLASS.METADATA_ONLY_LEGACY_RECORD,
        requestIsReady
          ? REASON.READY_WITHOUT_REFERENCE
          : REASON.NO_ARTIFACT_REFERENCE,
      );
    case "MALFORMED":
      return outcome(
        CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
        REASON.MALFORMED_REFERENCE,
      );
    case "UNSUPPORTED_SCHEME":
      return outcome(
        CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
        REASON.UNSUPPORTED_REFERENCE_SCHEME,
      );
    case "FILE":
      return policy.hasFileRoot
        ? null
        : outcome(
            CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
            REASON.LOCATION_NOT_CONFIGURED,
          );
    case "HTTP":
      if (PLACEHOLDER_HOSTS.has(reference.host))
        return outcome(
          CLASS.NO_LEGACY_ARTIFACT_PRESENT,
          REASON.PLACEHOLDER_UPLOADER_NEVER_PERSISTED,
        );
      if (policy.attestedNonPersistingHosts.has(reference.host))
        return outcome(
          CLASS.NO_LEGACY_ARTIFACT_PRESENT,
          REASON.OPERATOR_ATTESTED_NON_PERSISTING,
        );
      return policy.readableHttpHosts.has(reference.host)
        ? null
        : outcome(
            CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
            REASON.LOCATION_NOT_CONFIGURED,
          );
  }
}

/** Maps the result of really reading a configured location to its class. Never invents presence. */
export function classifyLegacyReportProbe(
  probe: LegacyReportProbe,
): LegacyReportOutcome {
  switch (probe.kind) {
    case "COPIED":
      return outcome(
        CLASS.ARTIFACT_PRESENT_AND_COPIED,
        REASON.COPIED_AND_VERIFIED,
      );
    case "MISSING":
      return outcome(
        CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
        REASON.REFERENCE_TARGET_MISSING,
      );
    case "OUTSIDE_ALLOWED_ROOT":
      return outcome(
        CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE,
        REASON.REFERENCE_OUTSIDE_ALLOWED_ROOT,
      );
    case "COPY_FAILED":
      return outcome(CLASS.ARTIFACT_PRESENT_BUT_COPY_FAILED, probe.reason);
  }
}

/**
 * ReadinessExport keeps its content inline in the database row, so a GENERATED export with content
 * is a real persisted artifact (archived verbatim); anything else is metadata only.
 */
export function classifyLegacyReadinessExport(input: {
  status: string;
  hasContent: boolean;
}): LegacyReportOutcome {
  return input.status === "GENERATED" && input.hasContent
    ? outcome(CLASS.ARTIFACT_PRESENT_AND_COPIED, REASON.INLINE_CONTENT_ARCHIVED)
    : outcome(CLASS.METADATA_ONLY_LEGACY_RECORD, REASON.NO_INLINE_CONTENT);
}
