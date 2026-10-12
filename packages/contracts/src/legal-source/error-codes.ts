export const LEGAL_SOURCE_ERROR_CODES = {
  citationUnresolved: "RULE_CITATION_UNRESOLVED",
  citationRepealed: "RULE_CITATION_REPEALED",
  sourceSnapshotNotFound: "SOURCE_SNAPSHOT_NOT_FOUND",
  sourceSnapshotConflict: "SOURCE_SNAPSHOT_CONFLICT",
  activeLegalSourceNotFound: "ACTIVE_LEGAL_SOURCE_NOT_FOUND",
  legalSourceVersionNotFound: "LEGAL_SOURCE_VERSION_NOT_FOUND",
  legalSourceVersionAlreadyActivated: "LEGAL_SOURCE_VERSION_ALREADY_ACTIVATED",
  legalSourceIngestInvalid: "LEGAL_SOURCE_INGEST_INVALID",
} as const;
