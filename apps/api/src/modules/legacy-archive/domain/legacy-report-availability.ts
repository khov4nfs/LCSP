import {
  LEGACY_ARTIFACT_AVAILABILITIES,
  LEGACY_ARTIFACT_RECONCILIATION_CLASSES as CLASS,
  type LegacyArtifactReconciliationClass,
} from "@lcsp/contracts/legacy-migration";

type Availability =
  (typeof LEGACY_ARTIFACT_AVAILABILITIES)[keyof typeof LEGACY_ARTIFACT_AVAILABILITIES];

/**
 * What the customer can do with one archived V1 report record. Derived only from the recorded
 * reconciliation class, so it can never promise bytes the archive does not hold.
 */
export function availabilityOf(
  reconciliationClass: LegacyArtifactReconciliationClass,
): Availability {
  switch (reconciliationClass) {
    case CLASS.ARTIFACT_PRESENT_AND_COPIED:
      return LEGACY_ARTIFACT_AVAILABILITIES.DOWNLOADABLE;
    case CLASS.NO_LEGACY_ARTIFACT_PRESENT:
      return LEGACY_ARTIFACT_AVAILABILITIES.NOT_RETAINED;
    case CLASS.METADATA_ONLY_LEGACY_RECORD:
      return LEGACY_ARTIFACT_AVAILABILITIES.METADATA_ONLY;
    case CLASS.ARTIFACT_PRESENT_BUT_COPY_FAILED:
    case CLASS.INVALID_OR_ORPHANED_LEGACY_REFERENCE:
      return LEGACY_ARTIFACT_AVAILABILITIES.UNAVAILABLE;
  }
}

const MEDIA_TYPES: Readonly<
  Record<string, { mediaType: string; extension: string }>
> = {
  ".md": { mediaType: "text/markdown; charset=utf-8", extension: "md" },
  ".markdown": { mediaType: "text/markdown; charset=utf-8", extension: "md" },
  ".pdf": { mediaType: "application/pdf", extension: "pdf" },
  ".json": { mediaType: "application/json", extension: "json" },
  ".txt": { mediaType: "text/plain; charset=utf-8", extension: "txt" },
  ".docx": {
    mediaType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
};

const OCTET_STREAM = {
  mediaType: "application/octet-stream",
  extension: "bin",
};

/** Picks a download type from the ORIGINAL reference's extension; unknown types stay opaque. */
export function mediaTypeForReference(documentUrl: string | null): {
  mediaType: string;
  extension: string;
} {
  if (!documentUrl) return OCTET_STREAM;
  let pathname: string;
  try {
    pathname = new URL(documentUrl).pathname.toLowerCase();
  } catch {
    return OCTET_STREAM;
  }
  const dot = pathname.lastIndexOf(".");
  return (
    (dot >= 0 ? MEDIA_TYPES[pathname.slice(dot)] : undefined) ?? OCTET_STREAM
  );
}

/**
 * Archived `timestamp without time zone` values are UTC (Prisma writes UTC); the JSON copy carries
 * no zone, so one is attached here.
 */
export function utcIso(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const parsed = new Date(
    /[zZ]|[+-]\d{2}:?\d{2}$/u.test(value) ? value : `${value}Z`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
