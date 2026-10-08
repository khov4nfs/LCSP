import {
  LEGACY_ARCHIVE_SOURCES,
  LEGACY_ARTIFACT_AVAILABILITIES,
  LEGACY_TERMINAL_ASSESSMENT_STATUSES,
} from "@lcsp/contracts/legacy-migration";
import type { MessageKey } from "@lcsp/i18n";

/** Message keys for the archive panel, indexed by contract codes so no domain string is repeated. */
export const LEGACY_AVAILABILITY_LABEL_KEYS = {
  [LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE]:
    "pages.legacyArchive.availability.DOWNLOADABLE",
  [LEGACY_ARTIFACT_AVAILABILITIES.NOT_RETAINED]:
    "pages.legacyArchive.availability.NOT_RETAINED",
  [LEGACY_ARTIFACT_AVAILABILITIES.METADATA_ONLY]:
    "pages.legacyArchive.availability.METADATA_ONLY",
  [LEGACY_ARTIFACT_AVAILABILITIES.UNAVAILABLE]:
    "pages.legacyArchive.availability.UNAVAILABLE",
} as const satisfies Record<
  (typeof LEGACY_ARTIFACT_AVAILABILITIES)[keyof typeof LEGACY_ARTIFACT_AVAILABILITIES],
  MessageKey
>;

export const LEGACY_AVAILABILITY_DETAIL_KEYS = {
  [LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE]:
    "pages.legacyArchive.availabilityDetail.DOWNLOADABLE",
  [LEGACY_ARTIFACT_AVAILABILITIES.NOT_RETAINED]:
    "pages.legacyArchive.availabilityDetail.NOT_RETAINED",
  [LEGACY_ARTIFACT_AVAILABILITIES.METADATA_ONLY]:
    "pages.legacyArchive.availabilityDetail.METADATA_ONLY",
  [LEGACY_ARTIFACT_AVAILABILITIES.UNAVAILABLE]:
    "pages.legacyArchive.availabilityDetail.UNAVAILABLE",
} as const satisfies Record<
  (typeof LEGACY_ARTIFACT_AVAILABILITIES)[keyof typeof LEGACY_ARTIFACT_AVAILABILITIES],
  MessageKey
>;

export const LEGACY_STATUS_LABEL_KEYS = {
  [LEGACY_TERMINAL_ASSESSMENT_STATUSES.READY_FOR_REVIEW]:
    "pages.legacyArchive.statuses.READY_FOR_REVIEW",
  [LEGACY_TERMINAL_ASSESSMENT_STATUSES.AI_NOT_DETECTED]:
    "pages.legacyArchive.statuses.AI_NOT_DETECTED",
} as const satisfies Record<
  (typeof LEGACY_TERMINAL_ASSESSMENT_STATUSES)[keyof typeof LEGACY_TERMINAL_ASSESSMENT_STATUSES],
  MessageKey
>;

const DOCUMENT_TYPE_KEYS: Readonly<Record<string, MessageKey>> = {
  FINAL_REPORT: "pages.legacyArchive.documentTypes.FINAL_REPORT",
  GAP_ANALYSIS: "pages.legacyArchive.documentTypes.GAP_ANALYSIS",
  [LEGACY_ARCHIVE_SOURCES.READINESS_EXPORT]:
    "pages.legacyArchive.documentTypes.READINESS_EXPORT",
};

export function legacyDocumentTypeKey(documentType: string | null): MessageKey {
  return (
    (documentType ? DOCUMENT_TYPE_KEYS[documentType] : undefined) ??
    "pages.legacyArchive.documentTypes.OTHER"
  );
}

export function legacyStatusKey(status: string): MessageKey | null {
  return (
    (LEGACY_STATUS_LABEL_KEYS as Readonly<Record<string, MessageKey>>)[
      status
    ] ?? null
  );
}
